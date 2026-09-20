export interface BroadcastMessage {
  /** 事件名（与 cmd/subCmd 编码体系并列）。广播信封会原样带上。 */
  type: string;
  data: unknown;
  timestamp: number;
  fromUserId?: string;
  /** 可选：与响应同构的路由 cmd。给出时写入推送信封，便于客户端按 cmd/subCmd 路由。 */
  cmd?: number;
  subCmd?: number;
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

/**
 * RS6：连接上下线观测钩子。对外服实现把 userId 的首次上线/最后一次下线
 * 上报给跨进程连接表；回调可异步，调用方不阻塞连接建立。
 */
export interface ConnectionObserver {
  onUserOnline?(userId: string): void | Promise<void>;
  onUserOffline?(userId: string): void | Promise<void>;
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
