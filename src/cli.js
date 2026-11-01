import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { lstat, mkdir, readFile, realpath, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTodoServer } from './http/server.js';
import { TodoRepository } from './storage/todo-repository.js';
import { UsageRepository } from './storage/usage-repository.js';
import { SettingsRepository } from './storage/settings-repository.js';

const DEFAULT_PORT = 3210;
const VOICE_INPUT_BUNDLE = '@deepseek-ai/dsh-experimental-voice-input-bundle';
const WEB_PROFILE_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
const require = createRequire(import.meta.url);

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: npm start [-- --port <port>] [--no-open]\n');
    return;
  }

  const dataRoot = resolve(process.env.TODO_HARNESS_DATA_DIR ?? join(homedir(), '.todo-harness'));
  const dataFile = resolve(process.env.TODO_HARNESS_DATA ?? join(dataRoot, 'todos.json'));
  const usageFile = resolve(process.env.TODO_HARNESS_USAGE ?? join(dataRoot, 'usage.json'));
  const settingsFile = resolve(process.env.TODO_HARNESS_SETTINGS ?? join(dataRoot, 'settings.json'));
  const dshHome = resolve(process.env.DSH_HOME ?? join(dataRoot, 'dsh'));
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const workspaceRoot = resolve(process.env.TODO_HARNESS_WORKSPACE_DIR ?? packageRoot);
  process.env.DSH_HOME = dshHome;
  process.stdout.write(`Todo Harness data directory: ${dataRoot}\nHarness data directory: ${dshHome}\n`);
  await Promise.all([mkdir(dirname(dataFile), { recursive: true }), mkdir(dshHome, { recursive: true }), mkdir(workspaceRoot, { recursive: true })]);
  await linkWorkspacePackage(dshHome, packageRoot);
  await ensureVoiceInputBundle(dshHome);

  const webPort = await findPortPair(options.port);
  const apiPort = webPort + 1;
  const repository = await new TodoRepository(dataFile).init();
  const usageRepository = await new UsageRepository(usageFile).init();
  const settingsRepository = await new SettingsRepository(settingsFile).init();
  const api = createTodoServer({ repository, usageRepository, settingsRepository, allowedOrigin: `http://127.0.0.1:${webPort}`, port: apiPort });
  await api.listen();

  const patchFile = join(dshHome, 'todo-harness.patch.json');
  const profilePatch = [{
    insert: [
      { id: 'time-context', name: '@deepseek-ai/dsh-time-context', config: { timeZone: 'Asia/Shanghai' } },
      { id: 'schedule', name: '@deepseek-ai/dsh-schedule' },
      { id: 'todo-harness', name: 'todo-harness', config: { dataFile, usageFile, workspaceRoot } },
      { id: 'todo-harness-web-search', name: 'todo-harness/web-search' },
      { id: 'ui-plugin-manager', name: '@deepseek-ai/dsh-client-ui-plugin-manager' }
    ]
  },
  { id: 'agent-preset-registry', config: { default: 'standard' } },
  // The Web Models bundle's versioned notice is product-owned copy. Keep the
  // current version acknowledged so a new Todo Harness profile opens directly
  // in the configured workspace instead of showing that preview dialog.
  { id: 'ui-settings-general', config: { welcomeNoticeVersion: '2026-09-28.1' } },
  { id: 'llm-deepseek', disabled: true },
  { id: 'llm-deepseek-account', disabled: true },
  { id: 'web-search-deepseek', disabled: true },
  { id: 'web', config: { searchProvider: 'todo-harness-auto', fetchProvider: 'http' } },
  { id: 'ui-settings-models', config: { credentialOnboarding: false } },
  { id: 'preset-ptc', disabled: true },
  { id: 'preset-minimal', disabled: true },
  { id: 'preset-cordis', disabled: true },
  {
    id: 'permission',
    config: {
      defaultPreset: 'todo-harness-standard',
      presets: {
        'todo-harness-standard': {
          sandbox: 'workspace-write',
          approval: 'never',
          name: '标准模式',
          description: '在工作区内直接执行，不弹出审批提示。'
        }
      }
    }
  },
  { id: 'session-log-deepseek', config: { enabled: false, maxBytes: 8 * 1024 * 1024 } },
  { id: 'plugin-manager' },
  { id: 'ui-plugin-manager' },
  { id: 'ui-settings-plugins', disabled: true },
  { id: 'ui-settings-plugin-inventory', disabled: true },
  { id: 'ui-settings-session-log', disabled: true },
  { id: 'ui-agent-preset', disabled: true },
  { id: 'approval', config: { policy: 'never' } },
  { id: 'ui-approval', disabled: true },
  { id: 'ui-permission', disabled: true },
  { id: 'ui-message-feedback', disabled: true },
  { id: 'message-feedback', disabled: true },
  { id: 'session-log-download', disabled: true },
  { id: 'ui-jobs', disabled: true },
  { id: 'ui-deliverables', disabled: true },
  { id: 'workspace-changes', disabled: true },
  { id: 'ui-workflow-run', disabled: true },
  { id: 'ui-goal', disabled: true },
  { id: 'ui-plan', disabled: true },
  { id: 'plan-mode', disabled: true },
  { id: 'typert-loader', config: { packages: ['todo-harness'] } },
  { id: 'ui-brand-official', disabled: true }
  ];
  await writeFile(patchFile, `${JSON.stringify(profilePatch, null, 2)}\n`, 'utf8');

  const dshPackage = require.resolve('@deepseek-ai/dsh/package.json');
  const dshBin = join(dirname(dshPackage), 'lib', 'bin.js');
  const childArgs = [dshBin, '--profile', 'web', '--patch', patchFile, '--host', '127.0.0.1', '--port', String(webPort)];
  if (options.noOpen) childArgs.push('--no-open');
  childArgs.push(...options.dshArgs);

  const child = spawn(process.execPath, childArgs, { stdio: 'inherit', env: process.env, cwd: workspaceRoot });
  let stopping = false;
  const stopApi = async (exitCode) => {
    if (stopping) return;
    stopping = true;
    await api.close();
    process.exitCode = exitCode;
  };
  child.once('error', (error) => {
    process.stderr.write(`Todo Harness could not start DSH: ${error.message}\n`);
    stopApi(1).catch(() => { process.exitCode = 1; });
  });
  child.once('exit', (code, signal) => {
    stopApi(code ?? (signal ? 1 : 0)).catch(() => { process.exitCode = 1; });
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
}

async function linkWorkspacePackage(dshHome, packageRoot) {
  const packageDirectory = join(dshHome, 'profiles', 'web', 'node_modules', 'todo-harness');
  await mkdir(dirname(packageDirectory), { recursive: true });

  let existing;
  try {
    existing = await lstat(packageDirectory);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (existing) {
    if (!existing.isSymbolicLink()) {
      throw new Error(`Cannot link the local Todo Harness package because ${packageDirectory} already exists and is not a symbolic link`);
    }

    let linkedPackageRoot;
    try {
      linkedPackageRoot = await realpath(packageDirectory);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (linkedPackageRoot === await realpath(packageRoot)) return;
    if (process.platform === 'win32') await rmdir(packageDirectory);
    else await unlink(packageDirectory);
  }

  await symlink(packageRoot, packageDirectory, process.platform === 'win32' ? 'junction' : 'dir');
}

async function ensureVoiceInputBundle(dshHome) {
  const profileDirectory = join(dshHome, 'profiles', 'web');
  const manifestPath = join(profileDirectory, 'package.json');
  await mkdir(profileDirectory, { recursive: true });

  let manifest;
  let createdManifest = false;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    createdManifest = true;
    manifest = {
      name: 'dsh-profile-web',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...WEB_PROFILE_BUNDLES] } }
    };
  }

  const currentBundles = Array.isArray(manifest.dsh?.profile?.bundles)
    ? manifest.dsh.profile.bundles
    : [...WEB_PROFILE_BUNDLES];
  if (currentBundles.includes(VOICE_INPUT_BUNDLE)) return;

  const updated = {
    ...manifest,
    dsh: {
      ...manifest.dsh,
      profile: {
        ...manifest.dsh?.profile,
        bundles: [...currentBundles, VOICE_INPUT_BUNDLE]
      }
    }
  };
  await writeFile(manifestPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  if (createdManifest) {
    await writeFile(join(profileDirectory, 'cordis.patch.yml'), '[]\n', { encoding: 'utf8', flag: 'wx' }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
    await writeFile(join(profileDirectory, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n', { encoding: 'utf8', flag: 'wx' }).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
}

function parseArguments(args) {
  const result = { port: Number(process.env.TODO_HARNESS_PORT) || undefined, noOpen: process.env.TODO_HARNESS_NO_OPEN === '1', help: false, dshArgs: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--help' || argument === '-h') result.help = true;
    else if (argument === '--no-open') result.noOpen = true;
    else if (argument === '--port') {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value < 1024 || value > 65534) throw new RangeError('--port must be an integer between 1024 and 65534');
      result.port = value;
      index += 1;
    } else result.dshArgs.push(argument);
  }
  return result;
}

async function findPortPair(requestedPort) {
  if (requestedPort !== undefined) {
    if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65534) throw new RangeError('TODO_HARNESS_PORT must be between 1024 and 65534');
    if (!(await isPortAvailable(requestedPort)) || !(await isPortAvailable(requestedPort + 1))) throw new Error(`Ports ${requestedPort} and ${requestedPort + 1} must both be available`);
    return requestedPort;
  }
  for (let port = DEFAULT_PORT; port < 65534; port += 1) {
    if (await isPortAvailable(port) && await isPortAvailable(port + 1)) return port;
  }
  throw new Error('No available adjacent ports for the DSH web client and Todo API');
}

function isPortAvailable(port) {
  return new Promise((resolveAvailable) => {
    const server = createNetServer();
    server.once('error', () => resolveAvailable(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolveAvailable(true)));
  });
}

main().catch((error) => {
  process.stderr.write(`Todo Harness startup failed: ${error.message}\n`);
  process.exitCode = 1;
});
