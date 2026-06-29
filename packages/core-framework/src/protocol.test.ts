import { describe, it, expect } from 'vitest';
import { jsonCodec, JsonProtocolCodec } from './protocol/json-codec.js';
import {
  createRequestMessage,
  requestMessageToCmdInfo,
  createResponseMessage,
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
