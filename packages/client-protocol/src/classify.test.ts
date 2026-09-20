import { describe, it, expect } from 'vitest';
import { classifyFrame, isNotificationFrame } from './classify.js';

describe('classify.ts · §5 kind 分流判定', () => {
  it("kind='notification' → notification（服务端主动推送）", () => {
    expect(classifyFrame({ kind: 'notification', type: 'room.tick', data: {} })).toBe('notification');
    expect(isNotificationFrame({ kind: 'notification', type: 'room.tick' })).toBe(true);
  });

  it("kind='response' → response（新协议响应）", () => {
    expect(classifyFrame({ kind: 'response', data: 1, reqId: 'r-1' })).toBe('response');
  });

  it('无 kind 但带 cmd/subCmd → request（旧协议请求帧）', () => {
    expect(classifyFrame({ cmd: 30, subCmd: 1, data: null })).toBe('request');
  });

  it('kind 存在但取值域外 → unknown（协议外值）', () => {
    expect(classifyFrame({ kind: 'bogus' })).toBe('unknown');
    expect(classifyFrame({ kind: 1 })).toBe('unknown');
  });

  it('无 kind 且无 cmd/subCmd → response（旧服务无 reqId/kind 的响应，§4/§12 兼容）', () => {
    expect(classifyFrame({ data: 'legacy' })).toBe('response');
    expect(classifyFrame({ errorCode: 404, errorMessage: 'x' })).toBe('response');
  });
});
