import { type TaskExecutor } from './task-executor.js';

export class SimpleTaskExecutor implements TaskExecutor {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  execute(task: () => void | Promise<void>): void {
    queueMicrotask(() => {
      void task();
    });
  }
}
