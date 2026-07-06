export class TimingWheel {
  private slots: Map<number, Set<string>> = new Map();
  private tickInterval: NodeJS.Timeout | null = null;
  private readonly tickMs: number;
  private onTick: (playerIds: string[]) => void;

  constructor(tickMs: number = 100, onTick: (playerIds: string[]) => void) {
    this.tickMs = tickMs;
    this.onTick = onTick;
  }

  start(): void {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  schedule(playerId: string, executeAt: number): void {
    const slot = Math.floor(executeAt / this.tickMs);
    if (!this.slots.has(slot)) {
      this.slots.set(slot, new Set());
    }
    this.slots.get(slot)!.add(playerId);
  }

  remove(playerId: string, executeAt: number): void {
    const slot = Math.floor(executeAt / this.tickMs);
    const players = this.slots.get(slot);
    if (players) {
      players.delete(playerId);
      if (players.size === 0) {
        this.slots.delete(slot);
      }
    }
  }

  private tick(): void {
    const now = Date.now();
    const currentSlot = Math.floor(now / this.tickMs);

    const players = this.slots.get(currentSlot);
    if (!players || players.size === 0) {
      return;
    }

    this.slots.delete(currentSlot);
    this.onTick(Array.from(players));
  }
}
