import { type ActionCommand } from '../action-command.js';
import { type FlowContext } from './flow-context.js';

export interface FlowExecutor {
  execute(
    actionCommand: ActionCommand,
    ctx: FlowContext,
    data: unknown,
    invokeFn: (actionCommand: ActionCommand, ctx: FlowContext, data: unknown) => Promise<unknown>,
  ): Promise<unknown>;
}

export class DefaultFlowExecutor implements FlowExecutor {
  async execute(
    actionCommand: ActionCommand,
    ctx: FlowContext,
    data: unknown,
    invokeFn: (actionCommand: ActionCommand, ctx: FlowContext, data: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    return invokeFn(actionCommand, ctx, data);
  }
}

export class QueuedFlowExecutor implements FlowExecutor {
  private readonly queues = new Map<number, Promise<unknown>>();

  async execute(
    actionCommand: ActionCommand,
    ctx: FlowContext,
    data: unknown,
    invokeFn: (actionCommand: ActionCommand, ctx: FlowContext, data: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    const userId = ctx.getUserId();
    const queueKey = typeof userId === 'bigint' ? Number(userId % 1000n) : 0;

    const existing = this.queues.get(queueKey) ?? Promise.resolve();
    const next = existing.then(
      () => invokeFn(actionCommand, ctx, data),
      () => invokeFn(actionCommand, ctx, data),
    );
    this.queues.set(queueKey, next);

    return next;
  }
}
