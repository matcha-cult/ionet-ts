import { type BarSkeleton } from '@nbb-ionet/core-framework';
import { type ProtocolCodec } from '@nbb-ionet/core-framework';
import { OnExternalRegistry, type OnExternalContext } from '@nbb-ionet/core-framework';

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
  /**
   * RS6：本对外服实例的 OnExternal handler 注册表。
   * 分布式传输（RedisOnExternalTransport / RPC external.onExternal）收到逻辑服指令后
   * 经 `handleOnExternal(...)` 分发到这里。
   */
  readonly onExternal = new OnExternalRegistry();

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

  /** 分发一条 OnExternal 指令到本实例注册的 handler（未注册显式抛错）。 */
  async handleOnExternal(context: OnExternalContext): Promise<unknown> {
    return this.onExternal.dispatch(context);
  }

  get port(): number {
    return this.options.port;
  }
}
