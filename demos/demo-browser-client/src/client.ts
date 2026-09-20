/**
 * ionet 浏览器参考客户端核心（零依赖 · 仅 Web 平台原生能力）
 *
 * 红线：本包源码不得 import 框架 workspace 包（其核心运行时依赖 Node 内置 async_hooks
 * 模块，浏览器加载即炸），也不得引用任何 Node 内置模块。
 * 本文件只使用平台原生 API：WebSocket、fetch、crypto.randomUUID、setTimeout 等。
 * 线协议语义以仓库根 PROTOCOL.md（§1–§12）为唯一真相：
 *   §1 连接 /ws   §3 请求信封   §4 响应信封与 reqId 配对   §5 推送分流
 *   §6 握手鉴权 ?token=   §7 应用层心跳   §8 错误语义   §9 HTTP fallback
 */

/** 响应/推送判别（PROTOCOL §4/§5）。 */
export type ResponseKind = 'response' | 'notification';

/** 请求信封（PROTOCOL §3）。 */
export interface RequestEnvelope {
  cmd: number;
  subCmd: number;
  data?: unknown;
  headers?: Record<string, string>;
  traceId?: string;
  /** string | number；服务端仅当请求携带时才在响应中回显（PROTOCOL §4.1）。 */
  reqId?: string | number;
}

/** 响应信封（PROTOCOL §4）。errorCode 缺失/0 = 成功，>=400 = 失败（§8）。 */
export interface ResponseEnvelope {
  data?: unknown;
  errorCode?: number;
  errorMessage?: string;
  headers?: Record<string, string>;
  reqId?: string | number;
  kind?: ResponseKind;
}

/** 推送信封（PROTOCOL §5）。客户端据 kind 分流，未知字段忽略。 */
export interface NotificationEnvelope {
  kind: 'notification';
  type?: string;
  cmd?: number;
  subCmd?: number;
  data?: unknown;
  timestamp?: number;
  headers?: Record<string, string>;
  reqId?: string | number;
  fromUserId?: string;
}

export type IonetFrame = ResponseEnvelope | NotificationEnvelope;

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed'
  | 'error';

export interface HeartbeatOptions {
  cmd: number;
  subCmd: number;
  intervalMs: number;
}

export interface ReconnectOptions {
  enabled?: boolean;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export interface IonetClientOptions {
  /** WS 端点，如 ws://localhost:8081/ws（PROTOCOL §1）。 */
  url: string;
  /** 握手凭据。浏览器无法设置 WS 请求头，客户端追加为 ?token=（PROTOCOL §6）。 */
  token?: string;
  /** 应用层心跳（PROTOCOL §7）；false 关闭。默认 (1,1) / 15s。 */
  heartbeat?: HeartbeatOptions | false;
  /** 断线自动重连；重连会重新携带（可能已更换的）token。 */
  reconnect?: ReconnectOptions;
  /** 请求超时（毫秒），默认 10000。 */
  requestTimeoutMs?: number;
  /** 推送帧回调（PROTOCOL §5：kind=notification 一律不进响应配对）。 */
  onNotification?: (notification: NotificationEnvelope) => void;
  onStateChange?: (state: ConnectionState, detail?: string) => void;
  log?: (...args: unknown[]) => void;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  traceId?: string;
  timeoutMs?: number;
}

export interface HttpRequestOptions {
  /** HTTP 通道凭据（PROTOCOL §6 Authorization: Bearer）。 */
  bearerToken?: string;
}

export function isSuccess(response: ResponseEnvelope): boolean {
  return response.errorCode === undefined || response.errorCode === 0;
}

interface PendingEntry {
  resolve: (response: ResponseEnvelope) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  cmd: number;
  subCmd: number;
  startedAt: number;
}

const DEFAULT_HEARTBEAT: HeartbeatOptions = { cmd: 1, subCmd: 1, intervalMs: 15_000 };

/** 应用层心跳缺省路由（PROTOCOL §7 建议复用 system 段 ping Action，可按服务端实际路由覆盖）。 */
export const DEFAULT_HEARTBEAT_ROUTE = { cmd: 1, subCmd: 1 } as const;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_RECONNECT = { enabled: true, minDelayMs: 500, maxDelayMs: 30_000 };

let uidSeq = 0;
function makeReqId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  uidSeq += 1;
  return `r-${Date.now().toString(36)}-${uidSeq}`;
}

export class BrowserIonetClient {
  private readonly baseUrl: string;
  private readonly heartbeatOptions: HeartbeatOptions | false;
  private readonly reconnectOptions: { enabled: boolean; minDelayMs: number; maxDelayMs: number };
  private readonly requestTimeoutMs: number;
  private readonly onNotificationCb?: (notification: NotificationEnvelope) => void;
  private readonly onStateChangeCb?: (state: ConnectionState, detail?: string) => void;
  private readonly logCb?: (...args: unknown[]) => void;

  private token: string;
  private ws: WebSocket | null = null;
  private pending = new Map<string | number, PendingEntry>();
  private pendingOrder: Array<string | number> = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectPromise: { resolve: () => void; reject: (reason: Error) => void } | null = null;
  private reconnectAttempt = 0;
  private closeRequested = false;
  private state: ConnectionState = 'idle';

  /** 应用层心跳观测（PROTOCOL §7）：收到回执帧的次数与最近回执时间/错误码。 */
  heartbeatCount = 0;
  lastHeartbeatAckAt: number | null = null;
  lastHeartbeatErrorCode: number | undefined;

  constructor(options: IonetClientOptions) {
    this.baseUrl = options.url;
    this.token = options.token ?? '';
    this.heartbeatOptions = options.heartbeat === false ? false : { ...DEFAULT_HEARTBEAT, ...(options.heartbeat ?? {}) };
    this.reconnectOptions = { ...DEFAULT_RECONNECT, ...(options.reconnect ?? {}) };
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.onNotificationCb = options.onNotification;
    this.onStateChangeCb = options.onStateChange;
    this.logCb = options.log;
  }

  getState(): ConnectionState {
    return this.state;
  }

  getToken(): string {
    return this.token;
  }

  /** 更换 token；若已连接则断开走自动重连，重连会重新携带新 token（PROTOCOL §6）。 */
  setToken(token: string): void {
    this.token = token;
    if (this.ws !== null && this.state === 'open') {
      this.log('token 已更换，断开并以新 token 重连');
      this.closeRequested = false;
      this.ws.close(1000, 're-auth');
    }
  }

  /** 建立连接：resolve = 握手成功进入 open；reject = 握手被拒（如 401）或网络失败。 */
  connect(): Promise<void> {
    if (this.ws !== null) {
      throw new Error('client already connected (state=' + this.state + ')');
    }
    this.closeRequested = false;
    this.setState('connecting');
    return new Promise<void>((resolve, reject) => {
      this.connectPromise = { resolve, reject };
      const url = this.buildWsUrl();
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (error) {
        this.connectPromise = null;
        this.setState('error', '无法创建 WebSocket（地址无效：' + url + '）');
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.ws = socket;

      socket.onopen = () => {
        this.reconnectAttempt = 0;
        this.setState('open');
        this.startHeartbeat();
        this.connectPromise?.resolve();
        this.connectPromise = null;
      };

      socket.onmessage = (event) => {
        this.handleFrame(event.data);
      };

      socket.onerror = () => {
        const tokenHint = this.token === '' ? '；服务端会以 HTTP 401 拒绝无 token 的握手（PROTOCOL §6）——请先填入 token' : '';
        this.setState('error', '握手或连接错误' + tokenHint);
      };

      socket.onclose = (event) => {
        this.ws = null;
        this.stopHeartbeat();
        const wasOpen = this.state === 'open';
        if (this.closeRequested) {
          this.setState('closed');
        } else {
          this.failAllPending(new Error(`连接已断开（closeCode=${event.code}）`));
          if (this.connectPromise !== null) {
            const hint = this.token === ''
              ? '；服务端会以 HTTP 401 拒绝无 token 的握手（PROTOCOL §6）——请先填入 token'
              : '';
            const error = new Error(`握手被拒或连接失败（closeCode=${event.code}）${hint}`);
            this.connectPromise.reject(error);
            this.connectPromise = null;
          } else if (wasOpen) {
            this.scheduleReconnect();
          }
        }
      };
    });
  }

  /** 主动关闭：停止心跳/重连，发送 close 帧。 */
  close(): void {
    this.closeRequested = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.failAllPending(new Error('client closed'));
    if (this.ws !== null) {
      try {
        this.ws.close(1000, 'client close');
      } catch {
        // WebSocket.close 在 CONNECTING 阶段抛错时忽略，交由 onclose 收尾
      }
    } else {
      this.setState('closed');
    }
  }

  /**
   * 发送请求并按 reqId 精确配对响应（PROTOCOL §4.1），支持并发在途。
   * 对响应 envelope 的判定：errorCode 缺失/0 = 成功，否则按 §8 语义处理（调用方决定）。
   */
  request(cmd: number, subCmd: number, data?: unknown, options?: RequestOptions): Promise<ResponseEnvelope> {
    const socket = this.ws;
    if (socket === null || this.state !== 'open') {
      return Promise.reject(new Error('client not connected (state=' + this.state + ')'));
    }
    const reqId = makeReqId();
    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
    const frame: RequestEnvelope = { cmd, subCmd, reqId, ...(data !== undefined ? { data } : {}) };
    if (options?.headers !== undefined) frame.headers = options.headers;
    if (options?.traceId !== undefined) frame.traceId = options.traceId;

    return new Promise<ResponseEnvelope>((resolve, reject) => {
      const entry: PendingEntry = {
        resolve,
        reject,
        cmd,
        subCmd,
        startedAt: Date.now(),
        timer: setTimeout(() => {
          this.settle(reqId, new Error(`请求超时（${cmd},${subCmd} reqId=${reqId}，${timeoutMs}ms）`));
        }, timeoutMs),
      };
      this.pending.set(reqId, entry);
      this.pendingOrder.push(reqId);
      try {
        socket.send(JSON.stringify(frame));
      } catch (error) {
        this.settle(reqId, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * HTTP fallback 通道（PROTOCOL §9）：POST {prefix}/{cmd}/{subCmd}。
   * 注意：HTTP 通道不产生 reqId/kind，无请求配对语义；状态码 = errorCode>=400 ? errorCode : 200。
   */
  async requestHttp(
    httpBaseUrl: string,
    cmd: number,
    subCmd: number,
    data?: unknown,
    options?: HttpRequestOptions
  ): Promise<ResponseEnvelope> {
    const base = httpBaseUrl.replace(/\/$/, '');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options?.bearerToken !== undefined && options.bearerToken !== '') {
      headers['Authorization'] = `Bearer ${options.bearerToken}`;
    }
    let response: Response;
    try {
      response = await fetch(`${base}/${cmd}/${subCmd}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(data === undefined ? {} : { data }),
      });
    } catch (error) {
      throw new Error('HTTP fallback 请求失败：' + (error instanceof Error ? error.message : String(error)));
    }
    const text = await response.text();
    let envelope: ResponseEnvelope;
    try {
      envelope = text === '' ? {} : (JSON.parse(text) as ResponseEnvelope);
    } catch {
      return { errorCode: response.status, errorMessage: text.slice(0, 200) };
    }
    if (response.status >= 400 && envelope.errorCode === undefined) {
      envelope.errorCode = response.status;
    }
    return envelope;
  }

  private buildWsUrl(): string {
    if (this.token === '') return this.baseUrl;
    const separator = this.baseUrl.includes('?') ? '&' : '?';
    return `${this.baseUrl}${separator}token=${encodeURIComponent(this.token)}`;
  }

  private handleFrame(raw: unknown): void {
    if (typeof raw !== 'string') {
      this.log('忽略非文本帧（', typeof raw, '）——默认 codec 为 UTF-8 JSON 文本帧（PROTOCOL §1/§2）');
      return;
    }
    let frame: IonetFrame;
    try {
      frame = JSON.parse(raw) as IonetFrame;
    } catch {
      this.log('忽略无法解析的帧：', raw.slice(0, 200));
      return;
    }
    // §5 推送分流：kind=notification 一律走推送渲染，不当作任何请求的响应（即使携带 reqId）。
    if (frame.kind === 'notification') {
      this.onNotificationCb?.(frame as NotificationEnvelope);
      return;
    }
    const response = frame as ResponseEnvelope;
    const reqId = response.reqId;
    if (reqId !== undefined && this.pending.has(reqId)) {
      this.settle(reqId, response); // 新协议：按 reqId 精确配对
      return;
    }
    if (reqId === undefined && this.pendingOrder.length > 0) {
      // 旧服务回退：响应不带 reqId（PROTOCOL §4 逐字节旧行为）→ 按「最早在途」配对
      const oldest = this.pendingOrder[0]!;
      this.log(`响应不带 reqId，按最早在途回退配对 → (${this.pending.get(oldest)?.cmd},${this.pending.get(oldest)?.subCmd})`);
      this.settle(oldest, response);
      return;
    }
    this.log('无法配对的响应帧：', raw.slice(0, 200));
  }

  private settle(reqId: string | number, result: ResponseEnvelope | Error): void {
    const entry = this.pending.get(reqId);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    this.pending.delete(reqId);
    const index = this.pendingOrder.indexOf(reqId);
    if (index >= 0) this.pendingOrder.splice(index, 1);
    if (result instanceof Error) entry.reject(result);
    else entry.resolve(result);
  }

  private startHeartbeat(): void {
    if (this.heartbeatOptions === false || this.heartbeatTimer !== null) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.ws === null || this.state !== 'open') return;
      const { cmd, subCmd, intervalMs } = this.heartbeatOptions as HeartbeatOptions;
      this.request(cmd, subCmd, undefined, { timeoutMs: Math.max(intervalMs - 200, 1_000) })
        .then((response) => {
          this.heartbeatCount += 1;
          this.lastHeartbeatAckAt = Date.now();
          this.lastHeartbeatErrorCode = response.errorCode;
        })
        .catch(() => {
          // 心跳失败留给连接层的 close/重连机制处理；404 回执同样证明链路存活
        });
    }, this.heartbeatOptions.intervalMs) as unknown as ReturnType<typeof setInterval>;
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.reconnectOptions.enabled || this.reconnectTimer !== null || this.closeRequested) return;
    const { minDelayMs, maxDelayMs } = this.reconnectOptions;
    const delay = Math.min(minDelayMs * 2 ** this.reconnectAttempt, maxDelayMs);
    this.reconnectAttempt += 1;
    this.setState('reconnecting', `${delay}ms 后重连（第 ${this.reconnectAttempt} 次）`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error: Error) => {
        this.log('重连失败：', error.message);
      });
    }, delay) as unknown as ReturnType<typeof setTimeout>;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private failAllPending(reason: Error): void {
    for (const reqId of [...this.pending.keys()]) {
      this.settle(reqId, reason);
    }
  }

  private setState(state: ConnectionState, detail?: string): void {
    this.state = state;
    this.onStateChangeCb?.(state, detail);
    if (detail !== undefined) this.log('[state]', state, detail);
  }

  private log(...args: unknown[]): void {
    this.logCb?.(...args);
  }
}
