import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_SETTINGS = Object.freeze({ version: 1, agentName: 'Kre-Weave', dailyTokenBudget: 10_000_000 });

export class SettingsRepository {
  constructor(filePath) {
    this.filePath = resolve(filePath);
    this.queue = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const source = JSON.parse(await readFile(this.filePath, 'utf8'));
      const settings = normalizeSettings(source);
      if (JSON.stringify(source) !== JSON.stringify(settings)) await this.write(settings);
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      await this.write(DEFAULT_SETTINGS);
    }
    return this;
  }

  async get() {
    return publicSettings(normalizeSettings(JSON.parse(await readFile(this.filePath, 'utf8'))));
  }

  async update(patch = {}) {
    const operation = this.queue.then(async () => {
      const current = await this.get();
      const next = normalizeSettings({ ...current, ...patch });
      await this.write(next);
      return publicSettings(next);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async write(settings) {
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}

export function publicSettings(settings) {
  return { agentName: settings.agentName, dailyTokenBudget: settings.dailyTokenBudget };
}

function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('settings must be an object');
  const agentName = typeof value.agentName === 'string' ? value.agentName.trim() : DEFAULT_SETTINGS.agentName;
  if (!agentName || agentName.length > 60) throw new RangeError('agentName must contain 1 to 60 characters');
  const dailyTokenBudget = value.dailyTokenBudget ?? DEFAULT_SETTINGS.dailyTokenBudget;
  if (!Number.isSafeInteger(dailyTokenBudget) || dailyTokenBudget < 0 || dailyTokenBudget > 1_000_000_000) {
    throw new RangeError('dailyTokenBudget must be an integer between 0 and 1000000000');
  }
  return { version: 1, agentName, dailyTokenBudget };
}
