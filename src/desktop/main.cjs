const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const { mkdir } = require('node:fs/promises');
const { join } = require('node:path');

const STARTUP_TIMEOUT_MS = 120_000;
const APP_ID = 'com.todo-harness.desktop';

let serverProcess;
let mainWindow;
let appUrl;
let quitting = false;
let startupFailed = false;
let startupTimer;
let outputBuffer = '';
const startupErrors = [];

app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(startHarness).catch((error) => failStartup(error));

  app.on('activate', () => {
    if (!mainWindow && appUrl) openWindow(appUrl);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
    clearTimeout(startupTimer);
    if (serverProcess && serverProcess.exitCode === null) serverProcess.kill('SIGTERM');
  });
}

async function startHarness() {
  const appRoot = app.getAppPath();
  const workspaceRoot = process.env.TODO_HARNESS_WORKSPACE_DIR ?? join(app.getPath('documents'), 'Todo Harness');
  await mkdir(workspaceRoot, { recursive: true });
  const childEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    TODO_HARNESS_NO_OPEN: '1',
    TODO_HARNESS_WORKSPACE_DIR: workspaceRoot
  };

  serverProcess = spawn(process.execPath, [join(appRoot, 'src', 'cli.js'), '--no-open'], {
    cwd: workspaceRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  serverProcess.stdout.setEncoding('utf8');
  serverProcess.stderr.setEncoding('utf8');
  serverProcess.stdout.on('data', readOutput);
  serverProcess.stderr.on('data', (chunk) => rememberError(chunk));
  serverProcess.once('error', failStartup);
  serverProcess.once('exit', (code, signal) => {
    if (quitting) return;
    const reason = code === null ? `The local service stopped (${signal ?? 'unknown signal'}).` : `The local service stopped with exit code ${code}.`;
    if (!appUrl) failStartup(new Error(reason));
    else {
      dialog.showErrorBox('Todo Harness stopped', `${reason}\n\n${errorDetails()}`);
      app.quit();
    }
  });

  startupTimer = setTimeout(() => failStartup(new Error('Timed out while starting the local Harness service.')), STARTUP_TIMEOUT_MS);
  startupTimer.unref();
}

function readOutput(chunk) {
  outputBuffer += chunk;
  const lines = outputBuffer.split(/\r?\n/u);
  outputBuffer = lines.pop() ?? '';
  for (const line of lines) {
    const match = line.match(/^dsh web: (https?:\/\/\S+)/u);
    if (!match || appUrl) continue;

    try {
      const url = new URL(match[1]);
      if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('The local service returned an unexpected address.');
      appUrl = url.href;
      clearTimeout(startupTimer);
      openWindow(appUrl);
    } catch (error) {
      failStartup(error);
    }
  }
}

function openWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    show: false,
    title: 'Todo Harness',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isLocalHarnessUrl(target)) return { action: 'allow' };
    shell.openExternal(target).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (isLocalHarnessUrl(target)) return;
    event.preventDefault();
    shell.openExternal(target).catch(() => {});
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = undefined; });
  mainWindow.loadURL(url).catch((error) => failStartup(error));
}

function isLocalHarnessUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function rememberError(chunk) {
  const text = scrubSecrets(chunk).trim();
  if (!text) return;
  startupErrors.push(text);
  if (startupErrors.length > 12) startupErrors.shift();
}

function errorDetails() {
  return startupErrors.join('\n').slice(-4000) || 'No additional startup details were reported.';
}

function scrubSecrets(value) {
  return value.replace(/([?&](?:token|key|password)=)[^&\s]+/giu, '$1[redacted]');
}

function failStartup(error) {
  if (startupFailed || quitting) return;
  startupFailed = true;
  clearTimeout(startupTimer);
  dialog.showErrorBox('Could not start Todo Harness', `${error.message}\n\n${errorDetails()}`);
  app.quit();
}
