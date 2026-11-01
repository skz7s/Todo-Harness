import { withDefaultModelInput } from '../domain/model-input.js';

function providerDefaultInput(namespace, path) {
  const user = path.reduce((value, key) => value?.[key], namespace.user);
  const base = path.reduce((value, key) => value?.[key], namespace.base);
  return user?.defaultInput ?? base?.defaultInput;
}

export function modelInputDefaultOps(namespace, providers) {
  const ops = [];
  for (const entry of providers) {
    if (entry.settingsNs !== namespace.ns || entry.declared !== true) continue;
    const profile = entry.settingsPath.reduce((value, key) => value?.[key], namespace.value);
    if (!profile || providerDefaultInput(namespace, entry.settingsPath) !== undefined) continue;
    if (!Array.isArray(profile.models)) continue;
    for (const [index, model] of profile.models.entries()) {
      const next = withDefaultModelInput(model);
      if (next !== model) ops.push({ op: 'set', path: [...entry.settingsPath, 'models', String(index), 'input'], value: next.input });
    }
  }
  return ops;
}

export function modelReasoningDefaultOps(namespace, providers) {
  const ops = [];
  for (const entry of providers) {
    if (entry.settingsNs !== namespace.ns || entry.declared !== true) continue;
    const profile = entry.settingsPath.reduce((value, key) => value?.[key], namespace.value);
    if (!['openai-responses', 'openai-completions'].includes(profile?.api) || !Array.isArray(profile.models)) continue;
    for (const [index, model] of profile.models.entries()) {
      if (model.reasoningEfforts !== undefined) continue;
      if (profile.api === 'openai-completions' && (model.compat?.supportsReasoningEffort ?? profile.compat?.supportsReasoningEffort) === false) continue;
      const id = model.id?.toLowerCase() ?? '';
      if (!/^(?:gpt-[5-9](?:[.-]|$)|o[1-9](?:[.-]|$))/.test(id) || /(?:^|-)chat(?:-|$)/.test(id)) continue;
      const levels = /(?:^|-)pro(?:-|$)/.test(id) ? ['high'] : ['low', 'medium', 'high'];
      ops.push({
        op: 'set', path: [...entry.settingsPath, 'models', String(index), 'reasoningEfforts'],
        value: Object.fromEntries(levels.map((level) => [level, level]))
      });
    }
  }
  return ops;
}

export function installModelDefaults(ctx) {
  const { llm, settings } = ctx;
  const originalDiscover = llm.discoverModels;
  const discover = async function discoverWithInputDefaults(namespace, ...args) {
    const models = await originalDiscover.call(this, namespace, ...args);
    if (namespace !== 'llm-pi-ai') return models;
    const provider = llm.listConfigurableProviders().find((entry) => entry.settingsNs === namespace && entry.provider === args[0]?.provider);
    const descriptor = provider && settings.describe({ redactSecrets: true }).find((entry) => entry.ns === namespace);
    const fallback = descriptor && providerDefaultInput(descriptor, provider.settingsPath);
    return models.map((model) => {
      if (model.inputModalities?.length) return model;
      return fallback?.length ? { ...model, inputModalities: [...fallback] } : withDefaultModelInput(model, 'inputModalities');
    });
  };
  llm.discoverModels = discover;

  let active = true;
  let running = false;
  let dirty = false;
  const reconcile = async () => {
    dirty = true;
    if (running || !active) return;
    running = true;
    try {
      do {
        dirty = false;
        if (!settings.writable) break;
        const namespace = settings.describe({ redactSecrets: true }).find((entry) => entry.ns === 'llm-pi-ai');
        if (!namespace) break;
        const providers = llm.listConfigurableProviders();
        const ops = [...modelInputDefaultOps(namespace, providers), ...modelReasoningDefaultOps(namespace, providers)];
        if (!ops.length || !active) continue;
        try {
          await settings.mutate(namespace.ns, ops, namespace.revision);
        } catch (error) {
          // A concurrent editor owns the new revision; its next event retries.
          if (error.code !== 'SETTINGS_CONFLICT') throw error;
        }
      } while (dirty && active);
    } catch (error) {
      ctx.logger.warn('Could not apply model capability defaults: %s', error.message);
    } finally {
      running = false;
    }
  };
  const disposers = [
    ctx.on('settings/document-updated', (namespace) => { if (namespace === 'llm-pi-ai') void reconcile(); }),
    ctx.on('llm/adapters-updated', () => { void reconcile(); })
  ];
  void reconcile();
  return () => {
    active = false;
    for (const dispose of disposers) dispose();
    if (llm.discoverModels === discover) llm.discoverModels = originalDiscover;
  };
}
