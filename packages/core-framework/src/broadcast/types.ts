export interface BroadcastMessage {
  type: string;
  data: unknown;
  timestamp: number;
  fromUserId?: string;
}

export interface Connection {
  readonly id: string;
  readonly ready: boolean;
  send(data: string): void;
  close(): void;
}

export interface ConnectionRegistry {
  register(userId: string, connection: Connection): void;
  unregister(userId: string): void;
  getLocalUserIds(): string[];
  isLocalUser(userId: string): boolean;
  getLocalConnection(userId: string): Connection | undefined;
}

export interface RoomRegistry {
  join(roomId: string, userId: string): Promise<void>;
  leave(roomId: string, userId: string): Promise<void>;
  getMembers(roomId: string): Promise<string[]>;
  getLocalMembers(roomId: string): string[];
}

export interface Broadcaster {
  broadcastToAll(message: BroadcastMessage): Promise<void>;
  broadcastToUser(userId: string, message: BroadcastMessage): Promise<void>;
  broadcastToUsers(userIds: string[], message: BroadcastMessage): Promise<void>;
  broadcastToRoom(roomId: string, message: BroadcastMessage, excludeUserId?: string): Promise<void>;
}
