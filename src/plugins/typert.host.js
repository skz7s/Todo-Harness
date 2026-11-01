import {
  createSchedulePayloadSchema,
  modelSelectionSchema,
  noResultSchema,
  scheduleCreateRequestSchema,
  scheduleRecordSchema
} from './remote-schemas.js';

const remoteMethod = (method, parameters, resultType, resultFactory, line) => ({
  id: `todo-harness#todoHarness/${method}`,
  service: 'todoHarness',
  namespace: 'todoHarness',
  method,
  invocation: { kind: 'direct' },
  parameters,
  result: {
    mode: 'strict',
    typeSymbol: `todo-harness#todoHarness/${method}:result`,
    create: resultFactory
  },
  sourceLocation: { file: 'src/plugins/todo-harness-remotes.js', line, column: 3 }
});

const requestParameter = (name, schemaName, create) => ({
  name,
  wire: name,
  source: 'json',
  codec: { mode: 'strict', typeSymbol: schemaName, create }
});

export const TYPERT = {
  package: 'todo-harness',
  face: 'host',
  schemas: [
    { name: 'CreateSchedulePayload', create: () => createSchedulePayloadSchema },
    { name: 'ScheduleCreateRequest', create: () => scheduleCreateRequestSchema },
    { name: 'ScheduleRecord', create: () => scheduleRecordSchema },
    { name: 'ModelSelection', create: () => modelSelectionSchema },
    { name: 'NoResult', create: () => noResultSchema }
  ],
  invocations: [
    remoteMethod('createSchedule', [requestParameter('payload', 'todo-harness#CreateSchedulePayload', () => createSchedulePayloadSchema)], 'todo-harness#ScheduleRecord', () => scheduleRecordSchema, 12),
    remoteMethod('getDefaultModel', [], 'todo-harness#ModelSelection', () => modelSelectionSchema, 16),
    remoteMethod('setDefaultModel', [requestParameter('selection', 'todo-harness#ModelSelection', () => modelSelectionSchema)], 'todo-harness#NoResult', () => noResultSchema, 20)
  ],
  model: {
    services: [{
      description: 'Todo Harness actions exposed over the authenticated browser Remote.',
      summary: 'Todo Harness actions exposed over the authenticated browser Remote.',
      tags: [],
      key: 'todoHarness',
      exportName: 'TodoHarnessRemotes',
      members: [
        { kind: 'method', name: 'createSchedule', signature: '@Remote async createSchedule(payload: CreateSchedulePayload): Promise<ScheduleRecord>' },
        { kind: 'method', name: 'getDefaultModel', signature: '@Remote getDefaultModel(): ModelSelection' },
        { kind: 'method', name: 'setDefaultModel', signature: '@Remote async setDefaultModel(selection: ModelSelection): Promise<void>' }
      ],
      types: [
        { name: 'CreateSchedulePayload', declaration: 'export interface CreateSchedulePayload { sessionId: string; request: ScheduleCreateRequest }' },
        { name: 'ScheduleCreateRequest', declaration: 'export interface ScheduleCreateRequest { title: string; prompt: string; at?: string | LocalAtInput; every_seconds?: number; daily?: DailyInput; weekly?: WeeklyInput; cron?: CronInput }' },
        { name: 'ScheduleRecord', declaration: 'export type ScheduleRecord = object' },
        { name: 'ModelSelection', declaration: 'export interface ModelSelection { provider: string; model: string; reasoningEffort?: string }' }
      ]
    }],
    events: [],
    objects: []
  }
};
