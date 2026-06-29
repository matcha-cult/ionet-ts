import { type ProtocolCodec } from './protocol-codec.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class JsonProtocolCodec implements ProtocolCodec {
  readonly contentType = 'application/json';

  encode(data: unknown): string {
    return JSON.stringify(data);
  }

  decode(buffer: Uint8Array | string): unknown {
    const text = typeof buffer === 'string' ? buffer : textDecoder.decode(buffer);
    return JSON.parse(text);
  }
}

export const jsonCodec = new JsonProtocolCodec();
