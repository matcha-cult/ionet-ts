import { describe, it, expect } from 'vitest';
import {
  createRequestMessage,
  createResponseMessage,
  createNotificationMessage,
  isSuccess,
} from './message.js';

describe('message.ts · 信封构造（与 PROTOCOL.md §3/§4/§5 逐字段一致）', () => {
  it('createRequestMessage：字段集与键序 = cmd/subCmd/data/headers/traceId/reqId', () => {
    const msg = createRequestMessage({
      cmd: 30,
      subCmd: 1,
      data: { n: 1 },
      headers: { 'x-trace': 'abc' },
      traceId: 't-1',
      reqId: 'r-1',
    });
    expect(msg).toEqual({
      cmd: 30,
      subCmd: 1,
      data: { n: 1 },
      headers: { 'x-trace': 'abc' },
      traceId: 't-1',
      reqId: 'r-1',
    });
    expect(Object.keys(msg)).toEqual(['cmd', 'subCmd', 'data', 'headers', 'traceId', 'reqId']);
    expect(JSON.stringify(msg)).toBe(
      '{"cmd":30,"subCmd":1,"data":{"n":1},"headers":{"x-trace":"abc"},"traceId":"t-1","reqId":"r-1"}',
    );
  });

  it('createResponseMessage（不带 reqId/kind）：响应逐字节仅含 data（§12.1 旧协议兼容）', () => {
    const msg = createResponseMessage({ data: 'legacy' });
    // 未提供 reqId/kind 时不写入键：与旧协议响应逐字节一致
    expect(JSON.stringify(msg)).toBe('{"data":"legacy"}');
    expect('reqId' in msg).toBe(false);
    expect('kind' in msg).toBe(false);
  });

  it('createResponseMessage（带 reqId/kind）：新协议回显 reqId + kind="response"，不回显 cmd/subCmd', () => {
    const msg = createResponseMessage({ data: { a: 1 }, reqId: 'r-1', kind: 'response' });
    expect(JSON.stringify(msg)).toBe('{"data":{"a":1},"reqId":"r-1","kind":"response"}');
    expect(Object.keys(msg)).toEqual(['data', 'errorCode', 'errorMessage', 'headers', 'reqId', 'kind']);
  });

  it('createNotificationMessage：kind 恒为 notification，未显式给出的可选字段不写入（§5）', () => {
    expect(createNotificationMessage()).toEqual({ kind: 'notification' });
    expect(JSON.stringify(createNotificationMessage())).toBe('{"kind":"notification"}');

    const msg = createNotificationMessage({ type: 'room.tick', data: { n: 1 } });
    expect(msg).toEqual({ kind: 'notification', type: 'room.tick', data: { n: 1 } });
    expect('timestamp' in msg).toBe(false);
    expect('cmd' in msg).toBe(false);
    expect('fromUserId' in msg).toBe(false);
    expect(JSON.stringify(msg)).toBe('{"kind":"notification","type":"room.tick","data":{"n":1}}');
  });

  it('createNotificationMessage：全字段键序 = kind/type/cmd/subCmd/data/timestamp/headers/reqId/fromUserId', () => {
    const msg = createNotificationMessage({
      type: 't',
      cmd: 1,
      subCmd: 2,
      data: {},
      timestamp: 1700000000000,
      headers: { h: '1' },
      reqId: 'r',
      fromUserId: '42',
    });
    expect(JSON.stringify(msg)).toBe(
      '{"kind":"notification","type":"t","cmd":1,"subCmd":2,"data":{},"timestamp":1700000000000,"headers":{"h":"1"},"reqId":"r","fromUserId":"42"}',
    );
  });

  it('isSuccess：errorCode 缺失或 0 → true；其余 → false（§8）', () => {
    expect(isSuccess({})).toBe(true);
    expect(isSuccess({ errorCode: 0 })).toBe(true);
    expect(isSuccess({ errorCode: 400 })).toBe(false);
    expect(isSuccess({ errorCode: 404 })).toBe(false);
    expect(isSuccess({ errorCode: 500, errorMessage: 'x' })).toBe(false);
  });
});
