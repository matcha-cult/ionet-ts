import { type ActionMethodInOut } from '../action-method-inout.js';
import { type FlowContext } from '../flow-context.js';

export interface ActionStat {
  cmdMerge: number;
  count: number;
  totalMs: number;
  errorCount: number;
}

export class StatActionInOut implements ActionMethodInOut {
  private readonly stats = new Map<number, ActionStat>();

  fuckIn(_flowContext: FlowContext): void {
    // No-op for now; could record start time per-stat
  }

  fuckOut(flowContext: FlowContext): void {
    const cmdMerge = flowContext.getCmdMerge();
    const startTime = flowContext.getNanoTime();
    const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

    let stat = this.stats.get(cmdMerge);
    if (!stat) {
      stat = { cmdMerge, count: 0, totalMs: 0, errorCount: 0 };
      this.stats.set(cmdMerge, stat);
    }

    stat.count++;
    stat.totalMs += elapsedMs;
    if (flowContext.hasError()) {
      stat.errorCount++;
    }
  }

  getStats(): ActionStat[] {
    return Array.from(this.stats.values());
  }

  getStat(cmdMerge: number): ActionStat | undefined {
    return this.stats.get(cmdMerge);
  }

  reset(): void {
    this.stats.clear();
  }
}
