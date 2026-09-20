import type { GameResult, Player, RoomState, UserId } from '../types/index.js';
import { userIdKey } from '../types/index.js';

/**
 * Base room: player membership lifecycle and state transitions. Subclasses
 * implement join/leave hooks and (optionally) a broadcast sink.
 */
export abstract class AbstractRoom {
  protected readonly players = new Map<string, Player>();
  protected state: RoomState = 'waiting';

  /** Invoked when a player joins. */
  protected abstract onPlayerJoin(player: Player): void | Promise<void>;

  /** Invoked when a player leaves. */
  protected abstract onPlayerLeave(player: Player): void | Promise<void>;

  /** Invoked when the game starts. Default no-op. */
  protected onGameStart(): void | Promise<void> {
    return undefined;
  }

  /** Invoked when the game ends. Default no-op. */
  protected onGameEnd(result: GameResult): void | Promise<void> {
    return undefined;
  }

  /** Default broadcast sink. Override to fan out to real connections. */
  protected broadcast(message: unknown): void | Promise<void> {
    return undefined;
  }

  get playerCount(): number {
    return this.players.size;
  }

  getPlayerList(): Player[] {
    return [...this.players.values()];
  }

  getState(): RoomState {
    return this.state;
  }

  hasPlayer(playerId: UserId): boolean {
    return this.players.has(userIdKey(playerId));
  }

  async join(player: Player): Promise<void> {
    this.players.set(userIdKey(player.id), player);
    await this.onPlayerJoin(player);
  }

  async leave(playerId: UserId): Promise<Player | null> {
    const key = userIdKey(playerId);
    const player = this.players.get(key);
    if (!player) return null;
    this.players.delete(key);
    await this.onPlayerLeave(player);
    return player;
  }

  /** Publish a message to every player via {@link broadcast}. */
  async sendToRoom(message: unknown): Promise<void> {
    await this.broadcast(message);
  }

  protected async startGame(): Promise<void> {
    this.state = 'playing';
    await this.onGameStart();
  }

  protected async endGame(result: GameResult): Promise<void> {
    this.state = 'ended';
    await this.onGameEnd(result);
  }
}
