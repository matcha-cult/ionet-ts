import { type ThreadExecutorRegion } from './thread-executor-region.js';
import { SimpleThreadExecutorRegion } from './thread-executor-region.js';
import { type TaskExecutor } from './task-executor.js';

export interface ExecutorRegion {
  getUserThreadExecutorRegion(): ThreadExecutorRegion;
  getSimpleThreadExecutorRegion(): ThreadExecutorRegion;
  getUserThreadExecutor(index: bigint | number): TaskExecutor;
  getSimpleThreadExecutor(index: bigint | number): TaskExecutor;
}

export class DefaultExecutorRegion implements ExecutorRegion {
  private readonly userRegion: ThreadExecutorRegion;
  private readonly simpleRegion: ThreadExecutorRegion;

  constructor(poolSize = 4) {
    this.userRegion = new SimpleThreadExecutorRegion(poolSize, 'User');
    this.simpleRegion = new SimpleThreadExecutorRegion(poolSize, 'Simple');
  }

  getUserThreadExecutorRegion(): ThreadExecutorRegion {
    return this.userRegion;
  }

  getSimpleThreadExecutorRegion(): ThreadExecutorRegion {
    return this.simpleRegion;
  }

  getUserThreadExecutor(index: bigint | number): TaskExecutor {
    return this.userRegion.getThreadExecutor(index);
  }

  getSimpleThreadExecutor(index: bigint | number): TaskExecutor {
    return this.simpleRegion.getThreadExecutor(index);
  }
}

export const executorRegionKit: ExecutorRegion = new DefaultExecutorRegion();
