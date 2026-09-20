import { describe, it, expect } from 'vitest';
import { EnvelopeCodec, envelopeCodec } from './envelope-codec.js';

describe('envelope-codec.ts · 客户端线协议编解码（§1 JSON 文本帧 / §12.3 未知字段透传）', () => {
  const codec = new EnvelopeCodec();

  it('encode/decode 基础往返', () => {
    const frame = { kind: 'notification' as const, type: 'x', data: { n: 1 } };
    const text = codec.encode(frame);
    expect(text).toBe('{"kind":"notification","type":"x","data":{"n":1}}');
    expect(codec.decode(text)).toEqual(frame);
  });

  it('未知字段前向透传：decode 不裁剪、encode 不注入（§12.3）', () => {
    const wire = '{"kind":"notification","type":"x","data":{},"future":{"a":1},"v2flag":true}';
    const frame = codec.decode(wire);
    // 未知字段原样保留
    expect(frame['future']).toEqual({ a: 1 });
    expect(frame['v2flag']).toBe(true);
    // 往返逐字节不变
    expect(codec.encode(frame)).toBe(wire);
  });

  it('decodeClassified：decode + §5 分流一体化', () => {
    const notif = codec.decodeClassified('{"kind":"notification","type":"tick"}');
    expect(notif.kind).toBe('notification');
    expect(notif.frame['type']).toBe('tick');

    const resp = codec.decodeClassified('{"data":1,"reqId":"r-1","kind":"response"}');
    expect(resp.kind).toBe('response');
    expect(resp.frame['reqId']).toBe('r-1');

    const legacy = codec.decodeClassified('{"data":"legacy"}');
    expect(legacy.kind).toBe('response'); // 旧服务无 kind 的响应（§4 兼容）
    expect('reqId' in legacy.frame).toBe(false);
    expect('kind' in legacy.frame).toBe(false);

    const req = codec.decodeClassified('{"cmd":30,"subCmd":1,"data":null}');
    expect(req.kind).toBe('request');
  });

  it('坏帧（非 JSON / 标量 / 数组 / null）按 §8 客户端侧语义抛错', () => {
    expect(() => codec.decode('this is not json')).toThrow(/Invalid message format/);
    expect(() => codec.decode('"string"')).toThrow(/Invalid message format/);
    expect(() => codec.decode('[1,2]')).toThrow(/Invalid message format/);
    expect(() => codec.decode('null')).toThrow(/Invalid message format/);
  });

  it('包级单例导出可用', () => {
    expect(envelopeCodec.contentType).toBe('application/json');
    expect(envelopeCodec.decode('{"kind":"response"}').kind).toBe('response');
  });
});
