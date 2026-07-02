import { MemoryBroadcaster } from './memory-broadcaster.js';
import { MemoryConnectionRegistry } from './memory-connection-registry.js';
import { MemoryRoomRegistry } from './memory-room-registry.js';
import { type Broadcaster, type ConnectionRegistry, type RoomRegistry } from './types.js';

export interface BroadcasterFactoryOptions {
  connections?: ConnectionRegistry;
  rooms?: RoomRegistry;
}

export function createMemoryBroadcaster(options: BroadcasterFactoryOptions = {}): {
  broadcaster: Broadcaster;
  connections: ConnectionRegistry;
  rooms: RoomRegistry;
} {
  const connections = options.connections ?? new MemoryConnectionRegistry();
  const rooms = options.rooms ?? new MemoryRoomRegistry();
  const broadcaster = new MemoryBroadcaster(connections, rooms);

  return { broadcaster, connections, rooms };
}
