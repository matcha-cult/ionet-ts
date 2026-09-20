import { describe, it, expect } from 'vitest';
import { EnvelopeCodec } from '../envelope-codec.js';
import { ENVELOPE_GOLDENS } from './envelope-goldens.js';

/**
 * 客户端侧协议一致性套件 —— 与 A1 主套件（packages/external-server/src/protocol-conformance.test.ts）
 * 消费同一组金样（ENVELOPE_GOLDENS，经 '@nbb-ionet/client-protocol/testing'）：同一份协议真相。
 * 本套件断言 EnvelopeCodec 的编码/解码与金样字节一致；A1 侧断言服务端产出的帧与同一组金样一致。
 */
describe('协议一致性金样 · 客户端接线（与 A1 同源）', () => {
  it('金样组非空且 id 唯一（两套件共享的开关）', () => {
    expect(ENVELOPE_GOLDENS.length).toBeGreaterThan(0);
    const ids = ENVELOPE_GOLDENS.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const golden of ENVELOPE_GOLDENS) {
    describe(`${golden.clause} ${golden.id} · ${golden.title}`, () => {
      it('金样自洽：JSON.stringify(decoded) === wire', () => {
        expect(JSON.stringify(golden.decoded)).toBe(golden.wire);
      });

      it('EnvelopeCodec.encode(decoded) 产出与 A1 主张一致的字节', () => {
        expect(new EnvelopeCodec().encode(golden.decoded)).toBe(golden.wire);
      });

      it('EnvelopeCodec.decode(wire) 恢复形状且保留全部字段（含未知字段）', () => {
        const frame = new EnvelopeCodec().decode(golden.wire);
        expect(frame).toEqual(golden.decoded);
      });

      it('decode→encode 逐字节往返（不注入/不裁剪）', () => {
        const codec = new EnvelopeCodec();
        expect(codec.encode(codec.decode(golden.wire))).toBe(golden.wire);
      });
    });
  }
});
