import type { Player } from './player.js';

export type RoomState = 'waiting' | 'playing' | 'ended';

export interface GameResult {
  winners: Player[];
  losers: Player[];
  payload?: Record<string, unknown>;
}
