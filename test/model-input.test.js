import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultModelInput, withDefaultModelInput } from '../src/domain/model-input.js';
import { installModelDefaults, modelInputDefaultOps, modelReasoningDefaultOps } from '../src/plugins/model-defaults.js';

test('known image models match versions, provider prefixes, case, and deployment suffixes', () => {
  const models = [
    'openai/gpt-4o-mini-2024-07-18', 'GPT_4.1_NANO', 'gpt-4.5-preview',
    'gpt-4-turbo-2024-04-09', 'gpt-4-vision-preview', 'gpt-5.4-mini', 'gpt-6.1-sol', 'gpt-6.1-terra',
    'o1-2024-12-17', 'o3-pro', 'o4-mini-2025-04-16',
    'anthropic/claude-3.5-sonnet-20241022', 'claude-3-7-sonnet-latest',
    'claude-haiku-4-5-20251001', 'claude-opus-4.6', 'claude-fable-5-1',
    'moonshotai/Kimi-K2.5', 'kimi-k2.6-0905', 'kimi-k2.7-code-highspeed', 'kimi-k3', 'kimi-vision-preview',
    'Qwen/Qwen2.5-VL-72B-Instruct-AWQ', 'qwen-vl-max-2025-08-13', 'qwen3-vl-8b-thinking',
    'qwen2.5-omni-7b', 'qwen3.5-27b', 'qwen3.6-plus', 'qwen3.7-flash', 'qwen3.8-max-0902',
    'z-ai/glm-4v-9b', 'THUDM/GLM-4.1V-9B-Thinking', 'glm-4.6v-flash', 'glm-5v-turbo', 'glm-5.3-flashx',
    'deepseek-ai/deepseek-vl2-small', 'deepseek-ocr-2', 'deepseek-v4-flash-vision-exp', 'deepseek-v4.1-flash-0901', 'deepseek-flash',
    'xiaomi/MiMo-V2.5', 'mino-v2.5-20260901', 'mimo-v2-omni', 'mimo-v2.6-pro-ultraspeed',
    'MiniMax-VL-01', 'minimax-m3-0901', 'google/gemini-2.5-flash', 'gemini-3.1-pro-preview',
    'pixtral-12b-2409', 'meta-llama/Llama-3.2-11B-Vision-Instruct'
  ];
  for (const model of models) assert.deepEqual(defaultModelInput(model), ['text', 'image'], model);
});

test('text-only variants and unrecognized models never gain image input from a family keyword', () => {
  const models = [
    'gpt-3.5-turbo', 'gpt-4', 'gpt-4-0613', 'gpt-4-1106-preview', 'gpt-4o-audio-preview', 'gpt-4o-mini-tts',
    'gpt-4o-transcribe', 'gpt-5-text-only', 'gpt-7-unknown', 'notgpt-4o', 'o1-mini', 'o1-preview', 'o3-mini',
    'claude-2.1', 'claude-instant-1.2', 'claude-unknown', 'kimi-k2-instruct-0905', 'kimi-k2-thinking',
    'moonshot-v1-128k', 'kimi-latest', 'kimi-k2.50-unknown', 'qwen3-235b-a22b', 'qwen-plus',
    'qwen3-coder-plus', 'qwen3.5-coder-32b', 'qwen3.6-max-preview', 'qwen3.7-max', 'qwen3.8-2.4t-a95b',
    'qwen4-future', 'glm-4-plus', 'glm-4.7', 'glm-5', 'glm-5.3', 'glm-5.3-highspeed',
    'deepseek-chat', 'deepseek-reasoner', 'deepseek-r1-0528', 'deepseek-v3.2', 'deepseek-v4-flash', 'deepseek-v4-pro',
    'mimo-v2-flash', 'mimo-v2-pro', 'mimo-v2.5-pro', 'mimo-v2.5-pro-ultraspeed',
    'mino-unknown', 'MiniMax-M2.7-highspeed', 'text-embedding-3-large', 'qwen3-vl-embedding',
    'unknown-vision-model', 'my-company-gpt', 'custom-model', '', undefined
  ];
  for (const model of models) assert.deepEqual(defaultModelInput(model), ['text'], String(model));
});

test('explicit model modalities take precedence over name-based defaults', () => {
  const disabled = { id: 'gpt-6.1-sol', input: ['text'] };
  const enabled = { id: 'custom-model', input: ['text', 'image'] };
  assert.equal(withDefaultModelInput(disabled), disabled);
  assert.equal(withDefaultModelInput(enabled), enabled);
  assert.deepEqual(withDefaultModelInput({ id: 'gpt-6.1-sol', input: [] }).input, ['text', 'image']);
  const advertised = { id: 'gpt-4o', inputModalities: ['text'] };
  assert.equal(withDefaultModelInput(advertised, 'inputModalities'), advertised);
});

function fixture() {
  const profiles = {
    gateway: { api: 'openai-responses', models: [{ id: 'gpt-6.1-sol' }, { id: 'qwen3-32b' }, { id: 'gpt-4o', input: ['text'] }, { id: 'custom', input: ['text', 'image'] }] },
    manual: { defaultInput: ['text'], models: [{ id: 'gpt-4o' }] },
    inherited: { defaultInput: ['text', 'image'], models: [{ id: 'unknown' }] },
    official: { models: [{ id: 'gpt-4o' }] }
  };
  const namespace = {
    ns: 'llm-pi-ai', revision: 7, value: { providers: profiles },
    user: { providers: { gateway: profiles.gateway, manual: profiles.manual } },
    base: { providers: { inherited: profiles.inherited } }
  };
  const providers = Object.keys(profiles).map((provider) => ({
    provider, settingsNs: namespace.ns, settingsPath: ['providers', provider], declared: provider !== 'official'
  }));
  return { namespace, providers, profiles };
}

test('settings defaults use minimal paths and leave explicit provider, model, and built-in catalog values intact', () => {
  const { namespace, providers } = fixture();
  assert.deepEqual(modelInputDefaultOps(namespace, providers), [
    { op: 'set', path: ['providers', 'gateway', 'models', '0', 'input'], value: ['text', 'image'] },
    { op: 'set', path: ['providers', 'gateway', 'models', '1', 'input'], value: ['text'] }
  ]);
});

test('reasoning defaults restore custom OpenAI model capabilities and preserve explicit mappings and protocol opt-outs', () => {
  const profiles = {
    gateway: { api: 'openai-responses', models: [
      { id: 'gpt-6.1-sol' }, { id: 'gpt-5-pro' }, { id: 'o3-mini' },
      { id: 'gpt-4.1' }, { id: 'gpt-5-chat-latest' }, { id: 'custom-model' },
      { id: 'gpt-6-astra', reasoningEfforts: false },
      { id: 'gpt-6-sol', reasoningEfforts: { high: 'enabled', xhigh: 'extra' } }
    ] },
    completions: { api: 'openai-completions', models: [{ id: 'gpt-5.5' }] },
    unsupported: { api: 'anthropic-messages', models: [{ id: 'gpt-6.1-sol' }] },
    disabled: { api: 'openai-completions', compat: { supportsReasoningEffort: false }, models: [
      { id: 'gpt-6.1-sol' }, { id: 'gpt-6-sol', compat: { supportsReasoningEffort: true } }
    ] },
    modelDisabled: { api: 'openai-completions', models: [{ id: 'gpt-6.1-sol', compat: { supportsReasoningEffort: false } }] },
    official: { api: 'openai-responses', models: [{ id: 'gpt-6.1-sol' }] }
  };
  const namespace = { ns: 'llm-pi-ai', value: { providers: profiles } };
  const providers = Object.keys(profiles).map((provider) => ({
    provider, settingsNs: namespace.ns, settingsPath: ['providers', provider], declared: provider !== 'official'
  }));
  const standard = { low: 'low', medium: 'medium', high: 'high' };
  assert.deepEqual(modelReasoningDefaultOps(namespace, providers), [
    { op: 'set', path: ['providers', 'gateway', 'models', '0', 'reasoningEfforts'], value: standard },
    { op: 'set', path: ['providers', 'gateway', 'models', '1', 'reasoningEfforts'], value: { high: 'high' } },
    { op: 'set', path: ['providers', 'gateway', 'models', '2', 'reasoningEfforts'], value: standard },
    { op: 'set', path: ['providers', 'completions', 'models', '0', 'reasoningEfforts'], value: standard },
    { op: 'set', path: ['providers', 'disabled', 'models', '1', 'reasoningEfforts'], value: standard }
  ]);
});

test('model defaults persist for existing and newly saved models, preserve manual opt-outs, and enrich image discovery', async () => {
  const { namespace, providers, profiles } = fixture();
  const listeners = new Map();
  const writes = [];
  const discovered = [{ id: 'gpt-4o' }, { id: 'deepseek-v3' }, { id: 'custom', inputModalities: ['image'] }, { id: 'gpt-5', inputModalities: ['text'] }];
  const llm = { discoverModels: async () => discovered, listConfigurableProviders: () => providers };
  const original = llm.discoverModels;
  const emit = (event, ...args) => listeners.get(event)?.(...args);
  const ctx = {
    llm,
    settings: {
      writable: true,
      describe: () => [namespace],
      mutate: async (ns, ops, revision) => {
        assert.equal(ns, namespace.ns);
        assert.equal(revision, namespace.revision);
        writes.push(ops);
        for (const op of ops) {
          const parent = op.path.slice(0, -1).reduce((value, key) => value[key], namespace.value);
          parent[op.path.at(-1)] = op.value;
        }
        namespace.revision++;
        emit('settings/document-updated', ns);
      }
    },
    on: (event, listener) => { listeners.set(event, listener); return () => listeners.delete(event); },
    logger: { warn: (message) => assert.fail(message) }
  };
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const dispose = installModelDefaults(ctx);
  await flush();
  assert.equal(writes.length, 1);
  assert.deepEqual(profiles.gateway.models[0].input, ['text', 'image']);
  assert.deepEqual(profiles.gateway.models[0].reasoningEfforts, { low: 'low', medium: 'medium', high: 'high' });
  profiles.gateway.models.push({ id: 'glm-4.6v' });
  profiles.gateway.models.push({ id: 'gpt-6-luna' });
  profiles.gateway.models[0].input = ['text'];
  profiles.gateway.models[0].reasoningEfforts = false;
  emit('settings/document-updated', namespace.ns);
  await flush();
  assert.equal(writes.length, 2);
  assert.deepEqual(profiles.gateway.models.at(-1).input, ['text', 'image']);
  assert.deepEqual(profiles.gateway.models.at(-1).reasoningEfforts, { low: 'low', medium: 'medium', high: 'high' });
  assert.deepEqual(profiles.gateway.models[0].input, ['text']);
  assert.equal(profiles.gateway.models[0].reasoningEfforts, false);
  const result = await llm.discoverModels('llm-pi-ai', {});
  assert.deepEqual(result.map((model) => model.inputModalities), [['text', 'image'], ['text'], ['image'], ['text']]);
  assert.equal(discovered[0].inputModalities, undefined);
  assert.equal(await llm.discoverModels('other-adapter', {}), discovered);
  const manual = await llm.discoverModels('llm-pi-ai', { provider: 'manual' });
  assert.deepEqual(manual[0].inputModalities, ['text']);
  const inherited = await llm.discoverModels('llm-pi-ai', { provider: 'inherited' });
  assert.deepEqual(inherited[1].inputModalities, ['text', 'image']);
  dispose();
  assert.equal(listeners.size, 0);
  assert.equal(llm.discoverModels, original);
});

test('read-only settings remain untouched and stale defaults never overwrite a concurrent edit', async () => {
  const { namespace, providers, profiles } = fixture();
  const listeners = new Map();
  let writes = 0;
  const ctx = {
    llm: { discoverModels: async () => [], listConfigurableProviders: () => providers },
    settings: {
      writable: false,
      describe: () => [namespace],
      mutate: async () => {
        writes++;
        profiles.gateway.models[0].input = ['text'];
        profiles.gateway.models[0].reasoningEfforts = { high: 'enabled' };
        profiles.gateway.models[1].input = ['text'];
        namespace.revision++;
        listeners.get('settings/document-updated')(namespace.ns);
        throw Object.assign(new Error('changed by editor'), { code: 'SETTINGS_CONFLICT' });
      }
    },
    on: (event, listener) => { listeners.set(event, listener); return () => listeners.delete(event); },
    logger: { warn: (message) => assert.fail(message) }
  };
  const dispose = installModelDefaults(ctx);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 0);
  ctx.settings.writable = true;
  listeners.get('settings/document-updated')(namespace.ns);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 1);
  assert.deepEqual(profiles.gateway.models[0].input, ['text']);
  assert.deepEqual(profiles.gateway.models[0].reasoningEfforts, { high: 'enabled' });
  dispose();
});
