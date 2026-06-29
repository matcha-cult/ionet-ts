import { type ActionMethodInOut } from '../action-method-inout.js';
import { type FlowContext } from '../flow-context.js';
import { type SessionManager } from '../session.js';

export class SessionInOut implements ActionMethodInOut {
  constructor(private readonly sessionManager: SessionManager) {}

  async fuckIn(flowContext: FlowContext): Promise<void> {
    const session = await this.sessionManager.getSession(flowContext);
    if (session) {
      flowContext.setSession(session);
      if (session.userId) {
        flowContext.setUserId(session.userId);
      }
    }
  }

  async fuckOut(flowContext: FlowContext): Promise<void> {
    const session = flowContext.getSession();
    if (session) {
      session.userId = flowContext.getUserId();
      await this.sessionManager.saveSession(flowContext, session);
    }
  }
}
