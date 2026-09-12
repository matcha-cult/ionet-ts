import { type ActionFactoryBean } from '@nbb-ionet/core-framework';

/** Action 解析函数：由应用侧显式提供，返回容器中的实例；返回 undefined 时骨架回退 new。 */
export type NestActionResolver = (
  ActionClass: new (...args: any[]) => object,
) => object | undefined;

/**
 * 让 Action 走 NestJS DI 容器的 ActionFactoryBean 实现（任务 4）。
 *
 * 设计要害：解析逻辑完全由应用侧显式传入，本类**不注入** ModuleRef / Reflector /
 * HttpAdapterHost 等 @nestjs/core 类令牌。跨仓库 pnpm workspace 链接下，应用侧与框架侧
 * 可能各自解析到物理独立的一份 @nestjs/core，注入这些类令牌会静默降级为 undefined
 * （消费方已实证）；显式函数传递不经过令牌查找，因此不受多副本影响。
 *
 * 调用时机：IonetModule 在 onModuleInit 阶段调用（此时 app 已创建、所有 provider 就绪），
 * 故应用侧可安全使用 app.get(Cls) / ModuleRef。
 *
 * 典型用法：
 *   IonetModule.forRoot({ actions, resolveAction: (Cls) => app.get(Cls) })
 */
export class ActionFactoryBeanForNest implements ActionFactoryBean {
  constructor(private readonly resolve: NestActionResolver) {}

  getBean<T extends object>(ActionClass: new (...args: any[]) => T): T {
    return this.resolve(ActionClass) as T;
  }
}
