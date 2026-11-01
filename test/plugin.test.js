import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { apply, name } from '../src/plugins/dsh-todo-plugin.js';
import { TYPERT } from '../src/plugins/typert.host.js';
import { TYPERT_REMOTE } from '../src/plugins/typert.remote.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'todo-harness-plugin-'));
  const registrations = [];
  const events = [];
  const sections = [];
  const workspaceUpdates = [];
  const dataFile = join(directory, 'todos.json');
  const usageFile = join(directory, 'usage.json');
  const workspaceRoot = directory;
  await apply({
    tools: { register: (tool) => registrations.push(tool) },
    systemPrompt: {
      getSectionOrder: (name) => name === 'HARNESS_IDENTITY' ? -1000 : 100,
      section: (section) => sections.push(section)
    },
    workspaceRegistry: {
      create: async (path, title) => {
        workspaceUpdates.push({ action: 'create', path, title });
        return {
          title: 'default-workspace',
          setTitle: async (nextTitle) => workspaceUpdates.push({ action: 'rename', title: nextTitle })
        };
      }
    },
    on: (event, listener) => events.push({ event, listener })
  }, {
    dataFile,
    usageFile,
    workspaceRoot
  });
  return { registrations, sections, events, dataFile, usageFile, workspaceRoot, workspaceUpdates };
}

test('DSH plugin registers durable Todo tools and per-turn maintenance guidance', async () => {
  const { registrations, sections, dataFile, workspaceRoot, workspaceUpdates } = await fixture();
  assert.equal(name, 'todo-harness');
  assert.deepEqual(workspaceUpdates, [
    { action: 'create', path: workspaceRoot, title: 'Todo-Harness' },
    { action: 'rename', title: 'Todo-Harness' }
  ]);
  assert.deepEqual(registrations.map((tool) => tool.name), [
    'todo_list', 'todo_create', 'todo_update', 'todo_complete', 'todo_delete', 'todo_clear_completed', 'todo_stats'
  ]);

  const prompt = sections[0].text;
  assert.equal(sections[0].order, -990);
  assert.match(prompt, /first and foremost the user's secretary and planning assistant/);
  assert.match(prompt, /before answering, executing, or calling any other tool, call todo_list/);
  assert.match(prompt, /Treat progress and completion statements as reports, not commands/);
  assert.match(prompt, /今天完成了 Todo-Harness 的开发/);
  assert.match(prompt, /Never start X again from that report alone/);
  assert.match(prompt, /Do not begin execution unless the user explicitly directs you/);
  assert.match(prompt, /Mark it in_progress before execution/);
  assert.match(prompt, /do not assume execution/);
  assert.match(prompt, /At the beginning of every user turn, before answering, executing, or calling any other tool, call todo_list/);
  assert.match(prompt, /Before sending the final response for every user turn, call todo_list again/);
  assert.match(prompt, /Use them directly when a relevant change is warranted/);
  assert.match(prompt, /estimate or re-estimate effort for all Todos or plans, such as/);
  assert.match(prompt, /给所有的待办和计划评估工时/);
  assert.match(prompt, /call todo_update for every relevant record with an integer estimatedMinutes value in minutes/);
  assert.match(prompt, /todo_list result includes stable record ids/);
  assert.match(prompt, /Use the user's current local time and time zone/);
  assert.match(prompt, /choose the earliest realistic available slot/);
  assert.match(prompt, /When urgent work arrives/);
  assert.match(prompt, /Never silently push dueAt forward/);
  assert.match(prompt, /persist actionable user-facing subtasks with parentId and dependsOn/);
  assert.match(prompt, /rather than counting passive waiting as continuous work/);
  assert.match(prompt, /All overdue active Todos remain visible in Today/);
  assert.match(prompt, /When a task starts ahead of its plan, mark it in_progress and bring startAt forward to the actual start time/);

  const signal = new AbortController().signal;
  const created = await registrations.find((tool) => tool.name === 'todo_create').execute({ title: 'Prepare the demo' }, { signal });
  assert.equal(created.todo.title, 'Prepare the demo');
  assert.equal(JSON.parse(await readFile(dataFile, 'utf8')).todos[0].id, created.todo.id);

  await registrations.find((tool) => tool.name === 'todo_update').execute({ id: created.todo.id, patch: { priority: 'high' } }, { signal });
  assert.equal((await registrations.find((tool) => tool.name === 'todo_list').execute({}, { signal })).todos[0].priority, 'high');
  await registrations.find((tool) => tool.name === 'todo_complete').execute({ id: created.todo.id }, { signal });
  assert.equal(JSON.parse(await readFile(dataFile, 'utf8')).todos[0].status, 'done');
});

test('todo list and mutation renderers expose ids needed for persisted bulk estimation', async () => {
  const { registrations } = await fixture();
  const signal = new AbortController().signal;
  const create = registrations.find((tool) => tool.name === 'todo_create');
  const list = registrations.find((tool) => tool.name === 'todo_list');
  const update = registrations.find((tool) => tool.name === 'todo_update');

  const first = await create.execute({ title: 'Initial build' }, { signal });
  const second = await create.execute({ title: 'Promotion plan' }, { signal });
  assert.match(create.output.render({}, first)[0].text, new RegExp(`id: ${first.todo.id}`));
  const snapshot = await list.execute({}, { signal });
  const renderedList = list.output.render({}, snapshot)[0].text;
  assert.match(renderedList, new RegExp(`id: ${first.todo.id}`));
  assert.match(renderedList, new RegExp(`id: ${second.todo.id}`));

  const updated = await update.execute({ id: first.todo.id, patch: { estimatedMinutes: 1920 } }, { signal });
  const renderedUpdate = update.output.render({}, updated)[0].text;
  assert.match(renderedUpdate, new RegExp(`id: ${first.todo.id}`));
  assert.match(renderedUpdate, /estimate 1920m/);

  await update.execute({ id: second.todo.id, patch: { estimatedMinutes: 600 } }, { signal });
  const confirmed = await list.execute({}, { signal });
  assert.deepEqual(new Map(confirmed.todos.map((todo) => [todo.id, todo.estimatedMinutes])), new Map([
    [first.todo.id, 1920],
    [second.todo.id, 600]
  ]));
});

test('Todo tools persist replanning and expose coordination context to the assistant', async () => {
  const { registrations } = await fixture();
  const tool = (name) => registrations.find((entry) => entry.name === name);
  const parent = (await tool('todo_create').execute({ title: 'Client delivery', dueAt: '2030-01-10T12:00:00Z' })).todo;
  const draft = (await tool('todo_create').execute({ title: 'Prepare draft', parentId: parent.id, startAt: '2030-01-02T09:00:00Z', estimatedMinutes: 90 })).todo;
  const review = (await tool('todo_create').execute({
    title: 'Follow up with client', parentId: parent.id, dependsOn: [draft.id], status: 'blocked',
    startAt: '2030-01-04T09:00:00Z', dueAt: parent.dueAt, estimatedMinutes: 15,
    notes: 'Client to review draft; follow up Friday morning.'
  })).todo;
  await tool('todo_update').execute({ id: review.id, patch: { startAt: '2030-01-05T10:00:00Z', estimatedMinutes: 30 } });
  const snapshot = await tool('todo_list').execute({});
  const saved = snapshot.todos.find((entry) => entry.id === review.id);
  assert.equal(saved.dueAt, parent.dueAt);
  assert.equal(saved.startAt, '2030-01-05T10:00:00.000Z');
  assert.equal(saved.status, 'blocked');
  const rendered = tool('todo_list').output.render({}, snapshot)[0].text;
  for (const value of [saved.startAt, saved.dueAt, saved.notes, `parent id: ${parent.id}`, `depends on: ${draft.id}`]) {
    assert.ok(rendered.includes(value), `Missing planning context: ${value}`);
  }
});

test('starting a future Todo through Harness persists its actual start and includes it in Today', async () => {
  const { registrations, dataFile } = await fixture();
  const tool = (name) => registrations.find((entry) => entry.name === name);
  const planned = (await tool('todo_create').execute({
    title: 'Begin planned work early', startAt: '2099-01-01T09:00:00Z', dueAt: '2099-01-05T12:00:00Z'
  })).todo;
  const started = (await tool('todo_update').execute({ id: planned.id, patch: { status: 'in_progress' } })).todo;
  const saved = (await tool('todo_list').execute({})).todos.find((todo) => todo.id === planned.id);
  assert.equal(saved.startAt, started.updatedAt);
  assert.equal(saved.dueAt, planned.dueAt);
  assert.equal(JSON.parse(await readFile(dataFile, 'utf8')).todos[0].startAt, saved.startAt);

  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helpers = [
    source.slice(source.indexOf('function startOfPlanRange'), source.indexOf('function TodoPanel()')),
    source.slice(source.indexOf('function selectTodos'), source.indexOf('function statusLabel')),
    source.slice(source.indexOf('function localDateKey'), source.indexOf('function isToday'))
  ].join('\n');
  const select = runInNewContext(`${helpers}; selectTodos`);
  const now = Date.parse(started.updatedAt);
  assert.equal(select([planned], 'today', false, now).length, 0);
  assert.deepEqual(Array.from(select([saved], 'today', false, now), (todo) => todo.id), [planned.id]);
});

test('Typert host schema names are local segments while Remote codecs use package-qualified symbols', () => {
  assert.deepEqual(TYPERT.schemas.map((schema) => schema.name), [
    'CreateSchedulePayload', 'ScheduleCreateRequest', 'ScheduleRecord', 'ModelSelection', 'NoResult'
  ]);
  assert.ok(TYPERT.schemas.every((schema) => !schema.name.includes('#')));
  const createSchedule = TYPERT_REMOTE.descriptors.find((descriptor) => descriptor.method === 'createSchedule');
  assert.equal(createSchedule.parameters[0].codec.typeSymbol, 'todo-harness#CreateSchedulePayload');
});

test('DSH client file registers through Harness native module loader', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const registrations = [];
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } }
  });

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].id, 'todo-harness');
  const react = { createElement() {}, useCallback() {}, useEffect() {}, useState() {} };
  const client = registrations[0].factory((specifier) => specifier === 'react' ? react : {});
  assert.deepEqual([...client.inject], ['slots', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'workspaces', 'uiWorkspace', 'remote', 'remote.speech', 'remote.settings', 'remote.schedule', 'remote.llm', 'remote.session', 'pluginNavigation', 'configForms', 'settingsSchema']);
  assert.equal(typeof client.apply, 'function');
});

test('DSH client keeps native Chinese and English locales without conflicting registrations', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /locale\.(?:addLanguage|register|setLocale)/);
  assert.match(source, /\['选择一个工作区开始', '正在 Todo-Harness 工作区开始新会话'\]/);
  assert.match(source, /\['Choose a workspace to start', 'Starting a new session in the Todo-Harness workspace'\]/);
  assert.doesNotMatch(source, /setLocale\(['"]zh-CN['"]\)/);
  assert.match(source, /grid-template-columns:auto minmax\(0,1fr\) minmax\(0,33\.333vw\)!important/);
  assert.match(source, /width:33\.333vw!important/);
  assert.match(source, /data-todo-harness-model-url/);
  assert.match(source, /grid-template-rows:minmax\(0,1fr\)!important/);
  assert.match(source, /sidebarRight\.openTab\(TODO_TAB_KIND\)/);
  assert.match(source, /sidebarRight\.toggleExpanded\(\)/);
  assert.match(source, /data-todo-harness-mobile-todo-open/);
  assert.match(source, /@media\(max-width:767px\)/);
  assert.match(source, /data-sidebar-right-expand\]\{display:none!important\}/);
  assert.match(source, /\.todo-harness-expand-button:hover:not\(:disabled\),\.todo-harness-mobile-sidebar-toggle:hover:not\(:disabled\)\{background:transparent!important/);
  assert.doesNotMatch(source, /height:min\(52vh,440px\)!important/);
  assert.match(source, /installVoiceSetupTrigger/);
  assert.match(source, /todo-harness-voice-setup/);
  assert.match(source, /runtime\.speech\.prepare/);
});

test('voice download progress uses current resource bytes and keeps unknown totals indeterminate', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('function voiceByteText'), source.indexOf('function voiceStepLabel'));
  const progress = runInNewContext(`${helpers}; voiceDownloadProgress`);

  const known = progress({ phase: 'downloading', completedBytes: 234e6, totalBytes: 1e9 });
  assert.ok(Math.abs(known.percent - 23.4) < 1e-9);
  assert.equal(known.bytes, '234.0 MB / 1.0 GB');
  assert.equal(progress({ phase: 'downloading', completedBytes: 8e6 }).percent, undefined);
  assert.equal(progress({ phase: 'downloading', completedBytes: 8e6 }).bytes, '已下载 8.0 MB');
  assert.equal(progress({ phase: 'downloading', completedBytes: 0, totalBytes: 10 }).percent, 0);
  assert.equal(progress({ phase: 'downloading', completedBytes: 11, totalBytes: 10 }).percent, 100);
  for (const totalBytes of [0, -1, Infinity, NaN]) {
    assert.equal(progress({ phase: 'downloading', completedBytes: 8e6, totalBytes }).percent, undefined);
  }
  assert.equal(progress({ phase: 'downloading', completedBytes: -1, totalBytes: 10 }).percent, undefined);
  assert.equal(progress({ phase: 'loading', completedBytes: 10, totalBytes: 10 }), undefined);
});

test('thinking copy preserves the live duration and animated ellipsis', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const registrations = [];
  const textNodes = [
    { nodeType: 3, nodeValue: '深度求索中，用时 12秒 ···' },
    { nodeType: 3, nodeValue: '深度求索中' },
    { nodeType: 3, nodeValue: '深度求索正在思考' },
    { nodeType: 3, nodeValue: ' DeepSeek is thinking for 3 sec ' }
  ];
  const shimmerAttributes = new Map([['data-shimmer-text', '深度求索中，用时 12秒 ···']]);
  const shimmerText = {
    nodeType: 1,
    matches: (selector) => selector.includes('[data-shimmer-text]') && shimmerAttributes.has('data-shimmer-text'),
    querySelectorAll: () => [],
    getAttribute: (attribute) => shimmerAttributes.get(attribute) ?? null,
    setAttribute: (attribute, value) => shimmerAttributes.set(attribute, value)
  };
  let nativeObserver;
  const body = {
    nodeType: 1,
    matches: () => false,
    querySelectorAll: (selector) => selector.includes('[data-shimmer-text]') ? [shimmerText] : []
  };
  const document = {
    body,
    createTreeWalker: () => {
      let index = 0;
      return { nextNode: () => textNodes[index++] ?? null };
    }
  };
  class TestMutationObserver {
    constructor(callback) { this.callback = callback; nativeObserver = this; }
    observe(_target, options) { this.options = options; }
    disconnect() {}
  }
  const window = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } };
  runInNewContext(source, {
    window,
    document,
    MutationObserver: TestMutationObserver,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    NodeFilter: { SHOW_TEXT: 4 }
  });
  const react = { createElement() {}, useCallback() {}, useEffect() {}, useState() {} };
  const client = registrations[0].factory((specifier) => specifier === 'react' ? react : {});
  const effects = [];
  client.apply({ effect: (callback, name) => effects.push({ callback, name }) });
  effects.find((effect) => effect.name === 'todo-harness: native copy observer').callback();

  assert.equal(textNodes[0].nodeValue, '思考中，用时 12秒 ···');
  assert.equal(textNodes[1].nodeValue, '思考中');
  assert.equal(textNodes[2].nodeValue, '思考中');
  assert.equal(textNodes[3].nodeValue, ' Thinking… for 3 sec ');
  assert.equal(shimmerAttributes.get('data-shimmer-text'), '思考中，用时 12秒 ···');
  assert.ok(nativeObserver.options.attributeFilter.includes('data-shimmer-text'));
  shimmerText.setAttribute('data-shimmer-text', '深度求索中，用时 13秒 ···');
  nativeObserver.callback([{ type: 'attributes', target: shimmerText }]);
  assert.equal(shimmerAttributes.get('data-shimmer-text'), '思考中，用时 13秒 ···');
  assert.match(source, /\[data-chat-running\] span\[aria-hidden="true"\]:has\(> svg\)::before\{box-sizing:border-box;display:block/);
  assert.match(source, /@keyframes todo-harness-thinking-spin/);
  assert.match(source, /prefers-reduced-motion:reduce/);
});

test('custom provider thinking levels can be configured and first-run provider onboarding stays enabled', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');

  assert.match(source, /getModelReasoningSettingsTarget\(ctx, selected\.group\.id, selected\.model\.id\)/);
  assert.match(source, /remote\.settings\.mutate\('llm-pi-ai'/);
  assert.match(source, /reasoningEfforts/);
  assert.match(source, /此模型未声明思考等级/);
  assert.doesNotMatch(source, /dismissPreviewNotice|welcomeNoticeVersion/);
  assert.match(source, /推荐/);
});

test('reasoning controls use declared capabilities and preserve provider wire mappings', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('function reasoningEffortMapping'), source.indexOf('function modelSelectionKey'));
  const { mapping, suggested } = runInNewContext(`${helpers}; ({ mapping: reasoningEffortMapping, suggested: suggestedReasoningLevels })`);
  const normalize = (value) => JSON.parse(JSON.stringify(value));
  assert.doesNotMatch(source, /ConversationReasoningControl|todo-harness:conversation-reasoning/);
  const target = { api: 'openai-responses', model: 'gpt-6.1-sol', levels: [], disabled: false };
  assert.deepEqual(normalize(suggested(target)), ['low', 'medium', 'high']);
  assert.deepEqual(normalize(suggested({ ...target, levels: ['high', 'xhigh'] })), ['high', 'xhigh']);
  assert.deepEqual(normalize(suggested({ ...target, disabled: true })), []);
  assert.deepEqual(normalize(suggested({ ...target, model: 'gpt-4.1' })), []);
  assert.deepEqual(normalize(mapping(['off', 'low', 'high'], { off: 'none', high: 'enabled' })), { off: 'none', low: 'low', high: 'enabled' });
});

test('reasoning configuration targets only the selected provider model and uses its current revision', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('const REASONING_LEVELS'), source.indexOf('function ProviderSetupOnboarding'));
  const getTarget = runInNewContext(`${helpers}; getModelReasoningSettingsTarget`);
  const providers = {
    custom: { api: 'openai-responses', models: [{ id: 'gpt-4.1' }, { id: 'gpt-6.1-sol', reasoningEfforts: { high: 'enabled' } }] },
    official: { api: 'openai-completions', modelOverrides: { 'o3-mini': { reasoningEfforts: false } } }
  };
  const ctx = {
    configForms: { describe: () => ({ ensure: async () => {}, getSnapshot: () => ({ view: { writable: true, namespaces: [{ ns: 'llm-pi-ai', user: { providers }, revision: 7 }] } }) }) },
    settingsSchema: { getPath: (root, path) => path.reduce((value, key) => value?.[key], root) }
  };
  const target = await getTarget(ctx, 'custom', 'gpt-6.1-sol');
  assert.deepEqual([...target.path], ['providers', 'custom', 'models', '1', 'reasoningEfforts']);
  assert.equal(target.revision, 7);
  assert.equal(target.efforts.high, 'enabled');
  assert.equal(await getTarget(ctx, 'custom', 'missing'), null);
  const disabled = await getTarget(ctx, 'official', 'o3-mini');
  assert.deepEqual([...disabled.path], ['providers', 'official', 'modelOverrides', 'o3-mini', 'reasoningEfforts']);
  assert.equal(disabled.disabled, true);
});

test('agent model settings can render while its catalog and provider configuration are still loading', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('function ReasoningSettingsRow'), source.indexOf('function modelSelectionKey'));
  const create = (type, props, ...children) => ({ type, props, children });
  const render = runInNewContext(`${helpers}; ReasoningSettingsRow`, {
    React: { Fragment: 'fragment' }, h: create, Button: 'button',
    useState: (value) => [value, () => {}], useRef: (value) => ({ current: value }),
    useCallback: (value) => value, useEffect: () => {}, runtimeContext: {}
  });
  const tree = render();
  const row = tree.children[0];
  const modelSelect = row.children[0].children[1];
  assert.equal(modelSelect.props.disabled, true);
  assert.equal(modelSelect.props.value, '');
  assert.equal(row.children[1].children[1].children[0].props.disabled, true);
});

test('todo action icons expose tooltips and keep session dispatch controls', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');

  assert.match(source, /function renderTodayGroups\(todos, now, renderTodo\)/);
  assert.match(source, /function planDateInfo\(key, now = Date\.now\(\)\)/);
  assert.match(source, /function IconActionButton\(\{ label, \.\.\.props \}\)/);
  assert.match(source, /Tooltip, \{ label, delayMs: 350, focusDelayMs: 0 \}/);
  assert.match(source, /markInProgress = true/);
  assert.match(source, /const patch = \{ sessionId: newSessionId, dispatchOptions \}/);
  assert.match(source, /todo\.sessionId \? h\(Button,[\s\S]*?查看会话/);
  assert.match(source, /onOpenSession: \(\) => \{ try \{ openHarnessSession\(ctx, todo\.sessionId\)/);
  assert.match(source, /dispatchId: record\.id/);
});

test('plan calendar includes leap days and complete weeks across month and year boundaries', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helpers = source.slice(source.indexOf('function planCalendarDays'), source.indexOf('function TodoPanel()'));
  const calendar = runInNewContext(`${helpers}; ({ days: planCalendarDays, start: startOfPlanRange })`);

  for (const value of ['2028-02-15', '2026-12-31', '2027-01-01']) {
    const month = new Date(`${value}T12:00:00`);
    const days = calendar.days(month);
    assert.equal(days.length, 42);
    assert.equal(days[0].getDay(), 1);
    assert.equal(days[41].getDay(), 0);
    assert.equal(new Set(days.map((date) => date.toDateString())).size, 42);
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    assert.equal(days.filter((date) => date.getMonth() === month.getMonth()).length, lastDay);
  }
  assert.ok(calendar.days(new Date('2028-02-15T12:00:00')).some((date) => date.getDate() === 29 && date.getMonth() === 1));
  const now = new Date('2026-10-31T12:00:00');
  assert.equal(calendar.start(now).getDate(), 31);
  assert.equal(calendar.start(now).getHours(), 0);
  for (const key of ['2025-01-01', '2026-10-30', '2026-11-06', '2027-12-31', '2028-02-29']) {
    const selected = new Date(`${key}T12:00:00`);
    const start = calendar.start(selected);
    assert.equal(start.toDateString(), selected.toDateString(), `${key} must start the visible range`);
    assert.equal(calendar.start(calendar.start(start, 1), -1).toDateString(), start.toDateString());
  }
});

test('plan filters seven local execution dates and retains an unscheduled group', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helpers = [
    source.slice(source.indexOf('function startOfPlanRange'), source.indexOf('function TodoPanel()')),
    source.slice(source.indexOf('function selectTodos'), source.indexOf('function statusLabel')),
    source.slice(source.indexOf('function localDateKey'), source.indexOf('function isToday'))
  ].join('\n');
  const select = runInNewContext(`${helpers}; selectTodos`);
  const now = new Date('2026-10-31T12:00:00').getTime();
  const task = (id, startAt, status = 'todo') => ({ id, startAt, dueAt: startAt, status });
  const todos = [
    task('previous', '2026-10-30T23:59:59'),
    task('first', '2026-10-31T00:00:00'),
    task('last', '2026-11-06T23:59:59'),
    task('after', '2026-11-07T00:00:00'),
    task('done', '2026-11-01T12:00:00', 'done'),
    task('canceled', '2026-11-01T12:00:00', 'canceled'),
    task('archived', '2026-11-01T12:00:00', 'archived'),
    task('in-progress', '2026-11-02T12:00:00', 'in_progress'),
    task('unscheduled', null)
  ];
  const ids = (...args) => Array.from(select(...args), (todo) => todo.id);
  assert.deepEqual(ids(todos, 'plan', false, now), ['first', 'last', 'in-progress', 'unscheduled']);
  assert.deepEqual(ids(todos, 'plan', true, now), ['first', 'last', 'done', 'in-progress', 'unscheduled']);
  assert.deepEqual(ids(todos, 'plan', true, now, '2026-11-01'), ['last', 'after', 'done', 'in-progress', 'unscheduled']);
  assert.deepEqual(ids(todos, 'plan', false, now, '2026-10-31', 30), ['first', 'last', 'after', 'in-progress', 'unscheduled']);
  assert.deepEqual(ids(todos, 'plan', false, now, '2026-10-31', 1), ['first', 'unscheduled']);
  assert.deepEqual(ids(todos, 'today', true, now), ['previous', 'first', 'unscheduled']);
  for (const key of ['2026-12-29', '2028-02-26', '2026-03-06', '2026-10-30']) {
    const rangeTodos = Array.from({ length: 9 }, (_, index) => {
      const date = new Date(`${key}T12:00:00`);
      date.setDate(date.getDate() + index - 1);
      return task(String(index), date.toISOString());
    });
    assert.deepEqual(ids(rangeTodos, 'plan', false, now, key), ['1', '2', '3', '4', '5', '6', '7']);
  }
});

test('Today keeps every overdue active task including future replans, and shows early scheduled work', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helpers = [
    source.slice(source.indexOf('function startOfPlanRange'), source.indexOf('function TodoPanel()')),
    source.slice(source.indexOf('function selectTodos'), source.indexOf('function statusLabel')),
    source.slice(source.indexOf('function localDateKey'), source.indexOf('function isToday'))
  ].join('\n');
  const select = runInNewContext(`${helpers}; selectTodos`);
  const now = new Date('2026-10-31T12:00:00').getTime();
  const todos = [
    { id: 'old', status: 'todo', dueAt: '2020-01-01T12:00:00' },
    { id: 'blocked', status: 'blocked', dueAt: '2026-10-30T23:59:59', startAt: '2026-11-05T09:00:00' },
    { id: 'overdue-this-morning', status: 'in_progress', dueAt: '2026-10-31T10:00:00' },
    { id: 'early', status: 'todo', startAt: '2026-10-31T15:00:00', dueAt: '2026-11-15T18:00:00' },
    { id: 'no-deadline', status: 'todo', startAt: '2026-10-31T09:00:00' },
    { id: 'finished-early', status: 'done', startAt: '2026-11-01T09:00:00', dueAt: '2026-11-15T18:00:00', completedAt: '2026-10-31T10:00:00' },
    { id: 'future', status: 'todo', startAt: '2026-11-02T09:00:00', dueAt: '2026-11-15T18:00:00' },
    ...['done', 'archived', 'canceled'].map((status) => ({ id: status, status, dueAt: '2026-10-01T09:00:00' }))
  ];
  const ids = (segment, completed = false) => Array.from(select(todos, segment, completed, now), (todo) => todo.id);
  assert.deepEqual(ids('today'), ['old', 'blocked', 'overdue-this-morning', 'early', 'no-deadline']);
  assert.deepEqual(ids('today', true), ['old', 'blocked', 'overdue-this-morning', 'early', 'no-deadline', 'finished-early']);
  assert.deepEqual(ids('plan'), ['old', 'blocked', 'overdue-this-morning', 'early', 'no-deadline', 'future']);
});

test('Today expands the overdue group first without a count limit', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('function renderTodayGroups'), source.indexOf('function renderPlanGroups'));
  const render = runInNewContext(`${helper}; renderTodayGroups`, {
    h: (type, props, ...children) => ({ type, props, children }),
    localDateKey: (date) => date.toISOString().slice(0, 10),
    isOverdueTodo: (todo, now) => todo.status !== 'done' && Date.parse(todo.dueAt) < now,
    compareTimeline: () => 0, formatTimelineMarker: () => '09:00', IconClockOutlineRegular: 'icon'
  });
  const todos = [
    { id: 'today', status: 'todo', startAt: '2026-10-31T09:00:00Z', dueAt: '2026-11-01T12:00:00Z' },
    ...Array.from({ length: 60 }, (_, index) => ({ id: String(index), status: index % 2 ? 'blocked' : 'todo', startAt: '2026-11-05T09:00:00Z', dueAt: '2020-01-01T12:00:00Z' }))
  ];
  const groups = render(todos, Date.parse('2026-10-31T12:00:00Z'), (todo) => todo);
  assert.equal(groups[0].props.key, 'overdue');
  assert.equal(groups[0].children[1].children[0].length, 60);
  assert.equal(groups[1].children[1].children[0][0].id, 'today');
});

test('plan date strip starts on the selected day and moves seven days from that date', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helpers = [
    source.slice(source.indexOf('function PlanWeekStrip'), source.indexOf('function PlanCalendar(')),
    source.slice(source.indexOf('function startOfPlanRange'), source.indexOf('function TodoPanel()')),
    source.slice(source.indexOf('function localDateKey'), source.indexOf('function isToday'))
  ].join('\n');
  const render = runInNewContext(`${helpers}; PlanWeekStrip`, {
    h: (type, props, ...children) => ({ type, props, children }),
    IconActionButton: 'button', IconChevronLeftOutlineRegular: 'icon', IconChevronRightOutlineRegular: 'icon',
    formatDateWithWeekday: (date) => date.toDateString(), formatIsoWeekday: (day) => String(day)
  });
  const selections = [];
  const now = new Date('2026-10-31T12:00:00').getTime();
  const tree = render({ now, selectedDate: '2026-11-02', onSelect: (key) => selections.push(key) });
  const days = tree.children[1].children[0];
  assert.deepEqual(Array.from(days, (day) => day.props.key), ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  assert.equal(days[0].props['aria-pressed'], true);
  tree.children[0].props.onClick();
  tree.children[2].props.onClick();
  days[3].props.onClick();
  assert.deepEqual(selections, ['2026-10-26', '2026-11-09', '2026-11-05']);
});

async function planSummaryHelpers(context = {}) {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  return runInNewContext([
    source.slice(source.indexOf('function PlanDateShortcuts'), source.indexOf('function PlanWeekStrip')),
    source.slice(source.indexOf('function startOfPlanRange'), source.indexOf('function TodoPanel()')),
    source.slice(source.indexOf('function isActiveTodo'), source.indexOf('function statusLabel')),
    source.slice(source.indexOf('function localDateKey'), source.indexOf('function isToday')),
    '; ({ range: planDateRange, length: planRangeLength, calendarTasks: planCalendarTasks, shortcuts: planDateShortcuts, summarize: summarizePlan, render: PlanSummary, renderShortcuts: PlanDateShortcuts })'
  ].join('\n'), {
    h: (type, props, ...children) => ({ type, props, children }), React: { Fragment: 'fragment' },
    IconPlanOutlineRegular: 'icon', IconCheckCircleOutlineRegular: 'icon', IconClockOutlineRegular: 'icon',
    formatNumber: (value) => String(value), ...context
  });
}

test('plan date ranges and custom lengths handle leap days, DST, and year transitions', async () => {
  const { range, length, shortcuts } = await planSummaryHelpers();
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(range('2027-01-01')), { start: '2027-01-01', end: '2027-01-08', last: '2027-01-07' });
  assert.deepEqual(plain(range('2028-02-29', 30)), { start: '2028-02-29', end: '2028-03-30', last: '2028-03-29' });
  assert.deepEqual(plain(range('2026-12-31', 1)), { start: '2026-12-31', end: '2027-01-01', last: '2026-12-31' });
  assert.deepEqual(plain(range('2026-12-31', 14)), { start: '2026-12-31', end: '2027-01-14', last: '2027-01-13' });
  assert.equal(length('2026-03-06', '2026-03-12'), 7);
  assert.equal(length('2028-02-28', '2028-03-01'), 3);
  assert.equal(length('2026-10-31', '2026-10-30'), 0);
  assert.equal(length('2026-02-30', '2026-03-02'), 0);
  assert.equal(length('', '2026-03-02'), 0);
  const dates = (date) => Object.fromEntries(shortcuts(new Date(`${date}T12:00:00`).getTime()).map((option) => [option.label, option.date]));
  assert.deepEqual(dates('2026-10-31'), { 昨天: '2026-10-30', 今天: '2026-10-31', 明天: '2026-11-01' });
  assert.equal(dates('2026-12-31')['明天'], '2027-01-01');
  assert.equal(dates('2028-03-01')['昨天'], '2028-02-29');
});

test('summaries match the selected execution range and exclude outside dates without duplicating parents', async () => {
  const { summarize } = await planSummaryHelpers();
  const task = (id, startAt, estimatedMinutes, extra = {}) => ({ id, startAt, estimatedMinutes, status: 'todo', ...extra });
  const todos = [
    task('parent', '2026-10-31T09:00:00', 600),
    task('draft', '2026-10-27T09:00:00', 90, { parentId: 'parent', dueAt: '2026-11-20T18:00:00' }),
    task('review', '2026-11-01T09:00:00', 45, { parentId: 'parent', status: 'blocked' }),
    task('backlog', '2026-10-01T09:00:00', 30),
    task('due-only', null, 15, { dueAt: '2026-10-30T18:00:00' }),
    task('next-week', '2026-11-03T09:00:00', 60),
    task('undated', null, 60),
    task('unknown-effort', '2026-10-31T09:00:00', null),
    task('no-deadline', '2026-10-31T09:00:00', 20),
    task('in-progress', '2026-10-31T09:00:00', 30, { status: 'in_progress' }),
    task('rescheduled', '2026-11-15T09:00:00', 30, { dueAt: '2026-10-20T18:00:00' }),
    ...['done', 'canceled', 'archived'].map((status) => task(status, '2026-10-31T09:00:00', 300, { status }))
  ];
  const now = new Date('2026-10-31T12:00:00').getTime();
  const week = summarize(todos, '2026-10-31', 7, now);
  assert.equal(week.remainingCount, 5);
  assert.equal(week.estimatedMinutes, 155);
  assert.equal(week.carriedCount, 0);
  assert.equal(week.unestimatedCount, 1);
  assert.equal(week.unscheduledCount, 2);
  const month = summarize(todos, '2026-10-31', 30, now);
  assert.equal(month.remainingCount, 6);
  assert.equal(month.estimatedMinutes, 185);
  assert.equal(month.carriedCount, 0);
  const next = summarize(todos, '2026-11-02', 7, now);
  assert.equal(next.remainingCount, 1);
  assert.equal(next.estimatedMinutes, 60);
  assert.equal(next.carriedCount, 0);
  const previous = summarize(todos, '2026-10-01', 7, now);
  assert.equal(previous.remainingCount, 1);
  assert.equal(previous.estimatedMinutes, 30);
});

test('calendar groups execution dates and exposes complete priority titles without mutating source order', async () => {
  const { calendarTasks } = await planSummaryHelpers({ compareTimeline: (a, b) => a.priority === 'urgent' ? -1 : b.priority === 'urgent' ? 1 : 0 });
  const todos = [
    { id: 'low', title: 'Long title '.repeat(30), priority: 'low', startAt: '2026-10-31T09:00:00', status: 'todo' },
    { id: 'urgent', title: 'Urgent', priority: 'urgent', startAt: '2026-10-31T09:00:00', status: 'blocked' },
    { id: 'done', startAt: '2026-11-01T09:00:00', status: 'done' },
    { id: 'unscheduled', dueAt: '2026-10-31T09:00:00', status: 'todo' },
    { id: 'canceled', startAt: '2026-10-31T09:00:00', status: 'canceled' }
  ];
  const groups = calendarTasks(todos);
  assert.deepEqual(Array.from(groups.get('2026-10-31'), (todo) => todo.id), ['urgent', 'low']);
  assert.equal(groups.get('2026-10-31')[1].title, todos[0].title);
  assert.equal(groups.get('2026-11-01')[0].id, 'done');
  assert.equal(todos[0].id, 'low');
});

test('summary shows only remaining tasks and effort while loading and errors stay explicit', async () => {
  const { render, renderShortcuts } = await planSummaryHelpers();
  const now = new Date('2026-10-31T12:00:00').getTime();
  const values = { todos: [], selectedDate: '2026-10-31', now };
  const tree = render(values);
  assert.equal(tree.children.length, 1);
  assert.equal(tree.children[0].type, 'dl');
  assert.deepEqual(Array.from(tree.children[0].children, (metric) => metric.children[0].children[1]), ['剩余任务', '预计工时']);
  assert.equal(render({ ...values, dataStatus: 'loading' }).children[0].children[0], '正在读取统计');
  assert.equal(render({ ...values, dataStatus: 'error' }).children[0].children[0], '统计暂不可用');
  const selections = [];
  const shortcuts = renderShortcuts({ now, selectedDate: '2026-10-31', onSelect: (...selection) => selections.push(selection) });
  const days = shortcuts.children[0].children[0];
  assert.equal(days[1].props['aria-pressed'], true);
  days[2].props.onClick();
  days[0].props.onClick();
  assert.deepEqual(selections, [['2026-11-01'], ['2026-10-30']]);
});

test('quick requests restore the original actions and preserve existing composer text', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const render = runInNewContext(`${source.slice(source.indexOf('function QuickRequests'), source.indexOf('function TodoPanelTitle'))}; QuickRequests`, {
    h: (type, props, ...children) => ({ type, props, children }),
    useRef: () => ({ current: null }), useState: () => [null, () => {}], useEffect: () => {},
    Button: 'button', IconCheckCircleOutlineRegular: 'icon', IconClockOutlineRegular: 'icon', IconEditOutlineRegular: 'icon'
  });
  const writes = [];
  const inputActions = { setDraft: (text) => writes.push(['set', text]), captureInsertion: () => 'selection', insertText: (text, span) => writes.push(['insert', text, span]) };
  const actions = (input) => render({ session: { running: false }, inputActions, input }).children[0].children[0];
  const empty = actions({ phase: 'plain', draft: '' });
  assert.deepEqual(Array.from(empty, (button) => button.children[0]), ['梳理今日待办', '统计本周工作', '写周报']);
  empty[0].props.onClick();
  assert.equal(writes[0][0], 'set');
  assert.match(writes[0][1], /先读取我的待办和计划/);
  actions({ phase: 'plain', draft: 'Existing draft' })[1].props.onClick();
  assert.equal(writes[1][0], 'insert');
  assert.equal(writes[1][2], 'selection');
  for (const state of [
    { session: { running: true }, input: { phase: 'plain' } },
    { session: { running: false, awaitingFirstTurn: true }, input: { phase: 'plain' } },
    { session: { running: false }, input: { phase: 'submitting' } }
  ]) {
    const hidden = render({ inputActions, ...state });
    assert.equal(hidden.props.hidden, true);
    assert.equal(hidden.children[0], null);
  }
  assert.equal(actions({ phase: 'plain', draft: '' }).length, 3);
});

test('plan groups all stay expanded and a selected empty date remains visible', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('function renderPlanGroups'), source.indexOf('function compareTimeline'));
  const render = runInNewContext(`${helper}; renderPlanGroups`, {
    h: (type, props, ...children) => ({ type, props, children }), React: { Fragment: 'fragment' },
    localDateKey: (date) => date.toISOString().slice(0, 10),
    compareTimeline: () => 0,
    planDateInfo: (key) => ({ distance: key, monthDay: key, weekday: 'Monday' })
  });
  const todos = Array.from({ length: 5 }, (_, index) => ({ id: String(index), startAt: `2026-11-0${index + 1}T12:00:00Z`, dueAt: '2026-12-01T12:00:00Z' }));
  const tree = render(todos, Date.now(), (todo) => todo, { selectedDate: '2028-02-29' });
  const groups = tree.children[0];
  assert.equal(groups.length, 6);
  assert.equal(tree.children.length, 1);
  const empty = groups.find((group) => group.props['data-plan-date'] === '2028-02-29');
  assert.ok(empty.props.className.includes('is-selected'));
  assert.equal(empty.children[1].children[0], '当天暂无计划');
  assert.equal(groups.filter((group) => group.props['data-plan-date'] !== '2028-02-29').length, todos.length);
});

test('execution time ranges use effort rather than the deadline', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helpers = [
    source.slice(source.indexOf('function formatDue'), source.indexOf('function deadlineUrgency')),
    source.slice(source.indexOf('function localDateKey'), source.indexOf('function isToday'))
  ].join('\n');
  const format = runInNewContext(`${helpers}; ({ window: formatTodoWindow, moment: formatMonthDayTime, time: formatTime })`);
  const startAt = new Date('2026-10-31T09:00:00').toISOString();
  const endAt = new Date('2026-10-31T10:30:00').toISOString();
  assert.equal(format.window({ startAt, dueAt: '2026-11-15T18:00:00', estimatedMinutes: 90 }), `计划 ${format.moment(startAt)} - ${format.time(endAt)}`);
  assert.equal(format.window({ dueAt: '2026-11-15T18:00:00' }), '待排期');
  const overnight = new Date('2026-10-31T23:30:00').toISOString();
  const nextDay = new Date('2026-11-01T01:00:00').toISOString();
  assert.equal(format.window({ startAt: overnight, estimatedMinutes: 90 }), `计划 ${format.moment(overnight)} - ${format.moment(nextDay)}`);
});

test('dispatching a Todo uses the current ClientSessions create contract and carries its stable id', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');

  assert.match(source, /newSessionId = await sessionClient\.create\(\{ workspaceId: workspace\.workspaceId \}\)/);
  assert.doesNotMatch(source, /created\.ok|created\.value\.sessionId/);
  assert.match(source, /待办 ID：\$\{todo\.id\}/);
  assert.match(source, /执行过程中持续更新这条待办的状态和进展/);
  assert.match(source, /session\.selectModel\(\{ sessionId: newSessionId, \.\.\.modelSelection \}\)/);
  assert.match(source, /label = '执行模型'/);
  assert.match(source, /h\('select', \{/);
  assert.ok(source.indexOf('session.selectModel({ sessionId: newSessionId') < source.indexOf('ctx.remote.session.prompt({'));
});

test('dispatch model defaults to the last supported model and falls back to the first catalog model', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const start = source.indexOf('function modelSelectionKey');
  const end = source.indexOf('const REASONING_LEVELS', start);
  const helper = runInNewContext(`(() => { ${source.slice(start, end)}; return buildDispatchModelChoices; })()`);
  const catalog = {
    default: { provider: 'gateway', model: 'reasoning-model', reasoningEffort: 'high' },
    groups: [
      { id: 'gateway', name: 'Gateway', models: [{ id: 'basic-model', name: 'Basic' }, { id: 'reasoning-model', reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'low' } }] },
      { id: 'other', name: 'Other', models: [{ id: 'third-model' }] }
    ]
  };
  const normalize = (value) => JSON.parse(JSON.stringify(value));
  const selected = helper(catalog);
  assert.equal(selected.selectedKey, 'gateway\nreasoning-model');
  assert.deepEqual(normalize(selected.choices.find((choice) => choice.key === selected.selectedKey).selection), {
    provider: 'gateway', model: 'reasoning-model', reasoningEffort: 'high'
  });

  catalog.default.reasoningEffort = 'unsupported';
  assert.equal(helper(catalog).choices.find((choice) => choice.key === 'gateway\nreasoning-model').selection.reasoningEffort, 'low');

  catalog.default = { provider: 'removed-provider', model: 'removed-model' };
  assert.equal(helper(catalog).selectedKey, 'gateway\nbasic-model');
  assert.deepEqual(normalize(helper(catalog).choices[0].reasoningEfforts), []);
  assert.equal(helper(catalog).choices[0].selection.reasoningEffort, undefined);
  assert.deepEqual(normalize(helper(catalog).choices[1].reasoningEfforts), [{ id: 'low' }, { id: 'high' }]);
  catalog.groups[0].models[1].reasoning.defaultEffort = 'unsupported';
  assert.equal(helper(catalog).choices[1].selection.reasoningEffort, undefined);
  assert.equal(helper(catalog).choices[1].defaultEffort, undefined);

  const prior = { provider: 'gateway', model: 'reasoning-model', reasoningEffort: 'high' };
  assert.equal(helper(catalog, prior).selectedKey, 'gateway\nreasoning-model');
  assert.equal(helper(catalog, prior).choices[1].selection.reasoningEffort, 'high');
  assert.equal(helper(catalog, prior).previousUnavailable, false);
  assert.equal(helper(catalog, { ...prior, reasoningEffort: 'removed' }).previousUnavailable, true);
  assert.equal(helper(catalog, { ...prior, model: 'removed' }).previousUnavailable, true);
  catalog.groups[0].models[1].reasoning.defaultEffort = 'low';
  assert.equal(helper(catalog, { provider: 'gateway', model: 'reasoning-model' }).choices[1].selection.reasoningEffort, undefined);
});

test('dispatch uses the selected directory and applies reasoning before sending the task', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const dispatchSource = source.slice(source.indexOf('  const dispatchTodo ='), source.indexOf('  const loadDispatchModels ='));
  const calls = [];
  let workspaceFailure = false;
  let modelFailure = false;
  const normalize = (value) => JSON.parse(JSON.stringify(value));
  const dispatch = runInNewContext(`${dispatchSource}; dispatchTodo`, {
    ctx: {
      workspaces: { create: async (request) => {
        calls.push(['workspace', normalize(request)]);
        if (workspaceFailure) throw new Error('目录不存在');
        return { workspaceId: 'selected-workspace', path: request.path };
      } },
      sessions: { create: async (request) => { calls.push(['session', normalize(request)]); return 'new-session'; } },
      uiWorkspace: { openSession: (id) => calls.push(['open', id]) },
      remote: { session: {
        selectModel: async (request) => { calls.push(['model', normalize(request)]); return modelFailure ? { ok: false, error: { message: '模型不可用' } } : { ok: true }; },
        prompt: async (request) => { calls.push(['prompt', normalize(request)]); return { ok: true }; }
      } }
    },
    setDispatchingId: (id) => calls.push(['busy', id]),
    setNotice: () => {},
    waitForTodoHarnessRemote: async () => {},
    todoHarnessRemote: () => ({ setDefaultModel: async () => ({ ok: true }) }),
    crypto: { randomUUID: () => 'request-id' },
    priorityLabel: () => '普通',
    formatMinutes: () => '',
    apiUrl: (path) => path,
    fetch: async (_path, request) => { calls.push(['patch', JSON.parse(request.body)]); return { ok: true }; },
    refresh: async () => {},
    rememberDispatchOptions: (key, options) => calls.push(['remember', key, normalize(options)]),
    openHarnessSession: (ctx, id) => ctx.uiWorkspace.openSession(id)
  });
  const selection = { provider: 'gateway', model: 'reasoner', reasoningEffort: 'high' };
  assert.equal(await dispatch({ id: 'todo-id', title: '整理项目材料', priority: 'normal' }, { workspacePath: '/projects/任务目录', modelSelection: selection }), true);
  assert.deepEqual(calls.find(([kind]) => kind === 'workspace')[1], { path: '/projects/任务目录' });
  assert.deepEqual(calls.find(([kind]) => kind === 'session')[1], { workspaceId: 'selected-workspace' });
  assert.deepEqual(calls.find(([kind]) => kind === 'model')[1], { sessionId: 'new-session', ...selection });
  assert.ok(calls.findIndex(([kind]) => kind === 'model') < calls.findIndex(([kind]) => kind === 'prompt'));
  const prompt = calls.find(([kind]) => kind === 'prompt')[1];
  assert.match(prompt.content[0].text, /工作目录：\/projects\/任务目录/);
  assert.match(prompt.content[0].text, /列出产物的完整路径/);
  const dispatchOptions = { modelSelection: selection, directoryMode: 'choose', directoryPath: '/projects/任务目录' };
  assert.deepEqual(calls.find(([kind]) => kind === 'patch')[1], { sessionId: 'new-session', dispatchOptions, status: 'in_progress' });
  assert.deepEqual(calls.find(([kind]) => kind === 'remember'), ['remember', 'todo-id', dispatchOptions]);
  assert.deepEqual(calls.at(-1), ['busy', null]);

  for (const failure of ['missing-path', 'workspace', 'model']) {
    calls.length = 0;
    workspaceFailure = failure === 'workspace';
    modelFailure = failure === 'model';
    await assert.rejects(dispatch({ title: '定时任务' }, { workspacePath: failure === 'missing-path' ? '' : '/projects/work', modelSelection: selection }), /交给 Harness 失败/);
    assert.equal(calls.some(([kind]) => kind === 'prompt'), false);
    assert.equal(calls.some(([kind]) => kind === 'open'), false);
    assert.deepEqual(calls.at(-1), ['busy', null]);
  }
});

test('opening a linked session reveals the conversation from the mobile Todo overlay', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('function openHarnessSession'), source.indexOf('// The package'));
  const calls = [];
  let frame = { removeAttribute: (name) => calls.push(['remove', name]) };
  const open = runInNewContext(`${helper}; openHarnessSession`, {
    document: { querySelector: () => frame },
    window: { dispatchEvent: (event) => calls.push(['event', event.detail.open]) },
    CustomEvent: class { constructor(_name, options) { this.detail = options.detail; } }
  });
  let expanded = true;
  const ctx = { uiWorkspace: { openSession: (id) => { calls.push(['open', id]); frame = null; } }, sidebarRight: { isExpanded: () => expanded, toggleExpanded: () => calls.push(['collapse']) } };
  open(ctx, 'linked-session');
  assert.deepEqual(calls, [['open', 'linked-session'], ['remove', 'data-todo-harness-mobile-todo-open'], ['collapse'], ['event', false]]);
  frame = { removeAttribute: () => {} };
  expanded = false;
  calls.length = 0;
  open(ctx, 'another-session');
  assert.deepEqual(calls, [['open', 'another-session'], ['event', false]]);
  assert.throws(() => open(ctx, null), /尚未关联/);
  assert.throws(() => open({}, 'linked-session'), /服务尚未连接/);
});

test('dispatch options survive client reload and unavailable browser storage', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('const dispatchOptionsCache'), source.indexOf('function openHarnessSession'));
  const storage = new Map();
  const window = { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } };
  const load = () => runInNewContext(`${helper}; ({read:readDispatchOptions,save:rememberDispatchOptions})`, { window });
  const options = { modelSelection: { provider: 'gateway', model: 'model', reasoningEffort: 'high' }, directoryMode: 'current', directoryPath: '/previous' };
  load().save('task-id', options);
  assert.deepEqual(JSON.parse(JSON.stringify(load().read('task-id'))), options);
  assert.equal(load().read('other-task'), null);
  storage.set('todo-harness:dispatch:invalid', 'bad json');
  assert.equal(load().read('invalid'), null);
  window.localStorage.setItem = () => { throw new Error('disabled'); };
  const cache = load();
  cache.save('memory-only', options);
  assert.deepEqual(cache.read('memory-only'), options);
});

test('dispatch confirmation restores the last options and resolves the main session directory without a mounted sidebar', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const askSource = source.slice(source.indexOf('  const askConfirmation ='), source.indexOf('  const confirmAction ='));
  const previousOptions = { modelSelection: { provider: 'gateway', model: 'reasoner', reasoningEffort: 'high' }, directoryMode: 'current', directoryPath: '/selected' };
  const workspace = { path: '/selected', sessionIds: ['main-session'] };
  let confirmation;
  const loads = [];
  const ctx = {
    sessions: { list: { getSnapshot: () => ({ byId: { 'main-session': { id: 'main-session', cwd: '/selected', retainedBy: { mainView: 1 } } } }) } },
    sidebarRight: { mounted: { getSnapshot: () => null } },
    workspaces: { list: { getSnapshot: () => ({ items: [workspace] }) } }
  };
  const ask = runInNewContext(`${askSource}; askConfirmation`, {
    ctx, crypto: { randomUUID: () => 'confirmation' },
    setConfirmation: (next) => { confirmation = next; },
    readDispatchOptions: () => null,
    loadDispatchModels: (...args) => loads.push(args)
  });
  const todo = { id: 'task', dispatchOptions: previousOptions };
  ask('dispatch', todo, () => {});
  assert.equal(confirmation.currentWorkspace, workspace);
  assert.equal(confirmation.directoryMode, 'current');
  assert.equal(confirmation.directoryPath, '/selected');
  assert.equal(confirmation.previousOptions, previousOptions);
  assert.deepEqual(loads[0], ['confirmation', previousOptions]);

  workspace.path = '/different';
  ask('dispatch', todo, () => {});
  assert.equal(confirmation.directoryMode, 'choose');
  assert.equal(confirmation.directoryPath, '/selected');
  assert.equal(confirmation.previousOptions.modelSelection.reasoningEffort, 'high');

  workspace.sessionIds = [];
  ask('dispatch', todo, () => {});
  assert.equal(confirmation.currentWorkspace.path, '/selected');
  assert.equal(confirmation.directoryMode, 'current');
});

test('dispatch confirmation requires an explicit directory choice and keeps settings after a failure', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const confirmSource = source.slice(source.indexOf('  const confirmAction ='), source.indexOf('  const todoAction ='));
  let pending = {
    id: 'confirmation', kind: 'dispatch', modelStatus: 'ready',
    modelSelection: { provider: 'gateway', model: 'reasoner', reasoningEffort: 'high' },
    directoryMode: 'choose', directoryPath: '', currentWorkspace: { path: '/current' },
    action: async (...args) => calls.push(args)
  };
  const calls = [];
  const confirm = async () => runInNewContext(`${confirmSource}; confirmAction()`, {
    confirmation: pending, setConfirming: () => {},
    setConfirmation: (next) => { pending = typeof next === 'function' ? next(pending) : next; }
  });
  await confirm();
  assert.equal(calls.length, 0);
  pending.directoryMode = 'current';
  await confirm();
  assert.equal(calls[0][1], '/current');
  assert.equal(pending, null);

  pending = { id: 'confirmation', kind: 'dispatch', modelStatus: 'ready', modelSelection: calls[0][0], directoryMode: 'choose', directoryPath: '/selected', action: async () => { throw new Error('连接中断'); } };
  await confirm();
  assert.equal(pending.directoryPath, '/selected');
  assert.equal(pending.modelSelection.reasoningEffort, 'high');
  assert.equal(pending.error, '连接中断');
  pending.action = async (...args) => calls.push(args);
  pending.directoryPickerOpen = true;
  await confirm();
  assert.equal(calls.length, 1);
  pending.directoryPickerOpen = false;
  await confirm();
  assert.equal(calls[1][1], '/selected');
});

test('launcher does not override saved model selection with its unregistered deepseek route', async () => {
  const source = await readFile(new URL('../src/cli.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /id: 'agent-default-model', config: \{ provider: 'deepseek'/);
  assert.match(source, /\{ id: 'llm-deepseek', disabled: true \}/);
});

test('DSH client retries model discovery with the URL entered after a failure', async () => {
  const source = await readFile(new URL('../src/dsh/client.js', import.meta.url), 'utf8');
  const registrations = [];
  const listeners = new Map();
  let field;
  let createdInput;
  let requestCall;
  let insertionPosition;
  const failure = {
    matches: (selector) => selector === 'p.zGbnIq_error',
    insertAdjacentElement: (_position, element) => { field = element; }
  };
  const catalog = {
    children: [failure],
    get previousElementSibling() { return field; },
    insertAdjacentElement: (position, element) => {
      insertionPosition = position;
      field = element;
    },
    querySelector: (selector) => selector === '[data-todo-harness-model-url]' ? createdInput : null
  };
  const document = {
    body: {},
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: (selector) => selector === '.zGbnIq_modelCatalog' ? [catalog] : selector === '[data-todo-harness-model-url-field]' && field ? [field] : [],
    createElement: (tagName) => {
      const element = {
        tagName,
        dataset: {},
        children: [],
        matches: (selector) => selector === '[data-todo-harness-model-url-field]' && element.dataset.todoHarnessModelUrlField === 'true',
        querySelector: (selector) => selector === '[data-todo-harness-model-url]' ? createdInput : null,
        append(...children) { this.children.push(...children); },
        remove() {}
      };
      if (tagName === 'input') {
        createdInput = element;
        element.addEventListener = (name, listener) => listeners.set(name, listener);
      }
      return element;
    }
  };
  class TestMutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() {}
    disconnect() {}
  }
  const window = {
    location: { href: 'http://127.0.0.1:3210/' },
    fetch: async (url, init) => {
      requestCall = { url, init };
      return { ok: true };
    },
    __ModuleLoader__: { load: (registration) => registrations.push(registration) }
  };
  runInNewContext(source, { window, document, MutationObserver: TestMutationObserver, URL, Request });
  const react = { createElement() {}, useCallback() {}, useEffect() {}, useState() {} };
  const client = registrations[0].factory((specifier) => specifier === 'react' ? react : {});
  const effects = [];
  client.apply({ effect: (callback, name) => effects.push({ callback, name }) });
  effects.find((effect) => effect.name === 'todo-harness: model discovery URL input').callback();
  effects.find((effect) => effect.name === 'todo-harness: model discovery URL override').callback();

  const message = {
    type: 'client-request',
    rpcId: 'test',
    method: 'llm/discoverModels',
    payload: { args: { settingsNs: 'llm-pi-ai', request: { provider: 'custom-provider', baseURL: 'https://old.example/v1', api: 'openai-responses' } } }
  };
  await window.fetch('/api/llm/discoverModels', { method: 'POST', body: JSON.stringify(message) });
  assert.equal(JSON.parse(requestCall.init.body).payload.args.request.baseURL, 'https://old.example/v1');

  createdInput.value = 'https://models.example.com/v1/models';
  listeners.get('input')();
  await window.fetch('/api/llm/discoverModels', { method: 'POST', body: JSON.stringify(message) });

  const forwarded = JSON.parse(requestCall.init.body);
  assert.equal(forwarded.payload.args.request.baseURL, 'https://models.example.com/v1');
  assert.equal(forwarded.payload.args.request.api, 'openai-responses');
  assert.equal(forwarded.payload.args.settingsNs, 'llm-pi-ai');
  assert.equal(insertionPosition, 'beforebegin');
  assert.ok(field);
});

test('DSH session usage events are persisted for the native sidebar', async () => {
  const { events, usageFile } = await fixture();
  const sessionEvent = events.find((entry) => entry.event === 'session/event');
  assert.ok(sessionEvent);
  sessionEvent.listener({}, {
    type: 'assistant/message',
    data: {
      usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 },
      message: { source: { provider: 'deepseek', model: 'test-model' } }
    }
  });
  let usage;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    usage = JSON.parse(await readFile(usageFile, 'utf8'));
    if (usage.entries.length) break;
  }
  assert.equal(usage.entries[0].totalTokens, 17);
  assert.equal(usage.entries[0].model, 'test-model');
});

test('auxiliary model search usage is included in the native daily meter', async () => {
  const { events, usageFile } = await fixture();
  events.find((entry) => entry.event === 'session/event').listener({}, {
    type: 'web/model-search-usage',
    data: { provider: 'gateway', model: 'search-model', inputTokens: 20, outputTokens: 7, cacheReadTokens: 10, totalTokens: 37 }
  });
  let usage;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    usage = JSON.parse(await readFile(usageFile, 'utf8'));
    if (usage.entries.length) break;
  }
  assert.equal(usage.entries[0].model, 'search-model');
  assert.equal(usage.entries[0].totalTokens, 37);
  assert.equal(usage.entries[0].cacheReadTokens, 10);
});
