import { createNotificationMessage } from '../protocol/message.js';
import { type Broadcaster, type BroadcastMessage, type ConnectionRegistry, type RoomRegistry } from './types.js';

export class MemoryBroadcaster implements Broadcaster {
  constructor(
    private readonly connections: ConnectionRegistry,
    private readonly rooms: RoomRegistry,
  ) {}

  async broadcastToAll(message: BroadcastMessage): Promise<void> {
    const data = this.encode(message);
    for (const userId of this.connections.getLocalUserIds()) {
      this.sendToLocal(userId, data);
    }
  }

  async broadcastToUser(userId: string, message: BroadcastMessage): Promise<void> {
    this.sendToLocal(userId, this.encode(message));
  }

  async broadcastToUsers(userIds: string[], message: BroadcastMessage): Promise<void> {
    const data = this.encode(message);
    for (const userId of userIds) {
      this.sendToLocal(userId, data);
    }
  }

  async broadcastToRoom(roomId: string, message: BroadcastMessage, excludeUserId?: string): Promise<void> {
    const data = this.encode(message);
    for (const userId of this.rooms.getLocalMembers(roomId)) {
      if (userId !== excludeUserId) {
        this.sendToLocal(userId, data);
      }
    }
  }

  /**
   * P1-3：推送信封由框架统一构造（kind = 'notification'），业务不得自造形状。
   * BroadcastMessage 的 type/timestamp/fromUserId/cmd/subCmd 原样映射进信封。
   */
  private encode(message: BroadcastMessage): string {
    return JSON.stringify(
      createNotificationMessage({
        type: message.type,
        cmd: message.cmd,
        subCmd: message.subCmd,
        data: message.data,
        timestamp: message.timestamp,
        fromUserId: message.fromUserId,
      }),
    );
  }

  private sendToLocal(userId: string, data: string): void {
    const conn = this.connections.getLocalConnection(userId);
    if (conn?.ready) {
      try {
        conn.send(data);
      } catch (error) {
        console.error(`Failed to send to user ${userId}:`, error);
      }
    }
  }
}
