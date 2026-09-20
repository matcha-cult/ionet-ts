import { ActionController, ActionMethod } from '@nbb-ionet/core-framework';
import type { FlowContext } from '@nbb-ionet/core-framework';
import type { ProductionService } from '../services/production-service.js';
import type { ProductionWorker } from '../worker/production-worker.js';

export const IDLE_CMD = {
  cmd: 40,
  startTask: 1,
  cancelTask: 2,
  getState: 3,
  addToQueue: 4,
} as const;

@ActionController(IDLE_CMD.cmd)
export class IdleAction {
  constructor(
    private productionService: ProductionService,
    private productionWorker: ProductionWorker,
  ) {}

  @ActionMethod(IDLE_CMD.startTask)
  async startTask(ctx: FlowContext, data: { taskType: string }): Promise<any> {
    const userId = ctx.getUserId();

    // 检查是否超过最大离线时间
    const offlineCheck = await this.productionService.checkMaxOfflineTime(userId);
    if (offlineCheck.shouldPause) {
      throw new Error(`Cannot start task: exceeded max offline time (${offlineCheck.lastOnline})`);
    }

    const result = await this.productionService.startTask(userId, data.taskType);

    // 加入时间轮（无论玩家是否在线，任务都会持续生产）
    const state = await this.productionService.getState(userId);
    if (state.current) {
      const completeTime = state.current.startTime + state.current.duration;
      await this.productionWorker.scheduleTask(userId, completeTime);
    }

    return result;
  }

  @ActionMethod(IDLE_CMD.cancelTask)
  async cancelTask(ctx: FlowContext): Promise<{ success: boolean }> {
    const userId = ctx.getUserId();
    await this.productionService.cancelTask(userId);
    return { success: true };
  }

  @ActionMethod(IDLE_CMD.getState)
  async getState(ctx: FlowContext): Promise<any> {
    const userId = ctx.getUserId();

    // 标记玩家上线（生产任务已经在持续运行，这里只是更新在线状态）
    await this.productionService.onPlayerOnline(userId);

    // 返回当前状态（道具已经在离线期间发放到背包了）
    return await this.productionService.getState(userId);
  }

  @ActionMethod(IDLE_CMD.addToQueue)
  async addToQueue(ctx: FlowContext, data: { taskType: string }): Promise<any> {
    const userId = ctx.getUserId();
    return await this.productionService.addToQueue(userId, data.taskType);
  }
}
