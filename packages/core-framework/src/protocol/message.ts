import { CmdInfo } from '../core/cmd-info.js';

export interface RequestMessage {
  cmd: number;
  subCmd: number;
  data?: unknown;
  headers?: Record<string, string>;
  traceId?: string;
}

export function createRequestMessage(options: {
  cmd: number;
  subCmd: number;
  data?: unknown;
  headers?: Record<string, string>;
  traceId?: string;
}): RequestMessage {
  return {
    cmd: options.cmd,
    subCmd: options.subCmd,
    data: options.data,
    headers: options.headers,
    traceId: options.traceId,
  };
}

export function requestMessageToCmdInfo(request: RequestMessage): CmdInfo {
  return CmdInfo.of(request.cmd, request.subCmd);
}

export interface ResponseMessage {
  data?: unknown;
  errorCode?: number;
  errorMessage?: string;
  headers?: Record<string, string>;
}

export function createResponseMessage(options: {
  data?: unknown;
  errorCode?: number;
  errorMessage?: string;
  headers?: Record<string, string>;
}): ResponseMessage {
  return {
    data: options.data,
    errorCode: options.errorCode,
    errorMessage: options.errorMessage,
    headers: options.headers,
  };
}

export function isSuccessResponse(response: ResponseMessage): boolean {
  return !response.errorCode || response.errorCode === 0;
}
