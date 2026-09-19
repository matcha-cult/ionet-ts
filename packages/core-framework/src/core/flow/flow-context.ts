import { AsyncLocalStorage } from 'node:async_hooks';
import { CmdInfo } from '../cmd-info.js';
import { CommunicationKit, resolveCmdInfo } from '../communication/communication-kit.js';
import { CrossServerError, type CrossServerResponse } from '../communication/types.js';
import { type SessionData } from './session.js';

export interface Request {
  cmd: number;
  subCmd: number;
  data?: unknown;
  headers?: Record<string, string>;
  /** 分布式链路追踪 id；由外部服从报文透传，与 reqId（请求配对）语义不混用。 */
  traceId?: string;
}

export interface Response {
  data?: unknown;
  errorCode?: number;
  errorMessage?: string;
  headers?: Record<string, string>;
}

export interface ServerInfo {
  id: string;
  /**
   * 承载本次执行的服务器类型。历史取值 'http' | 'ws' | 'tcp' 表示对外服传输通道；
   * 'logic' 表示逻辑服（RS1 引入，逻辑服无客户端端口时 port 为 -1）。
   */
  type: 'http' | 'ws' | 'tcp' | 'logic';
  port: number;
  host: string;
  /** RS2：逻辑服名称 / tag。对外服元数据可缺省。 */
  name?: string;
  tag?: string;
}

/** FlowContext 跨服调用的可选项（与 CrossServerCallContext 同构，去掉自动透传字段）。 */
export interface CrossServerCallOptions {
  timeoutMs?: number;
  /** 显式指定目标逻辑服 tag（应用级 affinity）；缺省按 cmdMerge 路由。 */
  tag?: string;
}

export class FlowContext {
  private _userId: bigint = 0n;
  private _cmdInfo: CmdInfo = CmdInfo.of(0, 0);
  private _request: Request | null = null;
  private _response: Response | null = null;
  private _errorCode: number = 0;
  private _errorMessage: string | null = null;
  private _nanoTime: bigint = 0n;
  private _methodResult: unknown = null;
  private _dataParam: unknown = null;
  private _serverInfo: ServerInfo | null = null;
  private _session: SessionData | null = null;
  private _attachments = new Map<string, unknown>();

  getUserId(): bigint {
    return this._userId;
  }

  setUserId(userId: bigint): void {
    this._userId = userId;
  }

  bindingUserId(userId: bigint): void {
    this._userId = userId;
    if (this._session) {
      this._session.userId = userId;
    }
  }

  getCmdInfo(): CmdInfo {
    return this._cmdInfo;
  }

  setCmdInfo(cmdInfo: CmdInfo): void {
    this._cmdInfo = cmdInfo;
  }

  getCmdMerge(): number {
    return this._cmdInfo.cmdMerge;
  }

  getRequest(): Request | null {
    return this._request;
  }

  setRequest(request: Request): void {
    this._request = request;
  }

  getResponse(): Response | null {
    return this._response;
  }

  setResponse(response: Response): void {
    this._response = response;
  }

  hasError(): boolean {
    return this._errorCode !== 0;
  }

  getErrorCode(): number {
    return this._errorCode;
  }

  setErrorCode(errorCode: number): void {
    this._errorCode = errorCode;
  }

  getErrorMessage(): string | null {
    return this._errorMessage;
  }

  setErrorMessage(errorMessage: string): void {
    this._errorMessage = errorMessage;
  }

  getNanoTime(): bigint {
    if (this._nanoTime === 0n) {
      this._nanoTime = process.hrtime.bigint();
    }
    return this._nanoTime;
  }

  getMethodResult(): unknown {
    return this._methodResult;
  }

  setMethodResult(result: unknown): void {
    this._methodResult = result;
  }

  getDataParam(): unknown {
    return this._dataParam;
  }

  setDataParam(dataParam: unknown): void {
    this._dataParam = dataParam;
  }

  getServer(): ServerInfo | null {
    return this._serverInfo;
  }

  setServer(serverInfo: ServerInfo): void {
    this._serverInfo = serverInfo;
  }

  getSession(): SessionData | null {
    return this._session;
  }

  setSession(session: SessionData): void {
    this._session = session;
  }

  getAttachment<T>(key: string): T | undefined {
    return this._attachments.get(key) as T | undefined;
  }

  setAttachment<T>(key: string, value: T): void {
    this._attachments.set(key, value);
  }

  removeAttachment(key: string): void {
    this._attachments.delete(key);
  }

  clearAttachments(): void {
    this._attachments.clear();
  }

  // ---------------------------------------------------------------------------
  // RS5 跨服通信 API
  // ---------------------------------------------------------------------------

  /**
   * 同步（await）调用另一个逻辑服的 Action，返回响应信封。
   *
   * - 支持 `call(cmd, subCmd, data?, options?)` 与 `call(cmdInfo, data?, options?)`。
   * - 失败（未注册路由 / 超时 / 对端下线 / 未配置跨服通信）会 reject `CrossServerError`。
   * - 调用者的 userId / traceId / headers 会透传给被调用逻辑服。
   *
   * 投递保证：至多一次（不重试、不承诺顺序），与 KB communication-logic-call-api-contract 一致。
   */
  call(
    cmd: number,
    subCmd: number,
    data?: unknown,
    options?: CrossServerCallOptions,
  ): Promise<CrossServerResponse>;
  call(
    cmdInfo: CmdInfo,
    data?: unknown,
    options?: CrossServerCallOptions,
  ): Promise<CrossServerResponse>;
  call(
    cmdOrCmdInfo: number | CmdInfo,
    subCmdOrData?: number | unknown,
    dataOrOptions?: unknown,
    maybeOptions?: CrossServerCallOptions,
  ): Promise<CrossServerResponse> {
    const parsed = this.parseCallArgs(cmdOrCmdInfo, subCmdOrData, dataOrOptions, maybeOptions);
    return CommunicationKit.call(this, parsed.cmdInfo, parsed.data, parsed.options);
  }

  /**
   * 异步调用：与 `call` 同一语义，但**不 reject** —— 失败时返回带 errorCode/errorMessage
   * 的错误信封，便于 Action 内不写 try/catch。
   */
  async callAsync(
    cmd: number,
    subCmd: number,
    data?: unknown,
    options?: CrossServerCallOptions,
  ): Promise<CrossServerResponse>;
  async callAsync(
    cmdInfo: CmdInfo,
    data?: unknown,
    options?: CrossServerCallOptions,
  ): Promise<CrossServerResponse>;
  async callAsync(
    cmdOrCmdInfo: number | CmdInfo,
    subCmdOrData?: number | unknown,
    dataOrOptions?: unknown,
    maybeOptions?: CrossServerCallOptions,
  ): Promise<CrossServerResponse> {
    try {
      const parsed = this.parseCallArgs(cmdOrCmdInfo, subCmdOrData, dataOrOptions, maybeOptions);
      return await CommunicationKit.call(this, parsed.cmdInfo, parsed.data, parsed.options);
    } catch (error) {
      if (error instanceof CrossServerError) {
        return { errorCode: error.errorCode, errorMessage: error.message };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { errorCode: 500, errorMessage: message };
    }
  }

  /**
   * 单向发送（fire-and-forget）：把消息投递到目标逻辑服，不等待响应、不返回结果。
   * 传输层失败只记录日志（Action 不应因旁路事件失败而中断）；需要感知失败请用 `sendAsync`。
   */
  send(
    cmd: number,
    subCmd: number,
    data?: unknown,
    options?: CrossServerCallOptions,
  ): void;
  send(cmdInfo: CmdInfo, data?: unknown, options?: CrossServerCallOptions): void;
  send(
    cmdOrCmdInfo: number | CmdInfo,
    subCmdOrData?: number | unknown,
    dataOrOptions?: unknown,
    maybeOptions?: CrossServerCallOptions,
  ): void {
    const parsed = this.parseCallArgs(cmdOrCmdInfo, subCmdOrData, dataOrOptions, maybeOptions);
    void CommunicationKit.send(this, parsed.cmdInfo, parsed.data, parsed.options).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ionet] FlowContext.send failed: ${message}`);
    });
  }

  /** `send` 的 await 版本：需要感知「未注册路由 / 对端下线」时使用。 */
  sendAsync(
    cmd: number,
    subCmd: number,
    data?: unknown,
    options?: CrossServerCallOptions,
  ): Promise<void>;
  sendAsync(cmdInfo: CmdInfo, data?: unknown, options?: CrossServerCallOptions): Promise<void>;
  sendAsync(
    cmdOrCmdInfo: number | CmdInfo,
    subCmdOrData?: number | unknown,
    dataOrOptions?: unknown,
    maybeOptions?: CrossServerCallOptions,
  ): Promise<void> {
    const parsed = this.parseCallArgs(cmdOrCmdInfo, subCmdOrData, dataOrOptions, maybeOptions);
    return CommunicationKit.send(this, parsed.cmdInfo, parsed.data, parsed.options);
  }

  private parseCallArgs(
    cmdOrCmdInfo: number | CmdInfo,
    subCmdOrData: number | unknown,
    dataOrOptions: unknown,
    maybeOptions?: CrossServerCallOptions,
  ): { cmdInfo: CmdInfo; data: unknown; options?: CrossServerCallOptions } {
    if (cmdOrCmdInfo instanceof CmdInfo) {
      return {
        cmdInfo: cmdOrCmdInfo,
        data: subCmdOrData,
        options: dataOrOptions as CrossServerCallOptions | undefined,
      };
    }
    return {
      cmdInfo: resolveCmdInfo(cmdOrCmdInfo, subCmdOrData as number),
      data: dataOrOptions,
      options: maybeOptions,
    };
  }
}

export const flowContextStorage = new AsyncLocalStorage<FlowContext>();

export function getCurrentFlowContext(): FlowContext | undefined {
  return flowContextStorage.getStore();
}

export function runWithFlowContext<T>(ctx: FlowContext, fn: () => T): T {
  return flowContextStorage.run(ctx, fn);
}
