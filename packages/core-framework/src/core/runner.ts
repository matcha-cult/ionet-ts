export interface Runner {
  startup(): Promise<void>;
  shutdown(): Promise<void>;
}

export class Runners {
  private readonly runners: Runner[] = [];

  add(runner: Runner): this {
    this.runners.push(runner);
    return this;
  }

  async startup(): Promise<void> {
    for (const runner of this.runners) {
      await runner.startup();
    }
  }

  async shutdown(): Promise<void> {
    for (const runner of [...this.runners].reverse()) {
      await runner.shutdown();
    }
  }

  get size(): number {
    return this.runners.length;
  }
}

export class CallbackRunner implements Runner {
  constructor(
    private readonly onStart: () => Promise<void> | void,
    private readonly onStop: () => Promise<void> | void = async () => {},
  ) {}

  async startup(): Promise<void> {
    await this.onStart();
  }

  async shutdown(): Promise<void> {
    await this.onStop();
  }
}
