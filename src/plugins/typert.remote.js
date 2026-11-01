import {
  createSchedulePayloadSchema,
  modelSelectionSchema,
  noResultSchema,
  scheduleRecordSchema
} from './remote-schemas.js';

const requestParameter = (name, schemaName, create) => ({
  name,
  wire: name,
  source: 'json',
  codec: { mode: 'strict', typeSymbol: schemaName, create }
});

const result = (name, create) => ({
  mode: 'strict',
  typeSymbol: `todo-harness#todoHarness/${name}:result`,
  create
});

export const TYPERT_REMOTE = {
  package: 'todo-harness',
  descriptors: [
    {
      id: 'todo-harness#todoHarness/createSchedule',
      service: 'todoHarness',
      namespace: 'todoHarness',
      method: 'createSchedule',
      invocation: { kind: 'direct' },
      parameters: [requestParameter('payload', 'todo-harness#CreateSchedulePayload', () => createSchedulePayloadSchema)],
      result: result('createSchedule', () => scheduleRecordSchema)
    },
    {
      id: 'todo-harness#todoHarness/getDefaultModel',
      service: 'todoHarness',
      namespace: 'todoHarness',
      method: 'getDefaultModel',
      invocation: { kind: 'direct' },
      parameters: [],
      result: result('getDefaultModel', () => modelSelectionSchema)
    },
    {
      id: 'todo-harness#todoHarness/setDefaultModel',
      service: 'todoHarness',
      namespace: 'todoHarness',
      method: 'setDefaultModel',
      invocation: { kind: 'direct' },
      parameters: [requestParameter('selection', 'todo-harness#ModelSelection', () => modelSelectionSchema)],
      result: result('setDefaultModel', () => noResultSchema)
    }
  ]
};

export default TYPERT_REMOTE;
