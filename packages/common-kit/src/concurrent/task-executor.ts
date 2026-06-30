export interface TaskExecutor {
  readonly name: string;
  execute(task: () => void | Promise<void>): void;
}
