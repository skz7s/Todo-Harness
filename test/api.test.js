import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TodoRepository } from '../src/storage/todo-repository.js';
import { UsageRepository } from '../src/storage/usage-repository.js';
import { SettingsRepository } from '../src/storage/settings-repository.js';
import { createTodoServer } from '../src/http/server.js';

test('loopback API exposes Todo snapshots and usage to the Harness origin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'todo-harness-api-'));
  const repository = await new TodoRepository(join(directory, 'todos.json')).init();
  const usageRepository = await new UsageRepository(join(directory, 'usage.json')).init();
  const settingsRepository = await new SettingsRepository(join(directory, 'settings.json')).init();
  await repository.create({ title: 'Prepare the demo' });
  await usageRepository.recordUsage({ provider: 'deepseek', model: 'test-model', inputTokens: 12, outputTokens: 4 });

  const allowedOrigin = 'http://127.0.0.1:3210';
  const app = createTodoServer({ repository, usageRepository, settingsRepository, allowedOrigin, port: 0, logger: { error() {} } });
  const address = await app.listen();
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { origin: allowedOrigin };

  try {
    const health = await fetch(`${base}/api/health`, { headers });
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('access-control-allow-origin'), allowedOrigin);

    const brandMark = await fetch(`${base}/api/brand-mark`, { headers });
    assert.equal(brandMark.status, 200);
    assert.equal(brandMark.headers.get('content-type'), 'image/png');
    assert.equal(brandMark.headers.get('cache-control'), 'no-store');
    assert.equal(brandMark.headers.get('access-control-allow-origin'), allowedOrigin);
    assert.deepEqual([...new Uint8Array(await brandMark.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal((await fetch(`${base}/api/brand-mark`, { headers: { origin: 'http://localhost:3210' } })).status, 403);

    const todos = await fetch(`${base}/api/todos`, { headers });
    assert.equal(todos.status, 200);
    assert.equal((await todos.json()).todos[0].title, 'Prepare the demo');

    const usage = await fetch(`${base}/api/usage`, { headers });
    assert.equal((await usage.json()).entries[0].totalTokens, 16);

    const settings = await fetch(`${base}/api/settings`, { headers });
    assert.deepEqual(await settings.json(), { agentName: 'Kre-Weave', dailyTokenBudget: 10000000 });

    const updatedSettings = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ agentName: 'Weave', dailyTokenBudget: 250000 })
    });
    assert.deepEqual(await updatedSettings.json(), { agentName: 'Weave', dailyTokenBudget: 250000 });
    assert.equal((await settingsRepository.get()).dailyTokenBudget, 250000);

    const invalidSettings = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ dailyTokenBudget: -1 })
    });
    assert.equal(invalidSettings.status, 400);

    const createdTodo = await fetch(`${base}/api/todos`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Plan an iteration', dueAt: '2030-05-01', priority: 'high' })
    });
    assert.equal(createdTodo.status, 201);
    const created = (await createdTodo.json()).todo;
    assert.equal(created.title, 'Plan an iteration');
    assert.equal(created.priority, 'high');
    assert.equal(created.startAt, null);

    const coordinated = await fetch(`${base}/api/todos`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Follow up with reviewer', parentId: created.id, dependsOn: [created.id], status: 'blocked', dueAt: '2020-01-01T12:00:00Z', startAt: '2030-01-01T09:00:00Z' })
    });
    assert.equal(coordinated.status, 201);
    const followUp = (await coordinated.json()).todo;
    const rescheduled = await fetch(`${base}/api/todos/${followUp.id}`, {
      method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ startAt: '2030-01-02T09:00:00Z' })
    });
    assert.equal(rescheduled.status, 200);
    const revised = (await rescheduled.json()).todo;
    assert.equal(revised.dueAt, followUp.dueAt);
    assert.equal(revised.parentId, created.id);
    assert.deepEqual(revised.dependsOn, [created.id]);
    const finishedLate = await fetch(`${base}/api/todos/${followUp.id}/complete`, { method: 'POST', headers });
    assert.equal(finishedLate.status, 200);
    assert.equal((await finishedLate.json()).todo.status, 'done');
    const invalidRelation = await fetch(`${base}/api/todos/${followUp.id}`, {
      method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ dependsOn: [followUp.id] })
    });
    assert.equal(invalidRelation.status, 400);

    const updatedTodo = await fetch(`${base}/api/todos/${encodeURIComponent(created.id)}`, {
      method: 'PATCH',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Plan next iteration', status: 'in_progress', sessionId: 'harness-session-123', startAt: '2099-01-01T09:00:00Z' })
    });
    assert.equal(updatedTodo.status, 200);
    const updated = (await updatedTodo.json()).todo;
    assert.equal(updated.status, 'in_progress');
    assert.equal(updated.sessionId, 'harness-session-123');
    assert.equal(updated.startAt, updated.updatedAt);
    assert.equal(updated.dueAt, created.dueAt);
    assert.equal((await repository.get(created.id)).startAt, updated.startAt);

    const completedTodo = await fetch(`${base}/api/todos/${encodeURIComponent(created.id)}/complete`, {
      method: 'POST',
      headers
    });
    const completed = (await completedTodo.json()).todo;
    assert.equal(completed.status, 'done');
    assert.equal(completed.sessionId, 'harness-session-123');

    const removedTodo = await fetch(`${base}/api/todos/${encodeURIComponent(created.id)}`, { method: 'DELETE', headers });
    assert.equal((await removedTodo.json()).todo.title, 'Plan next iteration');
    assert.equal((await fetch(`${base}/api/todos/missing`, { method: 'DELETE', headers })).status, 404);

    assert.equal((await fetch(`${base}/api/todos`, { headers: { origin: 'http://localhost:3210' } })).status, 403);
    assert.equal((await fetch(`${base}/api/todos`)).status, 403);
    assert.equal((await fetch(`${base}/api/todos`, { method: 'POST', headers: { origin: 'http://localhost:3210', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    const preflight = await fetch(`${base}/api/todos`, { method: 'OPTIONS', headers: { ...headers, 'access-control-request-method': 'POST' } });
    assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
    assert.equal((await fetch(base, { headers })).status, 404);
  } finally {
    await app.close();
  }
});
