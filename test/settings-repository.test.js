import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsRepository } from '../src/storage/settings-repository.js';

async function repository() {
  const directory = await mkdtemp(join(tmpdir(), 'todo-harness-settings-'));
  return new SettingsRepository(join(directory, 'settings.json')).init();
}

test('settings repository persists the assistant name and daily token budget', async () => {
  const store = await repository();
  assert.deepEqual(await store.get(), { agentName: 'Kre-Weave', dailyTokenBudget: 10000000 });

  const next = await store.update({ agentName: 'Kre', dailyTokenBudget: 500000 });
  assert.deepEqual(next, { agentName: 'Kre', dailyTokenBudget: 500000 });
  assert.deepEqual(JSON.parse(await readFile(store.filePath, 'utf8')), {
    version: 1,
    agentName: 'Kre',
    dailyTokenBudget: 500000
  });
});

test('settings updates serialize and reject invalid preferences without losing the last value', async () => {
  const store = await repository();
  await Promise.all([
    store.update({ agentName: 'Weave' }),
    store.update({ dailyTokenBudget: 120000 })
  ]);
  assert.deepEqual(await store.get(), { agentName: 'Weave', dailyTokenBudget: 120000 });

  await assert.rejects(() => store.update({ agentName: '  ' }), /agentName must contain/);
  await assert.rejects(() => store.update({ dailyTokenBudget: 1.5 }), /dailyTokenBudget must be an integer/);
  assert.deepEqual(await store.get(), { agentName: 'Weave', dailyTokenBudget: 120000 });
});
