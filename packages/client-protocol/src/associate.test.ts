import { describe, it, expect } from 'vitest';
import { RequestResponseAssociator } from './associate.js';

describe('associate.ts · 请求↔响应关联（§4.1：reqId 精确配对 + 最早在途回退）', () => {
  it('reqId 精确配对：并发未决、乱序返回也能一一对应', () => {
    const assoc = new RequestResponseAssociator();
    const a = assoc.begin({ reqId: 'r-a' });
    const b = assoc.begin({ reqId: 'r-b' });
    const c = assoc.begin({ reqId: 'r-c' });
    expect(assoc.pendingCount).toBe(3);

    // 乱序返回（c → a → b）
    expect(assoc.associate({ data: 'C', reqId: 'r-c' })).toEqual({ ok: true, pending: c, by: 'reqId' });
    expect(assoc.associate({ data: 'A', reqId: 'r-a' })).toEqual({ ok: true, pending: a, by: 'reqId' });
    expect(assoc.associate({ data: 'B', reqId: 'r-b' })).toEqual({ ok: true, pending: b, by: 'reqId' });
    expect(assoc.pendingCount).toBe(0);
  });

  it('最早在途回退（旧服务不回显 reqId）：帧无 reqId → FIFO 次序关联', () => {
    const assoc = new RequestResponseAssociator();
    const a = assoc.begin({ reqId: 'r-1' });
    const b = assoc.begin({ reqId: 'r-2' });
    const c = assoc.begin({ reqId: 'r-3' });
    // 旧服务逐条处理并按请求次序返回，响应帧不带 reqId
    expect(assoc.associate({ data: 1 })).toEqual({ ok: true, pending: a, by: 'fifo' });
    expect(assoc.associate({ data: 2 })).toEqual({ ok: true, pending: b, by: 'fifo' });
    expect(assoc.associate({ data: 3 })).toEqual({ ok: true, pending: c, by: 'fifo' });
    expect(assoc.pendingCount).toBe(0);
  });

  it('旧客户端（不带 reqId）串行请求：FIFO 语义不变（§4.1 兼容旧行为）', () => {
    const assoc = new RequestResponseAssociator();
    const a = assoc.begin();
    const b = assoc.begin();
    expect(assoc.associate({ data: 'x' })).toEqual({ ok: true, pending: a, by: 'fifo' });
    expect(assoc.associate({ data: 'y' })).toEqual({ ok: true, pending: b, by: 'fifo' });
  });

  it('帧带 reqId 但无匹配 → no-reqid-match（绝不回退 FIFO，避免错配）', () => {
    const assoc = new RequestResponseAssociator();
    assoc.begin({ reqId: 'r-1' });
    expect(assoc.associate({ data: 1, reqId: 'r-2' })).toEqual({
      ok: false,
      reason: 'no-reqid-match',
    });
    // 无 matches 不清空队列
    expect(assoc.pendingCount).toBe(1);
  });

  it('无在途请求 → no-pending', () => {
    const assoc = new RequestResponseAssociator();
    expect(assoc.associate({ data: 1 })).toEqual({ ok: false, reason: 'no-pending' });
  });

  it('begin：未决中 reqId 重复 → 抛错（id 必须唯一才能精确配对）', () => {
    const assoc = new RequestResponseAssociator();
    assoc.begin({ reqId: 'dup' });
    expect(() => assoc.begin({ reqId: 'dup' })).toThrow(/duplicate in-flight reqId/);
  });

  it('drain：连接断开/超时清空全部未决并返回', () => {
    const assoc = new RequestResponseAssociator();
    const a = assoc.begin({ reqId: 'r-a' });
    const b = assoc.begin();
    const drained = assoc.drain();
    expect(drained).toEqual([a, b]);
    expect(assoc.pendingCount).toBe(0);
    // drain 之后旧的 reqId 记录不可再被命中
    expect(assoc.associate({ data: 1, reqId: 'r-a' })).toEqual({ ok: false, reason: 'no-reqid-match' });
  });
});
