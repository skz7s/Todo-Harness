window.__ModuleLoader__.load({
  id: 'todo-harness',
  factory: (require) => {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const { useCallback, useEffect, useRef, useState } = React;
    const {
      Button,
      IconAlarmClockOutlineRegular,
      IconCheckOutlineRegular,
      IconCheckCircleOutlineRegular,
      IconChevronDownOutlineRegular,
      IconChevronLeftOutlineRegular,
      IconChevronRightOutlineRegular,
      IconClockOutlineRegular,
      IconDownloadOutlineRegular,
      IconEditOutlineRegular,
      IconFolderCloseRegular,
      IconLoadingOutlineRegular,
      IconMicrophoneOutlineRegular,
      IconPlusOutlineRegular,
      IconPanelLeftOutlineRegular,
      IconPlanOutlineRegular,
      IconPlayOutlineRegular,
      IconRefreshOutlineRegular,
      IconSearchOutlineRegular,
      IconSlidersTwoOutlineRegular,
      IconTrashOutlineRegular,
      IconWarningOutlineRegular,
      Menu,
      Modal,
      Tooltip
    } = require('@deepseek-ai/dsh-client-ui-primitives');
    const { RemoteStreamCarrierError } = require('@deepseek-ai/dsh-api-gateway/client');

const h = React.createElement;
const TODO_TAB_ID = 'todo-harness/todos';
const TODO_TAB_KIND = 'todo-harness-todos';
const VOICE_INPUT_BUNDLE = '@deepseek-ai/dsh-experimental-voice-input-bundle';
const VOICE_PROVIDER_ID = 'sensevoice-local';
let runtimeContext;
let brandMarkUrl;
let brandMarkLoad;
const DEFAULT_SETTINGS = { agentName: 'Kre-Weave', dailyTokenBudget: 10000000 };
const settingsListeners = new Set();
let settingsValue = { ...DEFAULT_SETTINGS };
let settingsLoad;
let settingsLoaded = false;
let lastModelDiscoveryCatalog;
let lastModelDiscoveryUrl = '';
let todoHarnessRemoteReady = Promise.resolve();
let voiceSetupOpen = false;
let voiceSetupRuntime;
let voiceReadiness = { catalog: null, connected: false, error: null };
const voiceSetupListeners = new Set();
const dispatchOptionsCache = new Map();

function readDispatchOptions(key) {
  if (!key) return null;
  if (dispatchOptionsCache.has(key)) return dispatchOptionsCache.get(key);
  try {
    const value = JSON.parse(window.localStorage.getItem(`todo-harness:dispatch:${key}`));
    if (!value?.modelSelection?.provider || !value.modelSelection.model || !value.directoryPath || !['choose', 'current'].includes(value.directoryMode)) return null;
    return value;
  } catch {
    return null;
  }
}

function rememberDispatchOptions(key, options) {
  if (!key) return;
  dispatchOptionsCache.set(key, options);
  try { window.localStorage.setItem(`todo-harness:dispatch:${key}`, JSON.stringify(options)); } catch {}
}

function openHarnessSession(ctx, sessionId) {
  if (!sessionId) throw new Error('此任务尚未关联会话');
  const uiWorkspace = ctx.uiWorkspace ?? ctx.get?.('uiWorkspace');
  if (!uiWorkspace) throw new Error('会话服务尚未连接，请稍后重试');
  const frame = document.querySelector('[data-todo-harness-mobile-todo-open]');
  uiWorkspace.openSession(sessionId);
  if (frame) {
    frame.removeAttribute('data-todo-harness-mobile-todo-open');
    if (ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded();
    window.dispatchEvent(new CustomEvent('todo-harness:mobile-todo-open', { detail: { open: false } }));
  }
}

// The package's Host face is loaded by the Typert loader, but the web client
// bundle is a standalone ModuleLoader entry. Keep its Remote contribution
// explicit so the client namespace is available before settings and schedules
// start making calls.
const TODO_HARNESS_REMOTE = {
  package: 'todo-harness',
  descriptors: [
    {
      id: 'todo-harness#todoHarness/createSchedule',
      service: 'todoHarness',
      namespace: 'todoHarness',
      method: 'createSchedule',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'payload', wire: 'payload', source: 'json', codec: { mode: 'strict', typeSymbol: 'todo-harness#CreateSchedulePayload', create: () => ({}) } }],
      result: { mode: 'strict', typeSymbol: 'todo-harness#todoHarness/createSchedule:result', create: () => ({}) }
    },
    {
      id: 'todo-harness#todoHarness/getDefaultModel',
      service: 'todoHarness',
      namespace: 'todoHarness',
      method: 'getDefaultModel',
      invocation: { kind: 'direct' },
      parameters: [],
      result: { mode: 'strict', typeSymbol: 'todo-harness#todoHarness/getDefaultModel:result', create: () => ({}) }
    },
    {
      id: 'todo-harness#todoHarness/setDefaultModel',
      service: 'todoHarness',
      namespace: 'todoHarness',
      method: 'setDefaultModel',
      invocation: { kind: 'direct' },
      parameters: [{ name: 'selection', wire: 'selection', source: 'json', codec: { mode: 'strict', typeSymbol: 'todo-harness#ModelSelection', create: () => ({}) } }],
      result: { mode: 'strict', typeSymbol: 'todo-harness#todoHarness/setDefaultModel:result', create: () => ({}) }
    }
  ]
};

async function waitForTodoHarnessRemote() {
  await todoHarnessRemoteReady;
}

function todoHarnessRemote(ctx) {
  const service = ctx.get?.('remote.todoHarness');
  if (!service) throw new Error('Todo Harness Remote 尚未连接');
  return service;
}

function setVoiceSetupOpen(open) {
  voiceSetupOpen = open;
  for (const listener of voiceSetupListeners) listener(open);
}

function voiceFailureMessage(failure) {
  if (failure instanceof Error) return failure.message;
  if (failure && typeof failure === 'object' && typeof failure.message === 'string') return failure.message;
  return String(failure);
}

function voiceStreamEnded() {
  return typeof RemoteStreamCarrierError === 'function'
    ? new RemoteStreamCarrierError('语音服务连接已结束')
    : new Error('语音服务连接已结束');
}

function selectedVoiceProvider(snapshot) {
  const catalog = snapshot?.catalog;
  if (!catalog) return undefined;
  return catalog.providers.find((provider) => provider.id === catalog.selection.providerId)
    ?? catalog.providers.find((provider) => provider.id === VOICE_PROVIDER_ID);
}

function voiceNeedsSetup() {
  const provider = selectedVoiceProvider(voiceReadiness);
  const phase = provider?.preparation?.phase;
  return phase === undefined || !['ready', 'standby', 'waking'].includes(phase);
}

function installVoiceSetupNavigation(ctx) {
  const navigation = ctx.pluginNavigation;
  const original = navigation?.openBundle;
  if (typeof original !== 'function') return;
  const wrapped = (packageName) => {
    if (packageName === VOICE_INPUT_BUNDLE && voiceNeedsSetup()) {
      setVoiceSetupOpen(true);
      return;
    }
    return original.call(navigation, packageName);
  };
  navigation.openBundle = wrapped;
  return () => {
    if (navigation.openBundle === wrapped) navigation.openBundle = original;
  };
}

function installVoiceSetupTrigger() {
  const onClick = (event) => {
    const target = event.target;
    const trigger = target?.closest?.('button[aria-label="打开语音输入引导"],button[aria-label="Open voice input setup"]');
    if (!trigger || !voiceNeedsSetup()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setVoiceSetupOpen(true);
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

function voicePreparationLabel(phase) {
  if (phase === 'checking') return '正在检查模型文件';
  if (phase === 'downloading') return '正在下载模型文件';
  if (phase === 'loading') return '正在加载语音模型';
  if (phase === 'cancelling') return '正在取消下载';
  if (phase === 'failed') return '模型准备失败';
  if (phase === 'cancelled') return '下载已取消';
  if (phase === 'standby' || phase === 'ready' || phase === 'waking') return '语音输入已就绪';
  if (phase === undefined) return '正在连接语音服务';
  return '等待下载';
}

function voiceByteText(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function voiceDownloadProgress(preparation) {
  if (preparation?.phase !== 'downloading') return undefined;
  const completed = preparation.completedBytes;
  const total = preparation.totalBytes;
  const hasCompleted = Number.isFinite(completed) && completed >= 0;
  const hasTotal = Number.isFinite(total) && total > 0;
  return {
    percent: hasCompleted && hasTotal ? Math.max(0, Math.min(100, completed / total * 100)) : undefined,
    bytes: hasCompleted ? (hasTotal ? `${voiceByteText(completed)} / ${voiceByteText(total)}` : `已下载 ${voiceByteText(completed)}`) : '等待下载数据'
  };
}

function voiceStepLabel(kind) {
  return { check: '检查本地文件', model: '下载语音模型', vad: '下载语音检测文件', verify: '校验文件完整性', load: '加载模型' }[kind] ?? kind;
}

function voiceDownloadAdvice(reason) {
  if (reason === 'storage') return '请确认本地磁盘有足够空间后重试。';
  if (reason === 'integrity') return '文件校验未通过，请重新下载。';
  if (['network', 'dns', 'timeout', 'certificate', 'http'].includes(reason)) return '请检查网络连接后重试。';
  return '请稍后重试。';
}

function VoiceSetupOverlay() {
  const [open, setOpen] = useState(voiceSetupOpen);
  const [readiness, setReadiness] = useState(voiceReadiness);
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const runtime = voiceSetupRuntime;

  useEffect(() => {
    voiceSetupListeners.add(setOpen);
    return () => voiceSetupListeners.delete(setOpen);
  }, []);

  useEffect(() => {
    if (!runtime?.remote?.$stream || !runtime.speech?.follow) return undefined;
    let mounted = true;
    let stream;
    const update = (next) => {
      voiceReadiness = next;
      if (mounted) setReadiness(next);
    };
    const observe = async () => {
      try {
        stream = runtime.remote.$stream({
          name: 'Todo Harness voice setup',
          open: (signal) => runtime.speech.follow(signal),
          ended: voiceStreamEnded,
          carrierFailed: (failure) => update({ ...voiceReadiness, connected: false, error: voiceFailureMessage(failure) })
        });
        for await (const item of stream) {
          update({ catalog: item.value, connected: true, error: null });
          item.accept();
        }
      } catch (failure) {
        if (mounted) update({ ...voiceReadiness, connected: false, error: voiceFailureMessage(failure) });
      }
    };
    void observe();
    return () => {
      mounted = false;
      void stream?.dispose();
    };
  }, [runtime]);

  const provider = selectedVoiceProvider(readiness);
  const preparation = provider?.preparation;
  const phase = preparation?.phase;
  const ready = ['ready', 'standby', 'waking'].includes(phase);
  const busy = pending || busyPreparation(phase);
  const failure = error || (phase === 'failed' ? preparation.message : '') || readiness.error;
  const progress = voiceDownloadProgress(preparation);
  const estimate = provider?.setupEstimate;
  const isCancelling = cancelling || phase === 'cancelling';
  const status = !readiness.connected ? (readiness.error ? '语音服务连接中断' : '正在连接语音服务')
    : isCancelling ? '正在取消下载'
    : pending && !busyPreparation(phase) && !ready ? '正在启动准备'
    : voicePreparationLabel(phase);
  const statusIcon = phase === 'failed' || readiness.error ? IconWarningOutlineRegular
    : ready ? IconCheckCircleOutlineRegular
    : busy || !readiness.connected ? IconLoadingOutlineRegular : IconDownloadOutlineRegular;

  if (!open) return null;

  const close = () => setVoiceSetupOpen(false);
  const prepare = async () => {
    if (!runtime?.speech || !provider || busy || !readiness.connected) return;
    setPending(true);
    setError('');
    try {
      const result = await runtime.speech.prepare(provider.id, undefined);
      if (result && result.ok === false) throw result.error ?? new Error('语音模型下载失败');
    } catch (failureValue) {
      setError(voiceFailureMessage(failureValue));
    } finally {
      setPending(false);
    }
  };
  const cancel = async () => {
    if (!runtime?.speech || !provider || isCancelling || !readiness.connected) return;
    setCancelling(true);
    setError('');
    try {
      const result = await runtime.speech.cancelPreparation(provider.id);
      if (result && result.ok === false) throw result.error ?? new Error('无法取消语音模型下载');
    } catch (failureValue) {
      setError(voiceFailureMessage(failureValue));
    } finally {
      setCancelling(false);
    }
  };

  const footer = h('div', { className: 'todo-harness-voice-actions' },
    busy ? h(Button, { variant: 'ghost', onClick: cancel, disabled: isCancelling || !readiness.connected }, isCancelling ? '正在取消…' : '取消下载') : null,
    h('div', { className: 'todo-harness-voice-actions-primary' },
      h(Button, { variant: busy || ready ? 'primary' : 'ghost', onClick: close }, ready ? '完成' : busy ? '后台继续' : '稍后'),
      !busy && !ready ? h(Button, { variant: 'primary', onClick: prepare, disabled: !provider || !readiness.connected, 'data-modal-autofocus': true },
        h(phase === 'failed' || phase === 'cancelled' ? IconRefreshOutlineRegular : IconDownloadOutlineRegular, { size: 16, 'aria-hidden': true }),
        phase === 'failed' || phase === 'cancelled' ? '重试下载' : '下载并准备'
      ) : null
    )
  );
  return h(Modal, {
    open: true,
    title: '准备语音模型',
    closeLabel: '关闭',
    onClose: close,
    className: 'todo-harness-voice-modal',
    contentClassName: 'todo-harness-voice-content',
    footer
  }, h('div', { className: 'todo-harness-voice-setup', 'data-phase': phase ?? 'connecting' },
    h('div', { className: 'todo-harness-voice-model' },
      h('span', { className: 'todo-harness-voice-model-icon', 'aria-hidden': true }, h(IconMicrophoneOutlineRegular, { size: 22 })),
      h('div', null,
        h('strong', null, provider?.name ?? '语音识别模型'),
        h('p', null, provider ? (provider.location === 'host-local' ? '本地语音识别' : '云端语音识别') : '正在获取模型信息')
      )
    ),
    estimate && !busy && !ready ? h('dl', { className: 'todo-harness-voice-estimates' },
      h('div', null, h('dt', null, '建议磁盘空间'), h('dd', null, voiceByteText(estimate.recommendedDiskBytes))),
      h('div', null, h('dt', null, '预计运行内存'), h('dd', null, voiceByteText(estimate.expectedMemoryBytes))),
      h('div', null, h('dt', null, '预计准备时间'), h('dd', null, `${estimate.minimumMinutes}–${estimate.maximumMinutes} 分钟`))
    ) : null,
    h('div', { className: 'todo-harness-voice-status', 'data-tone': phase === 'failed' || readiness.error ? 'error' : ready ? 'ready' : 'default' },
      h('div', { className: 'todo-harness-voice-status-heading', role: 'status' },
        h(statusIcon, { size: 18, 'aria-hidden': true, className: statusIcon === IconLoadingOutlineRegular ? 'todo-harness-voice-spinner' : undefined }),
        h('strong', null, status)
      ),
      progress ? h('div', { className: 'todo-harness-voice-download' },
        h('div', { className: 'todo-harness-voice-download-heading' },
          h('span', { title: preparation.resource }, preparation.resource),
          h('span', null, progress.percent === undefined ? '下载中' : `${Math.floor(progress.percent)}%`)
        ),
        h('progress', { max: 100, value: progress.percent, 'aria-label': '当前文件下载进度', 'aria-valuetext': progress.bytes }),
        h('p', { className: 'todo-harness-voice-download-bytes' }, progress.bytes)
      ) : null,
      !busy && !ready && !failure ? h('p', { className: 'todo-harness-voice-hint' }, phase === 'cancelled' ? '再次准备时会检查已下载的文件。' : provider?.location === 'host-local' ? '模型文件保存在本机，仅首次使用需要下载。' : '等待准备语音服务。') : null
    ),
    preparation?.steps?.length ? h('ol', { className: 'todo-harness-voice-steps', 'aria-label': '模型准备步骤' }, preparation.steps.map((step, index) => {
      const state = step.status;
      const stepStatus = { pending: '待处理', running: '进行中', complete: '已完成', failed: '失败', cancelled: '已取消' }[state] ?? state;
      return h('li', { key: step.kind, 'data-state': state, 'aria-current': state === 'running' ? 'step' : undefined },
        h('span', { className: 'todo-harness-voice-step-icon', 'aria-hidden': true },
          state === 'complete' ? h(IconCheckOutlineRegular, { size: 14 })
            : state === 'running' && readiness.connected ? h(IconLoadingOutlineRegular, { size: 14, className: 'todo-harness-voice-spinner' })
            : state === 'failed' ? h(IconWarningOutlineRegular, { size: 14 }) : index + 1
        ),
        h('span', null, voiceStepLabel(step.kind)),
        h('span', { className: 'todo-harness-voice-step-status' }, state === 'running' && !readiness.connected ? '等待连接' : stepStatus)
      );
    })) : null,
    failure ? h('div', { className: 'todo-harness-voice-error', role: 'alert' },
      h('p', null, failure),
      phase === 'failed' ? h('p', { className: 'todo-harness-voice-hint' }, voiceDownloadAdvice(preparation.download?.reason)) : null,
      preparation?.download ? h('details', null,
        h('summary', null, '错误详情'),
        h('dl', null, Object.entries({ 文件: preparation.download.resource, 来源: preparation.download.source, 错误码: preparation.download.code, 状态码: preparation.download.status }).filter(([, value]) => value !== undefined && value !== '').map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, String(value)))))
      ) : null
    ) : null
  ));
}

function busyPreparation(phase) {
  return ['checking', 'downloading', 'loading', 'cancelling'].includes(phase);
}

  const inject = ['slots', 'sidebarRight', 'sidebarRightTabs', 'sessions', 'workspaces', 'uiWorkspace', 'remote', 'remote.speech', 'remote.settings', 'remote.schedule', 'remote.llm', 'remote.session', 'pluginNavigation', 'configForms', 'settingsSchema'];

function useSettingsState() {
  const [value, setValue] = useState(settingsValue);
  useEffect(() => {
    settingsListeners.add(setValue);
    loadGlobalSettings();
    return () => settingsListeners.delete(setValue);
  }, []);
  return value;
}

function publishSettings(value) {
  settingsValue = {
    agentName: typeof value?.agentName === 'string' && value.agentName.trim() ? value.agentName.trim() : DEFAULT_SETTINGS.agentName,
    dailyTokenBudget: Number.isSafeInteger(value?.dailyTokenBudget) && value.dailyTokenBudget >= 0 ? value.dailyTokenBudget : DEFAULT_SETTINGS.dailyTokenBudget
  };
  settingsLoaded = true;
  document.title = `Todo Harness - ${settingsValue.agentName}`;
  for (const listener of settingsListeners) listener(settingsValue);
}

function loadGlobalSettings() {
  if (settingsLoaded) return Promise.resolve(settingsValue);
  if (settingsLoad) return settingsLoad;
  settingsLoad = fetch(apiUrl('settings'), { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      return response.json();
    })
    .then((value) => {
      publishSettings(value);
      return settingsValue;
    })
    .catch((error) => {
      settingsLoad = null;
      throw error;
    });
  return settingsLoad;
}

async function saveGlobalSettings(patch) {
  const response = await fetch(apiUrl('settings'), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch)
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `Request failed (${response.status})`);
  publishSettings(value);
  return settingsValue;
}

function installNativeCopyObserver() {
  const replacements = new Map([
    ['换行', '换行，Enter 发送'],
    ['使用互补的 Queue／Steer 方式', '运行期间按 Cmd/Ctrl+Enter 使用另一发送方式（排队或插话）'],
    ['打开命令菜单', '按 / 打开指令菜单'],
    ['打开引用菜单', '按 @ 搜索文件和会话'],
    ['描述你的任务以生成计划', '描述需要推进的任务，Kre-Weave 会先整理计划'],
    ['输入目标，智能体将持续执行', '告诉 Kre-Weave 一个需要持续推进的目标'],
    ['当前目标进行中。可输入 edit 修改 / pause 暂停 / resume 继续 / clear 清除', '目标进行中。可继续补充任务，Kre-Weave 会同步维护待办。'],
    ['发消息或创建任务, / 调用指令, @ 文件或对话', '描述要处理的任务，或继续当前工作；/ 打开指令，@ 搜索文件与会话'],
    ['选择一个工作区开始', '正在 Todo-Harness 工作区开始新会话'],
    ['描述你想要构建的内容, / 调用指令, @ 文件或对话', '描述要处理的工作；可提问、添加文件或使用语音输入'],
    ['探索未至之境', '今天准备推进什么？'],
    ['预览版', ''],
    ['New line', 'Enter to send; Shift+Enter for a new line'],
    ['Use the complementary Queue / Steer action', 'During a run, press Cmd/Ctrl+Enter to queue or interrupt'],
    ['Open command menu', 'Press / to open commands'],
    ['Open reference menu', 'Press @ to search files and chats'],
    ['describe your task to generate plan', 'Describe the work to move forward; Kre-Weave will organize a plan'],
    ['describe the objective for a long-running task', 'Tell Kre-Weave about a goal that needs ongoing progress'],
    ['goal active — edit / pause / resume / clear', 'Goal in progress. Add tasks and Kre-Weave will keep Todo up to date.'],
    ['正在分析请求', '思考中'],
    ['已完成分析', '已完成思考'],
    ['深度求索正在思考', '思考中'],
    ['Analyzing the request', 'Thinking…'],
    ['Analysis completed', 'Thinking complete'],
    ['DeepSeek is thinking', 'Thinking…'],
    ['Into the Unknown', 'What would you like to move forward today?'],
    ['Preview', ''],
    ['Choose a workspace to start', 'Starting a new session in the Todo-Harness workspace'],
    ['Describe what you want to build, / commands, @ files or sessions', 'Describe the task you want completed, attach files, or use voice input'],
    ['Message or run a task, / commands, @ files or sessions', 'Describe a task or continue the current work; / commands, @ files and sessions'],
    ['开启后，显示轨迹、本轮代码差异，可选择完整的 Agent 预设切换', '开启后，显示运行轨迹和本轮代码差异']
  ]);
  const observedAttributes = ['aria-label', 'title', 'placeholder', 'data-placeholder', 'data-shimmer-text'];
  const observedAttributeSelector = observedAttributes.map((attribute) => `[${attribute}]`).join(', ');
  const replaceValue = (value) => {
    const text = value?.trim();
    const replacement = replacements.get(text);
    if (replacement !== undefined) return replacement;
    if (/^深度求索中/.test(text ?? '')) return value.replace(/^(\s*)深度求索中/, '$1思考中');
    if (/^DeepSeek is thinking/.test(text ?? '')) return value.replace(/^(\s*)DeepSeek is thinking/, '$1Thinking…');
    return value;
  };
  const visit = (root) => {
    if (root.nodeType === Node.TEXT_NODE) {
      const replacement = replaceValue(root.nodeValue);
      if (replacement !== root.nodeValue) root.nodeValue = replacement;
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const replacement = replaceValue(node.nodeValue);
      if (replacement !== node.nodeValue) node.nodeValue = replacement;
    }
    const updateAttributes = (element) => {
      for (const attribute of observedAttributes) {
        const value = element.getAttribute(attribute);
        const replacement = value === null ? null : replaceValue(value);
        if (replacement !== null && replacement !== value) element.setAttribute(attribute, replacement);
      }
    };
    if (root.matches?.(observedAttributeSelector)) updateAttributes(root);
    if (root.querySelectorAll) {
      for (const element of root.querySelectorAll(observedAttributeSelector)) updateAttributes(element);
    }
  };
  visit(document.body);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') visit(record.target);
      else if (record.type === 'attributes') visit(record.target);
      else for (const node of record.addedNodes) visit(node);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: observedAttributes });
  return () => observer.disconnect();
}

function installDocumentTitleBranding() {
  const updateTitle = () => {
    const title = document.title.replaceAll('DeepSeek Harness', 'Todo Harness');
    if (title !== document.title) document.title = title;
  };
  const observer = new MutationObserver(updateTitle);
  observer.observe(document.head, { childList: true, characterData: true, subtree: true });
  updateTitle();
  return () => observer.disconnect();
}

function installModelDiscoveryUrlInput() {
  if (!document.body) return () => {};
  const rememberCatalog = (event) => {
    const catalog = event.target?.closest?.('.zGbnIq_modelCatalog');
    if (!catalog) return;
    if (lastModelDiscoveryCatalog && lastModelDiscoveryCatalog !== catalog) lastModelDiscoveryUrl = '';
    lastModelDiscoveryCatalog = catalog;
  };
  const addInput = () => {
    for (const catalog of document.querySelectorAll('.zGbnIq_modelCatalog')) {
      const failure = [...catalog.children].find((child) => child.matches?.('p.zGbnIq_error'));
      const existingField = catalog.previousElementSibling;
      if (!failure || existingField?.matches?.('[data-todo-harness-model-url-field]')) continue;
      const field = document.createElement('label');
      field.className = 'todo-harness-model-url-field';
      field.dataset.todoHarnessModelUrlField = 'true';
      const label = document.createElement('span');
      label.textContent = '模型列表连接';
      const input = document.createElement('input');
      input.type = 'url';
      input.inputMode = 'url';
      input.autocomplete = 'url';
      input.placeholder = 'https://example.com/models';
      input.value = lastModelDiscoveryUrl;
      input.dataset.todoHarnessModelUrl = 'true';
      input.addEventListener('focus', () => { lastModelDiscoveryCatalog = catalog; });
      input.addEventListener('input', () => {
        lastModelDiscoveryCatalog = catalog;
        lastModelDiscoveryUrl = input.value;
      });
      field.append(label, input);
      catalog.insertAdjacentElement('beforebegin', field);
    }
  };
  document.addEventListener('click', rememberCatalog, true);
  addInput();
  const observer = new MutationObserver(addInput);
  observer.observe(document.body, { subtree: true, childList: true });
  return () => {
    observer.disconnect();
    document.removeEventListener('click', rememberCatalog, true);
    document.querySelectorAll('[data-todo-harness-model-url-field]').forEach((field) => field.remove());
    lastModelDiscoveryCatalog = undefined;
  };
}

function installModelDiscoveryRemote(remote) {
  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return () => {};
  const wrappedFetch = async function fetchWithModelDiscoveryUrl(input, init) {
    const requestUrl = input instanceof Request ? input.url : String(input);
    let parsedUrl;
    try { parsedUrl = new URL(requestUrl, window.location.href); }
    catch { return originalFetch.call(this, input, init); }
    if (!parsedUrl.pathname.endsWith('/api/llm/discoverModels')) {
      return originalFetch.call(this, input, init);
    }

    const catalog = document.activeElement?.closest?.('.zGbnIq_modelCatalog') ?? lastModelDiscoveryCatalog;
    const precedingField = catalog?.previousElementSibling;
    const modelUrlInput = precedingField?.matches?.('[data-todo-harness-model-url-field]')
      ? precedingField.querySelector?.('[data-todo-harness-model-url]')
      : catalog?.querySelector?.('[data-todo-harness-model-url]');
    const entered = modelUrlInput?.value?.trim() ?? (catalog === lastModelDiscoveryCatalog ? lastModelDiscoveryUrl.trim() : '');
    if (!entered) return originalFetch.call(this, input, init);

    let body = typeof init?.body === 'string' ? init.body : undefined;
    if (body === undefined && input instanceof Request) body = await input.clone().text();
    if (typeof body !== 'string') return originalFetch.call(this, input, init);

    let message;
    try { message = JSON.parse(body); }
    catch { return originalFetch.call(this, input, init); }
    if (message?.method !== 'llm/discoverModels' || !message?.payload?.args?.request) {
      return originalFetch.call(this, input, init);
    }
    message.payload.args.request.baseURL = normalizeModelDiscoveryBaseURL(entered);
    const nextBody = JSON.stringify(message);
    if (init) return originalFetch.call(this, input, { ...init, body: nextBody });
    if (input instanceof Request) return originalFetch.call(this, new Request(input, { body: nextBody }));
    return originalFetch.call(this, input, { body: nextBody });
  };
  window.fetch = wrappedFetch;
  return () => {
    if (window.fetch === wrappedFetch) window.fetch = originalFetch;
  };
}

function normalizeModelDiscoveryBaseURL(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\/models\/?$/i, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return raw.replace(/\/models\/?$/i, '').replace(/\/+$/, '');
  }
}

function BrandMark({ size = 24 }) {
  const settings = useSettingsState();
  const [imageUrl, setImageUrl] = useState(brandMarkUrl);
  useEffect(() => {
    let active = true;
    loadBrandMark().then((url) => {
      if (active) setImageUrl(url);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const style = { width: size, height: size, borderRadius: Math.min(6, size * 0.18) };
  return imageUrl
    ? h('img', { className: 'todo-harness-brand-mark', src: imageUrl, style, alt: '', 'aria-hidden': true })
    : h('span', { className: 'todo-harness-brand-mark todo-harness-brand-mark-fallback', style, 'aria-hidden': true }, Array.from(settings.agentName)[0] ?? 'K');
}

function loadBrandMark() {
  if (!brandMarkLoad) {
    brandMarkLoad = fetch(apiUrl('brand-mark'), { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        return response.blob();
      })
      .then((blob) => {
        brandMarkUrl = URL.createObjectURL(blob);
        return brandMarkUrl;
      })
      .catch((error) => {
        brandMarkLoad = null;
        throw error;
      });
  }
  return brandMarkLoad;
}

function installBrandMark() {
  let active = true;
  const icons = Array.from(document.querySelectorAll('link[rel~="icon"]'));
  const originalAttributes = icons.map((icon) => ({
    icon,
    href: icon.getAttribute('href'),
    type: icon.getAttribute('type'),
    media: icon.getAttribute('media'),
    sizes: icon.getAttribute('sizes')
  }));
  let addedIcon;
  loadBrandMark().then((url) => {
    if (!active) return;
    if (!icons.length) {
      addedIcon = document.createElement('link');
      addedIcon.rel = 'icon';
      document.head.append(addedIcon);
      icons.push(addedIcon);
    }
    for (const icon of icons) {
      icon.href = url;
      icon.type = 'image/png';
      icon.removeAttribute('media');
    }
  }).catch(() => {});
  return () => {
    active = false;
    addedIcon?.remove();
    for (const { icon, href, type, media, sizes } of originalAttributes) {
      for (const [attribute, value] of Object.entries({ href, type, media, sizes })) {
        if (value === null) icon.removeAttribute(attribute);
        else icon.setAttribute(attribute, value);
      }
    }
  };
}

function BrandName() {
  const settings = useSettingsState();
  return h('span', { className: 'todo-harness-brand-name' }, settings.agentName);
}

function AgentNameSettingsRow() {
  const settings = useSettingsState();
  const [draft, setDraft] = useState(settings.agentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setDraft(settings.agentName), [settings.agentName]);
  return h('div', { className: 'todo-harness-settings-row' },
    h('label', { className: 'todo-harness-settings-field' },
      h('span', null, '智能体名称'),
      h('input', {
        type: 'text',
        value: draft,
        maxLength: 60,
        autoComplete: 'off',
        onChange: (event) => setDraft(event.target.value)
      })
    ),
    h(Button, {
      type: 'button', variant: 'outline', size: 'sm', disabled: saving || !draft.trim() || draft.trim() === settings.agentName,
      onClick: async () => {
        setSaving(true);
        setError('');
        try { await saveGlobalSettings({ agentName: draft }); }
        catch (failure) { setError(failure.message); }
        finally { setSaving(false); }
      }
    }, saving ? '保存中' : '保存'),
    error ? h('span', { className: 'todo-harness-settings-error', role: 'alert' }, error) : null
  );
}

function TokenBudgetSettingsRow() {
  const settings = useSettingsState();
  const [draft, setDraft] = useState(String(settings.dailyTokenBudget));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setDraft(String(settings.dailyTokenBudget)), [settings.dailyTokenBudget]);
  return h('div', { className: 'todo-harness-settings-row' },
    h('label', { className: 'todo-harness-settings-field' },
      h('span', null, '每日 Token 预算'),
      h('input', {
        type: 'number',
        value: draft,
        min: 0,
        max: 1000000000,
        step: 1000,
        inputMode: 'numeric',
        onChange: (event) => setDraft(event.target.value)
      })
    ),
    h(Button, {
      type: 'button', variant: 'outline', size: 'sm', disabled: saving || !/^\d+$/.test(draft) || Number(draft) > 1000000000 || Number(draft) === settings.dailyTokenBudget,
      onClick: async () => {
        setSaving(true);
        setError('');
        try { await saveGlobalSettings({ dailyTokenBudget: Number(draft) }); }
        catch (failure) { setError(failure.message); }
        finally { setSaving(false); }
      }
    }, saving ? '保存中' : '保存'),
    error ? h('span', { className: 'todo-harness-settings-error', role: 'alert' }, error) : null
  );
}

function AgentSettingsSection() {
  return h('section', { className: 'todo-harness-agent-settings', 'aria-label': '智能体设置' },
    h('h2', null, '智能体'),
    h(AgentNameSettingsRow),
    h(TokenBudgetSettingsRow),
    h(ReasoningSettingsRow)
  );
}

function ReasoningSettingsRow() {
  const [catalog, setCatalog] = useState(null);
  const [selection, setSelection] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reasoningConfig, setReasoningConfig] = useState(null);
  const [configureOpen, setConfigureOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const ctx = runtimeContext;
  const load = useCallback(async () => {
    const request = ++generation.current;
    setStatus('loading');
    setError('');
    try {
      await waitForTodoHarnessRemote();
      const [catalogResult, defaultResult] = await Promise.all([
        ctx.remote.session.modelCatalog(),
        todoHarnessRemote(ctx).getDefaultModel()
      ]);
      if (!catalogResult.ok) throw new Error(catalogResult.error?.message ?? '模型目录读取失败');
      if (!defaultResult.ok) throw new Error(defaultResult.error?.message ?? '当前模型读取失败');
      const nextCatalog = catalogResult.value;
      const nextSelection = defaultResult.value;
      if (request !== generation.current) return;
      setCatalog(nextCatalog);
      setSelection(nextSelection);
      setDraft((current) => current ?? nextSelection);
      setStatus('ready');
    } catch (failure) {
      if (request !== generation.current) return;
      setError(failure.message);
      setStatus('error');
    }
  }, [ctx]);
  useEffect(() => {
    void load();
    const disposers = [
      ctx.on('connection/reset', load),
      ctx.remote.$on('llm/adapters-updated', load),
      ctx.remote.$on('settings/document-updated', load)
    ];
    return () => {
      generation.current++;
      for (const dispose of disposers) dispose?.();
    };
  }, [ctx, load]);

  const models = (catalog?.groups ?? []).flatMap((group) => group.models.map((model) => ({ group, model })));
  const selectedKey = draft ? modelSelectionKey(draft) : '';
  const selected = models.find(({ group, model }) => modelSelectionKey({ provider: group.id, model: model.id }) === selectedKey);
  const advertisedEfforts = selected?.model.reasoning?.efforts ?? [];
  const reasoningConfigurable = Boolean(reasoningConfig && selected && reasoningConfig.provider === selected.group.id && reasoningConfig.model === selected.model.id);
  const fallbackLevels = reasoningConfigurable ? suggestedReasoningLevels(reasoningConfig) : [];
  const efforts = advertisedEfforts.length ? advertisedEfforts : fallbackLevels.map((id) => ({ id }));
  const selectedEffort = efforts.some((effort) => effort.id === draft?.reasoningEffort) ? draft.reasoningEffort : '';
  const changed = Boolean(draft) && (selectedKey !== (selection ? modelSelectionKey(selection) : '') || selectedEffort !== (selection?.reasoningEffort ?? ''));
  useEffect(() => {
    let active = true;
    setReasoningConfig(null);
    if (!selected) {
      return () => { active = false; };
    }
    getModelReasoningSettingsTarget(ctx, selected.group.id, selected.model.id)
      .then((target) => { if (active) setReasoningConfig(target); })
      .catch(() => { if (active) setReasoningConfig(null); });
    return () => { active = false; };
  }, [ctx, selectedKey, status]);

  return h(React.Fragment, null,
    h('div', { className: 'todo-harness-settings-row todo-harness-reasoning-row' },
      h('label', { className: 'todo-harness-settings-field' },
        h('span', null, '当前模型'),
        h('select', {
          'aria-label': '当前模型', value: selectedKey, disabled: saving || status !== 'ready' || models.length === 0,
          onChange: (event) => {
            const entry = models.find(({ group, model }) => modelSelectionKey({ provider: group.id, model: model.id }) === event.target.value);
            if (!entry) return;
            setDraft({ provider: entry.group.id, model: entry.model.id });
            setMessage('');
          }
        },
        !selected ? h('option', { value: selectedKey }, draft ? `${draft.model}（不可用）` : status === 'loading' ? '读取模型中…' : '请选择模型') : null,
        (catalog?.groups ?? []).map((group) => h('optgroup', { key: group.id, label: group.name }, group.models.map((model) => h('option', { key: model.id, value: modelSelectionKey({ provider: group.id, model: model.id }) }, model.name ?? model.id)))))
      ),
      h('div', { className: 'todo-harness-settings-field todo-harness-reasoning-field' },
        h('label', { htmlFor: 'todo-harness-default-effort' }, '思考强度'),
        h('div', { className: 'todo-harness-reasoning-control' },
          h('select', {
            id: 'todo-harness-default-effort',
            value: selectedEffort, disabled: saving || status !== 'ready' || !efforts.length,
            onChange: (event) => { setDraft({ ...draft, reasoningEffort: event.target.value || undefined }); setMessage(''); }
          },
          h('option', { value: '' }, '模型默认'),
          efforts.map((effort) => h('option', { key: effort.id, value: effort.id }, reasoningEffortLabel(effort)))),
          reasoningConfigurable ? h(IconActionButton, {
            label: '配置此模型支持的思考强度', variant: 'ghost', size: 'sm', className: 'todo-harness-reasoning-configure',
            disabled: saving, onClick: () => setConfigureOpen(true)
          }, h(IconSlidersTwoOutlineRegular, { size: 16 })) : null
        )
      ),
      h(Button, {
        type: 'button', variant: 'outline', size: 'sm',
        disabled: status !== 'ready' || !selected || !changed || saving,
        onClick: async () => {
          if (!selected) return;
          setSaving(true);
          setError('');
          try {
            const next = {
              provider: selected.group.id,
              model: selected.model.id,
              ...(selectedEffort ? { reasoningEffort: selectedEffort } : {})
            };
            if (selectedEffort && !advertisedEfforts.some((effort) => effort.id === selectedEffort)) {
              const target = await getModelReasoningSettingsTarget(ctx, next.provider, next.model);
              if (!target || !suggestedReasoningLevels(target).includes(selectedEffort)) throw new Error('模型能力已变化，请重新读取后选择');
              const configured = await ctx.remote.settings.mutate('llm-pi-ai', [{ op: 'set', path: target.path, value: reasoningEffortMapping(suggestedReasoningLevels(target), target.efforts) }], target.revision);
              if (!configured.ok) throw new Error(configured.error?.message ?? '思考等级保存失败');
            }
            const result = await todoHarnessRemote(ctx).setDefaultModel(next);
            if (!result.ok) throw new Error(result.error?.message ?? '模型设置保存失败');
            setSelection(next);
            setDraft(next);
            setMessage('模型设置已保存');
          } catch (failure) {
            setError(failure.message);
          } finally {
            setSaving(false);
          }
        }
      }, saving ? '保存中' : '保存'),
      status === 'ready' && models.length === 0 ? h('span', { className: 'todo-harness-settings-help' }, '先完成模型提供商配置') : null,
      status === 'ready' && selected && efforts.length === 0 ? h('span', { className: 'todo-harness-settings-help' }, reasoningConfigurable ? '此模型未声明思考等级' : '此模型未提供可选思考等级') : null,
      status === 'ready' && selected && efforts.length === 0 && reasoningConfigurable ? h(Button, { variant: 'ghost', size: 'sm', className: 'todo-harness-reasoning-setup', onClick: () => setConfigureOpen(true) }, '配置支持的强度') : null,
      message ? h('span', { className: 'todo-harness-settings-help', role: 'status' }, message) : null,
      error ? h('span', { className: 'todo-harness-settings-error', role: 'alert' }, error) : null,
      status === 'error' ? h(Button, { variant: 'outline', size: 'sm', onClick: load }, '重新读取') : null
    ),
    configureOpen && selected ? h(ReasoningLevelsDialog, { provider: selected.group.id, model: selected.model.id, efforts, onClose: () => setConfigureOpen(false), onSaved: async () => { await load(); setMessage('思考等级已保存'); } }) : null
  );
}

function ReasoningLevelsDialog({ provider, model, efforts, onClose, onSaved }) {
  const [target, setTarget] = useState(null);
  const [levels, setLevels] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const ctx = runtimeContext;
  useEffect(() => {
    let active = true;
    getModelReasoningSettingsTarget(ctx, provider, model).then((value) => {
      if (!active) return;
      if (!value) throw new Error('此模型的 Provider 配置不可编辑');
      setTarget(value);
      setLevels(value.levels.length ? value.levels : efforts.map((effort) => effort.id));
    }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, [ctx, provider, model]);
  const save = async () => {
    if (!target || !levels.some((level) => level !== 'off') || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await ctx.remote.settings.mutate('llm-pi-ai', [{
        op: 'set', path: target.path, value: reasoningEffortMapping(levels, target.efforts)
      }], target.revision);
      if (!result.ok) throw new Error(result.error?.message ?? '思考等级保存失败');
      await onSaved();
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  };
  return h(Modal, { open: true, onClose: () => { if (!saving) onClose(); }, title: '配置思考强度', closeLabel: '关闭', className: 'todo-harness-modal', contentClassName: 'todo-harness-modal-content' },
      h('div', { className: 'todo-harness-editor todo-harness-reasoning-editor' },
        h('p', { className: 'todo-harness-editor-help' }, `模型：${provider} · ${model}`),
        h('fieldset', { className: 'todo-harness-reasoning-levels' },
          h('legend', null, '此模型支持的强度'),
          REASONING_LEVELS.map(([level, label]) => h('label', { className: 'todo-harness-reasoning-level', key: level },
            h('input', {
              type: 'checkbox', checked: levels.includes(level), disabled: !target || saving,
              onChange: (event) => setLevels((current) => event.target.checked ? [...current, level] : current.filter((item) => item !== level))
            }), label
          ))
        ),
        h('p', { className: 'todo-harness-editor-help' }, '请按 Provider 文档选择支持的等级；接口不接受所选等级时会拒绝请求。'),
        error ? h('p', { className: 'todo-harness-settings-error', role: 'alert' }, error) : null,
        h('div', { className: 'todo-harness-editor-actions' },
          h(Button, { type: 'button', variant: 'ghost', size: 'sm', disabled: saving, onClick: onClose }, '取消'),
          h(Button, { type: 'button', variant: 'primary', size: 'sm', disabled: !target || saving || !levels.some((level) => level !== 'off'), onClick: save }, saving ? '保存中' : '保存等级')
        )
      )
  );
}

function reasoningEffortLabel(effort) {
  return REASONING_LEVELS.find(([id]) => id === effort.id)?.[1] ?? effort.name ?? effort.id;
}

function reasoningEffortMapping(levels, existing = {}) {
  return Object.fromEntries(levels.map((level) => [level, Object.hasOwn(existing, level) ? existing[level] : level === 'off' ? null : level]));
}

function suggestedReasoningLevels(target) {
  if (target.disabled) return [];
  if (target.levels.length) return target.levels;
  if (!['openai-responses', 'openai-completions'].includes(target.api)) return [];
  if (!/^(?:gpt-[5-9](?:[.-]|$)|o[1-9](?:[.-]|$))/.test(target.model) || /(?:^|-)chat(?:-|$)/.test(target.model)) return [];
  return /(?:^|-)pro(?:-|$)/.test(target.model) ? ['high'] : ['low', 'medium', 'high'];
}

function modelSelectionKey(selection) {
  return `${selection.provider}\n${selection.model}`;
}

function buildDispatchModelChoices(catalog, previousSelection) {
  const entries = (catalog?.groups ?? []).flatMap((group) => (group.models ?? []).map((model) => ({ group, model })));
  const preferred = entries.find(({ group, model }) => group.id === catalog?.default?.provider && model.id === catalog.default.model);
  const initial = preferred ?? entries[0];
  const choices = entries.map(({ group, model }) => {
    const isPreferred = preferred?.group.id === group.id && preferred.model.id === model.id;
    const supportedEfforts = model.reasoning?.efforts ?? [];
    const isPrevious = previousSelection && modelSelectionKey(previousSelection) === modelSelectionKey({ provider: group.id, model: model.id });
    const previousEffort = isPrevious ? previousSelection.reasoningEffort : catalog?.default?.reasoningEffort;
    const reasoningEffort = (isPrevious || isPreferred) && previousEffort && supportedEfforts.some((effort) => effort.id === previousEffort)
      ? previousEffort
      : supportedEfforts.find((effort) => effort.id === model.reasoning?.defaultEffort)?.id;
    const selection = {
      provider: group.id,
      model: model.id,
      ...(reasoningEffort ? { reasoningEffort } : {})
    };
    return {
      key: modelSelectionKey(selection),
      providerName: group.name,
      modelName: model.name ?? model.id,
      reasoningEfforts: supportedEfforts,
      defaultEffort: supportedEfforts.find((effort) => effort.id === model.reasoning?.defaultEffort)?.id,
      selection
    };
  });
  const previous = previousSelection && choices.find((choice) => choice.key === modelSelectionKey(previousSelection));
  if (previous && !previousSelection.reasoningEffort) delete previous.selection.reasoningEffort;
  return {
    choices,
    selectedKey: previous?.key ?? (initial ? modelSelectionKey({ provider: initial.group.id, model: initial.model.id }) : ''),
    previousUnavailable: Boolean(previousSelection && (!previous || (previousSelection.reasoningEffort && !previous.reasoningEfforts.some((effort) => effort.id === previousSelection.reasoningEffort))))
  };
}

const REASONING_LEVELS = [
  ['off', '关闭'], ['minimal', '最小'], ['low', '低'], ['medium', '中'], ['high', '高'], ['xhigh', '超高'], ['max', '最大']
];

function DispatchModelSelect({ choices, selection, status, disabled, onChange, label = '执行模型', id = 'model', helpId }) {
  const [open, setOpen] = useState(false);
  const [menuWidth, setMenuWidth] = useState(0);
  const anchorRef = useRef(null);
  useEffect(() => {
    const element = anchorRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setMenuWidth(element.getBoundingClientRect().width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const selectedKey = selection ? modelSelectionKey(selection) : '';
  const selected = choices.find((choice) => choice.key === selectedKey);
  const providers = [...new Set(choices.map((choice) => choice.selection.provider))];
  const items = providers.flatMap((provider) => {
    const models = choices.filter((choice) => choice.selection.provider === provider);
    return [
      ...(models[0].providerName ? [{ type: 'label', id: `provider:${provider}`, text: models[0].providerName }] : []),
      ...models.map((choice) => ({
        id: choice.key,
        label: h('span', { className: 'todo-harness-dispatch-model-option' },
          h('span', null, choice.modelName),
          choice.providerName && choice.modelName !== choice.selection.model ? h('small', null, choice.selection.model) : null)
      }))
    ];
  });
  return h('div', { className: 'todo-harness-settings-field' },
    open ? h('style', null, `.todo-harness-dispatch-${id}-list{width:${menuWidth}px!important}`) : null,
    h('span', { id: `todo-harness-dispatch-${id}-label` }, label),
    h(Menu, {
      open: open && !disabled && status === 'ready',
      portal: true,
      autoFocus: true,
      className: 'todo-harness-dispatch-model-menu',
      listClassName: `todo-harness-dispatch-model-list todo-harness-dispatch-${id}-list`,
      getAnchorRect: () => anchorRef.current?.getBoundingClientRect() ?? null,
      selectedId: selectedKey,
      items,
      onClose: () => setOpen(false),
      onSelect: (key) => {
        const choice = choices.find((item) => item.key === key);
        if (choice) onChange(choice.selection);
        setOpen(false);
      },
      anchor: h('button', {
        type: 'button', className: 'todo-harness-dispatch-model-trigger',
        ref: anchorRef,
        disabled: disabled || status !== 'ready',
        'aria-labelledby': `todo-harness-dispatch-${id}-label todo-harness-dispatch-${id}-value`,
        'aria-describedby': helpId,
        'aria-haspopup': 'menu', 'aria-expanded': open,
        onClick: () => setOpen((value) => !value),
        onKeyDown: (event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
        }
      },
      h('span', { className: 'todo-harness-dispatch-model-value', id: `todo-harness-dispatch-${id}-value` },
        h('strong', null, selected?.modelName ?? (status === 'loading' ? '正在读取模型…' : '暂无可用模型')),
        selected?.providerName ? h('small', null, selected.providerName) : null),
      h(IconChevronDownOutlineRegular, { size: 16, 'aria-hidden': true }))
    })
  );
}

function DispatchDirectoryDialog({ initialPath, onSelect, onClose }) {
  const [path, setPath] = useState(initialPath);
  const [address, setAddress] = useState(initialPath ?? '');
  const [listing, setListing] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [saving, setSaving] = useState(false);
  const [native, setNative] = useState(false);
  const active = useRef(true);
  const ctx = runtimeContext;
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setError('');
    ctx.uiWorkspace.listDirectory(path, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setListing(next);
      setAddress(next.path);
      setStatus('ready');
    }).catch((failure) => {
      if (controller.signal.aborted) return;
      if (failure.rpcError?.code === 'directory-picker/unavailable' && failure.rpcError.details?.capability === 'native') {
        setNative(true);
        setStatus('ready');
        return;
      }
      setStatus('error');
      setError(`无法读取目录：${failure.message}`);
    });
    return () => controller.abort();
  }, [ctx, path, revision]);
  const navigate = (next) => {
    setCreating(false);
    setFolderName('');
    setStatus('loading');
    setPath(next);
    setRevision((value) => value + 1);
  };
  const parent = listing?.crumbs?.at(-2);
  const entries = (listing?.entries ?? []).filter((entry) => showHidden || !entry.hidden);
  const createFolder = async (event) => {
    event.preventDefault();
    if (saving || status !== 'ready' || !folderName.trim()) return;
    setSaving(true);
    setError('');
    try {
      const createdPath = await ctx.uiWorkspace.createDirectory(listing.path, folderName.trim());
      if (active.current) navigate(createdPath);
    } catch (failure) {
      if (active.current) setError(`无法新建文件夹：${failure.message}`);
    } finally {
      if (active.current) setSaving(false);
    }
  };
  const pickNative = async () => {
    setSaving(true);
    setError('');
    try {
      const selected = await (window.__DSH_DIRECTORY_PICKER__?.pick?.() ?? ctx.uiWorkspace.pickDirectory());
      if (active.current && selected) onSelect(selected);
    } catch (failure) {
      if (active.current) setError(`无法选择目录：${failure.message}`);
    } finally {
      if (active.current) setSaving(false);
    }
  };
  return h(Modal, {
    open: true, title: '选择工作目录', closeLabel: '取消', onClose: () => { if (!saving) onClose(); },
    className: 'todo-harness-modal todo-harness-directory-modal', contentClassName: 'todo-harness-directory-content',
    footer: h('div', { className: 'todo-harness-directory-footer' },
      !native ? h('label', { className: 'todo-harness-directory-hidden' },
        h('input', { type: 'checkbox', checked: showHidden, disabled: saving, onChange: (event) => setShowHidden(event.target.checked) }), '显示隐藏目录') : null,
      h('div', { className: 'todo-harness-directory-actions' },
        h(Button, { type: 'button', variant: 'ghost', size: 'sm', disabled: saving, onClick: onClose }, '取消'),
        h(Button, { type: 'button', variant: 'primary', size: 'sm', disabled: status !== 'ready' || saving || creating || (native && !address.trim()), onClick: () => onSelect(native ? address.trim() : listing.path) }, '使用此目录')))
  },
    h('div', { className: 'todo-harness-directory-browser' },
      h('form', { className: 'todo-harness-directory-address', onSubmit: (event) => { event.preventDefault(); if (!saving && address.trim()) { if (native) onSelect(address.trim()); else navigate(address.trim()); } } },
        h(IconActionButton, { type: 'button', variant: 'ghost', size: 'sm', label: '上一级目录', disabled: !parent || status !== 'ready' || saving, onClick: () => navigate(parent.path) }, h(IconChevronLeftOutlineRegular, { size: 16 })),
        h('input', { 'aria-label': '目录路径', 'data-modal-autofocus': true, value: address, disabled: saving, placeholder: '输入目录的完整路径', onChange: (event) => setAddress(event.target.value) }),
        h(IconActionButton, { type: 'submit', variant: 'ghost', size: 'sm', label: '打开路径', disabled: saving || !address.trim() }, h(IconChevronRightOutlineRegular, { size: 16 }))),
      !native ? h('div', { className: 'todo-harness-directory-toolbar' },
        h('span', null, '文件夹'),
        h(Button, { type: 'button', variant: 'ghost', size: 'sm', disabled: status !== 'ready' || saving, onClick: () => { setCreating((value) => !value); setFolderName(''); setError(''); } }, h(IconPlusOutlineRegular, { size: 14 }), '新建文件夹')) : null,
      creating ? h('form', { className: 'todo-harness-directory-create', onSubmit: createFolder },
        h('input', { 'aria-label': '新文件夹名称', autoFocus: true, value: folderName, disabled: saving, placeholder: '文件夹名称', onChange: (event) => setFolderName(event.target.value) }),
        h(Button, { type: 'submit', variant: 'outline', size: 'sm', disabled: saving || !folderName.trim() }, saving ? '创建中…' : '创建')) : null,
      error ? h('p', { className: 'todo-harness-settings-error', role: 'alert' }, error) : null,
      h('div', { className: 'todo-harness-directory-entries', 'aria-busy': status === 'loading' },
        native ? h('div', { className: 'todo-harness-directory-native' },
          h(IconFolderCloseRegular, { size: 28, 'aria-hidden': true }),
          h(Button, { type: 'button', variant: 'outline', size: 'sm', disabled: saving, onClick: pickNative }, saving ? '等待选择…' : '打开系统目录选择器'),
          h('p', { className: 'todo-harness-settings-help' }, '也可直接输入工作目录的完整路径。'))
          : status === 'loading' ? h('p', { className: 'todo-harness-settings-help', role: 'status' }, '正在读取目录…')
          : status === 'error' ? h(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: () => navigate(path) }, h(IconRefreshOutlineRegular, { size: 14 }), '重试')
            : entries.length ? entries.map((entry) => h('button', {
              type: 'button', key: entry.path, className: 'todo-harness-directory-entry', disabled: saving,
              onClick: () => navigate(entry.path)
            }, h(IconFolderCloseRegular, { size: 17, 'aria-hidden': true }), h('span', null, entry.name), h(IconChevronRightOutlineRegular, { size: 14, 'aria-hidden': true })))
              : h('p', { className: 'todo-harness-settings-help' }, '此目录下没有可显示的子文件夹')),
      listing && status === 'ready' ? h('p', { className: 'todo-harness-directory-location' }, listing.path) : null,
      listing?.truncated ? h('p', { className: 'todo-harness-settings-help' }, '目录较多，仅显示部分文件夹；可输入完整路径继续。') : null)
  );
}

async function getModelReasoningSettingsTarget(ctx, provider, model) {
  const mirror = ctx.configForms?.describe?.();
  const schema = ctx.settingsSchema;
  if (!mirror || !schema || typeof mirror.ensure !== 'function' || typeof schema.getPath !== 'function') return null;
  await mirror.ensure();
  const view = mirror.getSnapshot?.()?.view;
  const namespace = view?.namespaces?.find((candidate) => candidate.ns === 'llm-pi-ai');
  if (!view?.writable || !namespace) return null;
  const providerProfile = schema.getPath(namespace.user, ['providers', provider]);
  if (!providerProfile || typeof providerProfile !== 'object') return null;

  const configuredModels = schema.getPath(providerProfile, ['models']);
  let path;
  let configuredEfforts;
  if (Array.isArray(configuredModels)) {
    const modelIndex = configuredModels.findIndex((candidate) => candidate?.id === model);
    if (modelIndex === -1) return null;
    path = ['providers', provider, 'models', String(modelIndex), 'reasoningEfforts'];
    configuredEfforts = configuredModels[modelIndex].reasoningEfforts;
  } else {
    path = ['providers', provider, 'modelOverrides', model, 'reasoningEfforts'];
    configuredEfforts = schema.getPath(providerProfile, ['modelOverrides', model, 'reasoningEfforts']);
  }
  return {
    provider,
    model,
    api: schema.getPath(providerProfile, ['api']),
    disabled: configuredEfforts === false,
    efforts: configuredEfforts && typeof configuredEfforts === 'object' && !Array.isArray(configuredEfforts) ? configuredEfforts : {},
    path,
    revision: namespace.revision,
    levels: configuredEfforts && typeof configuredEfforts === 'object' && !Array.isArray(configuredEfforts)
      ? Object.keys(configuredEfforts).filter((level) => REASONING_LEVELS.some(([id]) => id === level))
      : []
  };
}

function ProviderSetupOnboarding({ complete, openSection, automatic, explicit = false }) {
  const ctx = runtimeContext;
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setStatus('loading');
    setError('');
    try {
      const result = await ctx.remote.session.modelCatalog();
      const modelCount = result.ok
        ? (result.value?.groups ?? []).reduce((count, group) => count + (group.models?.length ?? 0), 0)
        : 0;
      if (modelCount > 0 && !explicit) {
        complete();
        return;
      }
      if (!result.ok) setError(result.error?.message ?? '暂时无法读取模型目录');
      setStatus('ready');
    } catch (failure) {
      setError(failure.message);
      setStatus('ready');
    }
  }, [complete, ctx, explicit]);

  useEffect(() => {
    if ((automatic || explicit) && status === 'idle') load();
  }, [automatic, explicit, load, status]);

  if (!automatic && !explicit) return null;
  if (status === 'idle' || status === 'loading') return null;

  const openProviderSettings = () => {
    complete();
    openSection?.('models');
  };
  return h(Modal, {
    open: true,
    title: '配置模型 Provider',
    closeLabel: '稍后设置',
    onClose: complete,
    className: 'todo-harness-provider-onboarding-modal'
  },
  h('div', { className: 'todo-harness-provider-onboarding' },
    h('p', null, '首次使用前，请先配置一个模型 Provider。推荐使用 DeepSeek，也可以添加 OpenAI、Anthropic 或其他兼容接口。'),
    h('p', { className: 'todo-harness-provider-onboarding-help' }, error || '配置完成后，返回对话即可开始工作。'),
    h('div', { className: 'todo-harness-editor-actions' },
      h(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: complete }, '稍后设置'),
      h(Button, { type: 'button', variant: 'primary', size: 'sm', onClick: openProviderSettings }, '打开 Provider 设置'))
  ));
}

function ProviderRecommendationBadge({ provider }) {
  if (provider?.provider !== 'deepseek') return null;
  return h('span', {
    className: 'todo-harness-provider-recommendation',
    title: '推荐 Provider'
  }, '推荐');
}

function apply(ctx) {
  runtimeContext = ctx;
  const effect = ctx.effect.bind(ctx);
  effect(() => {
    voiceSetupRuntime = { remote: ctx.remote, speech: ctx.remote?.speech };
    voiceReadiness = { catalog: null, connected: false, error: null };
    return () => {
      if (voiceSetupRuntime?.remote === ctx.remote) voiceSetupRuntime = undefined;
      voiceReadiness = { catalog: null, connected: false, error: null };
      setVoiceSetupOpen(false);
    };
  }, 'todo-harness: voice setup runtime');
  effect(() => {
    const mounted = ctx.remote.$mount(TODO_HARNESS_REMOTE);
    todoHarnessRemoteReady = mounted;
    return mounted;
  }, 'todo-harness: Remote contribution');
  effect(() => installVoiceSetupNavigation(ctx), 'todo-harness: voice setup navigation');
  effect(installVoiceSetupTrigger, 'todo-harness: voice setup trigger');
  effect(installStyles, 'todo-harness: styles');
  effect(installBrandMark, 'todo-harness: brand mark');
  effect(installDocumentTitleBranding, 'todo-harness: document title branding');
  effect(installNativeCopyObserver, 'todo-harness: native copy observer');
  effect(installModelDiscoveryUrlInput, 'todo-harness: model discovery URL input');
  effect(installModelDiscoveryRemote, 'todo-harness: model discovery URL override');
  effect(() => ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({
    name: 'sidebar.brand.mark',
    id: 'todo-harness:brand-mark'
  }, BrandMark)), 'todo-harness: sidebar brand mark');
  effect(() => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({
    name: 'sidebar.brand.name',
    id: 'todo-harness:brand-name'
  }, BrandName)), 'todo-harness: sidebar brand name');
  effect(() => ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({
    name: 'conversation.hero.brand.mark',
    id: 'todo-harness:hero-mark',
    order: 100
  }, BrandMark)), 'todo-harness: conversation brand mark');
  effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock', id: 'todo-harness:quick-requests', order: -20
  }, QuickRequests)), 'todo-harness: quick requests');
  effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'todo-harness-agent', order: 5, label: () => '智能体'
  }, AgentSettingsSection)), 'todo-harness: agent settings section');
  effect(() => ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'todo-harness:provider-setup',
    order: -50,
    inject: () => ({ automatic: true })
  }, ProviderSetupOnboarding)), 'todo-harness: provider setup onboarding');
  effect(() => ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: 'llm-pi-ai'
  }, ProviderRecommendationBadge)), 'todo-harness: DeepSeek provider recommendation');
  effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'todo-harness:mobile-todo-toggle',
    order: 10
  }, MobileTodoSidebarToggle)), 'todo-harness: mobile Todo sidebar toggle');
  effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'todo-harness:daily-token-usage',
    order: 20
  }, TokenUsageSidebarItem)), 'todo-harness: daily token usage');
  effect(() => {
    loadGlobalSettings();
    const applyStandardPreset = () => ctx.remote.settings.update('agent-preset-registry', { selectedDefault: 'standard' }, undefined).catch(() => {});
    applyStandardPreset();
    ctx.on('connection/reset', applyStandardPreset);
  }, 'todo-harness: standard preset default');
  effect(() => ctx.sidebarRightTabs.register({
    id: TODO_TAB_ID,
    kind: TODO_TAB_KIND,
    title: () => '待办',
    guide: [{ id: 'todo-list', order: 20, title: () => '待办' }]
  }), 'todo-harness: right sidebar tab type');
  effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TODO_TAB_ID
  }, TodoPanel)), 'todo-harness: right sidebar tab');
  effect(() => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title',
    key: TODO_TAB_ID
  }, TodoTabTitle)), 'todo-harness: persistent Todo tab title');
  effect(installTodoCloseGuard, 'todo-harness: prevent Todo tab closure');
  effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'todo-harness:session-opener',
    order: 90
  }, SessionTodoOpener)), 'todo-harness: open todos in new sessions');
  effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'todo-harness:voice-setup',
    order: 80
  }, VoiceSetupOverlay)), 'todo-harness: voice setup dialog');

  function TodoTabTitle() {
    return h('span', { 'data-todo-harness-tab-title': true }, '待办');
  }

  function installTodoCloseGuard() {
    const preventClose = (event) => {
      if (event.code !== 'KeyW' || !event.altKey || !(event.metaKey || event.ctrlKey)) return;
      const activeTodo = document.querySelector('[data-sidebar-right-open] [role="tab"][aria-selected="true"] [data-todo-harness-tab-title]');
      if (!activeTodo) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    document.addEventListener('keydown', preventClose, true);
    return () => document.removeEventListener('keydown', preventClose, true);
  }

  function SessionTodoOpener() {
    useEffect(() => {
      let mounted = true;
      const opening = new Set();
      const timers = new Set();
      const hasTodoTab = (sessionId) => ctx.sidebarRight.openTabs.getSnapshot().some((tab) => tab.sessionId === sessionId && tab.kind === TODO_TAB_KIND);
      const openFor = (sessionId) => {
        if (!sessionId || hasTodoTab(sessionId) || opening.has(sessionId)) return;
        if (window.matchMedia('(max-width: 767px)').matches) return;
        opening.add(sessionId);
        let attempts = 0;
        const attempt = () => {
          timers.delete(timer);
          if (!mounted || ctx.sidebarRight.mounted.getSnapshot() !== sessionId) {
            opening.delete(sessionId);
            return;
          }
          if (hasTodoTab(sessionId)) {
            opening.delete(sessionId);
            return;
          }
          try {
            ctx.sidebarRight.openTab(TODO_TAB_KIND);
            opening.delete(sessionId);
          } catch {
            attempts += 1;
            if (attempts < 60) {
              timer = window.setTimeout(attempt, 50);
              timers.add(timer);
            } else opening.delete(sessionId);
          }
        };
        let timer = window.setTimeout(attempt, 0);
        timers.add(timer);
      };
      const ensureTodo = () => openFor(ctx.sidebarRight.mounted.getSnapshot());
      const unsubscribeMounted = ctx.sidebarRight.mounted.subscribe(ensureTodo);
      const unsubscribeTabs = ctx.sidebarRight.openTabs.subscribe(ensureTodo);
      openFor(ctx.sidebarRight.mounted.getSnapshot());
      return () => {
        mounted = false;
        unsubscribeMounted();
        unsubscribeTabs();
        for (const timer of timers) window.clearTimeout(timer);
      };
    }, []);
    return null;
  }
}

function TodoTopNavigation({ segment, onChange, onSearch, onFilter, onCreate, onRefresh, onCollapse }) {
  const options = [
    { value: 'today', label: '今日待办' },
    { value: 'plan', label: '计划' },
    { value: 'scheduled', label: '定时任务' }
  ];
  return h('nav', { className: 'todo-harness-topnav', 'aria-label': '待办视图' },
    h('div', { className: 'todo-harness-topnav-tabs', role: 'tablist', 'aria-label': '待办视图' }, options.map((option, index) => {
      const selected = segment === option.value;
      return h('button', {
        type: 'button',
        id: `todo-harness-todo-view-${option.value}`,
        role: 'tab',
        'aria-selected': selected,
        tabIndex: selected ? 0 : -1,
        className: `todo-harness-topnav-tab${selected ? ' is-active' : ''}`,
        onClick: () => onChange(option.value),
        onKeyDown: (event) => {
          const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
          if (!delta) return;
          event.preventDefault();
          const next = options[(index + delta + options.length) % options.length];
          onChange(next.value);
          document.getElementById(`todo-harness-todo-view-${next.value}`)?.focus();
        }
      }, option.label);
    })),
    h('div', { className: 'todo-harness-topnav-actions' },
      segment !== 'scheduled' ? h(IconActionButton, { type: 'button', variant: 'ghost', size: 'sm', className: 'todo-harness-topnav-action', icon: h(IconSearchOutlineRegular, { size: 18 }), label: '搜索待办', 'aria-pressed': onSearch.open, onClick: onSearch.toggle }) : null,
      segment !== 'scheduled' ? h(IconActionButton, { type: 'button', variant: 'ghost', size: 'sm', className: 'todo-harness-topnav-action', icon: h(IconSlidersTwoOutlineRegular, { size: 18 }), label: '筛选待办', 'aria-pressed': onFilter.open, onClick: onFilter.toggle }) : null,
      h(IconActionButton, { type: 'button', variant: 'ghost', size: 'sm', className: 'todo-harness-topnav-action todo-harness-create-action', icon: h(IconPlusOutlineRegular, { size: 17 }), label: segment === 'scheduled' ? '新建定时任务' : segment === 'plan' ? '新建计划' : '新建待办', disabled: onCreate.disabled, onClick: onCreate.run }),
      h(IconActionButton, { type: 'button', variant: 'ghost', size: 'sm', className: 'todo-harness-topnav-action', icon: h(IconRefreshOutlineRegular, { size: 17 }), label: segment === 'scheduled' ? '刷新定时任务' : '刷新列表', onClick: onRefresh }),
      h(IconActionButton, { type: 'button', variant: 'ghost', size: 'sm', className: 'todo-harness-topnav-action todo-harness-collapse-button', icon: h(IconChevronRightOutlineRegular, { size: 17 }), label: '折叠待办栏', onClick: onCollapse })
    )
  );
}

function QuickRequests({ session, inputActions, input }) {
  const anchor = useRef(null);
  const [target, setTarget] = useState(null);
  const hidden = session?.running || session?.awaitingFirstTurn || input?.phase === 'submitting';
  useEffect(() => {
    const root = anchor.current?.closest('[data-conversation-region="chat"]');
    if (!root) return undefined;
    const update = () => setTarget(root.querySelector('.pXSMma_workspace')?.parentElement ?? null);
    const observer = new MutationObserver(update);
    observer.observe(root, { childList: true, subtree: true });
    update();
    return () => observer.disconnect();
  }, []);
  const options = [
    ['梳理今日待办', IconCheckCircleOutlineRegular, '先读取我的待办和计划，结合当前时间、可用时间、优先级、截止日期与预估工时，梳理今天应该推进的事项，合理提前安排，并指出逾期、冲突和可调整空间。先整理建议，不要开始执行任务。'],
    ['统计本周工作', IconClockOutlineRegular, '先读取我的待办和计划，统计本周已完成、进行中、剩余事项与预估工时，列出逾期、受阻和需要协调的工作。只做统计，不要开始执行任务。'],
    ['写周报', IconEditOutlineRegular, '先读取我的待办和计划，根据本周已完成事项、当前进展、问题和下周计划整理一份周报。缺少的信息请明确标注，不要编造完成情况。']
  ];
  const content = hidden ? null : h('nav', { className: 'todo-harness-quick-actions', 'aria-label': '快捷请求' }, options.map(([label, Icon, prompt]) => h(Button, {
    key: label, type: 'button', variant: 'ghost', size: 'sm', className: 'todo-harness-quick-action', icon: h(Icon, { size: 14 }),
    disabled: !inputActions || input?.phase !== 'plain', onClick: () => {
      if (input?.draft) inputActions.insertText(`\n${prompt}`, inputActions.captureInsertion());
      else inputActions.setDraft(prompt);
      anchor.current?.closest('[data-conversation-region="chat"]')?.querySelector('[contenteditable="true"]')?.focus();
    }
  }, label)));
  return h('div', { ref: anchor, hidden, className: `todo-harness-quick-requests${target ? ' is-portaled' : ''}` }, target ? createPortal(content, target) : content);
}

function TodoPanelTitle({ segment, todos, activeSchedules, scheduleCount, now, selectedPlanDate, planRangeDays = 7, onPlanDateSelect, onPlanRangeSelect, dataStatus }) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  useEffect(() => setCalendarOpen(false), [segment]);
  const planStart = startOfPlanRange(selectedPlanDate ? `${selectedPlanDate}T12:00:00` : now);
  const planEnd = new Date(planStart);
  planEnd.setDate(planEnd.getDate() + planRangeDays - 1);
  const rangeFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', ...(planStart.getFullYear() !== new Date(now).getFullYear() || planStart.getFullYear() !== planEnd.getFullYear() ? { year: 'numeric' } : {}) });
  const planRangeLabel = `${rangeFormat.format(planStart)} - ${rangeFormat.format(planEnd)}`;
  const todayTodos = selectTodos(todos, 'today', true, now);
  const values = segment === 'scheduled'
      ? [['已开启', activeSchedules], ['全部任务', scheduleCount]]
      : [['总任务', todayTodos.length], ['已完成', todayTodos.filter((todo) => todo.status === 'done').length], ['进行中', todayTodos.filter((todo) => todo.status === 'in_progress').length], ['待处理', todayTodos.filter((todo) => todo.status === 'todo').length]];
  return h('header', { className: `todo-harness-panel-title todo-harness-panel-title-${segment}`, 'aria-label': segment === 'plan' ? '计划导航与统计' : undefined },
    h('div', { className: 'todo-harness-panel-title-copy' },
      segment === 'plan'
        ? h('div', { className: 'todo-harness-plan-title-heading' }, h('h1', null, '计划'),
          h('div', { className: 'todo-harness-plan-title-actions' },
            h(PlanDateShortcuts, { now, selectedDate: selectedPlanDate, onSelect: onPlanDateSelect }),
            h(Tooltip, { label: '选择开始日期', delayMs: 350, focusDelayMs: 0 },
              h(Button, { type: 'button', variant: 'outline', size: 'sm', className: 'todo-harness-plan-calendar-trigger', icon: h(IconPlanOutlineRegular, { size: 16 }), 'aria-label': `选择计划日期，当前范围 ${planRangeLabel}`, 'aria-haspopup': 'dialog', 'aria-expanded': calendarOpen, onClick: () => setCalendarOpen(true) },
                h('span', null, planRangeLabel), h(IconChevronDownOutlineRegular, { size: 14, 'aria-hidden': true })))))
        : h('h1', null, segment === 'scheduled' ? '定时任务' : '今日待办'),
      segment !== 'plan' ? h('span', null, segment === 'scheduled' ? `${activeSchedules} 个运行中` : `今天　${formatDateWithWeekday(now)}`) : null
    ),
    segment === 'plan' ? h('div', { className: 'todo-harness-plan-date-navigation' },
      h(PlanSummary, { todos, now, selectedDate: selectedPlanDate, rangeDays: planRangeDays, dataStatus }),
      h(PlanWeekStrip, { now, selectedDate: selectedPlanDate, rangeDays: planRangeDays, onSelect: onPlanDateSelect })) : null,
    segment !== 'plan' ? h('div', { className: 'todo-harness-panel-title-metrics' }, values.map(([label, value]) => h('div', { className: 'todo-harness-panel-title-metric', key: label }, h('strong', null, formatNumber(value)), h('span', null, label)))) : null,
    h(Modal, { open: calendarOpen && segment === 'plan', onClose: () => setCalendarOpen(false), title: '选择计划范围', closeLabel: '关闭日历', className: 'todo-harness-plan-calendar-modal' },
      calendarOpen ? h(PlanCalendar, { todos, now, selectedDate: selectedPlanDate, rangeDays: planRangeDays, onApply: (key, days) => { onPlanRangeSelect(key, days); setCalendarOpen(false); } }) : null)
  );
}

function PlanDateShortcuts({ now, selectedDate, onSelect }) {
  const options = planDateShortcuts(now);
  return h('nav', { className: 'todo-harness-plan-shortcuts', 'aria-label': '快捷日期' },
    h('div', { className: 'todo-harness-plan-day-shortcuts', role: 'group', 'aria-label': '按日跳转' },
      options.map((option) => h('button', {
        type: 'button', key: option.label, 'aria-pressed': selectedDate === option.date,
        onClick: () => onSelect(option.date)
      }, option.label))));
}

function PlanSummary({ todos, now, selectedDate, rangeDays = 7, dataStatus = 'ready' }) {
  const summary = summarizePlan(todos, selectedDate, rangeDays, now);
  const hours = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(Math.ceil(summary.estimatedMinutes / 6) / 10);
  return h('section', { className: 'todo-harness-plan-summary', 'aria-label': '计划统计', 'aria-busy': dataStatus === 'loading' },
    dataStatus !== 'ready'
      ? h('p', { className: 'todo-harness-plan-summary-state', role: 'status' }, dataStatus === 'error' ? '统计暂不可用' : '正在读取统计')
      : h('dl', { className: 'todo-harness-plan-summary-metrics', 'aria-live': 'polite' },
          h('div', null, h('dt', null, h(IconCheckCircleOutlineRegular, { size: 14, 'aria-hidden': true }), '剩余任务'), h('dd', null, h('strong', null, formatNumber(summary.remainingCount)), h('span', null, '项'))),
          h('div', null, h('dt', null, h(IconClockOutlineRegular, { size: 14, 'aria-hidden': true }), '预计工时'), h('dd', null, h('strong', null, hours), h('span', null, '小时'))))
  );
}

function PlanWeekStrip({ now, selectedDate, rangeDays = 7, onSelect }) {
  const start = startOfPlanRange(`${selectedDate}T12:00:00`);
  const days = Array.from({ length: Math.min(rangeDays, 366) }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    return date;
  });
  const todayKey = localDateKey(new Date(now));
  return h('div', { className: 'todo-harness-plan-week-strip', 'aria-label': '计划日期' },
    h(IconActionButton, { type: 'button', variant: 'ghost', size: 'sm', className: 'todo-harness-plan-week-arrow', icon: h(IconChevronLeftOutlineRegular, { size: 15 }), label: rangeDays === 7 ? '前七天' : `前${rangeDays}天`, onClick: () => onSelect(localDateKey(startOfPlanRange(start, -1, rangeDays))) }),
    h('div', { className: `todo-harness-plan-week-days${rangeDays > 7 ? ' is-long-range' : ''}` }, days.map((date) => {
      const key = localDateKey(date);
      const selected = key === selectedDate;
      return h('button', { type: 'button', key, 'data-plan-day': key, 'aria-label': formatDateWithWeekday(date), 'aria-pressed': selected, 'aria-current': key === todayKey ? 'date' : undefined, className: `todo-harness-plan-week-day${selected ? ' is-selected' : ''}`, onClick: () => onSelect(key) },
        h('strong', null, key === todayKey ? '今天' : formatIsoWeekday(date.getDay() || 7)),
        h('span', null, String(date.getDate())));
    })),
    h(IconActionButton, { type: 'button', variant: 'ghost', size: 'sm', className: 'todo-harness-plan-week-arrow', icon: h(IconChevronRightOutlineRegular, { size: 15 }), label: rangeDays === 7 ? '后七天' : `后${rangeDays}天`, onClick: () => onSelect(localDateKey(startOfPlanRange(start, 1, rangeDays))) })
  );
}

function PlanCalendar({ todos = [], now, selectedDate, rangeDays = 7, onApply }) {
  const [month, setMonth] = useState(() => new Date(`${selectedDate}T12:00:00`));
  const [yearInput, setYearInput] = useState(() => String(month.getFullYear()));
  const [focusedDate, setFocusedDate] = useState(selectedDate);
  const [draftStart, setDraftStart] = useState(selectedDate);
  const [draftEnd, setDraftEnd] = useState(() => planDateRange(selectedDate, rangeDays).last);
  const [rangeMode, setRangeMode] = useState([7, 30].includes(rangeDays) ? String(rangeDays) : 'custom');
  const [rangeEdge, setRangeEdge] = useState('start');
  const [agendaDate, setAgendaDate] = useState(selectedDate);
  const calendarRef = useRef(null);
  const days = planCalendarDays(month);
  const today = localDateKey(new Date(now));
  const count = planRangeLength(draftStart, draftEnd);
  const tasksByDate = planCalendarTasks(todos);
  const agendaTasks = tasksByDate.get(agendaDate) ?? [];
  const focusKey = days.some((day) => localDateKey(day) === focusedDate) ? focusedDate : localDateKey(new Date(month.getFullYear(), month.getMonth(), 1));
  const chooseStart = (key) => {
    setDraftStart(key);
    setAgendaDate(key);
    if (rangeMode !== 'custom') setDraftEnd(planDateRange(key, Number(rangeMode)).last);
    else if (draftEnd < key) setDraftEnd(key);
  };
  const choosePreset = (mode) => {
    setRangeMode(mode);
    setRangeEdge('start');
    if (mode !== 'custom') setDraftEnd(planDateRange(draftStart, Number(mode)).last);
  };
  const chooseDay = (key) => {
    if (rangeMode === 'custom' && rangeEdge === 'end') {
      if (key < draftStart) { setDraftStart(key); setDraftEnd(draftStart); }
      else setDraftEnd(key);
      setAgendaDate(key);
      setRangeEdge('start');
    } else {
      chooseStart(key);
      if (rangeMode === 'custom') setRangeEdge('end');
    }
  };
  const changeMonth = (next) => {
    if (next.getFullYear() < 1900 || next.getFullYear() > 9999) return;
    setMonth(next);
    setYearInput(String(next.getFullYear()));
  };
  const stepMonth = (amount) => changeMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1, 12));
  useEffect(() => {
    calendarRef.current?.querySelector(`[data-calendar-date="${focusedDate}"]`)?.focus();
  }, [focusedDate]);
  const moveFocus = (event, date) => {
    const next = new Date(date);
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (delta) next.setDate(next.getDate() + delta);
    else if (event.key === 'Home') next.setDate(next.getDate() - (next.getDay() + 6) % 7);
    else if (event.key === 'End') next.setDate(next.getDate() + 6 - (next.getDay() + 6) % 7);
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const day = next.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + (event.key === 'PageUp' ? -1 : 1));
      next.setDate(Math.min(day, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
    } else return;
    event.preventDefault();
    if (next.getFullYear() < 1900 || next.getFullYear() > 9999) return;
    changeMonth(next);
    setFocusedDate(localDateKey(next));
  };
  return h('div', { className: 'todo-harness-plan-calendar', ref: calendarRef },
    h('div', { className: 'todo-harness-calendar-range-controls' },
      h('div', { className: 'todo-harness-calendar-range-presets', role: 'group', 'aria-label': '计划范围长度' },
        [['7', '七天'], ['30', '三十天'], ['custom', '自定义']].map(([value, label]) => h('button', { type: 'button', key: value, 'aria-pressed': rangeMode === value, onClick: () => choosePreset(value) }, label))),
      h('div', { className: 'todo-harness-calendar-range-inputs' },
        h('label', { className: rangeEdge === 'start' ? 'is-active' : undefined }, '开始', h('input', { type: 'date', min: '1900-01-01', max: '9999-12-31', 'aria-label': '范围开始日期', value: draftStart, onFocus: () => setRangeEdge('start'), onChange: (event) => {
          const key = event.target.value;
          if (planRangeLength(key, key)) { chooseStart(key); changeMonth(new Date(`${key}T12:00:00`)); }
        } })),
        h('label', { className: rangeMode === 'custom' && rangeEdge === 'end' ? 'is-active' : undefined }, '结束', h('input', { type: 'date', min: draftStart, max: '9999-12-31', 'aria-label': '范围结束日期', value: draftEnd, onFocus: () => { setRangeEdge('end'); }, onChange: (event) => { setRangeMode('custom'); setDraftEnd(event.target.value); } })))),
    h('div', { className: 'todo-harness-calendar-toolbar' },
      h(IconActionButton, { type: 'button', variant: 'ghost', size: 'sm', icon: h(IconChevronLeftOutlineRegular, { size: 16 }), label: '上个月', disabled: month.getFullYear() === 1900 && month.getMonth() === 0, onClick: () => stepMonth(-1) }),
      h('label', { className: 'todo-harness-calendar-year' },
        h('input', { type: 'number', min: 1900, max: 9999, 'aria-label': '年份', value: yearInput,
          onChange: (event) => {
            const value = event.target.value;
            setYearInput(value);
            if (/^\d{4}$/.test(value) && Number(value) >= 1900) setMonth(new Date(Number(value), month.getMonth(), 1, 12));
          },
          onBlur: () => setYearInput(String(month.getFullYear())),
          onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } } }), '年'),
      h('select', { 'aria-label': '月份', value: month.getMonth(), onChange: (event) => changeMonth(new Date(month.getFullYear(), Number(event.target.value), 1, 12)) },
        Array.from({ length: 12 }, (_, index) => h('option', { key: index, value: index }, `${index + 1}月`))),
      h(IconActionButton, { type: 'button', variant: 'ghost', size: 'sm', icon: h(IconChevronRightOutlineRegular, { size: 16 }), label: '下个月', disabled: month.getFullYear() === 9999 && month.getMonth() === 11, onClick: () => stepMonth(1) })
    ),
    h('div', { className: 'todo-harness-calendar-layout' },
    h('div', { className: 'todo-harness-calendar-grid', role: 'grid', 'aria-label': `${month.getFullYear()}年${month.getMonth() + 1}月` },
      h('div', { className: 'todo-harness-calendar-weekdays', role: 'row' }, ['一', '二', '三', '四', '五', '六', '日'].map((label) => h('span', { key: label, role: 'columnheader', 'aria-label': `星期${label}` }, label))),
      Array.from({ length: 6 }, (_, week) => h('div', { className: 'todo-harness-calendar-week', role: 'row', key: week }, days.slice(week * 7, week * 7 + 7).map((date) => {
        const key = localDateKey(date);
        const selected = key === draftStart;
        const tasks = tasksByDate.get(key) ?? [];
        const highestPriority = ['urgent', 'high', 'normal', 'low'].find((priority) => tasks.some((todo) => (todo.priority ?? 'normal') === priority)) ?? 'normal';
        const valid = date.getFullYear() >= 1900 && date.getFullYear() <= 9999;
        return h('div', { role: 'gridcell', 'aria-selected': key >= draftStart && key <= draftEnd, key, className: `todo-harness-calendar-cell${key >= draftStart && key <= draftEnd ? ' is-in-range' : ''}${selected || key === draftEnd ? ' is-selected' : ''}${date.getMonth() !== month.getMonth() ? ' is-outside' : ''}` },
          h('button', {
          type: 'button',
          'data-calendar-date': key,
          'data-modal-autofocus': key === selectedDate ? true : undefined,
          'aria-label': `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`,
          'aria-current': key === today ? 'date' : undefined,
          tabIndex: key === focusKey ? 0 : -1,
          disabled: !valid,
          className: 'todo-harness-calendar-day',
          onClick: () => chooseDay(key),
          onKeyDown: (event) => moveFocus(event, date)
        },
          h('span', { className: 'todo-harness-calendar-day-heading' },
            h('span', { className: 'todo-harness-calendar-day-number' }, date.getDate()),
            tasks.length ? h('span', { className: `todo-harness-calendar-day-count todo-harness-task-priority-${highestPriority}`, 'aria-label': `${tasks.length}项计划` }, tasks.length, h('span', { className: 'todo-harness-calendar-count-unit' }, '项')) : null),
          h('span', { className: 'todo-harness-calendar-tasks' }, tasks.slice(0, 2).map((todo) => h('span', { key: todo.id, title: `${todo.title} · ${priorityLabel(todo.priority)}优先级`, className: `todo-harness-calendar-task todo-harness-task-priority-${todo.priority ?? 'normal'}${todo.status === 'done' ? ' is-done' : ''}` }, todo.title))),
          tasks.length > 2 ? h('span', { className: 'todo-harness-calendar-more' }, `+${tasks.length - 2} 项`) : null));
      })))
    ),
    h('section', { className: 'todo-harness-calendar-agenda', 'aria-label': '当日计划' },
      h('div', { className: 'todo-harness-calendar-agenda-heading' },
        h('h3', null, formatDateWithWeekday(`${agendaDate}T12:00:00`)),
        h('span', null, `${agendaTasks.length} 项计划`)),
      agendaTasks.length ? h('ul', null, agendaTasks.map((todo) => h('li', { key: todo.id },
        h('div', { className: 'todo-harness-calendar-agenda-time' },
          h('time', null, formatTime(todo.startAt)),
          h('span', null, todo.estimatedMinutes ? formatDurationMinutes(todo.estimatedMinutes) : '未估时')),
        h('div', { className: 'todo-harness-calendar-agenda-copy' },
          h('span', { className: `todo-harness-calendar-task todo-harness-task-priority-${todo.priority ?? 'normal'}${todo.status === 'done' ? ' is-done' : ''}` }, todo.title),
          h('span', { className: 'todo-harness-calendar-task-meta' }, `${priorityLabel(todo.priority)} · ${statusLabel(todo.status)}`))))) : h('p', null, '当天暂无计划'))),
    h('div', { className: 'todo-harness-calendar-footer' },
      h('span', { role: 'status', className: count < 1 || count > 366 ? 'todo-harness-error' : undefined }, count < 1 ? '结束日期不能早于开始日期' : count > 366 ? '请选择不超过 366 天的范围' : `${draftStart.replaceAll('-', '/')} - ${draftEnd.replaceAll('-', '/')} · ${count} 天`),
      h('div', null,
        h(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: () => { chooseStart(today); changeMonth(new Date(`${today}T12:00:00`)); } }, '回到今天'),
        h(Button, { type: 'button', variant: 'primary', size: 'sm', disabled: count < 1 || count > 366, onClick: () => onApply(draftStart, count) }, '应用范围')))
  );
}

function planCalendarDays(value) {
  const start = new Date(value);
  start.setHours(12, 0, 0, 0);
  start.setDate(1);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    return date;
  });
}

function startOfPlanRange(value, offset = 0, rangeDays = 7) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset * rangeDays);
  return date;
}

function planDateRange(dateKey, rangeDays = 7) {
  const end = startOfPlanRange(`${dateKey}T12:00:00`, 1, rangeDays);
  const last = new Date(end);
  last.setDate(last.getDate() - 1);
  return { start: dateKey, end: localDateKey(end), last: localDateKey(last) };
}

function planRangeLength(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return 0;
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || new Date(first).toISOString().slice(0, 10) !== start || new Date(last).toISOString().slice(0, 10) !== end) return 0;
  return Math.max(0, Math.round((last - first) / 86400000) + 1);
}

function planCalendarTasks(todos) {
  const groups = new Map();
  for (const todo of todos) {
    if (!todo.startAt || ['canceled', 'archived'].includes(todo.status)) continue;
    const date = new Date(todo.startAt);
    if (!Number.isFinite(date.getTime())) continue;
    const key = localDateKey(date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(todo);
  }
  for (const tasks of groups.values()) tasks.sort(compareTimeline);
  return groups;
}

function planDateShortcuts(now = Date.now()) {
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const offsetDay = (amount) => {
    const date = new Date(today);
    date.setDate(date.getDate() + amount);
    return localDateKey(date);
  };
  return [
    { label: '昨天', date: offsetDay(-1) },
    { label: '今天', date: offsetDay(0) },
    { label: '明天', date: offsetDay(1) }
  ];
}

function summarizePlan(todos, selectedDate, rangeDays = 7, now = Date.now()) {
  const today = localDateKey(new Date(now));
  const range = planDateRange(selectedDate ?? today, rangeDays);
  const active = todos.filter(isActiveTodo);
  const parents = new Set(active.map((todo) => todo.parentId).filter(Boolean));
  const result = { ...range, remainingCount: 0, estimatedMinutes: 0, unestimatedCount: 0, unscheduledCount: 0, carriedCount: 0 };
  // Count executable steps once; parent estimates commonly include their subtasks.
  for (const todo of active) {
    if (parents.has(todo.id)) continue;
    const date = new Date(todo.startAt ?? '');
    if (Number.isNaN(date.getTime())) {
      result.unscheduledCount += 1;
      continue;
    }
    const key = localDateKey(date);
    if (key >= range.end || key < range.start) continue;
    result.remainingCount += 1;
    if (Number.isFinite(todo.estimatedMinutes) && todo.estimatedMinutes > 0) result.estimatedMinutes += todo.estimatedMinutes;
    else result.unestimatedCount += 1;
  }
  return result;
}

function TodoPanel() {
  const ctx = runtimeContext;
  const [collapsed, setCollapsed] = useState(false);
  const [segment, setSegment] = useState('today');
  const [showCompleted, setShowCompleted] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [planStartDate, setPlanStartDate] = useState(null);
  const [planRangeDays, setPlanRangeDays] = useState(7);
  const listRef = useRef(null);
  const [dialog, setDialog] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState('');
  const [mutation, setMutation] = useState(false);
  const [dispatchingId, setDispatchingId] = useState(null);
  const [clock, setClock] = useState(Date.now());
  const selectedPlanDate = planStartDate ?? localDateKey(new Date(clock));
  const { data, error, refresh } = useApiData('todos', 5000);
  const [schedule, setSchedule] = useState({ status: 'idle', records: [], error: '' });
  const [scheduleRevision, setScheduleRevision] = useState(0);
  const [scheduleQuery, setScheduleQuery] = useState('');
  const [scheduleFilter, setScheduleFilter] = useState('all');
  const [selectedScheduleId, setSelectedScheduleId] = useState(null);
  const [scheduleDetailTab, setScheduleDetailTab] = useState('rule');
  const todos = data?.todos ?? [];
  const visible = selectTodos(todos, segment, showCompleted, clock, selectedPlanDate, planRangeDays).filter((todo) => {
    if (segment === 'today' && isOverdueTodo(todo, clock)) return true;
    const matchesQuery = !query.trim() || `${todo.title} ${todo.notes ?? ''}`.toLocaleLowerCase('zh-CN').includes(query.trim().toLocaleLowerCase('zh-CN'));
    const matchesPriority = priorityFilter === 'all' || todo.priority === priorityFilter;
    return matchesQuery && matchesPriority;
  });
  const stats = data?.stats ?? {};

  useEffect(() => {
    if (segment !== 'scheduled') return undefined;
    let active = true;
    const load = async () => {
      setSchedule((current) => ({ ...current, status: current.records.length ? 'refreshing' : 'loading' }));
      try {
        await waitForTodoHarnessRemote();
        if (!active) return;
        const result = await ctx.remote.schedule.catalog();
        if (!active) return;
        if (!result.ok) {
          setSchedule((current) => ({ ...current, status: 'error', error: result.error?.message ?? '无法读取定时任务' }));
          return;
        }
        setSchedule({ status: 'ready', records: result.value, error: '' });
      } catch (failure) {
        if (active) setSchedule((current) => ({ ...current, status: 'error', error: failure.message }));
      }
    };
    load();
    const timer = window.setInterval(load, 10000);
    const unsubscribeChange = ctx.remote.$on('schedule/changed', load);
    const unsubscribeReset = ctx.on('connection/reset', load);
    return () => {
      active = false;
      window.clearInterval(timer);
      unsubscribeChange?.();
      unsubscribeReset?.();
    };
  }, [segment, scheduleRevision]);

  const retrySchedule = () => {
    setSchedule((current) => ({ ...current, status: 'loading' }));
    setScheduleRevision((revision) => revision + 1);
  };
  const scheduleRecords = [...schedule.records].sort((left, right) => {
    if (left.status !== right.status) return left.status === 'active' ? -1 : 1;
    return Date.parse(left.scheduledAt) - Date.parse(right.scheduledAt);
  });
  const filteredScheduleRecords = scheduleRecords.filter((record) => {
    if (scheduleFilter === 'active' && record.status !== 'active') return false;
    if (scheduleFilter === 'inactive' && record.status !== 'inactive') return false;
    const queryText = scheduleQuery.trim().toLocaleLowerCase('zh-CN');
    return !queryText || `${record.title} ${record.prompt} ${record.sessionId}`.toLocaleLowerCase('zh-CN').includes(queryText);
  });
  const selectedSchedule = schedule.records.find((record) => record.id === selectedScheduleId) ?? null;
  const activeSchedules = schedule.records.filter((record) => record.status === 'active').length;

  useEffect(() => {
    if (schedule.status === 'ready' && selectedScheduleId && !schedule.records.some((record) => record.id === selectedScheduleId)) {
      setSelectedScheduleId(null);
    }
  }, [schedule.status, schedule.records, selectedScheduleId]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (segment === 'plan' && listRef.current) listRef.current.scrollTop = 0;
  }, [segment, selectedPlanDate, planRangeDays]);

  useEffect(() => {
    const onMobileTodoOpen = (event) => {
      if (event.detail?.open) setCollapsed(false);
    };
    window.addEventListener('todo-harness:mobile-todo-open', onMobileTodoOpen);
    return () => window.removeEventListener('todo-harness:mobile-todo-open', onMobileTodoOpen);
  }, []);

  if (collapsed) {
    return h('section', { className: 'todo-harness-panel todo-harness-panel-collapsed', 'data-todo-harness-collapsed': true, 'aria-label': '待办统计' },
      h(IconActionButton, { type: 'button', variant: 'ghost', size: 'sm', className: 'todo-harness-expand-button', icon: h(IconChevronLeftOutlineRegular, { size: 16 }), label: '展开待办栏', onClick: () => setCollapsed(false) }),
      h('div', { className: 'todo-harness-compact-stats' }, [
        ['全部', stats.total ?? todos.length], ['待办', stats.todo ?? 0], ['进行', stats.inProgress ?? 0], ['完成', stats.done ?? 0]
      ].map(([label, value]) => h('div', { className: 'todo-harness-compact-stat', key: label, title: `${label} ${formatNumber(value)}` }, h('span', null, label), h('strong', null, formatNumber(value)))))
    );
  }

  const mutateTodo = async (method, path, value) => {
    setMutation(true);
    setNotice('');
    try {
      const response = await fetch(apiUrl(path), { method, headers: { 'content-type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
      await refresh();
      setNotice(method === 'DELETE' ? '待办已删除' : '待办已更新');
    } catch (failure) {
      setNotice(`操作失败：${failure.message}`);
    } finally {
      setMutation(false);
    }
  };

  const dispatchTodo = async (todo, { markInProgress = true, dispatchId = todo.id, modelSelection, workspacePath, directoryMode = 'choose', preferenceKey = todo.id } = {}) => {
    setDispatchingId(dispatchId ?? 'dispatching');
    setNotice('');
    let newSessionId;
    let modelSaveFailed = false;
    try {
      const workspaceClient = ctx.workspaces ?? ctx.get?.('workspaces');
      const sessionClient = ctx.sessions ?? ctx.get?.('sessions');
      if (!workspacePath) throw new Error('请先选择工作目录');
      if (!workspaceClient) throw new Error('工作区服务尚未连接');
      if (!sessionClient) throw new Error('会话服务尚未连接');
      const workspace = await workspaceClient.create({ path: workspacePath });
      // ClientSessions.create() resolves to the new id and throws a typed error on failure.
      newSessionId = await sessionClient.create({ workspaceId: workspace.workspaceId });
      if (modelSelection) {
        const selected = await ctx.remote.session.selectModel({ sessionId: newSessionId, ...modelSelection });
        if (!selected.ok) throw new Error(selected.error?.message ?? '无法为新会话选择模型');
        try {
          await waitForTodoHarnessRemote();
          const saved = await todoHarnessRemote(ctx).setDefaultModel(modelSelection);
          if (!saved.ok) modelSaveFailed = true;
        } catch {
          modelSaveFailed = true;
        }
      }
      const content = [
        todo.id
          ? `请完成以下任务。开始前先调用 todo_list，执行过程中持续更新这条待办的状态和进展，完成后说明结果并将它标记为 done。`
          : '请处理以下定时任务，并在完成后说明结果。',
        todo.id ? `待办 ID：${todo.id}` : '',
        `标题：${todo.title}`,
        `工作目录：${workspace.path}\n请在此目录中查找相关文件并保存本任务的产物；完成后列出产物的完整路径。`,
        todo.notes ? `详情：\n${todo.notes}` : '',
        `优先级：${priorityLabel(todo.priority)}`,
        todo.startAt ? `计划开始：${todo.startAt}` : '',
        todo.dueAt ? `截止时间：${todo.dueAt}` : '',
        todo.estimatedMinutes ? `预估工作量：${formatMinutes(todo.estimatedMinutes)}` : ''
      ].filter(Boolean).join('\n\n');
      const sent = await ctx.remote.session.prompt({ requestId: crypto.randomUUID(), sessionId: newSessionId, mode: 'queue', content: [{ type: 'text', text: content }], clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      if (!sent.ok) throw new Error(sent.error?.message ?? '任务未能发送到新会话');
      const dispatchOptions = { modelSelection, directoryMode, directoryPath: workspace.path };
      rememberDispatchOptions(preferenceKey, dispatchOptions);
      let noticeText = modelSaveFailed ? '任务已交给 Harness，但所选模型未能保存为默认值' : '任务已交给 Harness';
      if (todo.id) {
        try {
          const patch = { sessionId: newSessionId, dispatchOptions };
          if (markInProgress) patch.status = 'in_progress';
          const response = await fetch(apiUrl(`todos/${encodeURIComponent(todo.id)}`), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
          if (response.ok) await refresh();
          else noticeText = '任务已交给 Harness，但会话关联未能保存';
        } catch {
          noticeText = '任务已交给 Harness，但会话关联未能保存';
        }
      }
      setNotice(noticeText);
      try { openHarnessSession(ctx, newSessionId); }
      catch (failure) { setNotice(`任务已交给 Harness，但会话打开失败：${failure.message}`); }
      return true;
    } catch (failure) {
      throw new Error(`交给 Harness 失败：${failure.message}`);
    } finally {
      setDispatchingId(null);
    }
  };
  const loadDispatchModels = async (confirmationId, previousOptions) => {
    setConfirmation((current) => current?.id === confirmationId
      ? { ...current, modelStatus: 'loading', modelError: '' }
      : current);
    try {
      const result = await ctx.remote.session.modelCatalog();
      if (!result.ok) throw new Error(result.error?.message ?? '模型目录读取失败');
      const { choices, selectedKey, previousUnavailable } = buildDispatchModelChoices(result.value, previousOptions?.modelSelection);
      if (!choices.length) throw new Error('没有可用模型，请先在设置中配置 Provider');
      const initialChoice = choices.find((choice) => choice.key === selectedKey) ?? choices[0];
      setConfirmation((current) => current?.id === confirmationId
        ? { ...current, modelStatus: 'ready', modelError: '', modelOptions: choices, modelSelection: initialChoice.selection, modelNotice: previousUnavailable ? '上次的模型或思考深度已不可用，已切换为可用设置。' : '' }
        : current);
    } catch (failure) {
      setConfirmation((current) => current?.id === confirmationId
        ? { ...current, modelStatus: 'error', modelError: failure.message }
        : current);
    }
  };
  const dispatchSchedule = (record) => askConfirmation('dispatch', {
    title: record.title,
    notes: record.prompt,
    priority: 'normal',
    dispatchKey: `schedule:${record.sessionId}:${record.id}`
  }, (modelSelection, workspacePath, directoryMode) => dispatchTodo({ title: record.title, notes: record.prompt, priority: 'normal' }, {
    markInProgress: false,
    dispatchId: record.id,
    modelSelection,
    workspacePath,
    directoryMode,
    preferenceKey: `schedule:${record.sessionId}:${record.id}`
  }));
  const handleScheduleDelete = async (record) => {
    const result = await ctx.remote.schedule.delete({ sessionId: record.sessionId, id: record.id });
    if (!result.ok || !result.value.deleted) throw new Error(result.value?.code ?? result.error?.message ?? '删除未完成');
    setScheduleRevision((revision) => revision + 1);
    setSelectedScheduleId(null);
    setNotice('定时任务已删除');
    return true;
  };
  const saveSchedule = async (record, values, change) => {
    const result = await ctx.remote.schedule.update({ sessionId: record.sessionId, id: record.id, expected: scheduleExpectedRecord(record), title: values.title.trim(), prompt: values.prompt.trim(), ...(change ? { change } : {}) });
    if (!result.ok) throw new Error(result.error?.message ?? '保存失败');
    if (!result.value.updated) throw new Error(result.value.code ?? result.value.message ?? '任务已变化，请刷新后重试');
    setScheduleRevision((revision) => revision + 1);
    setDialog(null);
    setNotice('定时任务已更新');
    return true;
  };
  const createSchedule = async (request) => {
    await waitForTodoHarnessRemote();
    const sessionId = ctx.sidebarRight.mounted.getSnapshot();
    if (!sessionId) throw new Error('请先打开一个会话');
    const result = await todoHarnessRemote(ctx).createSchedule({ sessionId, request });
    if (!result.ok) throw new Error(result.error?.message ?? '定时任务创建失败');
    setScheduleRevision((revision) => revision + 1);
    setDialog(null);
    setNotice('定时任务已创建');
  };

  const askConfirmation = (kind, todo, action) => {
    const next = { id: crypto.randomUUID(), kind, todo, action };
    if (kind === 'dispatch') {
      next.modelStatus = 'loading';
      next.modelOptions = [];
      next.modelSelection = null;
      next.modelError = '';
      const sessionClient = ctx.sessions ?? ctx.get?.('sessions');
      const sessionSummaries = sessionClient?.list?.getSnapshot?.().byId ?? {};
      const currentSession = Object.values(sessionSummaries).find((session) => session.retainedBy?.mainView > 0)
        ?? sessionSummaries[ctx.sidebarRight.mounted.getSnapshot()];
      const workspaceClient = ctx.workspaces ?? ctx.get?.('workspaces');
      next.currentWorkspace = workspaceClient?.list?.getSnapshot?.().items?.find((item) => item.sessionIds.includes(currentSession?.id))
        ?? (currentSession?.cwd ? { path: currentSession.cwd } : undefined);
      next.previousOptions = readDispatchOptions(todo.dispatchKey ?? todo.id) ?? todo.dispatchOptions;
      next.directoryMode = next.previousOptions?.directoryMode === 'current' && next.previousOptions.directoryPath === next.currentWorkspace?.path ? 'current' : 'choose';
      next.directoryPath = next.previousOptions?.directoryPath ?? '';
      next.directoryPickerOpen = false;
    }
    setConfirmation(next);
    if (kind === 'dispatch') loadDispatchModels(next.id, next.previousOptions);
  };
  const confirmAction = async () => {
    if (!confirmation) return;
    const pending = confirmation;
    const workspacePath = pending.directoryMode === 'current' ? pending.currentWorkspace?.path : pending.directoryPath;
    if (pending.kind === 'dispatch' && (!pending.modelSelection || pending.modelStatus !== 'ready' || !workspacePath || pending.directoryPickerOpen)) return;
    setConfirming(true);
    try {
      const result = await pending.action(pending.modelSelection, workspacePath, pending.directoryMode);
      if (result !== false) setConfirmation(null);
    } catch (failure) {
      setConfirmation((current) => current?.id === pending.id ? { ...current, error: failure.message } : current);
    } finally {
      setConfirming(false);
    }
  };
  const todoAction = (todo, kind) => {
    if (kind === 'dispatch') return askConfirmation('dispatch', todo, (modelSelection, workspacePath, directoryMode) => dispatchTodo(todo, { modelSelection, workspacePath, directoryMode }));
    if (kind === 'delete') return askConfirmation('delete', todo, () => mutateTodo('DELETE', `todos/${encodeURIComponent(todo.id)}`));
    if (todo.status === 'done') return mutateTodo('PATCH', `todos/${encodeURIComponent(todo.id)}`, { status: 'todo' });
    return askConfirmation('complete', todo, () => mutateTodo('PATCH', `todos/${encodeURIComponent(todo.id)}`, { status: 'done' }));
  };
  const confirmationCopy = confirmation
    ? {
      dispatch: { title: '确认交给 Harness', body: `将“${confirmation.todo.title}”交给 Harness 后，会在新会话中开始执行。`, action: '开始执行' },
      complete: { title: '确认完成待办', body: `确认“${confirmation.todo.title}”已经完成吗？`, action: '标记完成' },
      delete: { title: '确认删除待办', body: `删除“${confirmation.todo.title}”后将无法从待办列表恢复。`, action: '删除' },
      'schedule-delete': { title: '确认删除定时任务', body: `删除“${confirmation.todo.title}”后将停止后续投递，并同时移除已保存的运行记录。`, action: '删除任务' }
    }[confirmation.kind]
    : null;
  const updateDispatch = (values) => setConfirmation((current) => current?.id === confirmation.id ? { ...current, ...values, error: '' } : current);
  const selectedDispatchModel = confirmation?.kind === 'dispatch'
    ? confirmation.modelOptions.find((choice) => choice.key === (confirmation.modelSelection ? modelSelectionKey(confirmation.modelSelection) : ''))
    : null;
  const dispatchEfforts = selectedDispatchModel?.reasoningEfforts ?? [];
  const dispatchPath = confirmation?.directoryMode === 'current' ? confirmation.currentWorkspace?.path : confirmation?.directoryPath;
  const dispatchControls = confirmation?.kind === 'dispatch' ? h(React.Fragment, null,
    h('div', { className: 'todo-harness-dispatch-model-grid' },
      h(DispatchModelSelect, {
        key: confirmation.id, choices: confirmation.modelOptions, selection: confirmation.modelSelection,
        status: confirmation.modelStatus, disabled: confirming,
        onChange: (selection) => updateDispatch({ modelSelection: selection })
      }),
      h(DispatchModelSelect, {
        key: `${confirmation.id}:effort`, id: 'effort', label: '思考深度',
        helpId: 'todo-harness-dispatch-reasoning-help',
        choices: [{ id: '', name: selectedDispatchModel?.defaultEffort ? `模型默认（${reasoningEffortLabel({ id: selectedDispatchModel.defaultEffort })}）` : '模型默认' }, ...dispatchEfforts.map((effort) => ({ id: effort.id, name: reasoningEffortLabel(effort) }))].map((effort) => ({
          key: modelSelectionKey({ provider: 'effort', model: effort.id }),
          modelName: effort.name,
          selection: { provider: 'effort', model: effort.id }
        })),
        selection: { provider: 'effort', model: confirmation.modelSelection?.reasoningEffort ?? '' },
        status: 'ready', disabled: confirming || confirmation.modelStatus !== 'ready' || !dispatchEfforts.length,
        onChange: (selection) => updateDispatch({ modelSelection: { ...confirmation.modelSelection, reasoningEffort: selection.model || undefined } })
      })
    ),
    h('p', { className: 'todo-harness-settings-help', id: 'todo-harness-dispatch-reasoning-help' },
      confirmation.modelStatus !== 'ready' ? '模型与思考深度将在执行前应用。'
        : dispatchEfforts.length ? '更深的思考通常需要更多时间和 Token。'
          : '此模型未提供可选的思考深度，将使用模型默认设置。'),
    confirmation.modelNotice ? h('p', { className: 'todo-harness-settings-help', role: 'status' }, confirmation.modelNotice) : null,
    h('section', { className: 'todo-harness-dispatch-directory', 'aria-labelledby': 'todo-harness-dispatch-directory-label' },
      h('h3', { id: 'todo-harness-dispatch-directory-label' }, '工作目录'),
      h('p', { className: 'todo-harness-settings-help', id: 'todo-harness-dispatch-directory-help' }, '建议选择任务相关目录，便于找到源文件和执行产物。'),
      h('div', { className: 'todo-harness-dispatch-directory-modes', role: 'radiogroup', 'aria-label': '工作目录来源', 'aria-describedby': 'todo-harness-dispatch-directory-help' },
        h('label', null, h('input', { type: 'radio', name: 'todo-harness-dispatch-directory-mode', checked: confirmation.directoryMode === 'choose', disabled: confirming, onChange: () => updateDispatch({ directoryMode: 'choose' }) }), '选择任务目录', h('span', { className: 'todo-harness-dispatch-recommended' }, '推荐')),
        h('label', null, h('input', { type: 'radio', name: 'todo-harness-dispatch-directory-mode', checked: confirmation.directoryMode === 'current', disabled: confirming || !confirmation.currentWorkspace?.path, onChange: () => updateDispatch({ directoryMode: 'current' }) }), '使用当前目录')),
      confirmation.directoryMode === 'choose' ? h('button', {
        type: 'button', className: 'todo-harness-dispatch-directory-trigger', disabled: confirming,
        onClick: () => updateDispatch({ directoryPickerOpen: true })
      }, h(IconFolderCloseRegular, { size: 19, 'aria-hidden': true }),
      h('span', { className: 'todo-harness-dispatch-directory-copy' },
        h('strong', null, confirmation.directoryPath ? '已选目录' : '选择工作目录'),
        h('span', null, confirmation.directoryPath || '选择已有文件夹，或新建一个任务文件夹')),
      h(IconChevronRightOutlineRegular, { size: 16, 'aria-hidden': true }))
        : h('div', { className: 'todo-harness-dispatch-current-directory' },
          h(IconFolderCloseRegular, { size: 19, 'aria-hidden': true }),
          h('span', { className: 'todo-harness-dispatch-directory-copy' }, h('strong', null, confirmation.currentWorkspace?.title ?? '当前目录'), h('span', null, confirmation.currentWorkspace?.path))),
      h('p', { className: 'todo-harness-settings-help', role: 'status' }, dispatchPath ? '会在此目录中新建会话，完成后列出产物路径。' : '选择一个目录，或使用当前目录后即可开始。'))
  ) : null;
  const confirmationActions = confirmationCopy ? h('div', { className: 'todo-harness-editor-actions' },
    h(Button, { type: 'button', variant: 'ghost', size: 'sm', disabled: confirming, onClick: () => setConfirmation(null) }, '取消'),
    h(Button, { type: 'button', variant: confirmation.kind === 'delete' ? 'outline' : 'primary', size: 'sm', disabled: confirming || (confirmation.kind === 'dispatch' && (confirmation.modelStatus !== 'ready' || !confirmation.modelSelection || !dispatchPath || confirmation.directoryPickerOpen)), onClick: confirmAction }, confirmation.kind === 'dispatch' ? h(IconPlayOutlineRegular, { size: 14 }) : null, confirming ? '处理中' : confirmationCopy.action)) : null;

  const renderTodo = (todo, plan = false) => h(TodoRow, {
    key: todo.id,
    todo,
    todos,
    now: clock,
    plan,
    disabled: mutation || dispatchingId !== null || confirming,
    dispatching: dispatchingId === todo.id,
    onEdit: () => setDialog({ type: plan ? 'plan' : 'todo', todo }),
    onToggle: () => todoAction(todo, 'complete'),
    onDelete: () => todoAction(todo, 'delete'),
    onDispatch: () => todoAction(todo, 'dispatch'),
    onOpenSession: () => { try { openHarnessSession(ctx, todo.sessionId); } catch (failure) { setNotice(`无法打开会话：${failure.message}`); } }
  });

  const createEditor = () => setDialog(segment === 'scheduled' ? { type: 'schedule-create' } : { type: segment === 'plan' ? 'plan' : 'todo', todo: null });
  const selectPlanDate = (key) => {
    setPlanStartDate(key === localDateKey(new Date(clock)) ? null : key);
  };
  return h('section', { className: 'todo-harness-panel' },
    h(TodoTopNavigation, {
      segment,
      onChange: (next) => { setSegment(next); setSearchOpen(false); setFilterOpen(false); },
      onSearch: { open: searchOpen, toggle: () => setSearchOpen((open) => !open) },
      onFilter: { open: filterOpen, toggle: () => setFilterOpen((open) => !open) },
      onCreate: { disabled: mutation || dispatchingId !== null, run: createEditor },
      onRefresh: segment === 'scheduled' ? retrySchedule : refresh,
      onCollapse: () => setCollapsed(true)
    }),
    h('div', { className: `todo-harness-panel-tools${searchOpen || filterOpen ? ' is-open' : ''}` },
      searchOpen ? h('label', { className: 'todo-harness-search-field' }, h(IconSearchOutlineRegular, { size: 15 }), h('input', { autoFocus: true, value: query, placeholder: '搜索待办和计划', onChange: (event) => setQuery(event.target.value) })) : null,
      filterOpen ? h('div', { className: 'todo-harness-filter-menu', role: 'group', 'aria-label': '优先级筛选' },
        h('span', null, '优先级'),
        [['all', '全部'], ['urgent', '紧急'], ['high', '高'], ['normal', '普通'], ['low', '低']].map(([value, label]) => h('button', { type: 'button', key: value, className: priorityFilter === value ? 'is-selected' : '', onClick: () => setPriorityFilter(value) }, label)),
        segment !== 'scheduled' ? h('label', { className: 'todo-harness-filter-completed' }, h('input', { type: 'checkbox', checked: showCompleted, onChange: (event) => setShowCompleted(event.target.checked) }), '显示已完成') : null
      ) : null
    ),
    h(TodoPanelTitle, {
      segment, todos, activeSchedules, scheduleCount: scheduleRecords.length, now: clock, selectedPlanDate, planRangeDays,
      onPlanDateSelect: selectPlanDate,
      onPlanRangeSelect: (key, days) => { selectPlanDate(key); setPlanRangeDays(days); },
      dataStatus: error ? 'error' : data ? 'ready' : 'loading'
    }),
    notice ? h('p', { className: 'todo-harness-notice', role: 'status' }, notice) : null,
    h('div', { id: `todo-harness-todo-view-${segment}-panel`, role: 'tabpanel', className: 'todo-harness-list', ref: listRef }, error && segment !== 'scheduled'
      ? h('div', { className: 'todo-harness-state todo-harness-error' }, h('p', null, '暂时无法读取待办'), h(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: refresh }, '重试'))
      : segment === 'scheduled'
        ? h(ScheduleManager, {
          records: filteredScheduleRecords,
          total: scheduleRecords.length,
          query: scheduleQuery,
          onQueryChange: setScheduleQuery,
          filter: scheduleFilter,
          onFilterChange: setScheduleFilter,
          selected: selectedSchedule,
          selectedTab: scheduleDetailTab,
          onSelect: (record) => { setSelectedScheduleId(record.id); setScheduleDetailTab('rule'); setDialog(null); },
          onBack: () => setSelectedScheduleId(null),
          onTabChange: setScheduleDetailTab,
          status: schedule.status,
          error: schedule.error,
          onRetry: retrySchedule,
          onEdit: (record) => setDialog({ type: 'schedule', record }),
          onDelete: (record) => askConfirmation('schedule-delete', { title: record.title }, () => handleScheduleDelete(record)),
          onDispatch: dispatchSchedule,
          onOpenSession: (record) => { try { openHarnessSession(ctx, record.sessionId); } catch (failure) { setNotice(`无法打开会话：${failure.message}`); } },
          dispatching: dispatchingId !== null
        })
        : visible.length || segment === 'plan'
          ? segment === 'plan'
            ? renderPlanGroups(visible, clock, (todo) => renderTodo(todo, true), { selectedDate: selectedPlanDate })
            : renderTodayGroups(visible, clock, (todo) => renderTodo(todo))
          : h('div', { className: 'todo-harness-state' }, h('p', null, emptyLabel(segment)))
    ),
    h(Modal, { open: dialog !== null, onClose: () => setDialog(null), title: dialog?.type === 'todo' ? (dialog.todo ? '编辑待办' : '新建待办') : dialog?.type === 'plan' ? (dialog.todo ? '编辑计划' : '新建计划') : dialog?.type === 'schedule-create' ? '新建定时任务' : '编辑定时任务', closeLabel: '关闭', className: 'todo-harness-modal', contentClassName: 'todo-harness-modal-content' },
      dialog?.type === 'todo' ? h(TodoEditor, { todo: dialog.todo, todos, kind: 'todo', onClose: () => setDialog(null), onSaved: async () => { await refresh(); setDialog(null); setNotice(dialog.todo ? '待办已保存' : '待办已创建'); } })
        : dialog?.type === 'plan' ? h(TodoEditor, { todo: dialog.todo, todos, initialDate: selectedPlanDate, kind: 'plan', onClose: () => setDialog(null), onSaved: async () => { await refresh(); setDialog(null); setNotice(dialog.todo ? '计划已保存' : '计划已创建'); } })
        : dialog?.type === 'schedule-create' ? h(ScheduleCreateEditor, { onClose: () => setDialog(null), onCreate: createSchedule })
            : dialog?.type === 'schedule' ? h(ScheduleEditor, { record: dialog.record, onClose: () => setDialog(null), onSave: (values, change) => saveSchedule(dialog.record, values, change) }) : null),
    h(Modal, { open: confirmation !== null, onClose: () => { if (!confirming && !confirmation?.directoryPickerOpen) setConfirmation(null); }, title: confirmationCopy?.title ?? '确认操作', closeLabel: '取消', className: `todo-harness-confirm-modal${confirmation?.kind === 'dispatch' ? ' todo-harness-dispatch-modal' : ''}`, contentClassName: 'todo-harness-confirm-content', footer: confirmation?.kind === 'dispatch' ? confirmationActions : undefined },
      confirmationCopy ? h('div', { className: 'todo-harness-confirmation' },
        h('p', null, confirmationCopy.body),
        confirmation.error ? h('p', { className: 'todo-harness-settings-error', role: 'alert' }, confirmation.error) : null,
        dispatchControls,
        confirmation.kind === 'dispatch' && confirmation.modelStatus === 'loading' ? h('span', { className: 'todo-harness-settings-help' }, '正在读取可用模型…') : null,
        confirmation.kind === 'dispatch' && confirmation.modelError ? h('span', { className: 'todo-harness-settings-error', role: 'alert' }, confirmation.modelError) : null,
        confirmation.kind === 'dispatch' && confirmation.modelStatus === 'error' ? h(Button, { type: 'button', variant: 'outline', size: 'sm', disabled: confirming, onClick: () => loadDispatchModels(confirmation.id, confirmation.previousOptions) }, '重试读取模型') : null,
        confirmation.kind !== 'dispatch' ? confirmationActions : null
      ) : null),
    confirmation?.directoryPickerOpen ? h(DispatchDirectoryDialog, {
      key: confirmation.id,
      initialPath: confirmation.directoryPath || confirmation.currentWorkspace?.path,
      onClose: () => updateDispatch({ directoryPickerOpen: false }),
      onSelect: (path) => updateDispatch({ directoryPath: path, directoryMode: 'choose', directoryPickerOpen: false })
    }) : null
  );
}

function MobileTodoSidebarToggle() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const update = (event) => setOpen(Boolean(event.detail?.open));
    window.addEventListener('todo-harness:mobile-todo-open', update);
    return () => window.removeEventListener('todo-harness:mobile-todo-open', update);
  }, []);
  const sidebarRight = runtimeContext.sidebarRight;
  const label = open ? '返回对话' : '打开待办';
  return h(IconActionButton, {
    type: 'button',
    variant: 'ghost',
    size: 'sm',
    className: 'todo-harness-mobile-sidebar-toggle',
    icon: h(open ? IconPanelLeftOutlineRegular : IconCheckOutlineRegular, { size: 17 }),
    label,
    'aria-pressed': open,
    onClick: () => {
      const frame = document.querySelector('#root [data-slot="root"]>div:has(>[data-rightbar-col])');
      const nextOpen = !open;
      if (nextOpen) {
        sidebarRight.openTab(TODO_TAB_KIND);
        frame?.setAttribute('data-todo-harness-mobile-todo-open', 'true');
      } else {
        sidebarRight.toggleExpanded();
        frame?.removeAttribute('data-todo-harness-mobile-todo-open');
      }
      window.dispatchEvent(new CustomEvent('todo-harness:mobile-todo-open', { detail: { open: nextOpen } }));
      setOpen(nextOpen);
    }
  });
}

function IconActionButton({ label, ...props }) {
  return h(Tooltip, { label, delayMs: 350, focusDelayMs: 0 }, h(Button, { ...props, 'aria-label': props['aria-label'] ?? label }));
}

function TokenUsageSidebarItem({ wide }) {
  return wide ? h(TokenUsageSidebarContent) : null;
}

function TokenUsageSidebarContent() {
  const usage = useApiData('usage', 15000).data;
  const settings = useSettingsState();
  const today = sumUsage((usage?.entries ?? []).filter((entry) => isToday(entry.createdAt)));
  const budget = settings.dailyTokenBudget;
  const percent = budget > 0 ? Math.min(100, today.totalTokens / budget * 100) : 0;
  return h('div', { className: 'todo-harness-token-usage' },
    h('div', { className: 'todo-harness-token-usage-label' },
      h('span', null, '今日 Token'),
      h('strong', null, `${formatNumber(today.totalTokens)} / ${budget ? formatNumber(budget) : '不限'}`)),
    budget > 0 ? h('div', {
      className: 'todo-harness-token-usage-track',
      role: 'progressbar',
      'aria-label': '今日 Token 用量',
      'aria-valuemin': 0,
      'aria-valuemax': budget,
      'aria-valuenow': Math.min(today.totalTokens, budget)
    }, h('span', { style: { width: `${percent}%` } })) : null
  );
}

function TodoEditor({ todo, todos = [], initialDate = '', kind = 'todo', onClose, onSaved }) {
  const dueParts = inputDateTimeParts(todo?.dueAt);
  const startParts = inputDateTimeParts(todo?.startAt);
  const [values, setValues] = useState({
    title: todo?.title ?? '',
    notes: todo?.notes ?? '',
    status: todo?.status ?? 'todo',
    priority: todo?.priority ?? 'normal',
    dueDate: dueParts.date,
    dueTime: dueParts.time,
    startDate: startParts.date || (!todo ? initialDate : ''),
    startTime: startParts.time,
    estimatedMinutes: String(todo?.estimatedMinutes ?? 60),
    parentId: todo?.parentId ?? '',
    dependsOn: todo?.dependsOn ?? []
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (event) => {
    const value = event.target.value;
    setValues((current) => ({ ...current, [key]: value, ...(!value && key === 'startDate' ? { startTime: '' } : {}), ...(!value && key === 'dueDate' ? { dueTime: '' } : {}) }));
  };
  const relatedTodos = todos.filter((candidate) => candidate.id !== todo?.id);
  const plannedStart = localInputToIso(values.startDate, values.startTime, false);
  const deadline = localInputToIso(values.dueDate, values.dueTime, true);
  const deadlineRisk = plannedStart && deadline && Date.parse(plannedStart) + Number(values.estimatedMinutes) * 60_000 > Date.parse(deadline);
  return h('form', {
    className: `todo-harness-editor todo-harness-editor-${kind}`,
    onSubmit: async (event) => {
      event.preventDefault();
      setSaving(true);
      setError('');
      try {
        const estimatedMinutes = Number(values.estimatedMinutes);
        if (!Number.isSafeInteger(estimatedMinutes) || estimatedMinutes < 1) throw new Error('预估工作量必须是至少 1 分钟的整数');
        const dueAt = todo && values.dueDate === dueParts.date && values.dueTime === dueParts.time
          ? todo.dueAt ?? null : localInputToIso(values.dueDate, values.dueTime, true);
        const startAt = todo && values.startDate === startParts.date && values.startTime === startParts.time
          ? todo.startAt ?? null : localInputToIso(values.startDate, values.startTime, false);
        if (values.startTime && !values.startDate) throw new Error('请选择计划执行日期');
        if (values.dueTime && !values.dueDate) throw new Error('请选择截止日期');
        const response = await fetch(apiUrl(todo ? `todos/${encodeURIComponent(todo.id)}` : 'todos'), {
          method: todo ? 'PATCH' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: values.title, notes: values.notes, status: values.status, priority: values.priority, dueAt, startAt, estimatedMinutes, parentId: values.parentId || null, dependsOn: values.dependsOn })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
        await onSaved();
      } catch (failure) {
        setError(failure.message);
      } finally {
        setSaving(false);
      }
    }
  },
  h('label', { className: 'todo-harness-editor-field todo-harness-editor-title' }, '标题', h('input', { autoFocus: true, maxLength: 240, required: true, value: values.title, placeholder: kind === 'plan' ? '例如：整理下一版本的发布计划' : '例如：准备演示材料', onChange: set('title') })),
  h('label', { className: 'todo-harness-editor-field' }, '备注', h('textarea', { maxLength: 4000, rows: 4, value: values.notes, placeholder: '目标、对接人、交付物、等待回复或跟进时间', onChange: set('notes') })),
  h('div', { className: 'todo-harness-editor-grid todo-harness-todo-fields' },
    h('label', { className: 'todo-harness-editor-field' }, '截止日期', h('input', { type: 'date', value: values.dueDate, onChange: set('dueDate') })),
    h('label', { className: 'todo-harness-editor-field' }, '截止时间', h('input', { type: 'time', step: 60, value: values.dueTime, onChange: set('dueTime') })),
    h('label', { className: 'todo-harness-editor-field' }, '优先级', h('select', { value: values.priority, onChange: set('priority') },
      h('option', { value: 'low' }, '低'), h('option', { value: 'normal' }, '普通'), h('option', { value: 'high' }, '高'), h('option', { value: 'urgent' }, '紧急'))),
    h('label', { className: 'todo-harness-editor-field' }, '预估工作量', h('div', { className: 'todo-harness-input-with-suffix' }, h('input', { type: 'number', min: 1, max: 43200, step: 1, required: true, value: values.estimatedMinutes, onChange: set('estimatedMinutes') }), h('span', null, '分钟'))),
    h('label', { className: 'todo-harness-editor-field' }, '计划执行日期', h('input', { type: 'date', value: values.startDate, onChange: set('startDate') })),
    h('label', { className: 'todo-harness-editor-field' }, '计划执行时间', h('input', { type: 'time', step: 60, value: values.startTime, onChange: set('startTime') })),
    todo ? h('label', { className: 'todo-harness-editor-field' }, '状态', h('select', { value: values.status, onChange: set('status') },
      h('option', { value: 'todo' }, '待处理'), h('option', { value: 'in_progress' }, '进行中'), h('option', { value: 'blocked' }, '受阻'), h('option', { value: 'done' }, '已完成'), h('option', { value: 'canceled' }, '已取消'), h('option', { value: 'archived' }, '已归档'))) : null),
  relatedTodos.length ? h('details', { className: 'todo-harness-editor-relations' },
    h('summary', null, '协作与拆解'),
    h('label', { className: 'todo-harness-editor-field' }, '所属任务', h('select', { value: values.parentId, onChange: set('parentId') },
      h('option', { value: '' }, '无'), relatedTodos.map((candidate) => h('option', { key: candidate.id, value: candidate.id }, candidate.title)))),
    h('fieldset', { className: 'todo-harness-dependencies' }, h('legend', null, '前置任务'),
      relatedTodos.filter((candidate) => isActiveTodo(candidate) || values.dependsOn.includes(candidate.id)).map((candidate) => h('label', { key: candidate.id },
        h('input', { type: 'checkbox', checked: values.dependsOn.includes(candidate.id), onChange: (event) => setValues((current) => ({ ...current, dependsOn: event.target.checked ? [...current.dependsOn, candidate.id] : current.dependsOn.filter((id) => id !== candidate.id) })) }),
        h('span', null, candidate.title))))) : null,
  deadlineRisk && isActiveTodo({ status: values.status }) ? h('p', { className: 'todo-harness-settings-error', role: 'status' }, '当前排期预计晚于截止时间') : null,
  error ? h('p', { className: 'todo-harness-settings-error', role: 'alert' }, error) : null,
  h('div', { className: 'todo-harness-editor-actions' },
    h(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: onClose }, '取消'),
    h(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: saving || !values.title.trim() }, saving ? '保存中' : '保存'))
  );
}

function ScheduleCreateEditor({ onClose, onCreate }) {
  const localNow = new Date();
  localNow.setMinutes(0, 0, 0);
  localNow.setHours(localNow.getHours() + 1);
  const [values, setValues] = useState({ title: '', prompt: '', kind: 'at', date: localDateKey(localNow), time: `${String(localNow.getHours()).padStart(2, '0')}:00`, amount: '1', unit: 'hour', weekdays: [1, 2, 3, 4, 5], cron: '0 9 * * 1-5' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return h('form', { className: 'todo-harness-editor todo-harness-schedule-editor', onSubmit: async (event) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      if (values.kind === 'at') {
        const scheduledAt = new Date(`${values.date}T${values.time}:00`);
        if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) throw new Error('指定时间需要晚于当前时间');
      }
      await onCreate(buildScheduleRequest(values, timeZone));
    } catch (failure) { setError(failure.message); } finally { setSaving(false); }
  } },
  h('div', { className: 'todo-harness-editor-intro' }, h('span', { className: 'todo-harness-editor-kicker' }, '定时任务'), h('p', null, '按设定时间在当前会话中启动工作')),
  h('label', { className: 'todo-harness-editor-field todo-harness-editor-title' }, '名称', h('input', { autoFocus: true, maxLength: 120, required: true, value: values.title, placeholder: '例如：工作日巡检', onChange: set('title') })),
  h('label', { className: 'todo-harness-editor-field' }, '执行内容', h('textarea', { rows: 4, required: true, value: values.prompt, placeholder: '描述到时间后需要 Harness 执行的工作', onChange: set('prompt') })),
  h('label', { className: 'todo-harness-editor-field' }, '执行频率', h('select', { value: values.kind, onChange: set('kind') }, h('option', { value: 'at' }, '指定时间'), h('option', { value: 'after' }, '延迟后执行'), h('option', { value: 'every' }, '固定间隔'), h('option', { value: 'daily' }, '每天'), h('option', { value: 'weekly' }, '每周'), h('option', { value: 'cron' }, 'Cron'))),
  values.kind === 'at' ? h('div', { className: 'todo-harness-editor-grid' }, h('label', { className: 'todo-harness-editor-field' }, '日期', h('input', { type: 'date', min: localDateKey(new Date()), required: true, value: values.date, onChange: set('date') })), h('label', { className: 'todo-harness-editor-field' }, '时间', h('input', { type: 'time', required: true, value: values.time, onChange: set('time') }))) : null,
  values.kind === 'after' || values.kind === 'every' ? h('div', { className: 'todo-harness-editor-grid' }, h('label', { className: 'todo-harness-editor-field' }, values.kind === 'after' ? '延迟时长' : '间隔', h('input', { type: 'number', min: 1, step: 1, required: true, value: values.amount, onChange: set('amount') })), h('label', { className: 'todo-harness-editor-field' }, '单位', h('select', { value: values.unit, onChange: set('unit') }, h('option', { value: 'minute' }, '分钟'), h('option', { value: 'hour' }, '小时'), h('option', { value: 'day' }, '天')))) : null,
  values.kind === 'daily' || values.kind === 'weekly' ? h('div', { className: 'todo-harness-editor-grid' }, h('label', { className: 'todo-harness-editor-field' }, '时间', h('input', { type: 'time', required: true, value: values.time, onChange: set('time') })), values.kind === 'weekly' ? h('fieldset', { className: 'todo-harness-weekdays' }, h('legend', null, '重复日期'), ['一', '二', '三', '四', '五', '六', '日'].map((label, index) => { const weekday = index + 1; return h('label', { className: 'todo-harness-weekday', key: weekday }, h('input', { type: 'checkbox', checked: values.weekdays.includes(weekday), onChange: (event) => setValues((current) => ({ ...current, weekdays: event.target.checked ? [...current.weekdays, weekday].sort() : current.weekdays.filter((day) => day !== weekday) })) }), label); })) : h('div', { className: 'todo-harness-editor-timezone' }, `时区：${timeZone}`)) : null,
  values.kind === 'cron' ? h('label', { className: 'todo-harness-editor-field' }, 'Cron 表达式', h('input', { required: true, value: values.cron, onChange: set('cron') })) : null,
  values.kind === 'cron' ? h('p', { className: 'todo-harness-editor-help' }, `按当前时区 ${timeZone} 解释`) : null,
  error ? h('p', { className: 'todo-harness-settings-error', role: 'alert' }, error) : null,
  h('div', { className: 'todo-harness-editor-actions' }, h(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: onClose }, '取消'), h(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: saving || !values.title.trim() || !values.prompt.trim() || (values.kind === 'weekly' && values.weekdays.length === 0) }, saving ? '创建中' : '创建定时任务'))
  );
}

function buildScheduleRequest(values, timeZone) {
  const request = { title: values.title.trim(), prompt: values.prompt.trim() };
  if (values.kind === 'at') request.at = { date: values.date, time: `${values.time}:00`, time_zone: timeZone };
  else if (values.kind === 'after') request.after_seconds = Number(values.amount) * scheduleUnitSeconds(values.unit);
  else if (values.kind === 'every') request.every_seconds = Number(values.amount) * scheduleUnitSeconds(values.unit);
  else if (values.kind === 'daily') request.daily = { time: `${values.time}:00`, time_zone: timeZone };
  else if (values.kind === 'weekly') request.weekly = { time: `${values.time}:00`, time_zone: timeZone, weekdays: values.weekdays };
  else if (values.kind === 'cron') request.cron = { expression: values.cron.trim(), time_zone: timeZone };
  return request;
}

function scheduleUnitSeconds(unit) {
  return unit === 'day' ? 86400 : unit === 'hour' ? 3600 : unit === 'minute' ? 60 : 1;
}

function ScheduleEditor({ record, onClose, onSave }) {
  const [values, setValues] = useState(() => scheduleEditorDefaults(record));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (event) => setValues((current) => ({ ...current, [key]: event.target.value }));
  return h('form', {
    className: 'todo-harness-editor',
    onSubmit: async (event) => {
      event.preventDefault();
      setSaving(true);
      setError('');
      try { await onSave(values, buildScheduleUpdateChange(record, values)); }
      catch (failure) { setError(failure.message); }
      finally { setSaving(false); }
    }
  },
  h('label', { className: 'todo-harness-editor-field' }, '名称', h('input', { autoFocus: true, maxLength: 120, required: true, value: values.title, onChange: set('title') })),
  h('label', { className: 'todo-harness-editor-field' }, '提醒内容', h('textarea', { rows: 4, required: true, value: values.prompt, onChange: set('prompt') })),
  h('label', { className: 'todo-harness-editor-field' }, '重复', h('select', { value: values.kind, onChange: set('kind') },
    h('option', { value: 'at' }, '仅一次'), h('option', { value: 'every' }, '固定间隔'), h('option', { value: 'daily' }, '每天'), h('option', { value: 'weekly' }, '每周'), h('option', { value: 'cron' }, '自定义 Cron')
  )),
  values.kind === 'at' ? h('div', { className: 'todo-harness-editor-grid' },
    h('label', { className: 'todo-harness-editor-field' }, '日期', h('input', { type: 'date', min: localDateKey(new Date()), required: true, value: values.date, onChange: set('date') })),
    h('label', { className: 'todo-harness-editor-field' }, '时间', h('input', { type: 'time', step: '0.001', required: true, value: values.time, onChange: set('time') }))
  ) : null,
  values.kind === 'every' ? h('div', { className: 'todo-harness-editor-grid' },
    h('label', { className: 'todo-harness-editor-field' }, '间隔', h('input', { type: 'number', min: values.unit === 'second' ? 60 : 1, step: 1, required: true, value: values.amount, onChange: set('amount') })),
    h('label', { className: 'todo-harness-editor-field' }, '单位', h('select', { value: values.unit, onChange: set('unit') }, h('option', { value: 'second' }, '秒'), h('option', { value: 'minute' }, '分钟'), h('option', { value: 'hour' }, '小时'), h('option', { value: 'day' }, '天')))
  ) : null,
  values.kind === 'daily' || values.kind === 'weekly' ? h('div', { className: 'todo-harness-editor-grid' },
    h('label', { className: 'todo-harness-editor-field' }, '时间', h('input', { type: 'time', step: '0.001', required: true, value: values.time, onChange: set('time') })),
    h('label', { className: 'todo-harness-editor-field' }, '时区', h('input', { required: true, value: values.timeZone, onChange: set('timeZone') })),
    values.kind === 'weekly' ? h('fieldset', { className: 'todo-harness-weekdays' }, h('legend', null, '星期'), ['一', '二', '三', '四', '五', '六', '日'].map((label, index) => {
      const weekday = index + 1;
      return h('label', { className: 'todo-harness-weekday', key: weekday }, h('input', { type: 'checkbox', checked: values.weekdays.includes(weekday), onChange: (event) => setValues((current) => ({ ...current, weekdays: event.target.checked ? [...current.weekdays, weekday].sort() : current.weekdays.filter((day) => day !== weekday) })) }), label);
    })) : null
  ) : null,
  values.kind === 'cron' ? h('div', { className: 'todo-harness-editor-grid' },
    h('label', { className: 'todo-harness-editor-field' }, 'Cron 表达式', h('input', { required: true, value: values.cron, onChange: set('cron') })),
    h('label', { className: 'todo-harness-editor-field' }, '时区', h('input', { required: true, value: values.timeZone, onChange: set('timeZone') }))
  ) : null,
  values.kind === 'at' ? h('p', { className: 'todo-harness-editor-help' }, `一次性时间按本机时区 ${values.timeZone} 解释。`) : null,
  error ? h('p', { className: 'todo-harness-settings-error', role: 'alert' }, error) : null,
  h('div', { className: 'todo-harness-editor-actions' },
    h(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: onClose }, '取消'),
    h(Button, { type: 'submit', variant: 'primary', size: 'sm', disabled: saving || !values.title.trim() || !values.prompt.trim() || (values.kind === 'weekly' && values.weekdays.length === 0) }, saving ? '保存中' : '保存修改'))
  );
}

function scheduleEditorDefaults(record) {
  const kind = record.kind === 'after' ? 'at' : record.kind;
  const timeZone = record.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  const dateTime = preciseDateTimeParts(record.scheduledAt);
  let amount = '1';
  let unit = 'hour';
  if (record.kind === 'every') {
    amount = String(record.everySeconds);
    unit = 'second';
    for (const candidate of ['day', 'hour', 'minute']) {
      const seconds = scheduleUnitSeconds(candidate);
      if (record.everySeconds % seconds === 0) { amount = String(record.everySeconds / seconds); unit = candidate; break; }
    }
  }
  return {
    title: record.title,
    prompt: record.prompt,
    kind,
    date: dateTime.date,
    time: record.time || dateTime.time || '09:00:00',
    amount,
    unit,
    weekdays: record.weekdays ?? [1, 2, 3, 4, 5],
    cron: record.expression ?? '0 9 * * 1-5',
    timeZone
  };
}

function preciseDateTimeParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '', time: '' };
  return {
    date: localDateKey(date),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}.${String(date.getMilliseconds()).padStart(3, '0')}`
  };
}

function buildScheduleUpdateChange(record, values) {
  const time = values.time?.length === 5 ? `${values.time}:00` : values.time;
  if (values.kind === 'at') {
    const target = new Date(`${values.date}T${time}`);
    if (!Number.isFinite(target.getTime()) || target.getTime() <= Date.now()) throw new Error('指定时间需要晚于当前时间');
    if (['at', 'after'].includes(record.kind) && target.getTime() === Date.parse(record.scheduledAt)) return undefined;
    return { kind: 'at', at: target.toISOString() };
  }
  if (values.kind === 'every') {
    const everySeconds = Number(values.amount) * scheduleUnitSeconds(values.unit);
    if (!Number.isSafeInteger(everySeconds) || everySeconds < 60) throw new Error('固定间隔至少为 60 秒');
    if (record.kind === 'every' && record.everySeconds === everySeconds) return undefined;
    return { kind: 'every', every_seconds: everySeconds };
  }
  if (values.kind === 'daily') {
    if (record.kind === 'daily' && record.time === time && record.timeZone === values.timeZone) return undefined;
    return { kind: 'daily', daily: { time, time_zone: values.timeZone.trim() } };
  }
  if (values.kind === 'weekly') {
    const weekdays = [...values.weekdays].sort((left, right) => left - right);
    if (record.kind === 'weekly' && record.time === time && record.timeZone === values.timeZone && record.weekdays.length === weekdays.length && record.weekdays.every((day, index) => day === weekdays[index])) return undefined;
    return { kind: 'weekly', weekly: { time, time_zone: values.timeZone.trim(), weekdays } };
  }
  if (values.kind === 'cron') {
    const expression = values.cron.trim();
    if (record.kind === 'cron' && record.expression === expression && record.timeZone === values.timeZone) return undefined;
    return { kind: 'cron', cron: { expression, time_zone: values.timeZone.trim() } };
  }
  throw new Error('不支持的运行规则');
}

function TodoRow({ todo, todos = [], now = Date.now(), plan = false, disabled, dispatching, onEdit, onToggle, onDelete, onDispatch, onOpenSession }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const urgency = deadlineUrgency(todo, now);
  const urgencyTag = !plan && urgency === 'overdue'
    ? h('span', { className: 'todo-harness-urgency-tag todo-harness-urgency-tag-overdue' }, '已逾期')
    : !plan && (urgency === 'critical' || urgency === 'soon')
      ? h('span', { className: 'todo-harness-urgency-tag todo-harness-urgency-tag-soon' }, '即将到期')
      : null;
  return h('div', { className: `todo-harness-timeline-item todo-harness-task-priority-${todo.priority ?? 'normal'}` },
    h('div', { className: 'todo-harness-timeline-marker', 'aria-hidden': true },
      h('span', { className: `todo-harness-dot todo-harness-dot-${todo.status}` })),
    h('article', { className: `todo-harness-row todo-harness-${plan ? 'plan' : 'today'}-row todo-harness-status-${todo.status} todo-harness-urgency-${urgency}${todo.status === 'done' ? ' todo-harness-task-done' : ''}` },
      h('div', { className: 'todo-harness-row-copy' },
        h('div', { className: 'todo-harness-row-head' },
          h('div', { className: 'todo-harness-row-title' },
            h('input', { className: 'todo-harness-task-check', type: 'checkbox', checked: todo.status === 'done', 'aria-label': todo.status === 'done' ? `重新打开 ${todo.title}` : `完成 ${todo.title}`, disabled, onChange: onToggle }),
            h('strong', null, todo.title),
            todo.priority !== 'normal' ? h('span', { className: `todo-harness-priority todo-harness-priority-${todo.priority}` }, priorityLabel(todo.priority)) : null,
            urgencyTag
          ),
          h('span', { className: `todo-harness-status todo-harness-status-${todo.status}` }, statusLabel(todo.status))
        ),
        h('div', { className: 'todo-harness-row-time-range' },
          h('span', null, h(IconClockOutlineRegular, { size: 12 }), formatTodoWindow(todo)),
          h('span', null, todo.dueAt ? formatDue(todo.dueAt) : '无截止日期'),
          h('span', { className: 'todo-harness-effort' }, todo.estimatedMinutes ? `约 ${formatDurationMinutes(todo.estimatedMinutes)}` : '未估工时')
        ),
        todo.notes ? h('p', { className: 'todo-harness-notes' }, todo.notes) : null,
        h(TodoRelations, { todo, todos }),
        h('div', { className: 'todo-harness-row-footer' },
          todo.tags?.length ? h('div', { className: 'todo-harness-tags todo-harness-row-tags' }, [
            ...todo.tags.map((tag, index) => h('span', { key: tag, className: index ? 'todo-harness-tag-extra' : undefined }, tag)),
            todo.tags.length > 1 ? h('span', { className: 'todo-harness-tag-overflow', title: todo.tags.slice(1).join(', '), 'aria-label': `还有 ${todo.tags.length - 1} 个标签` }, `+${todo.tags.length - 1}`) : null
          ]) : null,
          h('div', { className: 'todo-harness-row-actions' },
            !['done', 'canceled', 'archived'].includes(todo.status) ? h(Button, { type: 'button', variant: 'ghost', size: 'sm', className: 'todo-harness-action-button todo-harness-action-text-button todo-harness-dispatch-button', disabled: disabled || dispatching, onClick: onDispatch }, dispatching ? '提交中' : '交给 Harness') : null,
            todo.sessionId ? h(Button, { type: 'button', variant: 'ghost', size: 'sm', className: 'todo-harness-action-button todo-harness-action-text-button todo-harness-open-session-button', disabled, onClick: onOpenSession }, '查看会话') : null,
            h(Button, { type: 'button', variant: 'ghost', size: 'sm', className: 'todo-harness-action-button todo-harness-action-text-button', disabled, onClick: onEdit }, urgency === 'overdue' ? '调整日期' : '编辑'),
            h('details', { className: 'todo-harness-row-more', open: menuOpen, onToggle: (event) => setMenuOpen(event.currentTarget.open) },
              h('summary', { title: '更多操作' }, '更多'),
              h('button', { type: 'button', disabled, onClick: () => { setMenuOpen(false); onDelete(); } }, '删除'))
          )
        )
      )
    )
  );
}

function TodoRelations({ todo, todos }) {
  const parent = todos.find((candidate) => candidate.id === todo.parentId);
  const dependencies = (todo.dependsOn ?? []).map((id) => todos.find((candidate) => candidate.id === id)).filter(Boolean);
  if (!parent && !dependencies.length) return null;
  return h('div', { className: 'todo-harness-task-relations' },
    parent ? h('span', null, `所属：${parent.title}`) : null,
    dependencies.length ? h('span', null, `前置：${dependencies.map((candidate) => `${candidate.title}${candidate.status === 'done' ? '（已完成）' : '（未完成）'}`).join('、')}`) : null);
}

function renderTodayGroups(todos, now, renderTodo) {
  const today = localDateKey(new Date(now));
  const groups = new Map();
  for (const todo of todos) {
    const dueDate = todo.dueAt ? localDateKey(new Date(todo.dueAt)) : null;
    const startDate = todo.startAt ? localDateKey(new Date(todo.startAt)) : dueDate;
    const startTime = Date.parse(todo.startAt ?? todo.dueAt ?? '');
    let key = 'unscheduled';
    if (isOverdueTodo(todo, now)) key = 'overdue';
    else if (startDate && startDate < today) key = 'cross-day';
    else if (Number.isFinite(startTime)) {
      const hour = new Date(startTime).getHours();
      const minuteOfDay = hour * 60 + new Date(startTime).getMinutes();
      key = minuteOfDay < 10 * 60 ? 'morning' : minuteOfDay < 15.5 * 60 ? 'project' : minuteOfDay < 18 * 60 ? 'daily' : 'evening';
    }
    const group = groups.get(key) ?? { key, todos: [] };
    group.todos.push(todo);
    groups.set(key, group);
  }
  const order = ['overdue', 'cross-day', 'morning', 'project', 'daily', 'evening', 'unscheduled'];
  const labels = { overdue: '已逾期', 'cross-day': '跨日安排', morning: '晨间工作', project: '项目推进', daily: '日常事务', evening: '收尾工作', unscheduled: '待安排' };
  return [...groups.values()].sort((left, right) => order.indexOf(left.key) - order.indexOf(right.key)).map((group) => {
    group.todos.sort(compareTimeline);
    const firstScheduled = group.todos.find((todo) => todo.startAt || todo.dueAt);
    const marker = group.key === 'overdue' ? '' : firstScheduled ? formatTimelineMarker(firstScheduled) : '—';
    return h('section', { className: `todo-harness-task-group todo-harness-timeline-group todo-harness-timeline-group-${group.key}`, key: group.key },
      h('header', { className: 'todo-harness-group-header todo-harness-timeline-group-header' },
        h('span', { className: 'todo-harness-group-dot', 'aria-hidden': true }),
        h('div', { className: 'todo-harness-group-heading' },
          marker ? h('div', { className: 'todo-harness-timeline-group-marker' }, h(IconClockOutlineRegular, { size: 13, 'aria-hidden': true }), h('time', null, marker)) : null,
          h('div', { className: 'todo-harness-timeline-group-copy' }, h('strong', null, labels[group.key])),
          h('span', null, `${group.todos.length} 项`))),
      h('div', { className: 'todo-harness-task-timeline' }, group.todos.map(renderTodo))
    );
  });
}

function renderPlanGroups(todos, now, renderTodo, { selectedDate } = {}) {
  const groups = new Map();
  for (const todo of todos) {
    const key = todo.startAt ? localDateKey(new Date(todo.startAt)) : 'unscheduled';
    const group = groups.get(key) ?? { key, todos: [] };
    group.todos.push(todo);
    groups.set(key, group);
  }
  if (selectedDate && !groups.has(selectedDate)) groups.set(selectedDate, { key: selectedDate, todos: [] });
  const sorted = [...groups.values()].sort((left, right) => {
    if (left.key === 'unscheduled') return 1;
    if (right.key === 'unscheduled') return -1;
    return left.key.localeCompare(right.key);
  });
  const renderGroup = (group) => {
    group.todos.sort(compareTimeline);
    const date = planDateInfo(group.key, now);
    return h('section', { className: `todo-harness-task-group todo-harness-plan-group${group.key === selectedDate ? ' is-selected' : ''}`, key: group.key, 'data-plan-date': group.key },
      h('header', { className: 'todo-harness-group-header todo-harness-plan-group-header' },
        h('span', { className: 'todo-harness-group-dot', 'aria-hidden': true }),
        h('div', { className: 'todo-harness-group-heading' },
          h('div', { className: 'todo-harness-plan-day' },
            h('div', { className: 'todo-harness-plan-day-copy' }, h('strong', null, date.distance), h('span', null, `${date.monthDay} · ${date.weekday}`))),
          h('div', { className: 'todo-harness-plan-group-summary' }, h('span', null, `${group.todos.length} 项`)))),
      group.todos.length
        ? h('div', { className: 'todo-harness-task-timeline' }, group.todos.map(renderTodo))
        : h('p', { className: 'todo-harness-plan-date-empty', role: 'status' }, '当天暂无计划')
    );
  };
  return h(React.Fragment, null, sorted.map(renderGroup));
}

function compareTimeline(left, right) {
  const leftStart = Date.parse(left.startAt ?? left.dueAt ?? '') || Number.MAX_SAFE_INTEGER;
  const rightStart = Date.parse(right.startAt ?? right.dueAt ?? '') || Number.MAX_SAFE_INTEGER;
  if (leftStart !== rightStart) return leftStart - rightStart;
  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
  return (priorityRank[left.priority] ?? 2) - (priorityRank[right.priority] ?? 2);
}

function ScheduleManager({ records, total, query, onQueryChange, filter, onFilterChange, selected, selectedTab, onSelect, onBack, onTabChange, status, error, onRetry, onEdit, onDelete, onDispatch, onOpenSession, dispatching }) {
  const filters = [['all', '全部'], ['active', '已开启'], ['inactive', '未运行']];
  return h('div', { className: `todo-harness-schedule-manager${selected ? ' has-detail' : ''}` },
    h('div', { className: 'todo-harness-schedule-layout' },
      h('section', { className: 'todo-harness-schedule-list-pane', 'aria-label': '自动化任务列表' },
        h('label', { className: 'todo-harness-schedule-search' },
          h(IconSearchOutlineRegular, { size: 15, 'aria-hidden': true }),
          h('input', { type: 'search', value: query, placeholder: '搜索名称、指令或会话 ID', 'aria-label': '搜索自动化任务', onChange: (event) => onQueryChange(event.target.value) }),
          query ? h('button', { type: 'button', className: 'todo-harness-schedule-clear', 'aria-label': '清除搜索', onClick: () => onQueryChange('') }, '×') : null
        ),
        h('div', { className: 'todo-harness-schedule-filters', role: 'group', 'aria-label': '任务状态' }, filters.map(([value, label]) => h('button', { type: 'button', key: value, className: filter === value ? 'is-selected' : '', 'aria-pressed': filter === value, onClick: () => onFilterChange(value) }, label))),
        h('div', { className: 'todo-harness-schedule-list', 'aria-busy': status === 'loading' || status === 'refreshing' },
          status === 'error' ? h('div', { className: 'todo-harness-schedule-feedback todo-harness-error', role: 'alert' }, h('p', null, error || '无法读取定时任务'), h(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: onRetry }, '重试')) : null,
          status === 'loading' || status === 'idle' ? h('div', { className: 'todo-harness-schedule-feedback', role: 'status' }, '正在读取定时任务') : null,
          status === 'refreshing' ? h('div', { className: 'todo-harness-schedule-refreshing', role: 'status' }, '正在更新') : null,
          records.length ? h('ul', { className: 'todo-harness-schedule-rows' }, records.map((record) => h('li', { key: record.id },
            h('button', { type: 'button', className: `todo-harness-schedule-entry${selected?.id === record.id ? ' is-selected' : ''}${record.status === 'inactive' ? ' is-inactive' : ''}`, 'aria-label': record.title, 'aria-expanded': selected?.id === record.id, onClick: () => onSelect(record) },
              h(IconClockOutlineRegular, { className: 'todo-harness-schedule-entry-icon', size: 16, 'aria-hidden': true }),
              h('span', { className: 'todo-harness-schedule-entry-copy' },
                h('span', { className: 'todo-harness-schedule-entry-title' }, record.title),
                h('span', { className: 'todo-harness-schedule-entry-summary' },
                  record.status === 'inactive' ? h('span', { className: 'todo-harness-schedule-entry-status' }, '未运行') : null,
                  h('span', null, scheduleFrequency(record)),
                  record.status === 'active' ? h('span', null, '下次运行 ', h('time', { dateTime: record.scheduledAt }, formatScheduleMoment(record.scheduledAt))) : record.lastDelivery ? h('span', null, '最近运行 ', h('time', { dateTime: record.lastDelivery.scheduledAt }, formatScheduleMoment(record.lastDelivery.scheduledAt))) : null
                )
              )
            )
          ))) : status === 'ready' ? h('div', { className: 'todo-harness-schedule-empty', role: 'status' },
            h(IconClockOutlineRegular, { size: 23, 'aria-hidden': true }),
            h('p', null, total === 0 ? '还没有自动化任务' : '没有匹配的任务'),
            query || filter !== 'all' ? h('button', { type: 'button', onClick: () => { onQueryChange(''); onFilterChange('all'); } }, '清除筛选') : null
          ) : null
        )
      ),
      selected ? h(ScheduleDetail, { record: selected, tab: selectedTab, onTabChange, onBack, onEdit, onDelete, onDispatch, onOpenSession, dispatching }) : null
    )
  );
}

function ScheduleDetail({ record, tab, onTabChange, onBack, onEdit, onDelete, onDispatch, onOpenSession, dispatching }) {
  const tabs = [['rule', '规则'], ['history', '任务运行记录']];
  const active = record.status === 'active';
  return h('section', { className: 'todo-harness-schedule-detail', 'aria-label': `自动化任务：${record.title}` },
    h('header', { className: 'todo-harness-schedule-detail-header' },
      h('button', { type: 'button', className: 'todo-harness-schedule-back', onClick: onBack }, h(IconChevronLeftOutlineRegular, { size: 15 }), '全部任务'),
      h('div', { className: 'todo-harness-schedule-detail-actions' },
        active ? h(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: () => onDispatch(record), disabled: dispatching }, h(IconPlayOutlineRegular, { size: 14 }), '交给 Harness') : null,
        active ? h(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: () => onEdit(record) }, h(IconEditOutlineRegular, { size: 14 }), '编辑') : null,
        h(IconActionButton, { type: 'button', variant: 'ghost', size: 'sm', className: 'todo-harness-action-button todo-harness-action-danger', icon: h(IconTrashOutlineRegular, { size: 15 }), label: '删除任务', onClick: () => onDelete(record) })
      )
    ),
    h('div', { className: 'todo-harness-schedule-detail-heading' },
      h('span', { className: `todo-harness-schedule-status${active ? ' is-active' : ' is-inactive'}` }, active ? '已开启' : '未运行'),
      h('h2', null, record.title),
      active ? h('p', null, h(IconAlarmClockOutlineRegular, { size: 15, 'aria-hidden': true }), '下次运行 ', h('time', { dateTime: record.scheduledAt }, formatScheduleMoment(record.scheduledAt))) : null
    ),
    h('div', { className: 'todo-harness-schedule-detail-tabs', role: 'tablist', 'aria-label': '任务详情' }, tabs.map(([value, label], index) => h('button', {
      type: 'button', role: 'tab', key: value, id: `todo-harness-schedule-tab-${record.id}-${value}`, 'aria-selected': tab === value,
      'aria-controls': `todo-harness-schedule-panel-${record.id}`, tabIndex: tab === value ? 0 : -1,
      onClick: () => onTabChange(value),
      onKeyDown: (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        onTabChange(tabs[next][0]);
        event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next]?.focus();
      }
    }, label))),
    h('div', { id: `todo-harness-schedule-panel-${record.id}`, role: 'tabpanel', 'aria-labelledby': `todo-harness-schedule-tab-${record.id}-${tab}`, className: 'todo-harness-schedule-detail-scroll' },
      tab === 'history' ? h(ScheduleHistory, { key: record.id, record }) : h(React.Fragment, null,
        h('section', { className: 'todo-harness-schedule-rule-section' },
          h('h3', null, '运行时间'),
          h('div', { className: 'todo-harness-schedule-rule-rows' },
            h('div', { className: 'todo-harness-schedule-rule-row' }, h('span', null, '重复'), h('strong', null, scheduleFrequency(record))),
            record.timeZone ? h('div', { className: 'todo-harness-schedule-rule-row' }, h('span', null, '时区'), h('strong', null, record.timeZone)) : null,
            h('div', { className: 'todo-harness-schedule-rule-row' }, h('span', null, '状态'), h('strong', null, active ? '已开启' : '未运行'))
          )
        ),
        h('section', { className: 'todo-harness-schedule-rule-section' }, h('h3', null, '执行内容'), h('p', { className: 'todo-harness-schedule-prompt' }, record.prompt)),
        h('button', { type: 'button', className: 'todo-harness-schedule-linked-session', onClick: () => onOpenSession(record) },
          h('span', null, '关联会话'), h('code', null, record.sessionId), h('span', { className: 'todo-harness-schedule-open-session' }, '打开')
        ),
        h('p', { className: 'todo-harness-schedule-id' }, '任务 ID ', h('code', null, record.id))
      )
    )
  );
}

function ScheduleHistory({ record }) {
  const [history, setHistory] = useState({ status: 'loading', records: [], nextBefore: null, earlierRecordsPruned: false, retention: null, error: '' });
  const requestEpoch = useRef(0);
  const load = useCallback(async (before) => {
    const epoch = ++requestEpoch.current;
    setHistory((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const result = await runtimeContext.remote.schedule.history({ sessionId: record.sessionId, id: record.id, limit: 20, ...(before ? { before } : {}) });
      if (epoch !== requestEpoch.current) return;
      if (!result.ok) throw new Error(result.error?.message ?? '无法读取运行记录');
      if ('code' in result.value) throw new Error(result.value.code === 'delivery_cursor_not_found' ? '记录分页已变化，请重新加载' : '任务记录不存在');
      setHistory((current) => ({
        status: 'ready',
        records: before ? [...current.records, ...result.value.records.filter((item) => !current.records.some((existing) => existing.messageId === item.messageId))] : result.value.records,
        nextBefore: result.value.nextBefore ?? null,
        earlierRecordsPruned: result.value.earlierRecordsPruned,
        retention: result.value.retention,
        error: ''
      }));
    } catch (failure) {
      if (epoch === requestEpoch.current) setHistory((current) => ({ ...current, status: 'error', error: failure.message }));
    }
  }, [record.id, record.sessionId]);
  useEffect(() => {
    load();
    return () => { requestEpoch.current += 1; };
  }, [load, record.lastDelivery?.messageId]);
  return h('div', { className: 'todo-harness-schedule-history', 'aria-busy': history.status === 'loading' },
    history.status === 'loading' && !history.records.length ? h('div', { className: 'todo-harness-schedule-feedback', role: 'status' }, '正在读取运行记录') : null,
    history.status === 'error' ? h('div', { className: 'todo-harness-schedule-history-error', role: 'alert' }, h('p', null, history.error), h(Button, { type: 'button', variant: 'outline', size: 'sm', onClick: () => load() }, '重新加载')) : null,
    history.status === 'ready' && !history.records.length ? h('div', { className: 'todo-harness-schedule-empty' }, h(IconClockOutlineRegular, { size: 22, 'aria-hidden': true }), h('p', null, '还没有已保存的运行记录')) : null,
    history.records.map((item) => h('article', { className: 'todo-harness-schedule-delivery', key: item.messageId },
      h(IconClockOutlineRegular, { size: 15, 'aria-hidden': true }),
      h('div', { className: 'todo-harness-schedule-delivery-copy' },
        h('time', { dateTime: item.scheduledAt }, formatScheduleOccurrence(item.scheduledAt, record.timeZone)),
        item.prompt ? h('details', { className: 'todo-harness-schedule-delivery-prompt' }, h('summary', null, '查看已发送内容'), h('p', null, item.prompt)) : null
      )
    )),
    history.nextBefore ? h(Button, { type: 'button', variant: 'outline', size: 'sm', disabled: history.status === 'loading', onClick: () => load(history.nextBefore) }, history.status === 'loading' ? '加载中' : '加载更早记录') : null,
    history.status === 'ready' && history.records.length && history.earlierRecordsPruned && !history.nextBefore ? h('details', { className: 'todo-harness-schedule-retention' }, h('summary', null, '旧记录已按保留规则清理'), h('p', null, `最多保留 ${history.retention?.records ?? '配置'} 条记录，保留期 ${history.retention?.days ?? '配置'} 天。`)) : null
  );
}

function formatScheduleMoment(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function formatScheduleOccurrence(value, timeZone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  try {
    return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, ...(timeZone ? { timeZone } : {}) }).format(date);
  } catch {
    return formatScheduleMoment(value);
  }
}

function scheduleFrequency(record) {
  if (record.kind === 'after') return `延迟 ${formatDuration(record.afterSeconds)} 后执行`;
  if (record.kind === 'at') return '指定时间执行';
  if (record.kind === 'every') return `每 ${formatDuration(record.everySeconds)}`;
  if (record.kind === 'daily') return `每天 ${formatScheduleClock(record.time)}`;
  if (record.kind === 'weekly') return `每周 ${record.weekdays.map(formatIsoWeekday).join('、')} ${formatScheduleClock(record.time)}`;
  if (record.kind === 'cron') return `Cron ${record.expression}`;
  return record.kind;
}

function formatIsoWeekday(day) {
  const labels = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六', 7: '周日' };
  return labels[day] ?? `周${day}`;
}

function formatScheduleClock(value) {
  return typeof value === 'string' ? value.slice(0, 5) : '';
}

function scheduleExpectedRecord(record) {
  const expected = { id: record.id, kind: record.kind, title: record.title, prompt: record.prompt, scheduledAt: record.scheduledAt };
  for (const field of ['afterSeconds', 'everySeconds', 'time', 'timeZone', 'weekdays', 'expression']) {
    if (record[field] !== undefined) expected[field] = record[field];
  }
  return expected;
}

function formatDuration(seconds) {
  if (seconds % 86400 === 0) return `${seconds / 86400} 天`;
  if (seconds % 3600 === 0) return `${seconds / 3600} 小时`;
  if (seconds % 60 === 0) return `${seconds / 60} 分钟`;
  return `${seconds} 秒`;
}

function useApiData(resource, intervalMs) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(apiUrl(resource), { cache: 'no-store' });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (failure) {
      setError(failure);
    }
  }, [resource]);

  useEffect(() => {
    let active = true;
    const safeRefresh = async () => {
      if (!active) return;
      await refresh();
    };
    safeRefresh();
    const timer = window.setInterval(safeRefresh, intervalMs);
    window.addEventListener('focus', safeRefresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', safeRefresh);
    };
  }, [intervalMs, refresh]);
  return { data, error, refresh };
}

function apiUrl(resource) {
  const base = new URL(window.location.origin);
  base.port = String(Number(base.port) + 1);
  base.pathname = `/api/${resource}`;
  base.search = '';
  base.hash = '';
  return base.href;
}

function selectTodos(todos, segment, showCompleted = false, now = Date.now(), planStartDate, rangeDays = 7) {
  const today = localDateKey(new Date(now));
  const rangeStart = planStartDate ?? today;
  const rangeEnd = segment === 'plan' ? planDateRange(rangeStart, rangeDays).end : null;
  return todos.filter((todo) => {
    const isDone = todo.status === 'done';
    const dueDate = todo.dueAt ? localDateKey(new Date(todo.dueAt)) : null;
    const startDate = todo.startAt ? localDateKey(new Date(todo.startAt)) : null;
    if (segment === 'plan') return (!startDate || (startDate >= rangeStart && startDate < rangeEnd)) && (isActiveTodo(todo) || (showCompleted && isDone));
    if (isDone) return showCompleted && (startDate === today || dueDate === today || (todo.completedAt && localDateKey(new Date(todo.completedAt)) === today));
    return isActiveTodo(todo) && (isOverdueTodo(todo, now) || (startDate && startDate <= today) || (dueDate && dueDate <= today) || (!startDate && !dueDate));
  });
}

function emptyLabel(segment) {
  if (segment === 'today') return '今天没有待办';
  if (segment === 'scheduled') return '没有定时任务';
  return '计划列表为空';
}

function isActiveTodo(todo) {
  return !['done', 'canceled', 'archived'].includes(todo.status);
}

function isOverdueTodo(todo, now = Date.now()) {
  return isActiveTodo(todo) && Boolean(todo.dueAt) && Date.parse(todo.dueAt) < now;
}

function statusLabel(status) {
  return ({ todo: '待处理', in_progress: '进行中', blocked: '受阻', done: '已完成', canceled: '已取消', archived: '已归档' })[status] ?? status;
}

function priorityLabel(priority) {
  return priority === 'urgent' ? '紧急' : priority === 'high' ? '高' : priority === 'low' ? '低' : '普通';
}

function formatDue(value) {
  if (!value) return '';
  const date = new Date(value);
  return `截止 ${new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)}`;
}

function inputDateTimeParts(value) {
  if (!value) return { date: '', time: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '', time: '' };
  return {
    date: localDateKey(date),
    time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  };
}

function localInputToIso(dateValue, timeValue, endOfDay) {
  if (!dateValue) return null;
  const [year, month, day] = dateValue.split('-').map(Number);
  if (![year, month, day].every(Number.isInteger)) return null;
  const [hours, minutes] = (timeValue || (endOfDay ? '23:59' : '00:00')).split(':').map(Number);
  const date = new Date(year, month - 1, day, hours || 0, minutes || 0, endOfDay && !timeValue ? 59 : 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDateWithWeekday(value) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(value));
}

function formatMonthDayTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function formatTimelineMarker(todo) {
  const value = todo.startAt;
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return formatTime(value);
}

function formatTodoWindow(todo) {
  const start = todo.startAt;
  if (start && todo.estimatedMinutes) {
    const end = new Date(Date.parse(start) + todo.estimatedMinutes * 60_000).toISOString();
    const crossesDay = localDateKey(new Date(start)) !== localDateKey(new Date(end));
    return crossesDay ? `计划 ${formatMonthDayTime(start)} - ${formatMonthDayTime(end)}` : `计划 ${formatMonthDayTime(start)} - ${formatTime(end)}`;
  }
  if (start) return `计划 ${formatMonthDayTime(start)}`;
  return '待排期';
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

function planDateInfo(key, now = Date.now()) {
  if (key === 'unscheduled') return { weekday: '待安排', monthDay: '执行日期未定', distance: '待排期' };
  const date = new Date(`${key}T12:00:00`);
  const today = new Date(now);
  const dateOrdinal = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const todayOrdinal = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const daysFromToday = Math.round((dateOrdinal - todayOrdinal) / 86_400_000);
  const distance = daysFromToday === 0 ? '今天' : daysFromToday === 1 ? '明天' : daysFromToday === 2 ? '后天' : daysFromToday > 0 ? `还有 ${daysFromToday} 天` : `${Math.abs(daysFromToday)} 天前`;
  return {
    weekday: new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date),
    monthDay: new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date),
    distance
  };
}

function formatMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return '';
  return `预估 ${formatDurationMinutes(minutes)}`;
}

function formatDurationMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return '';
  if (minutes % 1440 === 0) return `${minutes / 1440} 天`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

function deadlineUrgency(todo, now = Date.now()) {
  if (todo.status === 'done' || todo.status === 'canceled' || todo.status === 'archived') return 'done';
  if (!todo.dueAt) return 'unscheduled';
  const difference = Date.parse(todo.dueAt) - now;
  if (difference < 0) return 'overdue';
  if (difference <= 2 * 60 * 60 * 1000) return 'critical';
  if (difference <= 24 * 60 * 60 * 1000) return 'soon';
  return 'normal';
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isToday(value) {
  return typeof value === 'string' && localDateKey(new Date(value)) === localDateKey(new Date());
}

function sumUsage(entries) {
  return entries.reduce((total, entry) => {
    total.inputTokens += (entry.inputTokens ?? 0) + (entry.cacheReadTokens ?? 0) + (entry.cacheWriteTokens ?? 0);
    total.outputTokens += entry.outputTokens ?? 0;
    total.totalTokens += entry.totalTokens ?? ((entry.inputTokens ?? 0) + (entry.outputTokens ?? 0));
    total.calls += 1;
    return total;
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 });
}

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(value ?? 0);
}

function installStyles() {
  const existing = document.querySelector('style[data-todo-harness]');
  if (existing) return () => {};
  const style = document.createElement('style');
  style.dataset.todoHarness = 'true';
  style.textContent = `
    @media(min-width:1024px){
      #root [data-slot=root]>div:has(>[data-rightbar-col]){grid-template-columns:auto minmax(0,1fr) minmax(0,33.333vw)!important}
      #root [data-slot=root]>div:has(>[data-rightbar-col])>[data-rightbar-col]{min-width:0!important}
      #root [data-slot=root]>div:has(>[data-rightbar-col])>[data-side=rightbar]{display:none!important}
      [data-sidebar-right-open]{width:33.333vw!important;min-width:0!important;max-width:33.333vw;--dsh-sidebar-width:33.333vw!important}
    }
    .todo-harness-panel{box-sizing:border-box;display:flex;flex:1;flex-direction:column;gap:12px;min-width:0;min-height:0;width:100%;padding:14px 16px 12px;color:var(--dsw-alias-label-primary)}
    .todo-harness-expand-button,.todo-harness-mobile-sidebar-toggle,.todo-harness-action-button,.todo-harness-reasoning-configure{background:transparent!important;border-color:transparent!important;box-shadow:none!important}
    .todo-harness-expand-button:hover:not(:disabled),.todo-harness-mobile-sidebar-toggle:hover:not(:disabled){background:transparent!important;color:var(--dsw-alias-label-primary)!important}
    .todo-harness-action-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}
    .todo-harness-expand-button:focus-visible,.todo-harness-action-button:focus-visible,.todo-harness-mobile-sidebar-toggle:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
    .todo-harness-quick-requests{box-sizing:border-box;width:calc(100% - 2 * var(--dsh-composer-side-clearance,16px));max-width:var(--dsh-composer-card-max-width);min-width:0;margin:0 auto;background:var(--dsw-alias-bg-base)}
    .todo-harness-quick-requests.is-portaled{display:none}
    .todo-harness-quick-actions{box-sizing:border-box;display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:2px 6px;min-width:0;max-width:100%;margin-left:auto}
    .todo-harness-quick-action{width:auto;min-width:0!important;min-height:28px;padding:3px 5px!important;justify-content:center!important;border-color:transparent!important;background:transparent!important;color:var(--dsw-alias-label-secondary)!important;box-shadow:none!important;font-size:11px;white-space:normal}
    .wSkVaW_heroWorkspaceRow:has(.todo-harness-quick-actions){flex-wrap:wrap;gap:4px 8px}
    .wSkVaW_heroWorkspaceRow:has(.todo-harness-quick-actions)>.pXSMma_workspace{flex:0 1 auto;min-width:0}
    .todo-harness-quick-action:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)!important;background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}
    .todo-harness-quick-action svg{flex:none}
    .todo-harness-action-danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)!important;background:var(--dsw-alias-interactive-bg-hover-danger)!important}
    .todo-harness-panel-collapsed{align-items:center;gap:12px;width:64px;padding:12px 6px;border-left:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-expand-button{width:32px;height:32px;flex:none;justify-content:center}
    .todo-harness-compact-stats{display:grid;width:100%;gap:8px}
    .todo-harness-compact-stat{display:grid;justify-items:center;gap:3px;min-width:0;padding:5px 0;border-bottom:1px solid var(--dsw-alias-border-l3);font-variant-numeric:tabular-nums}
    .todo-harness-compact-stat span{color:var(--dsw-alias-label-tertiary);font-size:9px;line-height:13px;white-space:nowrap}
    .todo-harness-compact-stat strong{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:17px;overflow-wrap:anywhere}
    .todo-harness-list{flex:1;min-height:0;overflow:auto;padding:0 2px 4px;overscroll-behavior:contain}
    .todo-harness-row{display:flex;align-items:flex-start;gap:10px;min-width:0;padding:13px 2px;border-bottom:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-dot{width:8px;height:8px;margin-top:6px;border-radius:50%;background:#88929b;flex:none}
    .todo-harness-dot-in_progress{background:#4d9a73}.todo-harness-dot-blocked{background:#c57446}.todo-harness-dot-done{background:#6e9b7e}.todo-harness-dot-canceled,.todo-harness-dot-archived{background:#89929b}
    .todo-harness-row-copy{min-width:0;flex:1}
    .todo-harness-row-actions{display:flex;align-items:center;flex:none;gap:2px;margin-left:auto}.todo-harness-row-actions>button{width:30px;height:30px;min-width:30px;flex:none;padding:0}
    .todo-harness-row-copy strong{display:block;overflow-wrap:anywhere;font-size:13px;font-weight:500;line-height:19px}
    .todo-harness-priority{font-weight:600}.todo-harness-priority-low{color:var(--dsw-alias-label-tertiary)}.todo-harness-priority-normal{color:var(--dsw-alias-label-secondary)}.todo-harness-priority-high{color:#b17a2f}.todo-harness-priority-urgent{color:#b45f54}
    .todo-harness-effort{padding-left:5px;color:var(--dsw-alias-label-tertiary)}
    .todo-harness-timeline-group{margin:2px 0 16px}.todo-harness-timeline-group-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 1px 8px;border-bottom:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px}.todo-harness-timeline-group-header>div{display:flex;align-items:baseline;flex-wrap:wrap;gap:7px;min-width:0}.todo-harness-timeline-group-header strong{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600}.todo-harness-timeline-group-header>span{flex:none;font-variant-numeric:tabular-nums}.todo-harness-timeline-group-overdue .todo-harness-timeline-group-header strong{color:#ad574e}
    .todo-harness-task-timeline{display:flex;flex-direction:column;min-width:0;padding:3px 0 2px}
    .todo-harness-task-group{--todo-harness-timeline-rail:clamp(20px,5%,32px);--todo-harness-timeline-gap:8px;--todo-harness-timeline-dot-size:12px}
    .todo-harness-timeline-item{display:grid;grid-template-columns:var(--todo-harness-timeline-rail) minmax(0,1fr);column-gap:var(--todo-harness-timeline-gap);min-width:0}
    .todo-harness-timeline-marker{display:grid;grid-column:1;grid-row:1;place-items:center;min-width:0}
    .todo-harness-timeline-marker:before{grid-area:1/1;align-self:stretch;width:1px;background:var(--dsw-alias-border-l3);content:""}
    .todo-harness-timeline-marker .todo-harness-dot{grid-area:1/1;z-index:1;box-sizing:border-box;width:var(--todo-harness-timeline-dot-size);height:var(--todo-harness-timeline-dot-size);margin:0;border:2px solid var(--dsw-alias-bg-base);box-shadow:none}
    .todo-harness-timeline-item>.todo-harness-row{grid-column:2;grid-row:1;margin-block:9px}
    .todo-harness-row{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:9px;min-width:0;margin:7px 0;padding:10px 8px;border:1px solid var(--dsw-alias-border-l3);border-radius:5px;background:var(--dsw-alias-bg-base);transition:border-color .15s ease,background .15s ease}
    .todo-harness-row:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base))}.todo-harness-row.todo-harness-urgency-overdue{border-left:3px solid #b45f54;background:color-mix(in srgb,#b45f54 4%,var(--dsw-alias-bg-base))}.todo-harness-row.todo-harness-urgency-critical{border-left:3px solid #c57446}.todo-harness-row.todo-harness-urgency-soon{border-left:3px solid #b17a2f}.todo-harness-row.todo-harness-task-done{opacity:.72}
    .todo-harness-row-copy{grid-column:1;min-width:0}.todo-harness-row-title{display:flex;align-items:center;flex-wrap:wrap;gap:5px;min-width:0}.todo-harness-row-title>strong{flex:1 1 125px;min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:550;line-height:18px}.todo-harness-task-done .todo-harness-row-title>strong{color:var(--dsw-alias-label-secondary);text-decoration:line-through;text-decoration-color:var(--dsw-alias-label-dimmed)}
    .todo-harness-status,.todo-harness-priority{display:inline-flex;align-items:center;min-height:18px;max-width:100%;padding:1px 5px;border-radius:4px;font-size:10px;font-weight:600;line-height:14px;white-space:nowrap}.todo-harness-status{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.todo-harness-status-in_progress{background:color-mix(in srgb,#4d9a73 14%,var(--dsw-alias-bg-base));color:#36724f}.todo-harness-status-blocked{background:color-mix(in srgb,#c57446 14%,var(--dsw-alias-bg-base));color:#a85e3e}.todo-harness-status-done{background:color-mix(in srgb,#6e9b7e 13%,var(--dsw-alias-bg-base));color:#56846e}.todo-harness-priority-low{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}.todo-harness-priority-normal{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.todo-harness-priority-high{background:color-mix(in srgb,#b17a2f 13%,var(--dsw-alias-bg-base));color:#9a6827}.todo-harness-priority-urgent{background:color-mix(in srgb,#b45f54 13%,var(--dsw-alias-bg-base));color:#a34f45}
    .todo-harness-row-time-range{display:flex;align-items:center;flex-wrap:wrap;gap:5px 9px;margin-top:5px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:15px;font-variant-numeric:tabular-nums}
    .todo-harness-row-actions{grid-column:2;grid-row:1;align-self:start;gap:1px;margin:0}.todo-harness-row-actions>button{width:27px;height:27px;min-width:27px}.todo-harness-action-button{color:var(--dsw-alias-label-tertiary)!important}.todo-harness-action-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)!important}.todo-harness-action-danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)!important}
    .todo-harness-plan-day{display:flex;align-items:center;gap:8px;min-width:0}.todo-harness-plan-day-copy{display:flex;flex-direction:column;gap:1px;min-width:0}.todo-harness-plan-day-copy strong{color:var(--dsw-alias-label-primary);font-size:12px;font-weight:600;line-height:16px}.todo-harness-plan-day-copy span{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:13px}.todo-harness-plan-group-summary{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:4px 8px;min-width:0;text-align:right}.todo-harness-plan-group-summary>span{white-space:nowrap}
    .todo-harness-notes{margin:6px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px;white-space:pre-wrap;overflow-wrap:anywhere}
    .todo-harness-tags{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.todo-harness-tags span{border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);padding:2px 6px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:14px}
    .todo-harness-state{display:grid;min-height:150px;place-content:center;justify-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:13px;text-align:center}.todo-harness-state p{margin:0}.todo-harness-error{color:#a85f54}
    .todo-harness-notice{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .todo-harness-token-usage{box-sizing:border-box;display:flex;flex-direction:column;gap:7px;width:100%;padding:0 2px 12px;color:var(--dsw-alias-label-tertiary)}
    .todo-harness-token-usage-label{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:11px;line-height:15px}
    .todo-harness-token-usage-label strong{overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;font-variant-numeric:tabular-nums}
    .todo-harness-token-usage-track{height:5px;overflow:hidden;border-radius:3px;background:var(--dsw-alias-interactive-bg-hover)}
    .todo-harness-token-usage-track span{display:block;height:100%;border-radius:inherit;background:#56846e;transition:width .2s ease}
    .todo-harness-provider-onboarding-modal{width:min(560px,calc(100vw - 32px));max-width:calc(100vw - 32px)}
    .todo-harness-provider-onboarding{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
    .todo-harness-provider-onboarding p{margin:0}.todo-harness-provider-onboarding-help{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
    .todo-harness-voice-modal{width:min(460px,100%);max-height:100%;border-radius:8px;gap:20px;letter-spacing:0}
    .todo-harness-voice-content{min-height:0;overflow-y:auto;overscroll-behavior:contain}
    .todo-harness-voice-setup{display:flex;flex-direction:column;gap:20px;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
    .todo-harness-voice-setup p,.todo-harness-voice-setup dl,.todo-harness-voice-setup dd{margin:0}
    .todo-harness-voice-model{display:grid;grid-template-columns:44px minmax(0,1fr);align-items:center;gap:12px}
    .todo-harness-voice-model-icon{display:grid;place-items:center;width:44px;height:44px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;color:var(--dsw-alias-state-business-primary)}
    .todo-harness-voice-model strong{display:block;overflow-wrap:anywhere;font-size:15px;font-weight:600;line-height:22px}
    .todo-harness-voice-model p{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
    .todo-harness-voice-estimates{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding-block:14px;border-block:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-voice-estimates dt{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}
    .todo-harness-voice-estimates dd{margin-top:5px;font-size:13px;font-weight:550;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .todo-harness-voice-status{display:flex;flex-direction:column;gap:12px;min-width:0}
    .todo-harness-voice-status-heading{display:flex;align-items:center;gap:8px;min-height:22px}
    .todo-harness-voice-status-heading svg{flex:none;color:var(--dsw-alias-label-secondary)}
    .todo-harness-voice-status-heading strong{font-size:13px;font-weight:550;overflow-wrap:anywhere}
    .todo-harness-voice-status[data-tone=error] .todo-harness-voice-status-heading{color:var(--dsw-alias-state-error-primary)}
    .todo-harness-voice-status[data-tone=error] svg{color:inherit}
    .todo-harness-voice-status[data-tone=ready] .todo-harness-voice-status-heading{color:var(--dsw-alias-state-success-primary,#36724f)}
    .todo-harness-voice-status[data-tone=ready] svg{color:inherit}
    .todo-harness-voice-download{display:flex;flex-direction:column;gap:8px;min-width:0;font-size:12px;font-variant-numeric:tabular-nums}
    .todo-harness-voice-download-heading{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;color:var(--dsw-alias-label-secondary)}
    .todo-harness-voice-download-heading>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .todo-harness-voice-download-heading>span:last-child{font-weight:600;color:var(--dsw-alias-state-business-primary)}
    .todo-harness-voice-download progress{display:block;appearance:none;box-sizing:border-box;flex:none;width:100%;height:6px;overflow:hidden;border:0;border-radius:3px;background:var(--dsw-alias-interactive-bg-hover);accent-color:var(--dsw-alias-state-business-primary)}
    .todo-harness-voice-download progress::-webkit-progress-bar{background:var(--dsw-alias-interactive-bg-hover);border-radius:3px}
    .todo-harness-voice-download progress::-webkit-progress-value{background:var(--dsw-alias-state-business-primary);border-radius:3px;transition:width .2s ease}
    .todo-harness-voice-download progress::-moz-progress-bar{background:var(--dsw-alias-state-business-primary);border-radius:3px}
    .todo-harness-voice-download progress:indeterminate{background:linear-gradient(90deg,var(--dsw-alias-interactive-bg-hover) 25%,var(--dsw-alias-state-business-primary) 50%,var(--dsw-alias-interactive-bg-hover) 75%);background-size:200% 100%;animation:todo-harness-voice-progress 1.6s linear infinite}
    .todo-harness-voice-download progress:indeterminate::-webkit-progress-bar{background:transparent}
    .todo-harness-voice-download-bytes{color:var(--dsw-alias-label-tertiary);text-align:right}
    .todo-harness-voice-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:19px;overflow-wrap:anywhere}
    .todo-harness-voice-steps{display:flex;flex-direction:column;gap:12px;list-style:none;margin:0;padding:16px 0 0;border-top:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-voice-steps li{display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:9px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
    .todo-harness-voice-step-icon{box-sizing:border-box;display:grid;place-items:center;width:22px;height:22px;border:1px solid var(--dsw-alias-border-l3);border-radius:50%;font-size:10px;line-height:1;font-variant-numeric:tabular-nums}
    .todo-harness-voice-steps li[data-state=running]{color:var(--dsw-alias-label-primary)}
    .todo-harness-voice-steps li[data-state=running] .todo-harness-voice-step-icon{border-color:transparent;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent);color:var(--dsw-alias-state-business-primary)}
    .todo-harness-voice-steps li[data-state=complete] .todo-harness-voice-step-icon{border-color:transparent;color:var(--dsw-alias-state-success-primary,#36724f)}
    .todo-harness-voice-steps li[data-state=failed]{color:var(--dsw-alias-state-error-primary)}
    .todo-harness-voice-step-status{font-size:11px;white-space:nowrap}
    .todo-harness-voice-error{display:flex;flex-direction:column;gap:6px;border-left:2px solid var(--dsw-alias-state-error-primary);padding-left:12px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:19px;overflow-wrap:anywhere}
    .todo-harness-voice-error details{color:var(--dsw-alias-label-secondary)}
    .todo-harness-voice-error summary{width:max-content;max-width:100%;cursor:pointer}
    .todo-harness-voice-error details dl{display:flex;flex-direction:column;gap:5px;margin-top:8px}
    .todo-harness-voice-error details dl>div{display:grid;grid-template-columns:42px minmax(0,1fr);gap:6px}
    .todo-harness-voice-error dt{color:var(--dsw-alias-label-tertiary)}
    .todo-harness-voice-actions{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;width:100%;min-width:0}
    .todo-harness-voice-actions-primary{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;min-width:0;margin-left:auto}
    .todo-harness-voice-actions button{min-height:34px;gap:6px;font-size:13px}
    .todo-harness-voice-spinner{animation:todo-harness-voice-spin 1s linear infinite}
    @keyframes todo-harness-voice-spin{to{transform:rotate(360deg)}}
    @keyframes todo-harness-voice-progress{to{background-position:-200% 0}}
    @media(prefers-reduced-motion:reduce){.todo-harness-voice-spinner,.todo-harness-voice-download progress:indeterminate{animation:none}.todo-harness-voice-download progress::-webkit-progress-value{transition:none}}
    .todo-harness-provider-recommendation{display:inline-flex;align-items:center;height:20px;margin-left:7px;padding:0 6px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,transparent);border-radius:4px;color:var(--dsw-alias-state-business-primary);font-size:11px;line-height:18px}
    .todo-harness-modal{box-sizing:border-box;width:min(520px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:min(82vh,760px)}.todo-harness-modal-content{box-sizing:border-box;width:100%;min-width:0;max-width:100%;max-height:100%;overflow:auto}
    .todo-harness-editor{display:flex;flex-direction:column;gap:14px;min-width:0}.todo-harness-editor-field{display:flex;flex-direction:column;gap:7px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px}.todo-harness-editor-title input{height:42px;font-size:14px}.todo-harness-editor-field input,.todo-harness-editor-field select,.todo-harness-editor-field textarea{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l3);border-radius:5px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;padding:8px 10px}.todo-harness-editor-field input,.todo-harness-editor-field select{height:38px}.todo-harness-editor-field textarea{resize:vertical;line-height:18px}.todo-harness-editor-field input:focus,.todo-harness-editor-field select:focus,.todo-harness-editor-field textarea:focus{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}.todo-harness-editor-field input::placeholder,.todo-harness-editor-field textarea::placeholder{color:var(--dsw-alias-label-dimmed)}.todo-harness-editor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.todo-harness-todo-fields{align-items:start}.todo-harness-editor-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l3)}.todo-harness-editor-help{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.todo-harness-editor-timezone{align-self:end;padding:9px 0;color:var(--dsw-alias-label-tertiary);font-size:12px}.todo-harness-weekdays{display:flex;align-items:center;flex-wrap:wrap;gap:7px;border:0;margin:0;padding:0}.todo-harness-weekdays legend{width:100%;margin-bottom:0;color:var(--dsw-alias-label-secondary);font-size:12px}.todo-harness-weekday{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary);font-size:12px}.todo-harness-weekday input,.todo-harness-reasoning-level input{accent-color:var(--dsw-alias-state-business-primary)}
    .todo-harness-reasoning-row{grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) auto;align-items:end}.todo-harness-reasoning-field{min-width:0}.todo-harness-reasoning-control{display:flex;align-items:center;gap:8px;min-height:38px}.todo-harness-reasoning-configure{flex:none}.todo-harness-reasoning-levels{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px;border:0;margin:0;padding:0}.todo-harness-reasoning-levels legend{grid-column:1/-1;margin-bottom:2px;color:var(--dsw-alias-label-secondary);font-size:12px}.todo-harness-reasoning-level{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:13px}.todo-harness-reasoning-editor{gap:16px}
    .todo-harness-input-with-suffix{display:flex;align-items:center;gap:8px}.todo-harness-input-with-suffix input{min-width:0;flex:1}.todo-harness-input-with-suffix span{color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap}.todo-harness-confirm-modal{width:min(460px,calc(100vw - 32px));max-width:calc(100vw - 32px)}.todo-harness-confirmation{display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}.todo-harness-confirmation p{margin:0;overflow-wrap:anywhere}
    .todo-harness-dispatch-modal{box-sizing:border-box;width:min(540px,calc(100vw - 32px));max-height:calc(100dvh - 32px);letter-spacing:0}
    .todo-harness-confirm-content{min-width:0;min-height:0;overflow:auto}
    .todo-harness-dispatch-model-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:start}
    .todo-harness-dispatch-model-menu{display:block;width:100%;min-width:0}
    .todo-harness-dispatch-model-trigger{box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-width:0;height:64px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:5px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
    .todo-harness-dispatch-model-trigger>svg{flex:none;color:var(--dsw-alias-label-tertiary)}
    .todo-harness-dispatch-model-trigger:disabled{opacity:.55;cursor:default}
    .todo-harness-dispatch-model-value{display:flex;flex:1;flex-direction:column;gap:1px;min-width:0}
    .todo-harness-dispatch-model-value strong{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:13px;font-weight:500;line-height:18px;white-space:normal;overflow-wrap:anywhere}
    .todo-harness-dispatch-model-value small{overflow:hidden;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px;text-overflow:ellipsis;white-space:nowrap}
    .todo-harness-dispatch-model-list{box-sizing:border-box;min-width:0;max-width:calc(100vw - 48px);max-height:min(360px,48dvh);overflow:auto;letter-spacing:0}
    .todo-harness-dispatch-model-list [role=menuitem]{min-height:36px;height:auto}
    .todo-harness-dispatch-model-option{display:flex;flex-direction:column;min-width:0;padding:3px 0;white-space:normal;overflow-wrap:anywhere}
    .todo-harness-dispatch-model-option small{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
    .todo-harness-dispatch-model-grid+.todo-harness-settings-help{margin-top:-6px}
    .todo-harness-dispatch-directory{display:flex;flex-direction:column;gap:10px;min-width:0;padding-top:16px;border-top:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-dispatch-directory h3{margin:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:20px}
    .todo-harness-dispatch-directory h3+.todo-harness-settings-help{margin-top:-5px}
    .todo-harness-dispatch-directory-modes{display:flex;align-items:center;flex-wrap:wrap;gap:10px 20px;padding:2px 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px}
    .todo-harness-dispatch-directory-modes label{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
    .todo-harness-dispatch-directory-modes input,.todo-harness-directory-hidden input{flex:none;width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-state-business-primary)}
    .todo-harness-dispatch-recommended{color:var(--dsw-alias-state-business-primary);font-size:11px}
    .todo-harness-dispatch-directory-trigger,.todo-harness-dispatch-current-directory{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-width:0;min-height:68px;padding:12px;border:1px solid var(--dsw-alias-border-l3);border-radius:6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:inherit;text-align:left}
    .todo-harness-dispatch-directory-trigger{cursor:pointer}
    .todo-harness-dispatch-directory-trigger:hover{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover)}
    .todo-harness-dispatch-directory-trigger>svg,.todo-harness-dispatch-current-directory>svg{flex:none;color:var(--dsw-alias-label-tertiary)}
    .todo-harness-dispatch-directory-copy{display:flex;flex:1;flex-direction:column;gap:3px;min-width:0;overflow-wrap:anywhere}
    .todo-harness-dispatch-directory-copy strong{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:19px}
    .todo-harness-dispatch-directory-copy>span{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px;white-space:normal}
    .todo-harness-dispatch-modal .todo-harness-editor-actions{width:100%;margin:0;padding:0;border:0}
    .todo-harness-dispatch-modal .todo-harness-editor-actions button{gap:6px;min-height:34px}
    .todo-harness-dispatch-model-trigger:focus-visible,.todo-harness-dispatch-directory-trigger:focus-visible,.todo-harness-directory-entry:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
    .todo-harness-directory-modal{box-sizing:border-box;width:min(580px,calc(100vw - 32px));max-height:calc(100dvh - 32px);letter-spacing:0}
    .todo-harness-directory-content{display:flex;min-height:0;min-width:0;overflow:auto}
    .todo-harness-directory-browser{display:flex;flex:1;flex-direction:column;gap:10px;min-width:0;min-height:0}
    .todo-harness-directory-address{box-sizing:border-box;display:flex;align-items:center;gap:3px;width:100%;min-width:0;padding:3px;border:1px solid var(--dsw-alias-border-l3);border-radius:5px}
    .todo-harness-directory-address input,.todo-harness-directory-create input{box-sizing:border-box;flex:1;width:0;min-width:0;height:32px;padding:0 5px;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
    .todo-harness-directory-address:focus-within{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
    .todo-harness-directory-address input:focus{outline:none}
    .todo-harness-directory-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:12px}
    .todo-harness-directory-toolbar button{gap:5px;font-size:12px}
    .todo-harness-directory-create{display:flex;align-items:center;gap:8px;min-width:0}
    .todo-harness-directory-create input{border:1px solid var(--dsw-alias-border-l3);border-radius:4px;padding:0 8px}
    .todo-harness-directory-entries{height:min(270px,35dvh);min-height:90px;overflow:auto;overscroll-behavior:contain}
    .todo-harness-directory-entries>p{padding:12px 6px}
    .todo-harness-directory-native{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;height:100%;color:var(--dsw-alias-label-tertiary);text-align:center}
    .todo-harness-directory-entry{box-sizing:border-box;display:flex;align-items:center;gap:9px;width:100%;min-width:0;min-height:36px;padding:7px 6px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;text-align:left;cursor:pointer}
    .todo-harness-directory-entry:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .todo-harness-directory-entry>span{flex:1;min-width:0;overflow-wrap:anywhere}
    .todo-harness-directory-entry>svg{flex:none;color:var(--dsw-alias-label-tertiary)}
    .todo-harness-directory-location{margin:0;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px;overflow-wrap:anywhere}
    .todo-harness-directory-footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;width:100%;min-width:0}
    .todo-harness-directory-hidden{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px}
    .todo-harness-directory-actions{display:flex;justify-content:flex-end;gap:8px;margin-left:auto}
    @media(max-width:420px){.todo-harness-dispatch-directory-modes{gap:8px 14px}.todo-harness-dispatch-directory-trigger,.todo-harness-dispatch-current-directory{padding:10px}.todo-harness-directory-footer{align-items:flex-start}.todo-harness-directory-actions{flex:1}}
    .todo-harness-brand-mark{box-sizing:border-box;display:block;flex:none;object-fit:cover;transform:scale(1.18)}.todo-harness-brand-mark-fallback{display:inline-grid;place-items:center;background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-bg-base);font-size:15px;font-weight:700;line-height:1}.todo-harness-brand-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .todo-harness-settings-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:10px 12px;padding:14px 0;border-bottom:1px solid var(--dsw-alias-border-l3)}.todo-harness-settings-field{display:flex;flex-direction:column;gap:7px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:13px}.todo-harness-settings-field input,.todo-harness-settings-field select{box-sizing:border-box;width:100%;height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:5px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit}.todo-harness-settings-field input:focus,.todo-harness-settings-field select:focus{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}.todo-harness-settings-help{grid-column:1/-1;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.todo-harness-settings-error{grid-column:1/-1;color:var(--dsw-alias-state-error-primary);font-size:12px;overflow-wrap:anywhere}
    .todo-harness-agent-settings{min-width:0;color:var(--dsw-alias-label-primary);letter-spacing:0}
    .todo-harness-agent-settings h2{margin:0 0 10px;font-size:18px;font-weight:600;line-height:26px}
    .todo-harness-agent-settings .todo-harness-settings-row{padding-block:18px}
    .todo-harness-reasoning-row>.todo-harness-settings-field:first-child{grid-column:1/-1}
    .todo-harness-reasoning-row>.todo-harness-settings-field:nth-child(2){grid-column:1}
    .todo-harness-reasoning-row>button:nth-child(3){grid-column:2}
    .todo-harness-reasoning-control select{flex:1;min-width:0}
    .todo-harness-reasoning-configure{width:32px;height:32px;min-width:32px}
    .todo-harness-reasoning-setup{grid-column:1/-1;justify-self:start}
    @media(max-width:767px){
      [data-shortcut-modal="settings"]{box-sizing:border-box;width:calc(100vw - 32px)!important;max-width:calc(100vw - 32px)!important;height:calc(100vh - 32px)!important;max-height:calc(100vh - 32px)!important;flex-direction:column!important;overflow:auto!important}
      [data-shortcut-modal="settings"] nav{box-sizing:border-box;width:100%!important;flex:none!important;gap:10px!important;padding:16px 16px 0!important}
      [data-shortcut-modal="settings"] nav>div:nth-child(2){display:flex;flex-direction:row;gap:4px;max-width:100%;overflow-x:auto;overflow-y:hidden;padding-bottom:2px}
      [data-shortcut-modal="settings"] nav>div:nth-child(2)>button{flex:none;min-width:max-content;height:36px;padding:7px 12px!important}
      [data-shortcut-modal="settings"]>div:nth-child(2){display:flex;flex:1;min-height:0;width:100%}
      [data-shortcut-modal="settings"] [class*="options"]{box-sizing:border-box;min-width:0;width:100%;padding:0 16px 20px!important;overflow:auto}
    }
    ._WvWnq_section .yIbyla_row,.me01iq_action,.pXSMma_previewBadge{display:none!important}
    [data-sidebar-right-guide]{display:none!important}
    [data-sidebar-right-open] [data-dockkit-pane]:has([role="tab"][aria-selected="true"] [data-todo-harness-tab-title])>div:has(>[data-dockkit-strip]){display:none!important}
    [role="tab"]:has([data-todo-harness-tab-title]) [data-dockkit-tab-close]{display:none!important}
    button[aria-label="插件"],button[aria-label="Plugins"]{display:none!important}
    #root [data-slot=root]>div:has(>[data-rightbar-col]):has([data-todo-harness-collapsed]){grid-template-columns:auto minmax(0,1fr) 64px!important}
    [data-sidebar-right-open]:has([data-todo-harness-collapsed]){width:64px!important;max-width:64px!important;--dsh-sidebar-width:64px!important}
    .todo-harness-mobile-sidebar-toggle{display:none!important}
    .todo-harness-model-url-field{display:flex;flex-direction:column;gap:6px;margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
    .todo-harness-model-url-field input{box-sizing:border-box;width:100%;height:34px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit}
    .todo-harness-model-url-field input:focus{border-color:var(--dsw-alias-state-business-primary);outline:none}
    .todo-harness-model-url-field input::placeholder{color:var(--dsw-alias-label-dimmed)}
    @media(max-width:767px){
      .todo-harness-quick-actions{gap:2px;justify-content:flex-start}
      .todo-harness-quick-action{max-width:100%;font-size:11px}
      .todo-harness-quick-action>span:has(>svg){display:none}
      #root [data-slot=root]>div:has(>[data-rightbar-col]){grid-template-columns:56px minmax(0,1fr)!important;grid-template-rows:minmax(0,1fr)!important}
      #root [data-slot=root]>div:has(>[data-rightbar-col])>.pI_x6G_sidebarCol{grid-column:1;grid-row:1;z-index:30}
      #root [data-slot=root]>div:has(>[data-rightbar-col])>.pI_x6G_centerCol{grid-column:2;grid-row:1;min-height:0}
      #root [data-slot=root]>div:has(>[data-rightbar-col])>.pI_x6G_rightbarCol{grid-column:2;grid-row:1;min-height:0;overflow:visible;z-index:20}
      #root [data-slot=root]>div:has(>[data-rightbar-col]):has([data-todo-harness-collapsed]){grid-template-columns:56px minmax(0,1fr)!important}
      #root [data-slot=root]>div:has(>[data-rightbar-col]):not([data-todo-harness-mobile-todo-open="true"])>.pI_x6G_rightbarCol{pointer-events:none}
      #root [data-slot=root]>div:has(>[data-rightbar-col])[data-todo-harness-mobile-todo-open="true"]>.pI_x6G_rightbarCol{pointer-events:auto}
      [data-sidebar-right-open]:has([data-todo-harness-collapsed]){width:100%!important;max-width:none!important;--dsh-sidebar-width:100%!important}
      #root [data-slot=root]>div:has(>[data-rightbar-col]):not([data-todo-harness-mobile-todo-open="true"])>.pI_x6G_rightbarCol [data-sidebar-right-open]{display:none!important}
      #root [data-slot=root]>div:has(>[data-rightbar-col])[data-todo-harness-mobile-todo-open="true"]>.pI_x6G_centerCol{display:none!important}
      [data-sidebar-right-open]{box-sizing:border-box!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;min-width:0!important;--dsh-sidebar-width:100%!important}
      [data-sidebar-right-expand]{display:none!important}
      .todo-harness-mobile-sidebar-toggle{display:inline-flex!important;box-sizing:border-box;width:36px;height:36px;min-width:36px;flex:none;justify-content:center;padding:0}
      .todo-harness-collapse-button{display:none!important}
      .todo-harness-panel{height:100%;min-width:0;padding:12px}
      .todo-harness-modal{width:calc(100vw - 32px);max-width:calc(100vw - 32px);max-height:calc(100vh - 32px)}
      .todo-harness-settings-row{grid-template-columns:minmax(0,1fr) auto}
      .todo-harness-reasoning-row{grid-template-columns:minmax(0,1fr) auto}
      .todo-harness-editor-grid{grid-template-columns:minmax(0,1fr)}
      .todo-harness-modal-content{width:100%;min-width:0;max-width:100%;max-height:100%}
      .todo-harness-plan-row{grid-template-columns:44px minmax(0,1fr);column-gap:12px}
      .todo-harness-plan-row .todo-harness-row-copy{grid-column:2;grid-row:1}
      .todo-harness-plan-row .todo-harness-row-actions{grid-column:2;grid-row:2;justify-self:start;margin:10px 0 0}
      .todo-harness-list{padding-right:0}
      .todo-harness-row{grid-template-columns:minmax(0,1fr);gap:0;margin:7px 0;padding:9px 8px}
      .todo-harness-row-copy,.todo-harness-plan-row .todo-harness-row-copy{grid-column:1;grid-row:1}
      .todo-harness-row-actions,.todo-harness-plan-row .todo-harness-row-actions{grid-column:1;grid-row:2;justify-self:start;margin:7px 0 0}
      .todo-harness-row-actions>button{width:30px;height:30px;min-width:30px}
      .todo-harness-plan-group-header{align-items:flex-start;gap:6px;padding:8px 1px}.todo-harness-plan-day{gap:6px}.todo-harness-plan-day-copy strong{font-size:11px}.todo-harness-plan-day-copy span{font-size:9px}.todo-harness-plan-group-summary{gap:3px 5px;font-size:9px}
      .todo-harness-timeline-group-header{align-items:flex-start}.todo-harness-timeline-group-header>span{font-size:9px}
    }
    .todo-harness-compact-stat{border-bottom:0}
    .todo-harness-timeline-group-header,.todo-harness-plan-group-header{border-bottom:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-timeline-group-header{padding:9px 2px 10px}
    .todo-harness-plan-group-header{padding:10px 3px}
    .todo-harness-plan-group{margin:5px 0 22px}
    .todo-harness-row{margin:7px 0 12px;padding:12px 10px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l3) 78%,transparent);border-radius:6px;background:var(--dsw-alias-bg-base);transition:border-color .15s ease,background .15s ease}
    .todo-harness-row:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base))}
    .todo-harness-row.todo-harness-urgency-overdue,.todo-harness-row.todo-harness-urgency-critical,.todo-harness-row.todo-harness-urgency-soon{border-left-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base)}
    .todo-harness-row.todo-harness-urgency-overdue:hover,.todo-harness-row.todo-harness-urgency-critical:hover,.todo-harness-row.todo-harness-urgency-soon:hover{background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base))}
    @media(max-width:767px){
      .todo-harness-row{margin:7px 0 12px;padding:11px 9px}
      .todo-harness-timeline-group-header{padding:8px 2px 9px}
      .todo-harness-plan-group-header{padding:9px 2px}
    }
    /* Reference layout: compact navigation, overview bands and timeline cards. */
    @media(min-width:1024px){
      #root [data-slot=root]>div:has(>[data-rightbar-col]){grid-template-columns:auto minmax(0,1fr) minmax(0,33.333vw)!important}
      #root [data-slot=root]>div:has(>[data-rightbar-col])>[data-rightbar-col]{width:33.333vw!important;min-width:0!important;max-width:33.333vw!important}
      [data-sidebar-right-open]{box-sizing:border-box;width:100%!important;min-width:0!important;max-width:100%;--dsh-sidebar-width:33.333vw!important}
    }
    .todo-harness-panel{container-type:inline-size;gap:0;padding:0 20px 18px;background:#f5f9fc;color:#1d2b3d}
    .todo-harness-topnav{display:flex;align-items:stretch;justify-content:space-between;gap:12px;min-height:56px;margin:0 -20px;border-bottom:1px solid #e1ebf1;background:rgba(255,255,255,.58)}
    .todo-harness-topnav-tabs{display:flex;align-items:stretch;gap:4px;min-width:0;padding-left:20px}
    .todo-harness-topnav-tab{position:relative;display:inline-flex;align-items:center;gap:9px;height:56px;padding:0 13px;border:0;background:transparent;color:#5f7186;font:inherit;font-size:14px;white-space:nowrap;cursor:pointer}
    .todo-harness-topnav-tab:hover{color:#21364b}.todo-harness-topnav-tab.is-active{color:#182b40;font-weight:650}
    .todo-harness-topnav-tab.is-active::after{position:absolute;right:10px;bottom:-1px;left:10px;height:2px;border-radius:2px;background:#10a875;content:""}
    .todo-harness-topnav-actions{display:flex;align-items:center;gap:2px;padding:0 14px 0 0}
    .todo-harness-topnav-action{width:32px!important;height:32px!important;min-width:32px!important;padding:0!important;color:#536a80!important}
    .todo-harness-topnav-action:hover:not(:disabled){color:#173a59!important;background:#eaf2f5!important}
    .todo-harness-panel-tools{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;min-height:0;margin:0;padding:0}
    .todo-harness-panel-tools.is-open{padding:8px 0 0}
    .todo-harness-search-field{display:flex;align-items:center;gap:7px;width:100%;height:32px;padding:0 10px;border:1px solid #dbe7ed;border-radius:6px;background:#fff;color:#7590a0}
    .todo-harness-search-field input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:#1d2b3d;font:inherit;font-size:12px}.todo-harness-search-field input::placeholder{color:#a1b2bd}
    .todo-harness-filter-menu{display:flex;align-items:center;flex-wrap:wrap;gap:5px;width:100%;padding:7px 9px;border:1px solid #dbe7ed;border-radius:6px;background:#fff;color:#7990a0;font-size:11px}
    .todo-harness-filter-menu button{height:24px;padding:0 8px;border:1px solid transparent;border-radius:4px;background:#f3f7f9;color:#617789;font:inherit;cursor:pointer}
    .todo-harness-filter-menu button.is-selected{border-color:#bde8d8;background:#e4f6ef;color:#138561;font-weight:600}.todo-harness-filter-completed{display:inline-flex;align-items:center;gap:5px;margin-left:auto;color:#708596;white-space:nowrap}
    .todo-harness-panel-title{display:grid;grid-template-columns:minmax(145px,1fr) auto;align-items:center;gap:15px;min-height:86px;padding:15px 0 10px}
    .todo-harness-panel-title-copy{display:flex;flex-direction:column;gap:3px;min-width:0}.todo-harness-panel-title-copy h1{margin:0;color:#172b40;font-size:22px;font-weight:650;line-height:28px}.todo-harness-panel-title-copy span{color:#708398;font-size:12px;line-height:17px}
    .todo-harness-panel-title-metrics{display:flex;align-items:stretch;justify-content:flex-end;min-width:0}.todo-harness-panel-title-metric{display:flex;flex-direction:column;gap:1px;min-width:52px;padding:2px 10px;border-left:1px solid #e4edf2;text-align:center}
    .todo-harness-panel-title-metric strong{color:#172b40;font-size:17px;font-weight:650;line-height:22px;font-variant-numeric:tabular-nums}.todo-harness-panel-title-metric span{color:#7e90a0;font-size:10px;line-height:15px;white-space:nowrap}
    .todo-harness-panel-title-plan{grid-template-columns:minmax(112px,.65fr) minmax(290px,1.75fr)}.todo-harness-panel-title-plan .todo-harness-panel-title-metrics{grid-column:1/-1;justify-content:flex-start}
    .todo-harness-plan-week-strip{display:flex;align-items:center;justify-content:center;gap:3px;min-width:0}.todo-harness-plan-week-days{display:grid;grid-template-columns:repeat(7,minmax(34px,1fr));gap:2px;min-width:0}
    .todo-harness-plan-week-day{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-width:0;height:48px;padding:2px 3px;border:0;border-radius:6px;background:transparent;color:#667d91;font:inherit;cursor:pointer}
    .todo-harness-plan-week-day:hover{background:#edf5f7;color:#24435b}.todo-harness-plan-week-day.is-selected{background:#e1f4ee;color:#146c58}.todo-harness-plan-week-day strong{font-size:11px;font-weight:600;line-height:15px;white-space:nowrap}.todo-harness-plan-week-day span{font-size:10px;line-height:14px;white-space:nowrap}
    .todo-harness-plan-week-arrow{width:25px!important;height:30px!important;min-width:25px!important;padding:0!important;color:#8096a8!important}
    .todo-harness-list{padding:0 0 10px}.todo-harness-timeline-group{margin:0 0 16px}.todo-harness-timeline-group-header{justify-content:flex-start;gap:8px;padding:8px 2px 9px;border:0;color:#738a9c}.todo-harness-timeline-group-header>div{gap:8px}.todo-harness-timeline-group-header strong{font-size:14px;font-weight:650}.todo-harness-timeline-group-header>span{font-size:11px}
    .todo-harness-timeline-group-marker{display:flex;flex:0 0 86px;align-items:center;gap:8px;min-width:0;color:#536c82}.todo-harness-timeline-group-marker time{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
    .todo-harness-group-dot{display:inline-block;width:9px;height:9px;border:2px solid #c7d7e0;border-radius:50%;background:#f7fbfd;box-shadow:0 0 0 2px #f7fbfd}.todo-harness-timeline-group-copy{display:flex;align-items:baseline;gap:8px}.todo-harness-timeline-group-copy span{color:#8093a2;font-size:11px}
    .todo-harness-task-timeline{padding:1px 0}
    .todo-harness-row{grid-template-columns:minmax(0,1fr) auto;gap:9px;margin:1px 0 0;padding:8px 10px;border-color:#dfebf0;border-radius:6px;background:rgba(255,255,255,.52)}.todo-harness-row:hover{border-color:#c6dfe6;background:#fff}
    .todo-harness-today-row .todo-harness-row-title>strong{flex:0 1 auto}.todo-harness-row-title{gap:6px}.todo-harness-row-title>strong{font-size:13px;font-weight:600;line-height:18px}.todo-harness-task-check{width:16px;height:16px;margin:0 5px 0 1px;accent-color:#10a875}
    .todo-harness-row-tags{display:flex;align-items:center;gap:5px;margin-left:auto}.todo-harness-status,.todo-harness-priority{min-height:18px;padding:1px 8px;border-radius:10px;font-size:10px;line-height:15px}
    .todo-harness-urgency-tag{display:inline-flex;align-items:center;min-height:18px;padding:1px 8px;border-radius:10px;font-size:10px;line-height:15px;white-space:nowrap}.todo-harness-urgency-tag-soon{background:#fff0d6;color:#d89018}.todo-harness-urgency-tag-overdue{background:#ffe7e4;color:#eb6256}
    .todo-harness-status{background:#eef3f5;color:#6a7f90}.todo-harness-status-in_progress{background:#e0f4ed;color:#168263}.todo-harness-status-done{background:#e5f5ef;color:#23866d}.todo-harness-priority-urgent{background:#ffe7e4;color:#eb6256}.todo-harness-priority-high{background:#fff0d6;color:#d89018}
    .todo-harness-row-time-range{gap:7px 13px;margin-top:5px;color:#6e8497;font-size:10px}.todo-harness-row-time-range svg{color:#8ca2b0}.todo-harness-row-actions>button{width:28px;height:28px;min-width:28px}
    .todo-harness-row-more{position:relative;flex:none}.todo-harness-row-more>summary{display:grid;place-items:center;width:28px;height:28px;border-radius:4px;color:#687f92;list-style:none;cursor:pointer}.todo-harness-row-more>summary::-webkit-details-marker{display:none}.todo-harness-row-more>summary:hover{background:#eaf2f5;color:#1d3a53}
    .todo-harness-row-more>button{position:absolute;top:30px;right:0;z-index:5;display:flex;align-items:center;gap:7px;min-width:98px;height:32px;padding:0 9px;border:1px solid #dfe9ee;border-radius:5px;background:#fff;color:#b0524c;font:inherit;font-size:11px;box-shadow:0 5px 14px rgba(33,57,76,.1);cursor:pointer}
    .todo-harness-row-more>button:disabled{cursor:not-allowed;opacity:.55}.todo-harness-plan-group.is-selected .todo-harness-plan-group-header .todo-harness-group-dot{border-color:#1aa67b;background:#dff4ec}
    .todo-harness-row{grid-template-columns:minmax(0,1fr) auto;column-gap:7px}
    .todo-harness-row-copy{grid-column:1;min-width:0}
    .todo-harness-row-actions{grid-column:2;grid-row:1;display:flex;align-items:center;align-self:center;gap:7px;margin:0}
    .todo-harness-row-actions>button{width:26px;height:26px;min-width:26px}
    .todo-harness-row-more>summary{width:26px;height:26px}
    .todo-harness-plan-group{margin:0 0 13px}.todo-harness-plan-group-header{position:relative;top:auto;justify-content:flex-start;gap:7px;padding:8px 2px;border:0;background:transparent}.todo-harness-plan-day{gap:8px}.todo-harness-plan-day-copy{gap:0}.todo-harness-plan-day-copy strong{font-size:13px;line-height:18px}.todo-harness-plan-day-copy span{font-size:10px}.todo-harness-plan-group-summary{justify-content:flex-start;gap:5px 10px;font-size:10px;text-align:left}
    .todo-harness-plan-group .todo-harness-task-timeline{padding:1px 0}
    .todo-harness-plan-row{grid-template-columns:minmax(0,1fr) auto;align-items:start;column-gap:7px;margin:1px 0 0;padding:9px 8px}
    .todo-harness-plan-row .todo-harness-row-copy{grid-column:1;grid-row:1}
    .todo-harness-plan-row .todo-harness-row-actions{grid-column:2;grid-row:1}
    .todo-harness-plan-row .todo-harness-row-title>strong{font-size:12px}
    .todo-harness-plan-row .todo-harness-row-time-range{gap:4px 9px;margin-top:3px;font-size:10px}
    .todo-harness-plan-row.todo-harness-task-done{opacity:.72}
    .todo-harness-notice{padding:5px 0;color:#5c8c7f;font-size:11px}
    @media(max-width:1250px){
      .todo-harness-panel-title-today{grid-template-columns:1fr;gap:8px}.todo-harness-panel-title-today .todo-harness-panel-title-metrics{justify-content:flex-start}
      .todo-harness-panel-title-plan{grid-template-columns:110px minmax(0,1fr);gap:8px}.todo-harness-plan-week-days{grid-template-columns:repeat(7,minmax(28px,1fr))}
    }
    @media(max-width:767px){
      .todo-harness-panel{gap:0;padding:0 12px 12px;background:#f5f9fc}.todo-harness-topnav{margin:0 -12px}.todo-harness-topnav-tabs{gap:0;padding-left:6px}.todo-harness-topnav-tab{gap:5px;padding:0 7px;font-size:11px}.todo-harness-topnav-actions{gap:0;padding-right:5px}.todo-harness-topnav-action{width:29px!important;height:29px!important;min-width:29px!important}
      .todo-harness-panel-title{grid-template-columns:1fr;gap:8px;min-height:0;padding:12px 0}.todo-harness-panel-title-copy h1{font-size:19px}.todo-harness-panel-title-metrics{justify-content:flex-start;overflow:auto}.todo-harness-panel-title-metric{min-width:47px;padding:2px 8px}.todo-harness-panel-title-metric strong{font-size:15px}
      .todo-harness-panel-title-plan{grid-template-columns:1fr}.todo-harness-plan-week-strip{justify-content:space-between}.todo-harness-plan-week-days{grid-template-columns:repeat(7,minmax(0,1fr));flex:1}.todo-harness-plan-week-day{height:43px}.todo-harness-plan-week-day strong{font-size:10px}
      .todo-harness-timeline-group{margin-bottom:12px}.todo-harness-timeline-group-header{gap:5px;padding:7px 1px}.todo-harness-timeline-group-marker{min-width:50px;gap:5px}.todo-harness-timeline-group-marker time{font-size:10px}.todo-harness-timeline-group-header strong{font-size:12px}.todo-harness-timeline-group-header>span{font-size:9px}.todo-harness-timeline-group-copy span{display:none}
      .todo-harness-row{grid-template-columns:minmax(0,1fr) auto;margin:4px 0 6px;padding:9px 7px}.todo-harness-row-title{align-items:flex-start;gap:4px}.todo-harness-row-title>strong{flex:1 1 100px;font-size:12px}.todo-harness-row-tags{gap:3px}.todo-harness-status,.todo-harness-priority{min-height:16px;padding:1px 6px;font-size:9px}.todo-harness-row-time-range{gap:4px 8px;font-size:9px}.todo-harness-row-actions{gap:0}.todo-harness-row-actions>button{width:25px;height:25px;min-width:25px}
      .todo-harness-plan-group{margin-bottom:9px}.todo-harness-plan-group-header{padding:7px 1px}.todo-harness-plan-day{gap:6px}.todo-harness-plan-day-copy strong{font-size:12px}.todo-harness-plan-group-summary{gap:3px 6px;font-size:9px}.todo-harness-plan-group-summary>span{white-space:nowrap}
      .todo-harness-plan-row{grid-template-columns:minmax(0,1fr) auto;row-gap:4px}
      .todo-harness-plan-row .todo-harness-row-copy{grid-column:1;grid-row:1}
      .todo-harness-plan-row .todo-harness-row-actions{grid-column:2;grid-row:1}
    }
    @container (max-width:500px){
      .todo-harness-panel-title-plan{grid-template-columns:minmax(0,1fr);align-items:start}
      .todo-harness-plan-week-strip{justify-content:space-between;gap:2px}
      .todo-harness-plan-week-days{grid-template-columns:repeat(7,minmax(0,1fr));flex:1;gap:1px}
      .todo-harness-plan-week-day{width:100%;padding-right:0;padding-left:0}
      .todo-harness-topnav{gap:4px;padding-right:8px;padding-left:8px}
      .todo-harness-topnav-tabs{display:flex;flex:0 1 auto;width:max-content;max-width:calc(100% - 136px);min-width:0}
      .todo-harness-topnav-tabs>button[role="tab"]{min-width:0;padding:0 7px!important;font-size:11px;white-space:nowrap}
      .todo-harness-topnav-actions{gap:0;padding:0}
      .todo-harness-topnav-action{width:26px!important;height:28px!important;min-width:26px!important}
    }
    .todo-harness-panel{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}
    .todo-harness-topnav{box-sizing:border-box;align-items:center;min-height:52px;margin:0 -20px;padding:0 16px;border:0;border-bottom:1px solid var(--dsw-alias-border-l3);background:transparent}
    .todo-harness-topnav-tabs{box-sizing:border-box;display:flex;align-items:stretch;gap:12px;flex:0 1 auto;width:max-content;max-width:100%;min-width:0;padding:0 4px;background:transparent}
    .todo-harness-topnav-tab{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 1 auto;min-width:0;min-height:52px;padding:0 8px;border:0;border-radius:0;background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xs-13);font-weight:500;white-space:nowrap;cursor:pointer}
    .todo-harness-topnav-tab::after{position:absolute;right:8px;bottom:0;left:8px;height:2px;border-radius:var(--dsw-radius-xs);background:transparent;content:""}
    .todo-harness-topnav-tab:hover,.todo-harness-topnav-tab.is-active{color:var(--dsw-alias-label-primary)}
    .todo-harness-topnav-tab.is-active::after{background:var(--dsw-alias-state-business-primary)}
    .todo-harness-topnav-tab:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-3px}
    .todo-harness-topnav-tab{color:var(--dsw-alias-label-secondary)}
    .todo-harness-topnav-tab:hover{color:var(--dsw-alias-label-primary)}
    .todo-harness-topnav-tab.is-active{color:var(--dsw-alias-label-primary)}
    .todo-harness-topnav-tab.is-active::after{background:var(--dsw-alias-state-business-primary)}
    .todo-harness-topnav-action{color:var(--dsw-alias-label-secondary)!important}
    .todo-harness-topnav-action:hover:not(:disabled){color:var(--dsw-alias-label-primary)!important;background:var(--dsw-alias-interactive-bg-hover)!important}
    .todo-harness-search-field,.todo-harness-filter-menu{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-secondary)}
    .todo-harness-search-field input{color:var(--dsw-alias-label-primary)}
    .todo-harness-search-field input::placeholder{color:var(--dsw-alias-label-caption)}
    .todo-harness-filter-menu button{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
    .todo-harness-filter-menu button.is-selected{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 38%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-business-primary)}
    .todo-harness-filter-completed{color:var(--dsw-alias-label-secondary)}
    .todo-harness-panel-title-copy h1,.todo-harness-panel-title-metric strong{color:var(--dsw-alias-label-primary)}
    .todo-harness-panel-title-copy span,.todo-harness-panel-title-metric span{color:var(--dsw-alias-label-tertiary)}
    .todo-harness-panel-title-metric{border-color:var(--dsw-alias-border-l3)}
    .todo-harness-plan-week-day{color:var(--dsw-alias-label-secondary)}
    .todo-harness-plan-week-day:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
    .todo-harness-plan-week-day.is-selected{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-business-primary)}
    .todo-harness-plan-week-arrow{color:var(--dsw-alias-label-tertiary)!important}
    .todo-harness-timeline-group-header,.todo-harness-plan-group-header{color:var(--dsw-alias-label-tertiary)}
    .todo-harness-timeline-group-header strong,.todo-harness-plan-day-copy strong{color:var(--dsw-alias-label-primary)}
    .todo-harness-timeline-group-overdue .todo-harness-timeline-group-header strong{color:var(--dsw-alias-state-error-primary)}
    .todo-harness-timeline-group-marker{color:var(--dsw-alias-label-secondary)}
    .todo-harness-timeline-group-marker svg{flex:none;color:var(--dsw-alias-label-tertiary)}
    .todo-harness-timeline-group-copy span,.todo-harness-plan-day-copy span{color:var(--dsw-alias-label-tertiary)}
    .todo-harness-group-dot{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);box-shadow:0 0 0 2px var(--dsw-alias-bg-base)}
    .todo-harness-timeline-item{--todo-harness-priority-color:var(--dsw-alias-state-business-primary)}
    .todo-harness-task-priority-urgent{--todo-harness-priority-color:var(--dsw-alias-state-error-primary)}
    .todo-harness-task-priority-high{--todo-harness-priority-color:var(--dsw-alias-state-warn-label)}
    .todo-harness-task-priority-low{--todo-harness-priority-color:var(--dsw-alias-label-tertiary)}
    .todo-harness-timeline-item .todo-harness-dot{background:var(--todo-harness-priority-color)}
    .todo-harness-row{position:relative;border-color:var(--dsw-alias-border-l3);border-left:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));box-shadow:none}
    .todo-harness-row::before{content:none}
    .todo-harness-row:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base)}
    .todo-harness-row.todo-harness-urgency-overdue,.todo-harness-row.todo-harness-urgency-critical,.todo-harness-row.todo-harness-urgency-soon{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));box-shadow:none}
    .todo-harness-timeline-item>.todo-harness-row{border-left:2px solid var(--todo-harness-priority-color)}
    .todo-harness-row-time-range{color:var(--dsw-alias-label-secondary)}
    .todo-harness-row-time-range{gap:7px 12px}
    .todo-harness-row-time-range>span{display:inline-flex;align-items:center;gap:4px}
    .todo-harness-row-time-range svg{width:14px;height:14px;flex:none;color:var(--dsw-alias-label-tertiary)}
    .todo-harness-row .todo-harness-row-time-range{font-size:12px;line-height:17px}
    .todo-harness-notes{font-size:12px;line-height:17px}
    .todo-harness-tags span{font-size:10px;line-height:14px}
    .todo-harness-today-row .todo-harness-row-title>strong,.todo-harness-plan-row .todo-harness-row-title>strong{font-size:13px;line-height:19px}
    .todo-harness-task-check{margin-right:6px;accent-color:var(--dsw-alias-state-business-primary)}
    .todo-harness-status{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
    .todo-harness-status-in_progress{background:color-mix(in srgb,var(--dsw-alias-state-success-primary,var(--dsw-alias-state-business-primary)) 14%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-success-primary,var(--dsw-alias-state-business-primary))}
    .todo-harness-status-done{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
    .todo-harness-status-blocked,.todo-harness-priority-high,.todo-harness-urgency-tag-soon{background:color-mix(in srgb,var(--dsw-alias-state-warn-label) 14%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-warn-label)}
    .todo-harness-priority-urgent,.todo-harness-urgency-tag-overdue{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-error-primary)}
    .todo-harness-error{color:var(--dsw-alias-state-error-primary)}
    .todo-harness-row-copy{grid-column:1;grid-row:1;min-width:0}
    .todo-harness-today-row{grid-template-columns:minmax(0,1fr) auto;column-gap:8px}
    .todo-harness-today-row .todo-harness-row-actions{grid-column:2;grid-row:1;align-self:start;justify-self:end;gap:5px;margin:0}
    .todo-harness-plan-row .todo-harness-row-actions{align-self:start;justify-self:end;gap:5px;margin:0}
    .todo-harness-action-button,.todo-harness-row-more>summary{color:var(--dsw-alias-label-tertiary)!important}
    .todo-harness-action-button:hover:not(:disabled),.todo-harness-row-more>summary:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}
    .todo-harness-row-more>button{border-color:var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-state-error-primary);box-shadow:var(--dsw-elevation-panel)}
    .todo-harness-row{border-radius:var(--dsw-radius-sm)}
    .todo-harness-status,.todo-harness-priority,.todo-harness-urgency-tag{border-radius:var(--dsw-radius-xs)}
    .todo-harness-row-more>summary,.todo-harness-plan-week-day,.todo-harness-tags span{border-radius:var(--dsw-radius-sm)}
    .todo-harness-search-field,.todo-harness-filter-menu{border-radius:var(--dsw-radius-md)}
    .todo-harness-filter-menu button{border-radius:var(--dsw-radius-sm)}
    .todo-harness-plan-group-header{border-color:var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base)}
    .todo-harness-plan-group-summary,.todo-harness-effort{color:var(--dsw-alias-label-tertiary)}
    .todo-harness-plan-group.is-selected .todo-harness-plan-group-header .todo-harness-group-dot{border-color:var(--dsw-alias-bg-base);background:var(--dsw-alias-state-business-primary)}
    .todo-harness-token-usage-track span{background:var(--dsw-alias-state-success-primary,var(--dsw-alias-state-business-primary))}
    .todo-harness-plan-week-days{flex:1;grid-template-columns:repeat(7,minmax(0,1fr))}
    .todo-harness-panel-title-plan{grid-template-columns:minmax(0,1fr);gap:14px;min-height:0;padding:16px 0 14px}
    .todo-harness-plan-title-heading{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;min-width:0}
    .todo-harness-plan-title-heading h1{flex:none}
    .todo-harness-plan-title-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0;max-width:100%;margin-left:auto}
    .todo-harness-panel-title-plan .todo-harness-plan-week-strip{box-sizing:border-box;width:100%;min-width:0;max-width:100%}
    .todo-harness-panel-title-plan{flex:none}
    .todo-harness-plan-date-navigation{display:grid;grid-template-columns:minmax(164px,.8fr) minmax(260px,1.4fr);align-items:center;gap:16px;min-width:0;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-plan-shortcuts{display:flex;align-items:center;flex:none;min-width:0}
    .todo-harness-plan-day-shortcuts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:2px;min-width:0;padding:3px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover)}
    .todo-harness-plan-day-shortcuts button{box-sizing:border-box;min-width:0;min-height:28px;padding:3px 5px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
    .todo-harness-plan-day-shortcuts button:hover{color:var(--dsw-alias-label-primary)}
    .todo-harness-plan-day-shortcuts button[aria-pressed=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-state-business-primary);font-weight:600;box-shadow:0 1px 3px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
    .todo-harness-plan-shortcuts button:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
    .todo-harness-plan-date-navigation .todo-harness-plan-week-strip{gap:4px}
    .todo-harness-plan-date-navigation .todo-harness-plan-week-days{gap:4px}
    .todo-harness-plan-date-navigation .todo-harness-plan-week-days.is-long-range{display:flex;overflow-x:auto;scrollbar-width:thin;overscroll-behavior:contain}
    .todo-harness-plan-date-navigation .todo-harness-plan-week-days.is-long-range>button{flex:0 0 34px}
    .todo-harness-plan-date-navigation .todo-harness-plan-week-day{box-sizing:border-box;height:50px;gap:4px;padding:5px 0;border:1px solid transparent;border-radius:6px}
    .todo-harness-plan-date-navigation .todo-harness-plan-week-day strong{font-size:10px;font-weight:400;line-height:14px}
    .todo-harness-plan-date-navigation .todo-harness-plan-week-day span{font-size:13px;font-weight:550;line-height:18px;font-variant-numeric:tabular-nums}
    .todo-harness-plan-date-navigation .todo-harness-plan-week-day.is-selected{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 28%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 7%,var(--dsw-alias-bg-base))}
    .todo-harness-plan-date-navigation .todo-harness-plan-week-day.is-selected strong{font-weight:600}
    .todo-harness-plan-summary{min-width:0;margin:0;padding:0}
    .todo-harness-plan-summary-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;min-width:0;margin:0}
    .todo-harness-plan-summary-metrics>div{display:flex;flex-direction:column;gap:3px;min-width:0;padding-right:8px}
    .todo-harness-plan-summary-metrics>div+div{padding:0 0 0 10px;border-left:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-plan-summary-metrics dt{display:flex;align-items:center;gap:4px;color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px}
    .todo-harness-plan-summary-metrics dt svg{flex:none}
    .todo-harness-plan-summary-metrics dd{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px;min-width:0;margin:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}
    .todo-harness-plan-summary-metrics strong{color:var(--dsw-alias-label-primary);font-size:20px;font-weight:600;line-height:26px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .todo-harness-plan-summary-state{min-height:44px;margin:10px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px}
    @container(max-width:439px){
      .todo-harness-plan-date-navigation{grid-template-columns:minmax(0,1fr);gap:12px}
    }
    @container(max-width:340px){
      .todo-harness-plan-title-actions .todo-harness-plan-calendar-trigger{gap:4px;padding-right:6px!important;padding-left:6px!important}
      .todo-harness-plan-title-actions .todo-harness-plan-calendar-trigger>span:has(>svg){display:none}
      .todo-harness-plan-date-navigation .todo-harness-plan-week-strip{gap:0}
      .todo-harness-plan-date-navigation .todo-harness-plan-week-days{gap:1px}
    }
    .todo-harness-plan-calendar-trigger{display:inline-flex;align-items:center;justify-content:center;flex:0 1 auto;gap:7px;min-width:0!important;max-width:100%;min-height:34px;height:auto!important;padding:6px 9px!important;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-secondary)!important}
    .todo-harness-plan-calendar-trigger>svg{flex:none}
    .todo-harness-plan-calendar-trigger span{min-width:0;color:inherit;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
    .todo-harness-plan-calendar-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}
    .todo-harness-plan-calendar-trigger[aria-expanded=true]{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 8%,var(--dsw-alias-bg-base));color:var(--dsw-alias-state-business-primary)!important}
    .todo-harness-plan-calendar-trigger:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
    .todo-harness-plan-calendar-modal{box-sizing:border-box;width:min(1120px,100%);max-width:100%;max-height:min(900px,calc(100dvh - 48px));padding:0!important;overflow:hidden;border-radius:8px}
    .todo-harness-plan-calendar-modal>div{display:flex;flex:1;flex-direction:column;min-height:0;overflow:hidden}
    .todo-harness-plan-calendar-modal>div>div:has(>h2){flex:none;padding:20px 20px 16px 24px}
    .todo-harness-plan-calendar-modal>div>div:has(>.todo-harness-plan-calendar){display:flex;flex:1;min-height:0;margin:0;padding:0;overflow:hidden}
    .todo-harness-plan-calendar{display:flex;flex:1;flex-direction:column;gap:0;min-width:0;min-height:0;color:var(--dsw-alias-label-primary)}
    .todo-harness-calendar-range-controls{display:flex;flex:none;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:0 24px 16px;border-bottom:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-calendar-range-presets{display:flex;gap:2px;padding:3px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover)}
    .todo-harness-calendar-range-presets button{min-height:28px;padding:3px 12px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
    .todo-harness-calendar-range-presets button[aria-pressed=true]{background:var(--dsw-alias-bg-base);color:var(--dsw-alias-state-business-primary);font-weight:600;box-shadow:0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}
    .todo-harness-calendar-range-inputs{display:flex;flex-wrap:wrap;gap:8px;min-width:0}
    .todo-harness-calendar-range-inputs label{display:flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px}
    .todo-harness-calendar-range-inputs label.is-active{color:var(--dsw-alias-state-business-primary)}
    .todo-harness-calendar-range-inputs label.is-active input{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 50%,var(--dsw-alias-border-l3))}
    .todo-harness-calendar-range-inputs input{box-sizing:border-box;min-width:0;max-width:100%;width:142px;height:32px;padding:3px 6px;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px}
    .todo-harness-calendar-toolbar{display:grid;flex:none;grid-template-columns:28px minmax(76px,auto) minmax(64px,auto) 28px;align-items:center;justify-content:center;gap:8px;min-width:0;padding:12px 24px}
    .todo-harness-calendar-toolbar>button{width:28px!important;height:30px!important;min-width:28px!important;padding:0!important}
    .todo-harness-calendar-year{display:flex;align-items:center;justify-content:center;gap:3px;min-width:0;font-size:12px}
    .todo-harness-calendar-year input{box-sizing:border-box;width:64px;min-width:0;height:30px;padding:0 4px;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;background:var(--dsw-alias-bg-base);color:inherit;font:inherit;text-align:center;font-variant-numeric:tabular-nums;appearance:textfield}
    .todo-harness-calendar-year input::-webkit-inner-spin-button,.todo-harness-calendar-year input::-webkit-outer-spin-button{appearance:none;margin:0}
    .todo-harness-calendar-toolbar select{box-sizing:border-box;min-width:0;height:30px;padding:0 4px;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;background:var(--dsw-alias-bg-base);color:inherit;font:inherit;font-size:12px}
    .todo-harness-calendar-layout{display:grid;grid-template-columns:minmax(0,1fr) 260px;align-items:stretch;gap:20px;min-width:0;min-height:0;padding:0 24px 16px;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
    .todo-harness-calendar-grid{display:grid;grid-template-rows:24px repeat(6,88px);gap:2px;min-width:0}
    .todo-harness-calendar-weekdays,.todo-harness-calendar-week{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px;min-width:0}
    .todo-harness-calendar-weekdays>span{display:grid;place-items:center;color:var(--dsw-alias-label-tertiary);font-size:11px}
    .todo-harness-calendar-cell{box-sizing:border-box;display:flex;min-width:0;min-height:0;border:1px solid var(--dsw-alias-border-l3);border-radius:4px;overflow:hidden}
    .todo-harness-calendar-day{display:flex;flex-direction:column;align-items:stretch;gap:3px;box-sizing:border-box;width:100%;height:100%;min-width:0;padding:4px;border:0;border-radius:3px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;font-variant-numeric:tabular-nums;text-align:left;overflow:hidden;cursor:pointer}
    .todo-harness-calendar-day-heading{display:flex;align-items:center;justify-content:space-between;flex:none;min-width:0;height:24px;padding:0 4px}
    .todo-harness-calendar-day:hover{background:var(--dsw-alias-interactive-bg-hover)}
    .todo-harness-calendar-cell.is-outside .todo-harness-calendar-day{color:var(--dsw-alias-label-caption)}
    .todo-harness-calendar-cell.is-in-range{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,var(--dsw-alias-bg-base))}
    .todo-harness-calendar-day-number{display:grid;place-items:center;flex:none;width:24px;height:24px;border-radius:4px}
    .todo-harness-calendar-day[aria-current=date]{color:var(--dsw-alias-state-business-primary);font-weight:600}
    .todo-harness-calendar-cell.is-selected{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,var(--dsw-alias-border-l3));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-business-primary) 35%,transparent);border-radius:4px}
    .todo-harness-calendar-cell.is-selected .todo-harness-calendar-day-number{background:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-oncolor,white);font-weight:600}
    .todo-harness-calendar-day-count{--todo-harness-priority-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:400}
    .todo-harness-calendar-tasks{display:flex;flex-direction:column;gap:2px;min-width:0}
    .todo-harness-calendar-task{--todo-harness-priority-color:var(--dsw-alias-state-business-primary);display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--todo-harness-priority-color);font-size:11px;line-height:16px}
    .todo-harness-calendar-task.todo-harness-task-priority-urgent,.todo-harness-calendar-day-count.todo-harness-task-priority-urgent{--todo-harness-priority-color:var(--dsw-alias-state-error-primary)}
    .todo-harness-calendar-task.todo-harness-task-priority-high,.todo-harness-calendar-day-count.todo-harness-task-priority-high{--todo-harness-priority-color:var(--dsw-alias-state-warn-label)}
    .todo-harness-calendar-task.todo-harness-task-priority-low,.todo-harness-calendar-day-count.todo-harness-task-priority-low{--todo-harness-priority-color:var(--dsw-alias-label-tertiary)}
    .todo-harness-calendar-task.is-done{text-decoration:line-through;opacity:.6}
    .todo-harness-calendar-more{align-self:flex-start;min-width:0;max-width:100%;height:18px;flex:none;padding:0 3px;color:var(--dsw-alias-label-secondary);font-size:10px;white-space:nowrap}
    .todo-harness-calendar-agenda{align-self:stretch;box-sizing:border-box;padding:3px 0 0 16px;border-left:1px solid var(--dsw-alias-border-l3);min-width:0;max-height:564px;overflow:auto;scrollbar-width:thin}
    .todo-harness-calendar-agenda-heading{position:sticky;top:0;z-index:1;display:flex;flex-direction:column;gap:3px;margin-bottom:6px;padding-bottom:8px;background:var(--dsw-alias-bg-base)}
    .todo-harness-calendar-agenda h3{margin:0;font-size:13px;line-height:20px;font-weight:600}
    .todo-harness-calendar-agenda-heading>span{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
    .todo-harness-calendar-agenda ul{margin:0;padding:0;list-style:none}
    .todo-harness-calendar-agenda li{display:grid;grid-template-columns:42px minmax(0,1fr);gap:8px;padding:9px 0;min-width:0;border-bottom:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-calendar-agenda-time,.todo-harness-calendar-agenda-copy{display:flex;flex-direction:column;gap:4px;min-width:0}
    .todo-harness-calendar-agenda-time{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:16px;font-variant-numeric:tabular-nums}
    .todo-harness-calendar-agenda .todo-harness-calendar-task{white-space:normal;overflow-wrap:anywhere;flex:1}
    .todo-harness-calendar-task-meta{flex:none;color:var(--dsw-alias-label-tertiary);font-size:10px}
    .todo-harness-calendar-agenda p{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px}
    .todo-harness-calendar-day:disabled{cursor:default;opacity:.35}
    .todo-harness-calendar-day:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
    .todo-harness-calendar-year input:focus-visible,.todo-harness-calendar-toolbar select:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
    .todo-harness-calendar-footer{display:flex;flex:none;align-items:center;justify-content:space-between;gap:8px;padding:14px 24px;border-top:1px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-base)}
    .todo-harness-calendar-footer>span{min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .todo-harness-calendar-footer>div{display:flex;align-items:center;gap:6px}
    .todo-harness-calendar-footer>div>button{min-height:32px;padding:6px 12px;font-size:12px}
    .todo-harness-calendar-footer>div>button:last-child{background:var(--dsw-alias-state-business-primary);color:white}
    .todo-harness-calendar-footer>div>button:last-child:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 88%,black)}
    .todo-harness-calendar-footer>div>button:last-child:disabled{opacity:.4}
    .todo-harness-calendar-footer time{color:var(--dsw-alias-label-tertiary);font-size:12px;font-variant-numeric:tabular-nums}
    @media(max-width:850px){
      .todo-harness-calendar-layout{grid-template-columns:minmax(0,1fr);gap:14px;min-height:0}
      .todo-harness-calendar-agenda{height:auto;max-height:180px;padding:12px 0 0;border-left:0;border-top:1px solid var(--dsw-alias-border-l3)}
    }
    @media(max-width:600px){
      [role=presentation]:has(>.todo-harness-plan-calendar-modal){padding:8px}
      .todo-harness-plan-calendar-modal{width:100%;max-height:calc(100dvh - 16px)}
      .todo-harness-plan-calendar-modal>div>div:has(>h2){padding:14px 12px}
      .todo-harness-calendar-range-controls{gap:10px;padding:0 12px 12px}
      .todo-harness-calendar-range-presets{box-sizing:border-box;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));width:100%}
      .todo-harness-calendar-toolbar{padding:10px 12px}
      .todo-harness-calendar-layout{padding:0 12px 12px;scrollbar-gutter:auto}
      .todo-harness-calendar-grid{grid-template-rows:22px repeat(6,64px)}
      .todo-harness-calendar-day{padding:4px 2px;font-size:11px}
      .todo-harness-calendar-day-heading{display:contents}
      .todo-harness-calendar-day-number{align-self:flex-start}
      .todo-harness-calendar-day-count{align-self:center;color:var(--todo-harness-priority-color);font-size:14px;line-height:20px;font-weight:600}
      .todo-harness-calendar-tasks,.todo-harness-calendar-more,.todo-harness-calendar-count-unit,.todo-harness-calendar-agenda{display:none}
      .todo-harness-calendar-range-inputs{width:100%;display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
      .todo-harness-calendar-range-inputs label{flex-direction:column;align-items:flex-start;gap:3px}
      .todo-harness-calendar-range-inputs input{width:100%}
      .todo-harness-calendar-footer{flex-wrap:wrap;row-gap:8px;padding:10px 12px}
      .todo-harness-calendar-footer>span{flex-basis:100%;font-size:11px}
      .todo-harness-calendar-footer>div{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));width:100%}
    }
    .todo-harness-plan-date-empty{margin:4px 0 16px;padding:12px 0 12px calc(var(--todo-harness-timeline-rail) + var(--todo-harness-timeline-gap));color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
    .todo-harness-today-row{margin:5px 0 7px}
    .todo-harness-plan-row{margin-top:6px;padding:10px 11px}
    .todo-harness-plan-row .todo-harness-row-actions{align-self:start;gap:5px}
    .todo-harness-notice{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-state-business-primary))}
    .todo-harness-row-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;min-width:0}
    .todo-harness-row-head .todo-harness-row-title{flex:1;min-width:0}
    .todo-harness-row-head .todo-harness-row-title>strong{flex:0 1 auto}
    .todo-harness-row-head>.todo-harness-status{flex:none;margin-top:1px;font-size:11px;line-height:16px}
    .todo-harness-today-row>.todo-harness-row-copy,.todo-harness-plan-row>.todo-harness-row-copy{grid-column:1/-1;grid-row:1;min-width:0}
    .todo-harness-group-dot{box-sizing:border-box;width:10px;height:10px;box-shadow:none}
    .todo-harness-task-group>.todo-harness-group-header{display:grid;grid-template-columns:var(--todo-harness-timeline-rail) minmax(0,1fr);align-items:center;column-gap:var(--todo-harness-timeline-gap);padding-inline:0}
    .todo-harness-group-header>.todo-harness-group-dot{grid-column:1;grid-row:1;justify-self:center;position:static;width:var(--todo-harness-timeline-dot-size);height:var(--todo-harness-timeline-dot-size);margin:0;border-width:2px;transform:none}
    .todo-harness-group-header>.todo-harness-group-heading{grid-column:2;grid-row:1;display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;min-width:0}
    .todo-harness-group-heading>.todo-harness-timeline-group-marker{flex:0 1 auto;min-width:0}
    .todo-harness-group-heading>.todo-harness-timeline-group-marker time{overflow-wrap:anywhere}
    .todo-harness-group-heading>span{flex:none;font-size:10px;font-variant-numeric:tabular-nums}
    .todo-harness-row-time-range{margin-top:9px}
    .todo-harness-row-time-range svg{transform:translateY(1px)}
    .todo-harness-row .todo-harness-notes{margin-top:8px}
    .todo-harness-row-footer{display:flex;align-items:center;gap:8px;min-width:0;margin-top:10px}
    .todo-harness-row-footer .todo-harness-tags{flex:1;min-width:0;margin-top:0;margin-left:0}
    .todo-harness-row-footer .todo-harness-tags span{font-size:10px;line-height:14px}
    .todo-harness-row-footer .todo-harness-tag-overflow{display:none}
    .todo-harness-row-footer .todo-harness-row-actions{align-items:center;align-self:center;justify-content:flex-end;flex:none;gap:4px;margin:0 0 0 auto}
    .todo-harness-row-actions>.todo-harness-action-text-button{width:auto!important;height:28px;min-width:0!important;min-height:28px;padding:0 5px!important;border-radius:var(--dsw-radius-sm);font-size:11px;font-weight:500;white-space:nowrap}
    .todo-harness-row-actions .todo-harness-row-more>summary{display:inline-flex;align-items:center;justify-content:center;width:auto;height:28px;min-width:0;padding:0 5px;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap}
    .todo-harness-row-actions .todo-harness-row-more>summary:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
    .todo-harness-today-row{margin:8px 0 10px}
    .todo-harness-plan-row{margin:8px 0 10px;padding:12px 11px}
    #todo-harness-todo-view-today-panel{padding-right:12px}
    @media(max-width:767px){
      .todo-harness-row-footer{align-items:center;gap:5px}
      .todo-harness-row-footer .todo-harness-tags{flex-wrap:nowrap;gap:3px;overflow:hidden}
      .todo-harness-row-footer .todo-harness-tags>span{flex:none}
      .todo-harness-row-footer .todo-harness-tag-extra{display:none}
      .todo-harness-row-footer .todo-harness-tag-overflow{display:inline-flex}
      .todo-harness-row-footer .todo-harness-row-actions{gap:3px}
      .todo-harness-row-actions>.todo-harness-action-text-button,.todo-harness-row-actions .todo-harness-row-more>summary{padding-right:3px;padding-left:3px;font-size:11px}
    }
    @media(max-width:360px){.todo-harness-row-footer .todo-harness-tag-overflow{display:none}.todo-harness-row-footer .todo-harness-row-actions{gap:2px}.todo-harness-row-actions>.todo-harness-action-text-button,.todo-harness-row-actions .todo-harness-row-more>summary{padding-right:2px;padding-left:2px}}
    @container (max-width:500px){.todo-harness-topnav-tabs{max-width:calc(100% - 136px);gap:6px}.todo-harness-topnav-tab{padding:0 4px;font-size:11px}}
    .todo-harness-schedule-manager{container-type:inline-size;box-sizing:border-box;width:100%;height:100%;min-width:0;min-height:0;color:var(--dsw-alias-label-primary)}
    .todo-harness-schedule-layout{display:grid;grid-template-columns:minmax(0,1fr);width:100%;height:100%;min-width:0;min-height:0}
    .todo-harness-schedule-list-pane{display:flex;flex-direction:column;gap:10px;min-width:0;min-height:0}
    .todo-harness-schedule-search{box-sizing:border-box;display:flex;align-items:center;gap:8px;flex:none;width:100%;height:36px;padding:0 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-tertiary)}
    .todo-harness-schedule-search:focus-within{border-color:var(--dsw-alias-state-business-primary)}
    .todo-harness-schedule-search input{box-sizing:border-box;flex:1;min-width:0;height:100%;padding:0;border:0;outline:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
    .todo-harness-schedule-search input::placeholder{color:var(--dsw-alias-label-caption)}
    .todo-harness-schedule-search input::-webkit-search-cancel-button{display:none}
    .todo-harness-schedule-clear{display:grid;place-items:center;flex:none;width:24px;height:24px;border:0;border-radius:var(--dsw-radius-sm,4px);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:18px;cursor:pointer}
    .todo-harness-schedule-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
    .todo-harness-schedule-filters{display:flex;align-items:center;gap:4px;flex:none;min-width:0;overflow-x:auto;padding:0 0 2px;border-bottom:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-schedule-filters button{flex:none;min-height:30px;padding:0 10px;border:0;border-radius:var(--dsw-radius-sm,4px);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
    .todo-harness-schedule-filters button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
    .todo-harness-schedule-filters button.is-selected{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
    .todo-harness-schedule-list{flex:1;min-height:0;overflow:auto;padding:0 2px 12px 0;overscroll-behavior:contain;scrollbar-gutter:stable}
    .todo-harness-schedule-rows{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
    .todo-harness-schedule-rows li{min-width:0}
    .todo-harness-schedule-entry{box-sizing:border-box;display:flex;align-items:flex-start;gap:10px;width:100%;min-width:0;padding:9px 8px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
    .todo-harness-schedule-entry:hover,.todo-harness-schedule-entry.is-selected{background:var(--dsw-alias-interactive-bg-hover)}
    .todo-harness-schedule-entry-icon{flex:none;margin-top:3px;color:var(--dsw-alias-label-tertiary)}
    .todo-harness-schedule-entry-copy{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0}
    .todo-harness-schedule-entry-title{overflow:hidden;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:21px;text-overflow:ellipsis;white-space:nowrap}
    .todo-harness-schedule-entry-summary{display:flex;flex-wrap:wrap;gap:0 4px;min-width:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:19px;overflow-wrap:anywhere}
    .todo-harness-schedule-entry-summary>span+span:before{content:'·';padding-right:4px;color:var(--dsw-alias-label-caption)}
    .todo-harness-schedule-entry-status{color:var(--dsw-alias-label-secondary)}
    .todo-harness-schedule-entry.is-inactive .todo-harness-schedule-entry-title{color:var(--dsw-alias-label-secondary)}
    .todo-harness-schedule-feedback,.todo-harness-schedule-history-error{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:10px 8px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
    .todo-harness-schedule-feedback p,.todo-harness-schedule-history-error p{flex:1;min-width:0;margin:0;overflow-wrap:anywhere}
    .todo-harness-schedule-feedback.todo-harness-error,.todo-harness-schedule-history-error{color:var(--dsw-alias-state-error-primary)}
    .todo-harness-schedule-refreshing{padding:2px 8px;color:var(--dsw-alias-label-caption);font-size:11px;line-height:16px}
    .todo-harness-schedule-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:34px 14px;color:var(--dsw-alias-label-tertiary);font-size:13px;text-align:center}
    .todo-harness-schedule-empty p{margin:0}
    .todo-harness-schedule-empty>svg{color:var(--dsw-alias-label-caption)}
    .todo-harness-schedule-empty button{padding:3px 6px;border:0;border-radius:var(--dsw-radius-sm,4px);background:transparent;color:var(--dsw-alias-state-business-primary);font:inherit;cursor:pointer}
    .todo-harness-schedule-detail{display:flex;flex-direction:column;min-width:0;min-height:0;border-left:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-schedule-detail-header{display:flex;align-items:center;justify-content:space-between;gap:8px;flex:none;min-width:0;padding:4px 0 10px;border-bottom:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-schedule-back{display:inline-flex;align-items:center;gap:3px;flex:none;min-height:28px;padding:0 5px;border:0;border-radius:var(--dsw-radius-sm,4px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
    .todo-harness-schedule-back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
    .todo-harness-schedule-detail-actions{display:flex;align-items:center;justify-content:flex-end;gap:3px;min-width:0}
    .todo-harness-schedule-detail-actions>button{display:inline-flex;align-items:center;gap:5px;min-width:0;padding:0 6px;font-size:12px;white-space:nowrap}
    .todo-harness-schedule-detail-heading{flex:none;min-width:0;padding:15px 2px 12px}
    .todo-harness-schedule-status{display:inline-flex;align-items:center;min-height:20px;margin-bottom:5px;padding:0 7px;border-radius:var(--dsw-radius-sm,4px);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px}
    .todo-harness-schedule-status.is-active{color:var(--dsw-alias-state-business-primary)}
    .todo-harness-schedule-detail-heading h2{margin:0;color:var(--dsw-alias-label-primary);font-size:19px;font-weight:550;line-height:26px;overflow-wrap:anywhere}
    .todo-harness-schedule-detail-heading p{display:flex;align-items:center;gap:6px;margin:7px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .todo-harness-schedule-detail-heading p svg{flex:none}
    .todo-harness-schedule-detail-tabs{display:flex;align-items:flex-end;gap:18px;flex:none;min-width:0;overflow-x:auto;padding:0 2px;border-bottom:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-schedule-detail-tabs button{position:relative;flex:none;min-height:34px;padding:0 1px 8px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
    .todo-harness-schedule-detail-tabs button[aria-selected="true"]{color:var(--dsw-alias-state-business-primary);font-weight:600}
    .todo-harness-schedule-detail-tabs button[aria-selected="true"]:after{position:absolute;right:0;bottom:-1px;left:0;height:2px;border-radius:2px;background:var(--dsw-alias-state-business-primary);content:''}
    .todo-harness-schedule-detail-scroll{flex:1;min-height:0;overflow:auto;padding:12px 3px 20px;overscroll-behavior:contain;scrollbar-gutter:stable}
    .todo-harness-schedule-rule-section{margin:0 0 17px}
    .todo-harness-schedule-rule-section h3{margin:0 0 7px 2px;color:var(--dsw-alias-label-tertiary);font-size:12px;font-weight:500;line-height:18px}
    .todo-harness-schedule-rule-rows{display:flex;flex-direction:column;padding:0 10px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base))}
    .todo-harness-schedule-rule-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-width:0;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l3);font-size:13px;line-height:19px}
    .todo-harness-schedule-rule-row:last-child{border-bottom:0}
    .todo-harness-schedule-rule-row>span{flex:none;color:var(--dsw-alias-label-tertiary)}
    .todo-harness-schedule-rule-row>strong{min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:450;text-align:right;overflow-wrap:anywhere}
    .todo-harness-schedule-prompt{margin:0;padding:10px 11px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);font-size:13px;line-height:21px;white-space:pre-wrap;overflow-wrap:anywhere}
    .todo-harness-schedule-detail .todo-harness-schedule-prompt{display:block}
    .todo-harness-schedule-linked-session{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:9px;width:100%;min-width:0;padding:10px;border:1px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;text-align:left;cursor:pointer}
    .todo-harness-schedule-linked-session:hover{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover)}
    .todo-harness-schedule-linked-session code,.todo-harness-schedule-id code{min-width:0;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:11px;overflow-wrap:anywhere}
    .todo-harness-schedule-open-session{color:var(--dsw-alias-state-business-primary);white-space:nowrap}
    .todo-harness-schedule-id{margin:10px 2px 0;color:var(--dsw-alias-label-caption);font-size:11px;line-height:17px;overflow-wrap:anywhere}
    .todo-harness-schedule-history{display:flex;flex-direction:column;align-items:stretch;gap:8px;min-width:0}
    .todo-harness-schedule-delivery{display:flex;align-items:flex-start;gap:9px;min-width:0;padding:8px 2px;border-bottom:1px solid var(--dsw-alias-border-l3)}
    .todo-harness-schedule-delivery>svg{flex:none;margin-top:3px;color:var(--dsw-alias-label-tertiary)}
    .todo-harness-schedule-delivery-copy{flex:1;min-width:0}
    .todo-harness-schedule-delivery-copy>time{display:block;color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
    .todo-harness-schedule-delivery-prompt{margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:19px}
    .todo-harness-schedule-delivery-prompt summary,.todo-harness-schedule-retention summary{color:var(--dsw-alias-label-secondary);cursor:pointer}
    .todo-harness-schedule-delivery-prompt p,.todo-harness-schedule-retention p{margin:5px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
    .todo-harness-schedule-retention{padding:5px 2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px}
    .todo-harness-task-relations{display:flex;flex-direction:column;gap:3px;min-width:0;margin-top:7px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:17px;overflow-wrap:anywhere}
    .todo-harness-editor-relations{min-width:0;color:var(--dsw-alias-label-secondary);font-size:12px}
    .todo-harness-editor-relations>summary{padding:5px 0;cursor:pointer}
    .todo-harness-editor-relations>.todo-harness-editor-field{margin-top:8px}
    .todo-harness-dependencies{display:flex;flex-direction:column;gap:7px;max-height:180px;min-width:0;margin:12px 0 0;padding:0;overflow:auto;border:0}
    .todo-harness-dependencies legend{margin-bottom:8px;padding:0}
    .todo-harness-dependencies label{display:flex;align-items:flex-start;gap:7px;min-width:0;font-size:12px;line-height:18px;overflow-wrap:anywhere}
    .todo-harness-dependencies input[type="checkbox"]{flex:none;width:14px;height:14px;margin:2px 0 0;padding:0}
    @container (min-width:760px){.todo-harness-schedule-manager.has-detail .todo-harness-schedule-layout{grid-template-columns:minmax(0,.78fr) minmax(0,1.22fr);gap:0}.todo-harness-schedule-detail{padding-left:16px}.todo-harness-schedule-back{display:none}}
    @container (max-width:759px){.todo-harness-schedule-manager.has-detail .todo-harness-schedule-list-pane{display:none}.todo-harness-schedule-detail{border-left:0}.todo-harness-schedule-manager.has-detail .todo-harness-schedule-layout{grid-template-columns:minmax(0,1fr)}}
    @container (max-width:390px){.todo-harness-schedule-detail-header{align-items:flex-start}.todo-harness-schedule-detail-actions{gap:0}.todo-harness-schedule-detail-actions>button{padding:0 4px}.todo-harness-schedule-detail-heading{padding-top:11px}.todo-harness-schedule-detail-tabs{gap:13px}.todo-harness-schedule-rule-rows{padding-right:8px;padding-left:8px}.todo-harness-schedule-linked-session{grid-template-columns:auto minmax(0,1fr);gap:5px 8px}.todo-harness-schedule-open-session{grid-column:2}}
    [data-chat-running] span[aria-hidden="true"]:has(> svg){box-sizing:border-box;display:inline-grid!important;place-items:center;width:calc(14px + var(--dsh-content-font-delta,0px));height:calc(14px + var(--dsh-content-font-delta,0px))}
    [data-chat-running] span[aria-hidden="true"]:has(> svg)>*{display:none!important}
    [data-chat-running] span[aria-hidden="true"]:has(> svg)::before{box-sizing:border-box;display:block;width:12px;height:12px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;content:"";animation:todo-harness-thinking-spin .8s linear infinite}
    @keyframes todo-harness-thinking-spin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){[data-chat-running] span[aria-hidden="true"]:has(> svg)::before{animation:none;border-right-color:currentColor;opacity:.7}}
  `;
  document.head.append(style);
  return () => style.remove();
}

    return { inject, apply };
  }
});
