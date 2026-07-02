import { type Broadcaster, type BroadcastMessage, type ConnectionRegistry, type RoomRegistry } from './types.js';

export class MemoryBroadcaster implements Broadcaster {
  constructor(
    private readonly connections: ConnectionRegistry,
    private readonly rooms: RoomRegistry,
  ) {}

  async broadcastToAll(message: BroadcastMessage): Promise<void> {
    const data = JSON.stringify(message);
    for (const userId of this.connections.getLocalUserIds()) {
      this.sendToLocal(userId, data);
    }
  }

  async broadcastToUser(userId: string, message: BroadcastMessage): Promise<void> {
    this.sendToLocal(userId, JSON.stringify(message));
  }

  async broadcastToUsers(userIds: string[], message: BroadcastMessage): Promise<void> {
    const data = JSON.stringify(message);
    for (const userId of userIds) {
      this.sendToLocal(userId, data);
    }
  }

  async broadcastToRoom(roomId: string, message: BroadcastMessage, excludeUserId?: string): Promise<void> {
    const data = JSON.stringify(message);
    for (const userId of this.rooms.getLocalMembers(roomId)) {
      if (userId !== excludeUserId) {
        this.sendToLocal(userId, data);
      }
    }
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
