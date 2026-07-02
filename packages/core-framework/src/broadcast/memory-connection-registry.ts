import { type Connection, type ConnectionRegistry } from './types.js';

export class MemoryConnectionRegistry implements ConnectionRegistry {
  private readonly connections = new Map<string, Connection>();

  register(userId: string, connection: Connection): void {
    this.connections.set(userId, connection);
  }

  unregister(userId: string): void {
    this.connections.delete(userId);
  }

  getLocalUserIds(): string[] {
    return Array.from(this.connections.keys());
  }

  isLocalUser(userId: string): boolean {
    return this.connections.has(userId);
  }

  getLocalConnection(userId: string): Connection | undefined {
    return this.connections.get(userId);
  }

  getLocalCount(): number {
    return this.connections.size;
  }

  clear(): void {
    this.connections.clear();
  }
}
