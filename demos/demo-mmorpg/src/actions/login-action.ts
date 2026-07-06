import { ActionController, ActionMethod } from '@nbb-ionet/core-framework';
import type { AuthService } from '../services/auth-service.js';

export const LOGIN_CMD = {
  cmd: 10,
  login: 1,
  verify: 2,
} as const;

@ActionController(LOGIN_CMD.cmd)
export class LoginAction {
  constructor(private authService: AuthService) {}

  @ActionMethod(LOGIN_CMD.login)
  async login(data: { account: string; password: string }): Promise<{ token: string; userId: string }> {
    const result = await this.authService.login(data.account, data.password);
    return {
      token: result.token,
      userId: result.userId.toString(),
    };
  }

  @ActionMethod(LOGIN_CMD.verify)
  async verify(data: { token: string }): Promise<{ userId: string; account: string }> {
    const result = await this.authService.verify(data.token);
    return {
      userId: result.userId.toString(),
      account: result.account,
    };
  }
}
