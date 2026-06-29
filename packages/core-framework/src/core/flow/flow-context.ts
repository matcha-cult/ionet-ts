import { AsyncLocalStorage } from 'node:async_hooks';
import { CmdInfo } from '../cmd-info.js';

export interface Request {
  cmd: number;
  subCmd: number;
  data?: unknown;
}

export interface Response {
  data?: unknown;
  errorCode?: number;
  errorMessage?: string;
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

  getUserId(): bigint {
    return this._userId;
  }

  setUserId(userId: bigint): void {
    this._userId = userId;
  }

  bindingUserId(userId: bigint): void {
    this._userId = userId;
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
}

export const flowContextStorage = new AsyncLocalStorage<FlowContext>();

export function getCurrentFlowContext(): FlowContext | undefined {
  return flowContextStorage.getStore();
}

export function runWithFlowContext<T>(ctx: FlowContext, fn: () => T): T {
  return flowContextStorage.run(ctx, fn);
}
