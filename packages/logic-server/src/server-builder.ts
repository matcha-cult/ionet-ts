import type { BarSkeleton } from '@nbb-ionet/core-framework';
import type { ServerRecord, ServerRole } from '@nbb-ionet/redis';

/**
 * RS2 —— 逻辑服/对外服元数据构造器（对应 Java `ServerBuilder`）。
 *
 * 默认值（与 Java 对齐）：id 随机、tag 缺省等于 name、serverType 缺省 LOGIC、ip 缺省本机。
 * `setBarSkeleton(...)` 后 `build()` 会抽取路由表 cmdMerge，写入注册表元数据。
 */
export class ServerBuilder {
  private id?: string;
  private name?: string;
  private tag?: string;
  private ip?: string;
  private port?: number;
  private serverType?: ServerRole;
  private metadata?: Record<string, unknown>;
  private skeleton: BarSkeleton | null = null;

  setId(id: string): this {
    this.id = id;
    return this;
  }

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setTag(tag: string): this {
    this.tag = tag;
    return this;
  }

  setIp(ip: string): this {
    this.ip = ip;
    return this;
  }

  setPort(port: number): this {
    this.port = port;
    return this;
  }

  setServerType(serverType: ServerRole): this {
    this.serverType = serverType;
    return this;
  }

  setMetadata(metadata: Record<string, unknown>): this {
    this.metadata = metadata;
    return this;
  }

  setBarSkeleton(skeleton: BarSkeleton): this {
    this.skeleton = skeleton;
    return this;
  }

  getName(): string | undefined {
    return this.name;
  }

  getServerType(): ServerRole | undefined {
    return this.serverType;
  }

  build(): Omit<ServerRecord, 'lastHeartbeat'> {
    if (!this.name) {
      throw new Error('ServerBuilder: name is required (setName(...))');
    }
    return {
      id: this.id ?? randomServerId(),
      name: this.name,
      tag: this.tag ?? this.name,
      serverType: this.serverType ?? 'logic',
      ip: this.ip ?? '127.0.0.1',
      port: this.port,
      cmdMerges: this.skeleton ? this.skeleton.actionCommandRegions.listCmdMerges() : [],
      startedAt: Date.now(),
      metadata: this.metadata,
    };
  }
}

/** 生成实例 id（进程内唯一即可；注册表以它为主键）。 */
export function randomServerId(): string {
  const n = Math.floor(2_000_000 + Math.random() * 8_000_000);
  return `srv-${n}-${Date.now().toString(36)}`;
}
