import { type TaskExecutor } from './task-executor.js';
import { SimpleTaskExecutor } from './simple-task-executor.js';

export interface ThreadExecutorRegion {
  getThreadExecutor(index: bigint | number): TaskExecutor;
}

export class SimpleThreadExecutorRegion implements ThreadExecutorRegion {
  private readonly executors: TaskExecutor[];
  private readonly mask: number;

  constructor(poolSize: number, name = 'Simple') {
    const size = SimpleThreadExecutorRegion.nextPowerOfTwo(poolSize);
    this.mask = size - 1;
    this.executors = Array.from({ length: size }, (_, i) =>
      new SimpleTaskExecutor(`${name}-${i}`),
    );
  }

  getThreadExecutor(index: bigint | number): TaskExecutor {
    const idx = typeof index === 'bigint' ? Number(index) : index;
    return this.executors[idx & this.mask]!;
  }

  private static nextPowerOfTwo(n: number): number {
    let v = n - 1;
    v |= v >> 1;
    v |= v >> 2;
    v |= v >> 4;
    v |= v >> 8;
    v |= v >> 16;
    return v + 1;
  }
}
