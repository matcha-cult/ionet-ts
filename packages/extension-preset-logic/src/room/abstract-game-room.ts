import type { GameResult, Player, UserId } from '../types/index.js';
import { userIdKey } from '../types/index.js';
import { AbstractRoom } from './abstract-room.js';

/**
 * Turn-based game room: adds player-count gating, turn ordering, and win/lose
 * resolution on top of {@link AbstractRoom}.
 */
export abstract class AbstractGameRoom extends AbstractRoom {
  protected turn = 0;
  protected currentPlayerId: UserId | null = null;

  /** Minimum players required to start. */
  protected get minPlayers(): number {
    return 2;
  }

  /**
   * Process one player's action. Return a {@link GameResult} to end the game,
   * or null to keep playing.
   */
  protected abstract playTurn(player: Player, action: unknown): Promise<GameResult | null>;

  get turnNumber(): number {
    return this.turn;
  }

  getCurrentPlayerId(): UserId | null {
    return this.currentPlayerId;
  }

  /** Start the game when the room has enough players. */
  async start(): Promise<boolean> {
    if (this.players.size < this.minPlayers) {
      return false;
    }
    await this.startGame();
    this.turn = 0;
    this.currentPlayerId = this.getPlayerList()[0]?.id ?? null;
    return true;
  }

  /** Apply one action. Returns a {@link GameResult} if the game just ended. */
  async nextTurn(playerId: UserId, action: unknown): Promise<GameResult | null> {
    if (this.state !== 'playing') {
      throw new Error('Game is not playing');
    }
    const player = this.players.get(userIdKey(playerId));
    if (!player) {
      throw new Error('Player not in room');
    }

    const result = await this.playTurn(player, action);
    this.turn += 1;

    if (result) {
      await this.endGame(result);
      return result;
    }

    this.advanceTurn(playerId);
    return null;
  }

  /** Move the current-player marker to the next seat. */
  protected advanceTurn(afterPlayerId: UserId): void {
    const list = this.getPlayerList();
    if (list.length === 0) {
      this.currentPlayerId = null;
      return;
    }
    const index = list.findIndex((player) => userIdKey(player.id) === userIdKey(afterPlayerId));
    const next = list[(index + 1) % list.length];
    this.currentPlayerId = next.id;
  }
}
