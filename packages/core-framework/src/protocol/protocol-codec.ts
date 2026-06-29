export interface ProtocolCodec<T = unknown> {
  encode(data: T): Uint8Array | string;
  decode(buffer: Uint8Array | string): T;
  readonly contentType: string;
}
