import { describe, it, expect, beforeEach } from 'vitest';
import { AbstractRoom } from './abstract-room.js';
import type { GameResult, Player } from '../types/index.js';

class ChatRoom extends AbstractRoom {
  events: string[] = [];
  messages: unknown[] = [];

  protected async onPlayerJoin(player: Player): Promise<void> {
    this.events.push('join:' + player.name);
  }

  protected async onPlayerLeave(player: Player): Promise<void> {
    this.events.push('leave:' + player.name);
  }

  protected async onGameStart(): Promise<void> {
    this.events.push('start');
  }

  protected async onGameEnd(result: GameResult): Promise<void> {
    this.events.push('end:' + result.winners.length);
  }

  protected async broadcast(message: unknown): Promise<void> {
    this.messages.push(message);
  }

  async begin(): Promise<void> {
    await this.startGame();
  }

  async finish(result: GameResult): Promise<void> {
    await this.endGame(result);
  }
}

describe('AbstractRoom', () => {
  let room: ChatRoom;

  beforeEach(() => {
    room = new ChatRoom();
  });

  it('tracks player membership lifecycle', async () => {
    const alice: Player = { id: 'u1', name: 'alice' };
    await room.join(alice);

    expect(room.playerCount).toBe(1);
    expect(room.hasPlayer('u1')).toBe(true);
    expect(room.getPlayerList()).toEqual([alice]);

    const left = await room.leave('u1');

    expect(left).toEqual(alice);
    expect(room.playerCount).toBe(0);
    expect(room.hasPlayer('u1')).toBe(false);
  });

  it('fires join/leave hooks', async () => {
    await room.join({ id: 'u1', name: 'alice' });
    await room.leave('u1');

    expect(room.events).toEqual(['join:alice', 'leave:alice']);
  });

  it('transitions state through start and end', async () => {
    await room.join({ id: 'u1', name: 'alice' });
    expect(room.getState()).toBe('waiting');

    await room.begin();
    expect(room.getState()).toBe('playing');

    await room.finish({ winners: [{ id: 'u1', name: 'alice' }], losers: [] });
    expect(room.getState()).toBe('ended');
    expect(room.events).toEqual(['join:alice', 'start', 'end:1']);
  });

  it('broadcasts messages via the sink', async () => {
    await room.sendToRoom({ hello: 'world' });
    expect(room.messages).toEqual([{ hello: 'world' }]);
  });
});
