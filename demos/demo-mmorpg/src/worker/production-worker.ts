import type { RedisClient } from '@nbb-ionet/redis';
import { TimingWheel } from './timing-wheel.js';
import { ProductionService } from '../services/production-service.js';

export class ProductionWorker {
  private timingWheel: TimingWheel;
  private isRunning = false;

  constructor(
    private redis: RedisClient,
    private productionService: ProductionService,
  ) {
    this.timingWheel = new TimingWheel(100, (playerIds) => this.processBatch(playerIds));
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // 从 Redis 恢复活跃任务到时间轮
    await this.rebuildTimingWheel();

    this.timingWheel.start();
    console.log('✓ ProductionWorker started (持续处理，无论玩家是否在线)');
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.timingWheel.stop();
    console.log('✓ ProductionWorker stopped');
  }

  async scheduleTask(userId: bigint, completeTime: number): Promise<void> {
    this.timingWheel.schedule(userId.toString(), completeTime);
  }

  private async rebuildTimingWheel(): Promise<void> {
    // 从 Redis ZSet 恢复所有活跃任务（包括离线玩家的任务）
    const activePlayers = await this.redis.getClient().zrangebyscore('production:active', Date.now(), '+inf');

    for (const playerId of activePlayers) {
      // 检查是否超过最大离线时间
      const offlineCheck = await this.productionService.checkMaxOfflineTime(BigInt(playerId));
      if (offlineCheck.shouldPause) {
        console.log(`Player ${playerId} exceeded max offline time, pausing production`);
        await this.productionService.cancelTask(BigInt(playerId));
        continue;
      }

      const data = await this.redis.getClient().hgetall(`player:${playerId}:current`);
      if (data && data.startTime && data.duration) {
        const startTime = parseInt(data.startTime);
        const duration = parseInt(data.duration);
        const completeTime = startTime + duration;
        this.timingWheel.schedule(playerId, completeTime);
      }
    }

    console.log(`✓ Rebuilt timing wheel with ${activePlayers.length} active tasks`);
  }

  private async processBatch(playerIds: string[]): Promise<void> {
    for (const playerId of playerIds) {
      try {
        const result = await this.productionService.completeTask(BigInt(playerId));

        if (result.completed && result.reward) {
          // 道具已发放到 Redis 背包（无论玩家是否在线）

          if (result.isOnline) {
            // 玩家在线，广播通知
            console.log(`Player ${playerId} (online) completed task: +${result.reward.count} ${result.reward.itemId}`);
            // TODO: 通过 WebSocket 广播给客户端
            // broadcastToUser(playerId, { type: 'item.received', itemId: result.reward.itemId, count: result.reward.count });
          } else {
            // 玩家离线，静默发放
            console.log(`Player ${playerId} (offline) completed task: +${result.reward.count} ${result.reward.itemId} (silent)`);
          }

          // 检查是否有下一个任务，加入时间轮
          const state = await this.productionService.getState(BigInt(playerId));
          if (state.current) {
            const completeTime = state.current.startTime + state.current.duration;
            this.timingWheel.schedule(playerId, completeTime);
          }
        }
      } catch (error) {
        console.error(`Error processing task for player ${playerId}:`, error);
      }
    }
  }
}
