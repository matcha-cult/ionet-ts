import { WebSocketServer, WebSocket } from 'ws';
import { type IncomingMessage, type Server } from 'node:http';
import { type BarSkeleton, createResponseMessage } from '@nbb-ionet/core-framework';
import { BaseExternalServer, type ExternalServerOptions } from '../external-server.js';

/** 握手鉴权入参：Node 原始请求头（值可能为 string[]）、请求 url、Sec-WebSocket-Protocol。 */
export interface WebSocketAuthInput {
  headers: Record<string, string | string[] | undefined>;
  url: string;
  protocol?: string;
}

export interface WebSocketAuthContext {
  userId: bigint;
}

export interface WebSocketExternalServerOptions extends Omit<ExternalServerOptions, 'port'> {
  /** 独立模式：自起 listener 的端口。与 server 互斥，二者须恰有一个（可在 start 时经参数给出 server） */
  port?: number;
  /** attach 模式：挂载到已有 http.Server（如 NestJS 应用的 server）提供 WS upgrade。与 port 互斥 */
  server?: Server;
  path?: string;
  heartbeatInterval?: number;
  /**
   * 可选握手鉴权，默认不配置（未配置时行为与既有完全一致）。
   * 在 upgrade 阶段调用；返回 null 则以 HTTP 401 拒绝升级并输出可诊断日志。
   * 成功时把 userId 绑定到连接（与任务 1 注册表打通），该连接后续每次 execute
   * 的 FlowContext 都会预置该 userId，消费方 WsAuthInOut 可据此删除或降级为兜底。
   */
  authenticate?: (input: WebSocketAuthInput) => Promise<WebSocketAuthContext | null>;
}

interface ClientConnection {
  ws: WebSocket;
  isAlive: boolean;
  userId?: bigint;
}

/** 报文中可由外部服透传到 FlowContext 的字段。 */
interface InboundRequest {
  cmd: number;
  subCmd: number;
  data?: unknown;
  reqId?: string | number;
  headers?: Record<string, string>;
  traceId?: string;
}

type HandshakeVerifier = (
  info: { origin: string; secure: boolean; req: IncomingMessage },
  callback: (res: boolean, code?: number, message?: string) => void,
) => void;

export class WebSocketExternalServer extends BaseExternalServer {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<WebSocket, ClientConnection>();
  /**
   * userId -> 连接集合。与 clients 同步维护，仅承载任务 1 的定向推送索引。
   * 采用「一 userId 多连接」策略：sendTo 向该 userId 的全部 OPEN 连接发送，
   * 只要至少命中一个 OPEN 连接即返回 true（见 sendTo）。
   */
  private readonly userConnections = new Map<bigint, Set<ClientConnection>>();
  /**
   * 握手鉴权通过后暂存 userId，待 'connection' 事件（拿到 ws）时绑定到连接。
   * WeakMap 以 req 为键，连接建立后即删除，避免长期持有请求对象。
   */
  private readonly pendingAuthUserIds = new WeakMap<IncomingMessage, bigint>();
  private readonly wsOptions: WebSocketExternalServerOptions;
  private readonly path: string;
  private readonly heartbeatInterval: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  readonly protocol = 'ws';

  constructor(options: WebSocketExternalServerOptions) {
    if (typeof options.port === 'number' && options.server) {
      throw new Error(
        'WebSocketExternalServer: options.port 与 options.server 互斥（独立模式 / attach 模式），只能给出其一',
      );
    }
    // attach 模式下 port 缺省，基类 getter 返回 -1（语义：无独立端口）
    super({ ...options, port: options.port ?? -1 });
    this.wsOptions = options;
    this.path = options.path ?? '/ws';
    this.heartbeatInterval = options.heartbeatInterval ?? 30000;
  }

  /**
   * 启动 WS 服务。
   * @param server attach 模式延迟注入的 http.Server。NestJS 集成（extension-nestjs）在 DI 工厂阶段
   *        尚拿不到 http.Server（NestApplication 构造晚于 provider 工厂执行），故由其 onModuleInit 传入。
   *        也可在构造 options 时直接给出 server。
   */
  async start(skeleton: BarSkeleton, server?: Server): Promise<void> {
    this.skeleton = skeleton;

    const attachServer = this.wsOptions.server ?? server;
    if (attachServer) {
      if (typeof this.wsOptions.port === 'number') {
        throw new Error(
          'WebSocketExternalServer: options.port 与 attach server 互斥（独立模式 / attach 模式），只能给出其一',
        );
      }
      // attach 模式：共享外部 http.Server，upgrade 监听在 ws 构造时即已挂上。
      // 不得等待 wss 的 'listening'——它转发自共享 server 的 listen 事件，
      // 而 NestJS 的 app.listen() 晚于 onModuleInit，等待会与之死锁。
      this.wss = new WebSocketServer({
        server: attachServer,
        path: this.path,
        ...this.verifyClientOption(),
      });
      this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
      this.startHeartbeat();
      console.log(`WebSocket External Server attached to existing HTTP server at path ${this.path}`);
      return;
    }

    if (typeof this.wsOptions.port !== 'number') {
      throw new Error(
        'WebSocketExternalServer: 无法启动——未给出 options.port（独立模式），也未给出 server / start 参数（attach 模式）',
      );
    }

    // 独立模式：行为与日志保持既有契约不变
    this.wss = new WebSocketServer({
      port: this.wsOptions.port,
      path: this.path,
      ...this.verifyClientOption(),
    });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    this.startHeartbeat();

    return new Promise((resolve) => {
      this.wss!.on('listening', () => {
        console.log(`WebSocket External Server listening on ws://0.0.0.0:${this.wsOptions.port}${this.path}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // 先终止全部客户端连接：wss.close() 在 attach 模式下不关闭共享 http.Server，
    // 只等存量连接自然断开；30s 心跳会持续保活，不主动 terminate 则 stop() 会挂到
    // 宿主进程的强退兜底。独立模式同理（close 同样等待连接结束）。
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.terminate();
      }
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

  /**
   * 构造 ws 的 verifyClient 选项。仅配置 authenticate 时启用；
   * 未配置返回空对象，ws 行为与既有完全一致。
   */
  private verifyClientOption(): { verifyClient?: HandshakeVerifier } {
    const { authenticate } = this.wsOptions;
    if (!authenticate) return {};

    const verifyClient: HandshakeVerifier = (info, callback) => {
      void (async () => {
        try {
          const result = await authenticate({
            headers: info.req.headers,
            url: info.req.url ?? '',
            protocol: this.extractProtocol(info.req),
          });
          if (result && result.userId !== 0n) {
            this.pendingAuthUserIds.set(info.req, result.userId);
            callback(true);
            return;
          }
          console.warn('WebSocket handshake rejected: authenticate returned null');
          callback(false, 401, 'Unauthorized');
        } catch (error) {
          console.error('WebSocket handshake authenticate error:', error);
          callback(false, 401, 'Unauthorized');
        }
      })();
    };

    return { verifyClient };
  }

  private extractProtocol(req: IncomingMessage): string | undefined {
    const raw = req.headers['sec-websocket-protocol'];
    if (Array.isArray(raw)) return raw[0];
    if (typeof raw === 'string') {
      const first = raw.split(',')[0]?.trim();
      return first || undefined;
    }
    return undefined;
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const connection: ClientConnection = { ws, isAlive: true };
    this.clients.set(ws, connection);

    // 握手鉴权成功：连接建立起即把 userId 登记进任务 1 的注册表
    const authedUserId = this.pendingAuthUserIds.get(req);
    if (authedUserId !== undefined) {
      this.pendingAuthUserIds.delete(req);
      this.bindUser(connection, authedUserId);
    }

    ws.on('pong', () => {
      connection.isAlive = true;
    });

    ws.on('message', async (data) => {
      await this.handleMessage(connection, data.toString());
    });

    ws.on('close', () => {
      this.removeConnection(connection);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.removeConnection(connection);
    });
  }

  private async handleMessage(connection: ClientConnection, message: string): Promise<void> {
    const { ws } = connection;
    if (!this.skeleton) return;

    let request: InboundRequest;
    try {
      request = this.codec.decode(message) as InboundRequest;
    } catch {
      ws.send(this.codec.encode({ errorCode: 400, errorMessage: 'Invalid message format' }));
      return;
    }

    try {
      const result = await this.skeleton.execute(
        {
          cmd: request.cmd,
          subCmd: request.subCmd,
          data: request.data,
          // 任务 3：headers/traceId 透传给 FlowContext，Action 内可经
          // ctx.getRequest()?.headers / traceId 读取。
          headers: request.headers,
          traceId: request.traceId,
        },
        {
          // 任务 3：握手鉴权（或上一次 execute）已绑定 userId 时，本次执行前预置到 ctx，
          // 使每次 execute 的 FlowContext 天然带该 userId。
          onFlowContext: (ctx) => {
            if (connection.userId !== undefined) {
              ctx.bindingUserId(connection.userId);
            }
          },
          // 任务 1：Action / inOut 在 execute 期间通过 ctx.bindingUserId(...) 绑定的 userId，
          // 执行结束时经 onBound 回传，唯一合法赋值点在此登记到连接注册表。
          onBound: (userId) => this.bindUser(connection, userId),
        },
      );

      // 任务 2：回显 reqId；仅在新协议（请求带 reqId）下写入 kind='response'，
      // 未带 reqId 的旧客户端响应逐字节不变（reqId/kind 均不出现）。
      const response = createResponseMessage({
        ...result,
        reqId: request.reqId,
        kind: request.reqId === undefined ? undefined : 'response',
      });
      ws.send(this.codec.encode(response));
    } catch (error) {
      ws.send(this.codec.encode({ errorCode: 500, errorMessage: 'Internal error' }));
    }
  }

  /** userId === 0n 不绑定；重复绑定同一 userId 幂等；改绑先解绑旧项。 */
  private bindUser(connection: ClientConnection, userId: bigint): void {
    if (userId === 0n) return;
    if (connection.userId === userId) return;
    if (connection.userId !== undefined) {
      this.detachUser(connection);
    }
    connection.userId = userId;
    let set = this.userConnections.get(userId);
    if (!set) {
      set = new Set();
      this.userConnections.set(userId, set);
    }
    set.add(connection);
  }

  private detachUser(connection: ClientConnection): void {
    const { userId } = connection;
    if (userId === undefined) return;
    const set = this.userConnections.get(userId);
    if (set) {
      set.delete(connection);
      if (set.size === 0) {
        this.userConnections.delete(userId);
      }
    }
    connection.userId = undefined;
  }

  /** close / error / 心跳踢除的统一清理入口：注册表与连接表一并移除。 */
  private removeConnection(connection: ClientConnection): void {
    this.detachUser(connection);
    this.clients.delete(connection.ws);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const stale: ClientConnection[] = [];
      for (const connection of this.clients.values()) {
        if (!connection.isAlive) {
          stale.push(connection);
          continue;
        }
        connection.isAlive = false;
        connection.ws.ping();
      }
      for (const connection of stale) {
        connection.ws.terminate();
        this.removeConnection(connection);
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

  /**
   * 定向推送。策略（任务 1 锁定）：向该 userId 的**全部** OPEN 连接发送，
   * 至少命中一个 OPEN 连接即返回 true；userId === 0n 或未绑定/无 OPEN 连接返回 false（不抛错）。
   */
  sendTo(userId: bigint, message: unknown): boolean {
    if (userId === 0n) return false;
    const connections = this.userConnections.get(userId);
    if (!connections || connections.size === 0) return false;

    const encoded = this.codec.encode(message);
    let delivered = false;
    for (const connection of connections) {
      if (connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.send(encoded);
        delivered = true;
      }
    }
    return delivered;
  }

  get clientCount(): number {
    return this.clients.size;
  }
}
