import { describe, it, expect } from 'vitest';
import { jsonCodec, JsonProtocolCodec } from './protocol/json-codec.js';
import {
  createRequestMessage,
  requestMessageToCmdInfo,
  createResponseMessage,
  createNotificationMessage,
  isSuccessResponse,
} from './protocol/message.js';
import { attachToFlowContext } from './protocol/flow-attachment.js';
import { FlowContext } from './core/flow/flow-context.js';

describe('JsonProtocolCodec', () => {
  it('has correct contentType', () => {
    expect(jsonCodec.contentType).toBe('application/json');
  });

  it('encodes object to JSON string', () => {
    const result = jsonCodec.encode({ name: 'Alice', age: 30 });
    expect(result).toBe('{"name":"Alice","age":30}');
  });

  it('decodes JSON string to object', () => {
    const result = jsonCodec.decode('{"name":"Bob","age":25}');
    expect(result).toEqual({ name: 'Bob', age: 25 });
  });

  it('roundtrip consistency', () => {
    const original = {
      cmd: 1,
      subCmd: 2,
      data: { userId: 12345, items: ['a', 'b', 'c'] },
    };
    const encoded = jsonCodec.encode(original);
    const decoded = jsonCodec.decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('decodes Uint8Array', () => {
    const encoder = new TextEncoder();
    const buffer = encoder.encode('{"test":true}');
    const result = jsonCodec.decode(buffer);
    expect(result).toEqual({ test: true });
  });
});

describe('RequestMessage', () => {
  it('createRequestMessage creates message with required fields', () => {
    const msg = createRequestMessage({ cmd: 1, subCmd: 2 });
    expect(msg.cmd).toBe(1);
    expect(msg.subCmd).toBe(2);
    expect(msg.data).toBeUndefined();
  });

  it('createRequestMessage accepts optional fields', () => {
    const msg = createRequestMessage({
      cmd: 1,
      subCmd: 2,
      data: { name: 'test' },
      headers: { 'x-trace': 'abc' },
      traceId: 'trace-123',
    });
    expect(msg.data).toEqual({ name: 'test' });
    expect(msg.headers?.['x-trace']).toBe('abc');
    expect(msg.traceId).toBe('trace-123');
  });

  it('requestMessageToCmdInfo converts to CmdInfo', () => {
    const msg = createRequestMessage({ cmd: 5, subCmd: 10 });
    const cmdInfo = requestMessageToCmdInfo(msg);
    expect(cmdInfo.cmd).toBe(5);
    expect(cmdInfo.subCmd).toBe(10);
    expect(cmdInfo.cmdMerge).toBe((5 << 16) | 10);
  });
});

describe('ResponseMessage', () => {
  it('createResponseMessage creates success response', () => {
    const msg = createResponseMessage({ data: { result: 'ok' } });
    expect(msg.data).toEqual({ result: 'ok' });
    expect(msg.errorCode).toBeUndefined();
    expect(isSuccessResponse(msg)).toBe(true);
  });

  it('createResponseMessage creates error response', () => {
    const msg = createResponseMessage({
      errorCode: 500,
      errorMessage: 'Internal error',
    });
    expect(msg.errorCode).toBe(500);
    expect(msg.errorMessage).toBe('Internal error');
    expect(isSuccessResponse(msg)).toBe(false);
  });
});

describe('RequestMessage reqId（任务 2）', () => {
  it('createRequestMessage 可携带 string | number reqId', () => {
    expect(createRequestMessage({ cmd: 1, subCmd: 2, reqId: 'r-1' }).reqId).toBe('r-1');
    expect(createRequestMessage({ cmd: 1, subCmd: 2, reqId: 7 }).reqId).toBe(7);
    expect(createRequestMessage({ cmd: 1, subCmd: 2 }).reqId).toBeUndefined();
  });
});

describe('ResponseMessage reqId / kind（任务 2）', () => {
  it('未提供 reqId/kind 时响应逐字节兼容旧格式', () => {
    const msg = createResponseMessage({ data: 'ok' });
    expect('reqId' in msg).toBe(false);
    expect('kind' in msg).toBe(false);
    expect(JSON.stringify(msg)).toBe('{"data":"ok"}');
  });

  it('提供 reqId 时回显，kind 可显式给出 response', () => {
    const msg = createResponseMessage({ data: 'ok', reqId: 'r-9', kind: 'response' });
    expect(msg.reqId).toBe('r-9');
    expect(msg.kind).toBe('response');
    expect(JSON.parse(JSON.stringify(msg))).toEqual({
      data: 'ok',
      reqId: 'r-9',
      kind: 'response',
    });
  });

  it('旧调用形式仍编译通过且字段不变', () => {
    const msg = createResponseMessage({ errorCode: 500, errorMessage: 'x' });
    expect(msg.errorCode).toBe(500);
    expect(msg.errorMessage).toBe('x');
    expect(isSuccessResponse(msg)).toBe(false);
  });

  it('createNotificationMessage 产出 kind=notification', () => {
    const msg = createNotificationMessage({ data: { hello: 'world' } });
    expect(msg.kind).toBe('notification');
    expect(msg.data).toEqual({ hello: 'world' });
    expect(JSON.parse(JSON.stringify(msg))).toEqual({
      data: { hello: 'world' },
      kind: 'notification',
    });
  });

  it('JSON codec 往返不破坏既有解析', () => {
    const original = createResponseMessage({ data: { n: 1 }, reqId: 3, kind: 'response' });
    const round = jsonCodec.decode(jsonCodec.encode(original)) as typeof original;
    expect(round).toEqual(original);
  });
});

describe('FlowAttachment', () => {
  it('set/get attachment', () => {
    const ctx = new FlowContext();
    const attachment = attachToFlowContext(ctx);
    attachment.setAttachment('user', { id: 123, name: 'Alice' });
    expect(attachment.getAttachment('user')).toEqual({ id: 123, name: 'Alice' });
  });

  it('remove attachment', () => {
    const ctx = new FlowContext();
    const attachment = attachToFlowContext(ctx);
    attachment.setAttachment('temp', 'value');
    attachment.removeAttachment('temp');
    expect(attachment.getAttachment('temp')).toBeUndefined();
  });

  it('clear all attachments', () => {
    const ctx = new FlowContext();
    const attachment = attachToFlowContext(ctx);
    attachment.setAttachment('a', 1);
    attachment.setAttachment('b', 2);
    attachment.clearAttachments();
    expect(attachment.getAttachment('a')).toBeUndefined();
    expect(attachment.getAttachment('b')).toBeUndefined();
  });

  it('returns same attachment instance for same context', () => {
    const ctx = new FlowContext();
    const att1 = attachToFlowContext(ctx);
    const att2 = attachToFlowContext(ctx);
    att1.setAttachment('key', 'value');
    expect(att2.getAttachment('key')).toBe('value');
  });
});
