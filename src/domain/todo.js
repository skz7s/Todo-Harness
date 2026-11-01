import { randomUUID } from 'node:crypto';

export const TODO_STATUSES = Object.freeze(['todo', 'in_progress', 'blocked', 'done', 'canceled', 'archived']);
export const TODO_PRIORITIES = Object.freeze(['low', 'normal', 'high', 'urgent']);

const MAX_TITLE_LENGTH = 240;
const MAX_NOTE_LENGTH = 4000;
const MAX_SESSION_ID_LENGTH = 256;
const MAX_ESTIMATED_MINUTES = 43_200;
const DEFAULT_ESTIMATED_MINUTES = 60;

export function nowIso() {
  return new Date().toISOString();
}

export function cleanText(value, field, maxLength) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
  const text = value.trim();
  if (text.length > maxLength) throw new RangeError(`${field} exceeds ${maxLength} characters`);
  return text;
}

function normalizeSessionId(value) {
  if (value === undefined || value === null) return null;
  const sessionId = cleanText(value, 'sessionId', MAX_SESSION_ID_LENGTH);
  return sessionId || null;
}

function normalizeDispatchOptions(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('dispatchOptions must be an object');
  const selection = value.modelSelection;
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) throw new TypeError('dispatchOptions.modelSelection must be an object');
  const provider = cleanText(selection.provider, 'provider', 256);
  const model = cleanText(selection.model, 'model', 256);
  const reasoningEffort = cleanText(selection.reasoningEffort, 'reasoningEffort', 64);
  const directoryPath = cleanText(value.directoryPath, 'directoryPath', 4096);
  if (!provider || !model || !directoryPath) throw new RangeError('dispatchOptions requires provider, model, and directoryPath');
  if (!['choose', 'current'].includes(value.directoryMode)) throw new RangeError('dispatchOptions.directoryMode must be choose or current');
  return Object.freeze({
    modelSelection: Object.freeze({ provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) }),
    directoryMode: value.directoryMode,
    directoryPath
  });
}

export function normalizeStatus(value = 'todo') {
  const status = String(value).trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  const aliases = { pending: 'todo', open: 'todo', doing: 'in_progress', progress: 'in_progress', completed: 'done', complete: 'done', blocked: 'blocked', canceled: 'canceled', cancelled: 'canceled', archived: 'archived' };
  const normalized = aliases[status] ?? status;
  if (!TODO_STATUSES.includes(normalized)) throw new RangeError(`status must be one of ${TODO_STATUSES.join(', ')}`);
  return normalized;
}

export function normalizePriority(value = 'normal') {
  const priority = String(value).trim().toLowerCase();
  const aliases = { p0: 'urgent', p1: 'high', p2: 'normal', p3: 'low', critical: 'urgent', medium: 'normal', '紧急': 'urgent', '高': 'high', '中': 'normal', '低': 'low' };
  const normalized = aliases[priority] ?? priority;
  if (!TODO_PRIORITIES.includes(normalized)) throw new RangeError(`priority must be one of ${TODO_PRIORITIES.join(', ')}`);
  return normalized;
}

export function normalizeDueAt(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError('dueAt must be a valid date');
    return value.toISOString();
  }
  if (typeof value !== 'string') throw new TypeError('dueAt must be an ISO date string or null');
  const candidate = value.trim();
  const parsed = new Date(candidate.length === 10 ? `${candidate}T23:59:59.000Z` : candidate);
  if (Number.isNaN(parsed.getTime())) throw new RangeError('dueAt must be a valid ISO date');
  return parsed.toISOString();
}

export function normalizeStartAt(value) {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError('startAt must be a valid date');
    return value.toISOString();
  }
  if (typeof value !== 'string') throw new TypeError('startAt must be an ISO date string or null');
  const candidate = value.trim();
  const parsed = new Date(candidate.length === 10 ? `${candidate}T00:00:00.000Z` : candidate);
  if (Number.isNaN(parsed.getTime())) throw new RangeError('startAt must be a valid ISO date');
  return parsed.toISOString();
}

export function normalizeEstimatedMinutes(value = DEFAULT_ESTIMATED_MINUTES) {
  if (value === undefined) return DEFAULT_ESTIMATED_MINUTES;
  if (value === null || value === '') return null;
  const minutes = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > MAX_ESTIMATED_MINUTES) {
    throw new RangeError(`estimatedMinutes must be an integer between 1 and ${MAX_ESTIMATED_MINUTES}`);
  }
  return minutes;
}

function normalizeTodoId(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return cleanText(value, field, 256) || null;
}

function normalizeDependencies(value = []) {
  if (value === null) return [];
  if (!Array.isArray(value)) throw new TypeError('dependsOn must be an array of Todo ids');
  if (value.length > 50) throw new RangeError('dependsOn exceeds 50 Todo ids');
  return [...new Set(value.map((id) => {
    const normalized = normalizeTodoId(id, 'dependsOn');
    if (!normalized) throw new RangeError('dependsOn must contain nonempty Todo ids');
    return normalized;
  }))];
}

export function createTodo(input = {}) {
  const title = cleanText(input.title, 'title', MAX_TITLE_LENGTH);
  if (!title) throw new RangeError('title is required');
  const createdAt = input.createdAt ?? nowIso();
  const updatedAt = input.updatedAt ?? createdAt;
  const status = normalizeStatus(input.status);
  const dueAt = normalizeDueAt(input.dueAt);
  const estimatedMinutes = normalizeEstimatedMinutes(input.estimatedMinutes === undefined ? input.effortMinutes : input.estimatedMinutes);
  const startAt = normalizeStartAt(input.startAt === undefined ? input.plannedStartAt : input.startAt);
  const todo = {
    id: input.id ?? randomUUID(),
    title,
    notes: cleanText(input.notes, 'notes', MAX_NOTE_LENGTH),
    sessionId: normalizeSessionId(input.sessionId),
    dispatchOptions: normalizeDispatchOptions(input.dispatchOptions),
    status,
    priority: normalizePriority(input.priority),
    dueAt,
    startAt,
    estimatedMinutes,
    parentId: normalizeTodoId(input.parentId, 'parentId'),
    dependsOn: normalizeDependencies(input.dependsOn),
    tags: normalizeTags(input.tags),
    createdAt,
    updatedAt,
    completedAt: status === 'done' ? (input.completedAt ?? updatedAt) : null
  };
  return Object.freeze(todo);
}

export function normalizeTags(value = []) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError('tags must be an array');
  return [...new Set(value.map((tag) => cleanText(tag, 'tag', 40).toLowerCase()).filter(Boolean))].slice(0, 20);
}

export function updateTodo(todo, patch = {}) {
  const nextStatus = patch.status === undefined ? todo.status : normalizeStatus(patch.status);
  const updatedAt = nowIso();
  const dueAt = patch.dueAt === undefined ? normalizeDueAt(todo.dueAt) : normalizeDueAt(patch.dueAt);
  const estimatedMinutes = patch.estimatedMinutes === undefined
    ? normalizeEstimatedMinutes(todo.estimatedMinutes)
    : normalizeEstimatedMinutes(patch.estimatedMinutes);
  let startAt = patch.startAt === undefined ? normalizeStartAt(todo.startAt) : normalizeStartAt(patch.startAt);
  if (patch.status !== undefined && nextStatus === 'in_progress' && (!startAt || Date.parse(startAt) > Date.parse(updatedAt))) {
    startAt = updatedAt;
  }
  const next = {
    ...todo,
    sessionId: patch.sessionId === undefined ? normalizeSessionId(todo.sessionId) : normalizeSessionId(patch.sessionId),
    dispatchOptions: normalizeDispatchOptions(patch.dispatchOptions === undefined ? todo.dispatchOptions : patch.dispatchOptions),
    ...(patch.title === undefined ? {} : { title: cleanText(patch.title, 'title', MAX_TITLE_LENGTH) }),
    ...(patch.notes === undefined ? {} : { notes: cleanText(patch.notes, 'notes', MAX_NOTE_LENGTH) }),
    ...(patch.priority === undefined ? {} : { priority: normalizePriority(patch.priority) }),
    dueAt,
    startAt,
    estimatedMinutes,
    parentId: normalizeTodoId(patch.parentId === undefined ? todo.parentId : patch.parentId, 'parentId'),
    dependsOn: normalizeDependencies(patch.dependsOn === undefined ? todo.dependsOn : patch.dependsOn),
    ...(patch.tags === undefined ? {} : { tags: normalizeTags(patch.tags) }),
    status: nextStatus,
    updatedAt,
    completedAt: nextStatus === 'done' ? (todo.status === 'done' && todo.completedAt ? todo.completedAt : updatedAt) : null
  };
  if (!next.title) throw new RangeError('title is required');
  return Object.freeze(next);
}

export function isTodo(value) {
  return Boolean(value && typeof value.id === 'string' && typeof value.title === 'string' && TODO_STATUSES.includes(value.status));
}
