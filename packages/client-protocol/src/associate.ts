import type { WireFrame } from './message.js';

/** 一个已登记的在途请求。 */
export interface PendingRequest {
  /** 单调递增的在途序号（FIFO 次序依据；调用方可作为业务句柄键）。 */
  seq: number;
  /** 客户端请求配对 id（可选）。旧服务不解/不回显时由 FIFO 回退覆盖。 */
  reqId?: string | number;
}

/** 配对依据：reqId（新协议精确配对）| fifo（旧服务不回显 reqId 时最早在途回退）。 */
export type AssociateBy = 'reqId' | 'fifo';

export interface AssociateOk {
  ok: true;
  /** 匹配到的在途请求。 */
  pending: PendingRequest;
  /** 本轮匹配依据。 */
  by: AssociateBy;
}

export interface AssociateMiss {
  ok: false;
  /**
   * no-pending：无在途请求（响应/推送未被登记，或通知被当作响应消费）；
   * no-reqid-match：帧带 reqId 但在途无同 id（乱序、过期或重复响应）。
   */
  reason: 'no-pending' | 'no-reqid-match';
}

/**
 * 请求 ↔ 响应关联器（PROTOCOL.md §4.1）。
 *
 * 策略：
 * 1. 帧携带 reqId → 与在途请求**精确配对**（客户端为并发未决请求生成唯一 reqId，
 *    服务端原样回显，可乱序返回）；
 * 2. 帧不携带 reqId（旧服务不回显）→ 回退到「最早在途请求」（FIFO）；
 * 3. 帧携带 reqId 但无匹配 → 失败返回（绝不回退 FIFO，避免错配）。
 *
 * 旧客户端（不带 reqId）无法关联响应、只能串行请求 —— 本类对无 reqId 的在途
 * 请求同样按 begin 次序 FIFO 消费，语义不变（§4.1 兼容旧行为）。
 */
export class RequestResponseAssociator {
  private readonly inflightMap = new Map<string, PendingRequest>();
  private readonly inflightQueue: PendingRequest[] = [];
  private nextSeq = 1;

  /** 登记一个在途请求。reqId 在未决集合中重复 → 抛错（必须唯一才能精确配对）。 */
  begin(options: { reqId?: string | number } = {}): PendingRequest {
    const pending: PendingRequest = { seq: this.nextSeq++, reqId: options.reqId };
    if (options.reqId !== undefined) {
      const key = String(options.reqId);
      if (this.inflightMap.has(key)) {
        throw new Error('duplicate in-flight reqId: ' + key);
      }
      this.inflightMap.set(key, pending);
    }
    this.inflightQueue.push(pending);
    return pending;
  }

  /** 消费一个响应帧并关联到在途请求。 */
  associate(frame: WireFrame): AssociateOk | AssociateMiss {
    const reqId = frame['reqId'];
    if (reqId !== undefined) {
      const key = String(reqId);
      const pending = this.inflightMap.get(key);
      if (!pending) return { ok: false, reason: 'no-reqid-match' };
      this.remove(pending);
      return { ok: true, pending, by: 'reqId' };
    }
    const pending = this.inflightQueue[0];
    if (!pending) return { ok: false, reason: 'no-pending' };
    this.remove(pending);
    return { ok: true, pending, by: 'fifo' };
  }

  /** 当前未决请求数。 */
  get pendingCount(): number {
    return this.inflightQueue.length;
  }

  /** 连接断开/超时：清空全部未决并返回（供调用方做超时/失败回调）。 */
  drain(): PendingRequest[] {
    const all = this.inflightQueue.splice(0);
    this.inflightMap.clear();
    return all;
  }

  private remove(pending: PendingRequest): void {
    const idx = this.inflightQueue.indexOf(pending);
    if (idx >= 0) this.inflightQueue.splice(idx, 1);
    if (pending.reqId !== undefined) this.inflightMap.delete(String(pending.reqId));
  }
}
