import { classifyFrame } from './classify.js';
import type { FrameKind, WireFrame } from './message.js';

/** decode + 分流的结果视图。 */
export interface DecodedEnvelope {
  /** §5 分流判定（request / response / notification / unknown）。 */
  kind: FrameKind;
  /** JSON 解析后的帧：已知字段 + 未知字段原样透传（§12.3 前向兼容，不做裁剪）。 */
  frame: WireFrame;
}

/**
 * 客户端线协议编解码器（浏览器安全，零 Node 依赖）。
 *
 * - 文本帧 UTF-8 JSON（PROTOCOL.md §1 帧类型）；
 * - encode 不注入字段、decode 不裁剪字段 —— 未知字段逐字节透传，前向兼容（§12.3）；
 * - 帧必须是 JSON 对象；标量/数组/无法解析的文本按 §8 客户端侧坏帧语义抛错
 *   （服务端侧对坏帧响应 errorCode=400）。
 */
export class EnvelopeCodec {
  readonly contentType = 'application/json';

  /** JSON 编码（不注入任何字段；encode(JSON.parse(x)) 对未知字段恒等）。 */
  encode(message: unknown): string {
    return JSON.stringify(message);
  }

  /** JSON 解码：返回包含全部字段（含未知字段）的帧对象。 */
  decode(text: string): WireFrame {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Invalid message format: not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Invalid message format: expected a JSON object frame');
    }
    return parsed as WireFrame;
  }

  /** decode + §5 kind 分流。 */
  decodeClassified(text: string): DecodedEnvelope {
    const frame = this.decode(text);
    return { kind: classifyFrame(frame), frame };
  }
}

export const envelopeCodec = new EnvelopeCodec();
