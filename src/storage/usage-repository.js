import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { nowIso } from '../domain/todo.js';

const EMPTY_USAGE = { version: 1, entries: [] };

export class UsageRepository {
  constructor(filePath) {
    this.filePath = resolve(filePath);
    this.queue = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const source = JSON.parse(await readFile(this.filePath, 'utf8'));
      const entries = Array.isArray(source?.entries) ? source.entries.map(normalizeEntry).filter(Boolean).slice(-1000) : [];
      if (source?.version !== 1 || !Array.isArray(source.entries) || JSON.stringify(source.entries) !== JSON.stringify(entries)) await this.write({ version: 1, entries });
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      await this.write(EMPTY_USAGE);
    }
    return this;
  }

  async recordUsage(input = {}) {
    const entry = normalizeEntry({ ...input, id: randomUUID(), createdAt: nowIso() });
    const operation = this.queue.then(async () => {
      const database = await this.read();
      database.entries.push(entry);
      database.entries = database.entries.slice(-1000);
      await this.write(database);
      return clone(entry);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async usage() {
    const database = await this.read();
    return { available: database.entries.length > 0, entries: database.entries.map(clone) };
  }

  async read() {
    const database = JSON.parse(await readFile(this.filePath, 'utf8'));
    if (database?.version !== 1 || !Array.isArray(database.entries)) throw new Error('USAGE_DATABASE_INVALID');
    return database;
  }

  async write(database) {
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}

function normalizeEntry(value) {
  if (!value || typeof value !== 'object') return null;
  const inputTokens = tokenCount(value.inputTokens);
  const outputTokens = tokenCount(value.outputTokens);
  const cacheReadTokens = tokenCount(value.cacheReadTokens);
  const cacheWriteTokens = tokenCount(value.cacheWriteTokens);
  const totalTokens = Number.isSafeInteger(value.totalTokens) && value.totalTokens >= 0
    ? value.totalTokens
    : inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;
  return {
    id: typeof value.id === 'string' ? value.id : randomUUID(),
    provider: cleanName(value.provider),
    model: cleanName(value.model),
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : nowIso()
  };
}

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function cleanName(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : 'unknown';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
