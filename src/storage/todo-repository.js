import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createTodo, isTodo, updateTodo, normalizeStatus } from '../domain/todo.js';

const EMPTY_DATABASE = { version: 1, revision: 0, todos: [] };

export class TodoRepository {
  constructor(filePath) {
    this.filePath = resolve(filePath);
    this._queue = Promise.resolve();
  }

  async init() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this._write(EMPTY_DATABASE);
    }
    return this;
  }

  async list({ status, query, includeArchived = false, dueFrom, dueTo } = {}) {
    const database = await this._read();
    let todos = database.todos.map(normalizeStoredTodo).filter(isTodo);
    if (!includeArchived) todos = todos.filter((todo) => todo.status !== 'archived');
    if (status) todos = todos.filter((todo) => todo.status === normalizeStatus(status));
    if (dueFrom) todos = todos.filter((todo) => todo.dueAt && Date.parse(todo.dueAt) >= Date.parse(dueFrom));
    if (dueTo) todos = todos.filter((todo) => todo.dueAt && Date.parse(todo.dueAt) < Date.parse(dueTo));
    if (query) {
      const needle = String(query).trim().toLocaleLowerCase();
      todos = todos.filter((todo) => `${todo.title} ${todo.notes} ${todo.tags.join(' ')}`.toLocaleLowerCase().includes(needle));
    }
    return todos.sort(sortTodos).map(clone);
  }

  async get(id) {
    const database = await this._read();
    const todo = normalizeStoredTodo(database.todos.find((candidate) => candidate.id === id));
    return todo ? clone(todo) : null;
  }

  async create(input) {
    return this._mutate((database) => {
      const todo = createTodo(input);
      validateRelations([...database.todos, todo], todo);
      database.todos.push(todo);
      return todo;
    });
  }

  async update(id, patch) {
    return this._mutate((database) => {
      const index = database.todos.findIndex((candidate) => candidate.id === id);
      if (index === -1) throw notFound(id);
      const todo = updateTodo(normalizeStoredTodo(database.todos[index]), patch);
      database.todos[index] = todo;
      validateRelations(database.todos, todo);
      return todo;
    });
  }

  async complete(id) {
    return this.update(id, { status: 'done' });
  }

  async remove(id) {
    return this._mutate((database) => {
      const index = database.todos.findIndex((candidate) => candidate.id === id);
      if (index === -1) throw notFound(id);
      const [todo] = database.todos.splice(index, 1);
      database.todos = detachReferences(database.todos, new Set([id]));
      return todo;
    });
  }

  async clearCompleted() {
    return this._mutate((database) => {
      const removed = database.todos.filter((todo) => todo.status === 'done' || todo.status === 'archived');
      database.todos = detachReferences(database.todos.filter((todo) => todo.status !== 'done' && todo.status !== 'archived'), new Set(removed.map((todo) => todo.id)));
      return { removed: removed.length };
    });
  }

  async stats() {
    const todos = await this.list({ includeArchived: true });
    return {
      total: todos.length,
      todo: todos.filter((todo) => todo.status === 'todo').length,
      inProgress: todos.filter((todo) => todo.status === 'in_progress').length,
      done: todos.filter((todo) => todo.status === 'done').length,
      archived: todos.filter((todo) => todo.status === 'archived').length
    };
  }

  async _read() {
    const raw = await readFile(this.filePath, 'utf8');
    const database = JSON.parse(raw);
    if (!database || database.version !== 1 || !Array.isArray(database.todos)) throw new Error('TODO_DATABASE_INVALID');
    return database;
  }

  async _write(database) {
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }

  async _mutate(mutator) {
    const operation = this._queue.then(async () => {
      const database = await this._read();
      const result = mutator(database);
      database.revision += 1;
      await this._write(database);
      return clone(result);
    });
    this._queue = operation.catch(() => undefined);
    return operation;
  }
}

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function validateRelations(todos, todo) {
  const byId = new Map(todos.map((entry) => [entry.id, entry]));
  for (const field of ['parentId', 'dependsOn']) {
    const references = field === 'parentId' ? (todo.parentId ? [todo.parentId] : []) : todo.dependsOn;
    for (const id of references) {
      if (!byId.has(id)) throw new RangeError(`${field} references an unknown Todo: ${id}`);
      const pending = [id];
      const visited = new Set();
      while (pending.length) {
        const current = pending.pop();
        if (current === todo.id) throw new RangeError(`${field} must not create a cycle`);
        if (visited.has(current)) continue;
        visited.add(current);
        const related = byId.get(current);
        if (field === 'parentId') {
          if (related?.parentId) pending.push(related.parentId);
        } else pending.push(...(related?.dependsOn ?? []));
      }
    }
  }
}

function detachReferences(todos, removedIds) {
  return todos.map((todo) => {
    const parentRemoved = removedIds.has(todo.parentId);
    const dependsOn = (todo.dependsOn ?? []).filter((id) => !removedIds.has(id));
    if (!parentRemoved && dependsOn.length === (todo.dependsOn ?? []).length) return todo;
    return updateTodo(normalizeStoredTodo(todo), { parentId: parentRemoved ? null : todo.parentId, dependsOn });
  });
}

function sortTodos(a, b) {
  const statusOrder = { todo: 0, in_progress: 1, blocked: 2, done: 3, canceled: 4, archived: 5 };
  const terminalDifference = Number(['done', 'canceled', 'archived'].includes(a.status)) - Number(['done', 'canceled', 'archived'].includes(b.status));
  if (terminalDifference) return terminalDifference;
  const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
  const priorityDifference = priorityOrder[a.priority] - priorityOrder[b.priority];
  if (priorityDifference) return priorityDifference;
  const dueDifference = (a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY) - (b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY);
  if (dueDifference) return dueDifference;
  const startDifference = (a.startAt ? Date.parse(a.startAt) : Number.POSITIVE_INFINITY) - (b.startAt ? Date.parse(b.startAt) : Number.POSITIVE_INFINITY);
  if (startDifference) return startDifference;
  const statusDifference = statusOrder[a.status] - statusOrder[b.status];
  if (statusDifference) return statusDifference;
  return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
}

function normalizeStoredTodo(value) {
  if (!value || typeof value !== 'object') return value;
  try {
    return createTodo(value);
  } catch {
    return value;
  }
}

function notFound(id) {
  const error = new Error(`TODO_NOT_FOUND:${id}`);
  error.code = 'TODO_NOT_FOUND';
  error.statusCode = 404;
  return error;
}
