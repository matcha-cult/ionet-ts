import { describe, it, expect, beforeEach } from 'vitest';
import { AbstractGameRoom } from './abstract-game-room.js';
import type { GameResult, Player } from '../types/index.js';
import { userIdKey } from '../types/index.js';

class WinAfterTwoTurns extends AbstractGameRoom {
  protected async playTurn(player: Player, action: unknown): Promise<GameResult | null> {
    if (this.turnNumber >= 1) {
      return {
        winners: [player],
        losers: this.getPlayerList().filter(
          (candidate) => userIdKey(candidate.id) !== userIdKey(player.id),
        ),
      };
    }
    return null;
  }

  protected async onPlayerJoin(player: Player): Promise<void> {
    // no-op
  }

  protected async onPlayerLeave(player: Player): Promise<void> {
    // no-op
  }
}

describe('AbstractGameRoom', () => {
  let room: WinAfterTwoTurns;

  beforeEach(() => {
    room = new WinAfterTwoTurns();
  });

  it('refuses to start without enough players', async () => {
    await room.join({ id: 'u1', name: 'alice' });

    expect(await room.start()).toBe(false);
    expect(room.getState()).toBe('waiting');
  });

  it('starts once the minimum player count is met', async () => {
    await room.join({ id: 'u1', name: 'alice' });
    await room.join({ id: 'u2', name: 'bob' });

    expect(await room.start()).toBe(true);
    expect(room.getState()).toBe('playing');
    expect(room.turnNumber).toBe(0);
    expect(room.getCurrentPlayerId()).toBe('u1');
  });

  it('plays turns, advances order, and resolves a winner', async () => {
    await room.join({ id: 'u1', name: 'alice' });
    await room.join({ id: 'u2', name: 'bob' });
    await room.start();

    const first = await room.nextTurn('u1', 'act');
    expect(first).toBeNull();
    expect(room.turnNumber).toBe(1);
    expect(room.getCurrentPlayerId()).toBe('u2');

    const second = await room.nextTurn('u2', 'act');
    expect(second?.winners[0]?.id).toBe('u2');
    expect(room.getState()).toBe('ended');
    expect(room.turnNumber).toBe(2);
  });

  it('rejects turns outside an active game', async () => {
    await room.join({ id: 'u1', name: 'alice' });
    await room.join({ id: 'u2', name: 'bob' });

    await expect(room.nextTurn('u1', 'act')).rejects.toThrow('Game is not playing');
  });

  it('rejects turns from players not in the room', async () => {
    await room.join({ id: 'u1', name: 'alice' });
    await room.join({ id: 'u2', name: 'bob' });
    await room.start();

    await expect(room.nextTurn('u3', 'act')).rejects.toThrow('Player not in room');
  });
});
