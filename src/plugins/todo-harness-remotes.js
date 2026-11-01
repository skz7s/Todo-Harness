import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';

export class TodoHarnessRemotes extends TypertRemoteService {
  static inject = ['schedule', 'agentDefaultModel'];

  constructor(ctx) {
    super(ctx, 'todoHarness');
  }

  createSchedule({ sessionId, request }) {
    return this.ctx.schedule.create(sessionId, request);
  }

  getDefaultModel() {
    return this.ctx.agentDefaultModel.currentSelection();
  }

  setDefaultModel(selection) {
    return this.ctx.agentDefaultModel.saveSelection(selection);
  }
}

const initializers = [];
for (const method of ['createSchedule', 'getDefaultModel', 'setDefaultModel']) {
  Remote(TodoHarnessRemotes.prototype[method], {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    addInitializer(initializer) { initializers.push(initializer); }
  });
}
for (const initialize of initializers) initialize.call(Object.create(TodoHarnessRemotes.prototype));
