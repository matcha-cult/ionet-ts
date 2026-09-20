import {
  OnExternalError,
  OnExternalTemplates,
  type OnExternalContext,
} from '@nbb-ionet/core-framework';
import {
  ConnectionOwnerOfflineError,
  type ConnectionRegistryStore,
  type RedisOnExternalTransport,
  type RedisRequestReply,
  type ServerRegistry,
} from '@nbb-ionet/redis';
import { RPC_HANDLER_ON_EXTERNAL } from './protocol.js';

/**
 * RS6 —— 逻辑服 → 对外服反向通道（OnExternal 语义）。
 *
 * 连接归属来自 `ConnectionRegistryStore`（userId → 对外服实例）。
 * - 归属实例在线：定向投递（pub/sub 定向通道）或 RPC（需要应答时）；
 * - 归属实例离线：显式抛 `ConnectionOwnerOfflineError`（宕机不静默丢帧）；
 * - 无归属：`forceOffline` 幂等返回 false，`existUser` 返回 false。
 */
export class ExternalCommunication {
  constructor(
    private readonly registry: ServerRegistry,
    private readonly connectionStore: ConnectionRegistryStore | null,
    private readonly transport: RedisOnExternalTransport | null,
    private readonly rpc: RedisRequestReply | null,
    private readonly selfInstanceId: string,
    private readonly defaultTimeoutMs = 5000,
  ) {}

  /** 强制 userId 在对外服侧下线（关闭其全部连接）。返回是否定位到归属实例。 */
  async forceOffline(userId: string | bigint): Promise<boolean> {
    const id = String(userId);
    const owner = await this.resolveOwner(id);
    if (!owner) return false;
    const context: OnExternalContext = {
      templateId: OnExternalTemplates.FORCE_OFFLINE,
      userId: id,
      payload: {},
      sourceInstanceId: this.selfInstanceId,
    };
    await this.deliver(context, owner);
    return true;
  }

  /** 查询 userId 是否在线（由归属对外服实例应答）。 */
  async existUser(userId: string | bigint): Promise<boolean> {
    const id = String(userId);
    const owner = await this.resolveOwner(id);
    if (!owner) return false;
    if (!this.rpc) {
      throw new OnExternalError(
        'NOT_REGISTERED',
        'ExternalCommunication.existUser requires an RPC channel',
      );
    }
    const result = await this.rpc.call<unknown>(
      owner,
      RPC_HANDLER_ON_EXTERNAL,
      {
        templateId: OnExternalTemplates.EXIST_USER,
        userId: id,
        payload: {},
        sourceInstanceId: this.selfInstanceId,
      } satisfies OnExternalContext,
      { timeoutMs: this.defaultTimeoutMs },
    );
    return result === true;
  }

  /** 发送任意 OnExternal 模板；targetInstanceId 缺省时按连接归属解析或广播。 */
  async send(context: OnExternalContext, targetInstanceId?: string): Promise<void> {
    const resolved =
      targetInstanceId ?? (context.userId ? await this.resolveOwner(context.userId) : null);
    const envelope: OnExternalContext = { ...context, sourceInstanceId: this.selfInstanceId };
    await this.deliver(envelope, resolved ?? undefined);
  }

  private async deliver(context: OnExternalContext, owner?: string): Promise<void> {
    if (this.transport) {
      await this.transport.send(context, owner);
      return;
    }
    if (this.rpc && owner) {
      await this.rpc.send(owner, RPC_HANDLER_ON_EXTERNAL, context);
      return;
    }
    throw new OnExternalError(
      'NOT_REGISTERED',
      'ExternalCommunication has neither OnExternal transport nor RPC channel configured',
    );
  }

  /**
   * 解析连接归属实例；归属登记仍存在但实例心跳过期时显式抛错。
   */
  private async resolveOwner(userId: string): Promise<string | null> {
    if (!this.connectionStore) return null;
    const owner = await this.connectionStore.lookup(userId);
    if (!owner) return null;
    if (!(await this.registry.isAlive(owner))) {
      throw new ConnectionOwnerOfflineError(userId, owner);
    }
    return owner;
  }
}
