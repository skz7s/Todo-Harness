import test from 'node:test';
import assert from 'node:assert/strict';
import { createTodo, updateTodo } from '../src/domain/todo.js';

test('createTodo normalizes aliases and date-only due dates', () => {
  const todo = createTodo({ title: '  Ship it  ', priority: 'p1', dueAt: '2030-01-02', tags: ['Work', 'work'] });
  assert.equal(todo.title, 'Ship it');
  assert.equal(todo.priority, 'high');
  assert.equal(todo.dueAt, '2030-01-02T23:59:59.000Z');
  assert.deepEqual(todo.tags, ['work']);
});

test('updateTodo records completion and can reopen', () => {
  const created = createTodo({ title: 'Task' });
  const done = updateTodo(created, { status: 'done' });
  assert.equal(done.status, 'done');
  assert.ok(done.completedAt);
  const reopened = updateTodo(done, { status: 'todo' });
  assert.equal(reopened.status, 'todo');
  assert.equal(reopened.completedAt, null);
});

test('Todo can persist and clear an associated Harness session', () => {
  const created = createTodo({ title: 'Task', sessionId: '  session-123  ' });
  assert.equal(created.sessionId, 'session-123');
  const updated = updateTodo(created, { status: 'in_progress' });
  assert.equal(updated.sessionId, 'session-123');
  assert.equal(updateTodo(updated, { sessionId: null }).sessionId, null);
  assert.equal(createTodo({ title: 'Unlinked task' }).sessionId, null);
  assert.throws(() => createTodo({ title: 'Invalid session', sessionId: 42 }), /sessionId must be a string/);
});

test('Todo retains dispatch settings through edits and storage normalization', () => {
  const dispatchOptions = { modelSelection: { provider: 'gateway', model: 'reasoner', reasoningEffort: 'high' }, directoryMode: 'choose', directoryPath: '/projects/任务目录' };
  const todo = createTodo({ title: 'Task', dispatchOptions });
  assert.deepEqual(todo.dispatchOptions, dispatchOptions);
  assert.deepEqual(createTodo(JSON.parse(JSON.stringify(todo))).dispatchOptions, dispatchOptions);
  assert.deepEqual(updateTodo(todo, { notes: 'Updated progress', status: 'in_progress' }).dispatchOptions, dispatchOptions);
  assert.equal(updateTodo(todo, { dispatchOptions: null }).dispatchOptions, null);
  assert.equal(createTodo({ title: 'Old task' }).dispatchOptions, null);
  assert.throws(() => updateTodo(todo, { dispatchOptions: { ...dispatchOptions, directoryPath: '' } }), /directoryPath/);
  assert.throws(() => updateTodo(todo, { dispatchOptions: { ...dispatchOptions, directoryMode: 'invalid' } }), /directoryMode/);
});

test('deadlines do not implicitly schedule execution', () => {
  const todo = createTodo({ title: 'Timed task', dueAt: '2030-01-02T12:00:00.000Z', estimatedMinutes: 60 });
  assert.equal(todo.estimatedMinutes, 60);
  assert.equal(todo.startAt, null);
  assert.equal(updateTodo(todo, { estimatedMinutes: 120 }).startAt, null);
  assert.equal(createTodo({ title: 'No estimate', dueAt: todo.dueAt, estimatedMinutes: null }).estimatedMinutes, null);
});

test('planning fields accept an explicit cross-day window', () => {
  const todo = createTodo({
    title: 'Overnight task',
    startAt: '2030-01-01T22:00:00.000Z',
    dueAt: '2030-01-02T10:30:00.000Z',
    estimatedMinutes: 90
  });
  assert.equal(todo.startAt, '2030-01-01T22:00:00.000Z');
  assert.equal(todo.dueAt, '2030-01-02T10:30:00.000Z');
  assert.equal(todo.estimatedMinutes, 90);
});

test('rescheduling and effort updates preserve the independent deadline and execution time', () => {
  const todo = createTodo({ title: 'Prepare early', startAt: '2030-01-01T09:00:00Z', dueAt: '2030-01-05T12:00:00Z', estimatedMinutes: 60 });
  const revised = updateTodo(todo, { dueAt: '2030-01-06T12:00:00Z', estimatedMinutes: 600 });
  assert.equal(revised.startAt, todo.startAt);
  assert.equal(updateTodo(revised, { startAt: null }).startAt, null);
  assert.equal(createTodo({ ...revised, startAt: null }).startAt, null);
  const late = updateTodo(todo, { startAt: '2030-01-07T09:00:00Z' });
  assert.equal(late.dueAt, todo.dueAt);
  assert.equal(updateTodo(late, { status: 'done' }).status, 'done');
});

test('starting early moves a future or missing execution time to now and preserves the deadline', () => {
  for (const startAt of ['2099-01-01T09:00:00Z', null]) {
    const todo = createTodo({ title: 'Start early', startAt, dueAt: '2099-01-05T12:00:00Z' });
    const started = updateTodo(todo, { status: 'in_progress' });
    assert.equal(started.startAt, started.updatedAt);
    assert.equal(started.dueAt, todo.dueAt);
    assert.equal(updateTodo(started, { notes: 'Work has begun' }).startAt, started.startAt);
    assert.equal(updateTodo(started, { status: 'in_progress' }).startAt, started.startAt);
    assert.equal(updateTodo(started, { status: 'done' }).startAt, started.startAt);
  }
});

test('starting preserves an earlier execution time and reconciles an explicit future time', () => {
  const todo = createTodo({ title: 'Already scheduled', startAt: '2020-01-01T09:00:00Z' });
  assert.equal(updateTodo(todo, { status: 'in_progress' }).startAt, todo.startAt);
  const reportedStart = '2020-01-02T10:00:00.000Z';
  assert.equal(updateTodo(todo, { status: 'doing', startAt: reportedStart }).startAt, reportedStart);
  const started = updateTodo(todo, { status: 'in_progress', startAt: '2099-01-01T09:00:00Z' });
  assert.equal(started.startAt, started.updatedAt);
  const rescheduled = updateTodo(started, { startAt: '2099-01-02T09:00:00Z' });
  assert.equal(rescheduled.startAt, '2099-01-02T09:00:00.000Z');
  assert.equal(updateTodo(rescheduled, { notes: 'Resume later' }).startAt, rescheduled.startAt);
  const resumed = updateTodo(rescheduled, { status: 'in_progress' });
  assert.equal(resumed.startAt, resumed.updatedAt);
});

test('coordination references normalize and survive unrelated updates', () => {
  const todo = createTodo({ title: 'Review', parentId: ' project ', dependsOn: ['draft', ' draft '] });
  assert.equal(todo.parentId, 'project');
  assert.deepEqual(todo.dependsOn, ['draft']);
  assert.deepEqual(updateTodo(todo, { priority: 'urgent' }).dependsOn, ['draft']);
  assert.equal(updateTodo(todo, { parentId: null }).parentId, null);
  assert.deepEqual(updateTodo(todo, { dependsOn: [] }).dependsOn, []);
  assert.throws(() => createTodo({ title: 'Invalid', dependsOn: 'draft' }), /array/);
  assert.throws(() => createTodo({ title: 'Invalid', dependsOn: [''] }), /nonempty/);
});
