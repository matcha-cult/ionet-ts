import { type RoomRegistry } from './types.js';

export class MemoryRoomRegistry implements RoomRegistry {
  private readonly rooms = new Map<string, Set<string>>();

  async join(roomId: string, userId: string): Promise<void> {
    let members = this.rooms.get(roomId);
    if (!members) {
      members = new Set();
      this.rooms.set(roomId, members);
    }
    members.add(userId);
  }

  async leave(roomId: string, userId: string): Promise<void> {
    const members = this.rooms.get(roomId);
    if (members) {
      members.delete(userId);
      if (members.size === 0) {
        this.rooms.delete(roomId);
      }
    }
  }

  async getMembers(roomId: string): Promise<string[]> {
    const members = this.rooms.get(roomId);
    return members ? Array.from(members) : [];
  }

  getLocalMembers(roomId: string): string[] {
    const members = this.rooms.get(roomId);
    return members ? Array.from(members) : [];
  }

  getRoomIds(): string[] {
    return Array.from(this.rooms.keys());
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  clear(): void {
    this.rooms.clear();
  }
}
