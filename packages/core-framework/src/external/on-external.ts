/**
 * RS6 —— 逻辑服 → 对外服的反向操作通道（对应 Java `OnExternal` / `OnExternalManager`）。
 *
 * 与「推送广播」的分工：
 * - 广播（Broadcaster）用于把业务帧投递给某个/全部在线用户；
 * - OnExternal 用于**对连接本身**下指令（强制下线、查询在线、更新连接附件等），
 *   由持有该连接的对外服实例执行。
 *
 * 模板 id 约定为字符串常量（Java 用 int 模板号；TS 侧用可读字符串，跨进程 JSON 安全）。
 */
export const OnExternalTemplates = {
  /** 强制某 userId 下线（关闭其全部连接）。 */
  FORCE_OFFLINE: 'forceOffline',
  /** 查询某 userId 是否存在在线连接。 */
  EXIST_USER: 'existUser',
  /** 强制刷新/设置连接绑定的 userId（换绑场景）。 */
  SET_USER_ID: 'setUserId',
  /** 更新连接附件。 */
  ATTACHMENT_UPDATE: 'attachmentUpdate',
} as const;

export type OnExternalTemplateId =
  (typeof OnExternalTemplates)[keyof typeof OnExternalTemplates] | (string & {});

export interface OnExternalContext {
  templateId: string;
  payload: unknown;
  /** 目标用户（bigint 以字符串跨进程传输）。 */
  userId?: string;
  /** 发起方逻辑服实例 id。 */
  sourceInstanceId?: string;
  /** 目标对外服实例 id（定向投递时给出）。 */
  targetInstanceId?: string;
}

export class OnExternalError extends Error {
  readonly code: 'NO_HANDLER' | 'HANDLER_ERROR' | 'NOT_REGISTERED';
  constructor(code: OnExternalError['code'], message: string) {
    super(message);
    this.name = 'OnExternalError';
    this.code = code;
  }
}

export interface OnExternal {
  readonly templateId: string;
  /** 处理模板；返回结果会作为反回值（如 existUser 返回 boolean）。 */
  process(context: OnExternalContext): Promise<unknown> | unknown;
}

/**
 * 对外服侧 OnExternal handler 注册表。每个对外服实例持有自己的注册表，
 * 分布式传输收到消息后按 templateId 分发到本实例的 handler。
 *
 * 未注册 handler 必须显式报错（NO_HANDLER），不得静默丢弃。
 */
export class OnExternalRegistry {
  private readonly handlers = new Map<string, OnExternal>();

  register(handler: OnExternal): void {
    this.handlers.set(handler.templateId, handler);
  }

  unregister(templateId: string): void {
    this.handlers.delete(templateId);
  }

  has(templateId: string): boolean {
    return this.handlers.has(templateId);
  }

  listTemplateIds(): string[] {
    return [...this.handlers.keys()];
  }

  async dispatch(context: OnExternalContext): Promise<unknown> {
    const handler = this.handlers.get(context.templateId);
    if (!handler) {
      throw new OnExternalError(
        'NO_HANDLER',
        `No OnExternal handler registered for templateId='${context.templateId}' on instance ${context.targetInstanceId ?? '?'}`,
      );
    }
    try {
      return await handler.process(context);
    } catch (error) {
      if (error instanceof OnExternalError) throw error;
      throw new OnExternalError(
        'HANDLER_ERROR',
        `OnExternal handler '${context.templateId}' failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
