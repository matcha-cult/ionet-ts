import { ActionController, ActionMethod } from '@nbb-ionet/core-framework';
import type { FlowContext } from '@nbb-ionet/core-framework';
import type { ItemService } from '../services/item-service.js';

export const ITEM_CMD = {
  cmd: 30,
  getBag: 1,
  addItem: 2,
  useItem: 3,
} as const;

@ActionController(ITEM_CMD.cmd)
export class ItemAction {
  constructor(private itemService: ItemService) {}

  @ActionMethod(ITEM_CMD.getBag)
  async getBag(ctx: FlowContext): Promise<any> {
    const userId = ctx.getUserId();
    return await this.itemService.getBag(userId);
  }

  @ActionMethod(ITEM_CMD.addItem)
  async addItem(ctx: FlowContext, data: { itemId: string; count: number }): Promise<{ success: boolean }> {
    const userId = ctx.getUserId();
    await this.itemService.addItem(userId, data.itemId, data.count);
    return { success: true };
  }

  @ActionMethod(ITEM_CMD.useItem)
  async useItem(ctx: FlowContext, data: { itemId: string; count: number }): Promise<any> {
    const userId = ctx.getUserId();
    return await this.itemService.useItem(userId, data.itemId, data.count);
  }
}
