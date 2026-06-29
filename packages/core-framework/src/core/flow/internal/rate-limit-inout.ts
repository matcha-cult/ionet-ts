import { type ActionMethodInOut } from '../action-method-inout.js';
import { type FlowContext } from '../flow-context.js';

export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
  keyExtractor?: (ctx: FlowContext) => string;
  onLimitExceeded?: (ctx: FlowContext) => void;
}

export class RateLimitInOut implements ActionMethodInOut {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly keyExtractor: (ctx: FlowContext) => string;
  private readonly onLimitExceeded?: (ctx: FlowContext) => void;
  private readonly requests = new Map<string, number[]>();

  constructor(options: RateLimitOptions) {
    this.maxRequests = options.maxRequests;
    this.windowMs = options.windowMs;
    this.keyExtractor = options.keyExtractor ?? ((ctx) => ctx.getUserId().toString());
    this.onLimitExceeded = options.onLimitExceeded;
  }

  fuckIn(flowContext: FlowContext): void {
    const key = this.keyExtractor(flowContext);
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.requests.get(key);
    if (!timestamps) {
      timestamps = [];
      this.requests.set(key, timestamps);
    }

    timestamps = timestamps.filter((t) => t > windowStart);
    this.requests.set(key, timestamps);

    if (timestamps.length >= this.maxRequests) {
      flowContext.setErrorCode(429);
      flowContext.setErrorMessage('Rate limit exceeded');
      this.onLimitExceeded?.(flowContext);
      return;
    }

    timestamps.push(now);
  }

  fuckOut(_flowContext: FlowContext): void {
    // No-op
  }

  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [key, timestamps] of this.requests.entries()) {
      const valid = timestamps.filter((t) => t > windowStart);
      if (valid.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, valid);
      }
    }
  }

  getStats(key: string): { count: number; remaining: number } {
    const timestamps = this.requests.get(key) ?? [];
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const valid = timestamps.filter((t) => t > windowStart);
    return {
      count: valid.length,
      remaining: Math.max(0, this.maxRequests - valid.length),
    };
  }
}
