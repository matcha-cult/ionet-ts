import { type BarSkeleton } from '@nbb-ionet/core-framework';
import { type ProtocolCodec } from '@nbb-ionet/core-framework';

export interface ExternalServerOptions {
  port: number;
  host?: string;
  codec?: ProtocolCodec;
}

export interface ExternalServer {
  start(skeleton: BarSkeleton): Promise<void>;
  stop(): Promise<void>;
  readonly protocol: string;
  readonly port: number;
}

export abstract class BaseExternalServer implements ExternalServer {
  protected skeleton: BarSkeleton | null = null;
  protected readonly options: ExternalServerOptions;
  protected readonly codec: ProtocolCodec;

  constructor(options: ExternalServerOptions) {
    this.options = options;
    this.codec = options.codec ?? {
      encode: (data: unknown) => JSON.stringify(data),
      decode: (buffer: Uint8Array | string) => JSON.parse(typeof buffer === 'string' ? buffer : new TextDecoder().decode(buffer)),
      contentType: 'application/json',
    };
  }

  abstract start(skeleton: BarSkeleton): Promise<void>;
  abstract stop(): Promise<void>;
  abstract readonly protocol: string;

  get port(): number {
    return this.options.port;
  }
}
