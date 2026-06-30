import { type FlowContext } from '../core/flow/flow-context.js';

export interface FlowAttachment {
  getAttachment<T>(key: string): T | undefined;
  setAttachment<T>(key: string, value: T): void;
  removeAttachment(key: string): void;
  clearAttachments(): void;
}

const ATTACHMENTS_KEY = Symbol('flow_attachments');

export function attachToFlowContext(ctx: FlowContext): FlowAttachment {
  const ctxAny = ctx as unknown as Record<string | symbol, unknown>;

  if (!ctxAny[ATTACHMENTS_KEY]) {
    ctxAny[ATTACHMENTS_KEY] = new Map<string, unknown>();
  }

  const attachments = ctxAny[ATTACHMENTS_KEY] as Map<string, unknown>;

  return {
    getAttachment<T>(key: string): T | undefined {
      return attachments.get(key) as T | undefined;
    },
    setAttachment<T>(key: string, value: T): void {
      attachments.set(key, value);
    },
    removeAttachment(key: string): void {
      attachments.delete(key);
    },
    clearAttachments(): void {
      attachments.clear();
    },
  };
}
