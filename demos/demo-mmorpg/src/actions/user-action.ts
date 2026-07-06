import { ActionController, ActionMethod } from '@nbb-ionet/core-framework';
import type { FlowContext } from '@nbb-ionet/core-framework';
import type { UserService } from '../services/user-service.js';

export const USER_CMD = {
  cmd: 20,
  getUserInfo: 1,
  updateNickname: 2,
  addExp: 3,
} as const;

@ActionController(USER_CMD.cmd)
export class UserAction {
  constructor(private userService: UserService) {}

  @ActionMethod(USER_CMD.getUserInfo)
  async getUserInfo(ctx: FlowContext): Promise<any> {
    const userId = ctx.getUserId();
    return await this.userService.getUserInfo(userId);
  }

  @ActionMethod(USER_CMD.updateNickname)
  async updateNickname(ctx: FlowContext, data: { nickname: string }): Promise<{ success: boolean }> {
    const userId = ctx.getUserId();
    await this.userService.updateNickname(userId, data.nickname);
    return { success: true };
  }

  @ActionMethod(USER_CMD.addExp)
  async addExp(ctx: FlowContext, data: { exp: number }): Promise<{ level: number; exp: number }> {
    const userId = ctx.getUserId();
    return await this.userService.addExp(userId, data.exp);
  }
}
