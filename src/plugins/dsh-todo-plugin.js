import { defineTool } from '@deepseek-ai/dsh-tools';
import { TodoHarnessRemotes } from './todo-harness-remotes.js';
import { TODO_PRIORITIES, TODO_STATUSES } from '../domain/todo.js';
import { TodoRepository } from '../storage/todo-repository.js';
import { UsageRepository } from '../storage/usage-repository.js';
import { installModelDefaults } from './model-defaults.js';

export const name = 'todo-harness';
export const inject = ['tools', 'systemPrompt', 'workspaceRegistry'];

const todoFields = {
  title: { type: 'string', description: 'Short task title.' },
  notes: { type: 'string', description: 'Context, deliverables, coordination contacts, waiting periods, follow-up checkpoints, and scheduling assumptions.' },
  status: { type: 'string', enum: TODO_STATUSES },
  priority: { type: 'string', enum: TODO_PRIORITIES },
  dueAt: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Actual deadline as an ISO timestamp. Independent of the planned execution time; preserve unless the user changes it.' },
  startAt: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Planned execution or follow-up time as an ISO timestamp, chosen from availability and dependencies. Null clears the plan. Never automatically derived from the deadline.' },
  estimatedMinutes: { oneOf: [{ type: 'integer' }, { type: 'null' }], description: 'Estimated effort in whole minutes.' },
  parentId: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'Existing parent Todo id when this record is a user-facing subtask.' },
  dependsOn: { type: 'array', items: { type: 'string' }, description: 'Existing Todo ids that must finish before this step can begin.' },
  tags: { type: 'array', items: { type: 'string' } }
};

export async function apply(ctx, config = {}) {
  if (!config.dataFile || !config.usageFile || !config.workspaceRoot) throw new TypeError('Todo Harness requires dataFile, usageFile, and workspaceRoot');
  const workspace = await ctx.workspaceRegistry.create(config.workspaceRoot, 'Todo-Harness');
  if (workspace.title !== 'Todo-Harness') await workspace.setTitle('Todo-Harness');
  const repository = await new TodoRepository(config.dataFile).init();
  const usageRepository = await new UsageRepository(config.usageFile).init();

  if (typeof ctx.plugin === 'function') ctx.plugin(TodoHarnessRemotes);
  ctx.inject?.(['llm', 'settings'], (scope) => {
    scope.effect(() => installModelDefaults(scope), 'todo-harness: model capability defaults');
  });

  for (const tool of createTodoTools(repository)) ctx.tools.register(tool);

  ctx.systemPrompt.section({
    name: 'todo-harness:turn-reconciliation',
    order: ctx.systemPrompt.getSectionOrder('HARNESS_IDENTITY') + 10,
    text: `Primary role and intent policy:
- You are first and foremost the user's secretary and planning assistant. Planning, Todo maintenance, prioritization, and clear status are your primary duties; execution is a secondary capability and is never the default.
- At the beginning of every user turn, before answering, executing, or calling any other tool, call todo_list and read the latest saved Todo state.
- Treat progress and completion statements as reports, not commands. For example, "I finished X today", "X is done", "我今天完成了 X", and "今天完成了 Todo-Harness 的开发" mean reconcile the matching Todo; when completion is clear, mark it done and confirm it. Never start X again from that report alone.
- Treat goals, plans, and reminders such as "I need to finish X today" as planning intent: create or update the relevant Todo/Plan and help schedule it. Do not begin execution unless the user explicitly directs you to do the work.
- Execute work only after an explicit action request such as "implement X", "start X now", or "请实现 X". Even then, call todo_list first and reconcile the matching Todo. Mark it in_progress before execution; if no matching Todo exists and the work is substantive, create it and mark it in_progress before acting.
- When intent is ambiguous between reporting, planning, and execution, do not assume execution. Reconcile the Todo first and ask a concise clarifying question when needed.

Adaptive scheduling and coordination:
- Keep dueAt (the actual deadline) separate from startAt (planned execution). A deadline is a latest acceptable finish, not the day to begin. Never default to scheduling every task immediately before its deadline. Missing startAt means unscheduled; changing an estimate or deadline does not move an existing plan.
- When a task starts ahead of its plan, mark it in_progress and bring startAt forward to the actual start time (or the current time if none was reported), so it appears in Today. The status update automatically moves a future or missing startAt to the current time; pass an earlier actual startAt explicitly when known. Preserve dueAt and any already earlier startAt.
- Use the user's current local time and time zone, stated working hours, available time, energy, existing Todo plans, fixed appointments, priorities, effort, and dependencies to choose the earliest realistic available slot. Leave room for breaks, interruptions, review, and delivery. Do not invent calendar access, availability, or commitments; ask only for missing constraints that materially affect the plan and state any provisional assumption.
- When urgent work arrives, progress changes, a task finishes early, or a dependency is delayed, review the affected open tasks. Move flexible lower-priority startAt values to realistic free slots, bring ready work forward when capacity opens, and preserve deadlines and fixed commitments. Persist each affected startAt with todo_update, verify with todo_list, and explain the resulting changes and any deadline risk. Never silently push dueAt forward to conceal lateness or claim a plan fits when capacity is insufficient.
- For substantial work involving multiple parties, persist actionable user-facing subtasks with parentId and dependsOn. Separate preparation, outreach, waiting for a reply, follow-up, review, and delivery where useful. Put the responsible party, expected output, agreed response time, and next follow-up checkpoint in notes; record hands-on effort in estimatedMinutes rather than counting passive waiting as continuous work. Schedule dependencies before their successors and leave a coordination buffer before the real deadline.
- Reuse existing subtasks when replanning. Do not mark a parent done until its required steps are complete. When waiting on someone, preserve blocked status and plan a concrete follow-up; do not claim their reply or agreement. Planning alone does not authorize sending messages to other parties.
- All overdue active Todos remain visible in Today, even when their next startAt is in the future or they are blocked. Present them for the user to complete or reschedule; preserve the original deadline unless the user explicitly changes it. Never archive, cancel, or mark them done merely because they are late.

Persistent Todo maintenance rules:
- Before sending the final response for every user turn, call todo_list again. Compare the latest saved state with the user's request and the work completed in this turn. Decide whether a user Todo should be created, updated, completed, or deleted; do so when the actual situation warrants it, and leave the list unchanged when it does not.
- Todo tool calls write immediately. Use them directly when a relevant change is warranted.
- After any Todo mutation, call todo_list again and describe only changes confirmed in the saved list. Tell the user what was added, changed, completed, or deleted. Never claim an operation that did not persist.
- A request to estimate or re-estimate effort for all Todos or plans, such as “给所有的待办和计划评估工时”, is a persistence request, not a request for a chat-only table. Use the exact id shown in each todo_list entry and call todo_update for every relevant record with an integer estimatedMinutes value in minutes. Do not stop after calculating the estimates or update only the first record.
- When an estimate is expressed as a range, choose one representative integer minute value for estimatedMinutes, explain the range and assumption in the response, and preserve any useful context in the Todo notes when appropriate. After all updates, call todo_list once more and verify every requested id and estimatedMinutes before reporting success.
- The todo_list result includes stable record ids; never claim that ids are unavailable. If a mutation fails, report the failed record and do not claim that the full estimation was saved.
- Do not create Todos for internal reasoning or transient implementation steps. The built-in turn-planning tool, if present, is separate from this Todo list.`
  });

  ctx.on('session/event', (_session, event) => {
    if (event?.type === 'web/model-search-usage') {
      usageRepository.recordUsage(event.data).catch((error) => console.error('[todo-harness] search usage record failed', error));
      return;
    }
    if (event?.type !== 'assistant/message' || !event.data?.usage) return;
    const usage = event.data.usage;
    const source = event.data.message?.source ?? {};
    usageRepository.recordUsage({
      provider: source.provider,
      model: source.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens
    }).catch((error) => console.error('[todo-harness] usage record failed', error));
  });

}

export function createTodoTools(repository) {
  return [
    defineTool({
      name: 'todo_list',
      description: 'Read the latest saved Todo list, including each record id. Call this at the start of every user turn and again after any mutation.',
      parameters: {
        status: { type: 'string', enum: TODO_STATUSES },
        query: { type: 'string' },
        includeArchived: { type: 'boolean' }
      },
      output: jsonOutput('todo_list'),
      async execute(args, exec) {
        assertActive(exec);
        return { todos: await repository.list(args), stats: await repository.stats() };
      }
    }),
    defineTool({
      name: 'todo_create',
      description: 'Create and persist a user Todo directly.',
      parameters: { ...todoFields, title: { ...todoFields.title, required: true } },
      output: jsonOutput('todo_create'),
      async execute(args, exec) {
        assertActive(exec);
        return { todo: await repository.create(args) };
      }
    }),
    defineTool({
      name: 'todo_update',
      description: 'Update and persist one existing user Todo directly.',
      parameters: {
        id: { type: 'string', required: true },
        patch: { type: 'object', required: true, additionalProperties: false, properties: todoFields }
      },
      output: jsonOutput('todo_update'),
      async execute({ id, patch }, exec) {
        assertActive(exec);
        return { todo: await repository.update(id, patch ?? {}) };
      }
    }),
    defineTool({
      name: 'todo_complete',
      description: 'Mark one existing user Todo complete and persist it directly.',
      parameters: { id: { type: 'string', required: true } },
      output: jsonOutput('todo_complete'),
      async execute({ id }, exec) {
        assertActive(exec);
        return { todo: await repository.complete(id) };
      }
    }),
    defineTool({
      name: 'todo_delete',
      description: 'Delete one existing user Todo directly.',
      parameters: { id: { type: 'string', required: true } },
      output: jsonOutput('todo_delete'),
      async execute({ id }, exec) {
        assertActive(exec);
        return { todo: await repository.remove(id) };
      }
    }),
    defineTool({
      name: 'todo_clear_completed',
      description: 'Remove completed and archived user Todos directly.',
      parameters: {},
      output: jsonOutput('todo_clear_completed'),
      async execute(_args, exec) {
        assertActive(exec);
        return repository.clearCompleted();
      }
    }),
    defineTool({
      name: 'todo_stats',
      description: 'Read counts for the latest saved Todo list.',
      parameters: {},
      output: jsonOutput('todo_stats'),
      async execute(_args, exec) {
        assertActive(exec);
        return repository.stats();
      }
    })
  ];
}

function jsonOutput(toolName) {
  return {
    schema: { type: 'json' },
    render: (_args, value) => [{ type: 'text', text: renderToolResult(toolName, value) }]
  };
}

function renderToolResult(name, value) {
  if (name === 'todo_list') {
    if (!value.todos.length) return 'Todo list is empty.';
    return value.todos.map((todo) => [
      `- id: ${todo.id} | ${todo.status}: ${todo.title}`,
      `  priority: ${todo.priority ?? 'normal'} | planned start: ${todo.startAt ?? 'unscheduled'} | deadline: ${todo.dueAt ?? 'none'} | estimate ${todo.estimatedMinutes ?? 'unknown'}m`,
      todo.parentId ? `  parent id: ${todo.parentId}` : '',
      todo.dependsOn?.length ? `  depends on: ${todo.dependsOn.join(', ')}` : '',
      todo.notes ? `  notes: ${JSON.stringify(todo.notes)}` : '',
      todo.tags?.length ? `  tags: ${todo.tags.join(', ')}` : ''
    ].filter(Boolean).join('\n')).join('\n');
  }
  if (name === 'todo_create') return `Created Todo: ${value.todo.title} (id: ${value.todo.id})`;
  if (name === 'todo_update') return `Updated Todo: ${value.todo.title} (id: ${value.todo.id}${value.todo.estimatedMinutes ? `, estimate ${value.todo.estimatedMinutes}m` : ''})`;
  if (name === 'todo_complete') return `Completed Todo: ${value.todo.title} (id: ${value.todo.id})`;
  if (name === 'todo_delete') return `Deleted Todo: ${value.todo.title} (id: ${value.todo.id})`;
  if (name === 'todo_clear_completed') return `Removed ${value.removed} completed Todos.`;
  if (name === 'todo_stats') return `${value.todo} open, ${value.inProgress} in progress, ${value.done} completed.`;
  return JSON.stringify(value);
}

function assertActive(exec) {
  if (exec?.signal?.aborted) throw exec.signal.reason ?? new Error('Todo operation aborted');
}
