import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TodoRepository } from '../src/storage/todo-repository.js';

async function repository() {
  const directory = await mkdtemp(join(tmpdir(), 'todo-harness-'));
  return new TodoRepository(join(directory, 'todos.json')).init();
}

test('repository persists and serializes concurrent writes', async () => {
  const store = await repository();
  const created = await Promise.all([1, 2, 3].map((value) => store.create({ title: `Task ${value}` })));
  assert.equal(created.length, 3);
  assert.equal((await store.list()).length, 3);
  assert.equal((await store.stats()).total, 3);
});

test('repository rejects unknown ids and writes valid JSON', async () => {
  const store = await repository();
  await assert.rejects(() => store.complete('missing'), { code: 'TODO_NOT_FOUND' });
  const raw = await readFile(store.filePath, 'utf8');
  assert.equal(JSON.parse(raw).version, 1);
});

test('repository sorts active todos by priority and deadline', async () => {
  const store = await repository();
  await store.create({ title: 'Normal later', priority: 'normal', dueAt: '2030-01-01T10:00:00.000Z' });
  await store.create({ title: 'Urgent later', priority: 'urgent', dueAt: '2030-01-01T18:00:00.000Z' });
  await store.create({ title: 'Urgent sooner', priority: 'urgent', dueAt: '2030-01-01T09:00:00.000Z' });
  assert.deepEqual((await store.list()).map((todo) => todo.title), ['Urgent sooner', 'Urgent later', 'Normal later']);
});

test('coordination relationships persist and reject missing references and cycles atomically', async () => {
  const store = await repository();
  const parent = await store.create({ title: 'Launch' });
  const draft = await store.create({ title: 'Prepare materials', parentId: parent.id });
  const review = await store.create({ title: 'External review', parentId: parent.id, dependsOn: [draft.id], status: 'blocked' });
  const reopened = await new TodoRepository(store.filePath).init();
  assert.deepEqual((await reopened.get(review.id)).dependsOn, [draft.id]);
  await assert.rejects(() => store.create({ title: 'Missing parent', parentId: 'missing' }), /unknown Todo/);
  await assert.rejects(() => store.update(draft.id, { dependsOn: ['missing'] }), /unknown Todo/);
  await assert.rejects(() => store.update(draft.id, { dependsOn: [review.id] }), /cycle/);
  await assert.rejects(() => store.update(parent.id, { parentId: review.id }), /cycle/);
  await assert.rejects(() => store.update(review.id, { dependsOn: [review.id] }), /cycle/);
  assert.deepEqual((await store.get(draft.id)).dependsOn, []);
  assert.equal((await store.get(parent.id)).parentId, null);
  assert.equal((await store.list()).length, 3);
});

test('removing tasks or clearing completed tasks retains children without dangling references', async () => {
  const store = await repository();
  const parent = await store.create({ title: 'Parent' });
  const draft = await store.create({ title: 'Draft', parentId: parent.id });
  const review = await store.create({ title: 'Review', parentId: parent.id, dependsOn: [draft.id] });
  await store.remove(parent.id);
  assert.equal((await store.get(review.id)).parentId, null);
  await store.complete(draft.id);
  assert.deepEqual((await store.get(review.id)).dependsOn, [draft.id]);
  await store.clearCompleted();
  assert.deepEqual((await store.get(review.id)).dependsOn, []);
  assert.equal((await store.get(review.id)).status, 'todo');
  assert.equal((await store.list()).length, 1);
});
