export const IPC_CHANNELS = {
  BROADCAST: 'ionet:broadcast',
  USER_MESSAGE: 'ionet:user',
  ROOM_MESSAGE: 'ionet:room',
  ROOM_EVENT: 'ionet:room:event',
  INSTANCE_EVENT: 'ionet:instance',
} as const;

export interface IpcMessage {
  sourceInstanceId: string;
  type: string;
  payload: unknown;
  timestamp: number;
}

export interface BroadcastPayload {
  data: unknown;
  excludeUserId?: bigint;
}

export interface UserMessagePayload {
  userId: string;
  data: unknown;
}

export interface RoomMessagePayload {
  roomId: string;
  senderId?: string;
  data: unknown;
}

export interface RoomEventPayload {
  roomId: string;
  userId: string;
  event: 'join' | 'leave' | 'destroy';
}

export interface InstanceEventPayload {
  instanceId: string;
  event: 'online' | 'offline';
  metadata?: Record<string, unknown>;
}

export function createIpcMessage(
  sourceInstanceId: string,
  type: string,
  payload: unknown,
): IpcMessage {
  return {
    sourceInstanceId,
    type,
    payload,
    timestamp: Date.now(),
  };
}
