import { WebSocketServer, WebSocket } from 'ws';
import { type BarSkeleton, createResponseMessage } from '@nbb-ionet/core-framework';
import { BaseExternalServer, type ExternalServerOptions } from '../external-server.js';

export interface WebSocketExternalServerOptions extends ExternalServerOptions {
  path?: string;
  heartbeatInterval?: number;
}

interface ClientConnection {
  ws: WebSocket;
  isAlive: boolean;
  userId?: bigint;
}

export class WebSocketExternalServer extends BaseExternalServer {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<WebSocket, ClientConnection>();
  private readonly path: string;
  private readonly heartbeatInterval: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  readonly protocol = 'ws';

  constructor(options: WebSocketExternalServerOptions) {
    super(options);
    this.path = options.path ?? '/ws';
    this.heartbeatInterval = options.heartbeatInterval ?? 30000;
  }

  async start(skeleton: BarSkeleton): Promise<void> {
    this.skeleton = skeleton;
    this.wss = new WebSocketServer({ port: this.options.port, path: this.path });

    this.wss.on('connection', (ws) => this.handleConnection(ws));
    this.startHeartbeat();

    return new Promise((resolve) => {
      this.wss!.on('listening', () => {
        console.log(`WebSocket External Server listening on ws://0.0.0.0:${this.options.port}${this.path}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    return new Promise((resolve, reject) => {
      if (!this.wss) {
        resolve();
        return;
      }
      this.wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private handleConnection(ws: WebSocket): void {
    const connection: ClientConnection = { ws, isAlive: true };
    this.clients.set(ws, connection);

    ws.on('pong', () => {
      connection.isAlive = true;
    });

    ws.on('message', async (data) => {
      await this.handleMessage(ws, data.toString());
    });

    ws.on('close', () => {
      this.clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.clients.delete(ws);
    });
  }

  private async handleMessage(ws: WebSocket, message: string): Promise<void> {
    if (!this.skeleton) return;

    let request: { cmd: number; subCmd: number; data?: unknown };
    try {
      request = this.codec.decode(message) as { cmd: number; subCmd: number; data?: unknown };
    } catch {
      ws.send(this.codec.encode({ errorCode: 400, errorMessage: 'Invalid message format' }));
      return;
    }

    try {
      const result = await this.skeleton.execute({
        cmd: request.cmd,
        subCmd: request.subCmd,
        data: request.data,
      });

      const response = createResponseMessage(result);
      ws.send(this.codec.encode(response));
    } catch (error) {
      ws.send(this.codec.encode({ errorCode: 500, errorMessage: 'Internal error' }));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [ws, connection] of this.clients.entries()) {
        if (!connection.isAlive) {
          ws.terminate();
          this.clients.delete(ws);
          continue;
        }
        connection.isAlive = false;
        ws.ping();
      }
    }, this.heartbeatInterval);
  }

  broadcast(message: unknown, exclude?: WebSocket): void {
    const encoded = this.codec.encode(message);
    for (const [ws] of this.clients.entries()) {
      if (ws !== exclude && ws.readyState === WebSocket.OPEN) {
        ws.send(encoded);
      }
    }
  }

  sendTo(userId: bigint, message: unknown): boolean {
    const encoded = this.codec.encode(message);
    for (const [, connection] of this.clients.entries()) {
      if (connection.userId === userId && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(encoded);
        return true;
      }
    }
    return false;
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
