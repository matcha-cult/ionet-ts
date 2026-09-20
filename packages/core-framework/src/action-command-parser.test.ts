import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { ActionController, ActionMethod } from './decorators/action-decorators.js';
import { ActionCommandRegions } from './core/action-command-region.js';
import { DefaultActionCommandParser } from './core/action-command-parser.js';
import { ActionParameterPosition } from './core/action-command.js';
import { FlowContext } from './core/flow/flow-context.js';

const PARSE_CMD = { cmd: 91, ctxFirst: 1, dataOnly: 2 } as const;

@ActionController(PARSE_CMD.cmd)
class ParseProbeAction {
  @ActionMethod(PARSE_CMD.ctxFirst)
  ctxFirst(ctx: FlowContext, data: unknown): unknown {
    return { ctx, data };
  }

  @ActionMethod(PARSE_CMD.dataOnly)
  dataOnly(data: string): string {
    return data;
  }
}

// vitest 的 esbuild 转换不发射 design:paramtypes，此处手工模拟 tsc emitDecoratorMetadata 的
// 真实存储形态：以 (prototype, methodName) 为键——正是解析器必须读取的键位。
Reflect.defineMetadata('design:paramtypes', [FlowContext, Object], ParseProbeAction.prototype, 'ctxFirst');
Reflect.defineMetadata('design:paramtypes', [String], ParseProbeAction.prototype, 'dataOnly');

describe('DefaultActionCommandParser 参数解析', () => {
  const parser = new DefaultActionCommandParser();
  const regions = new ActionCommandRegions();
  const commands = parser.parse(ParseProbeAction, new ParseProbeAction(), {
    actionCommandRegions: regions,
  });

  it('FlowContext 参数识别为 FLOW_CONTEXT（回归：旧实现单参读 method 永远 undefined，ctx 参数一律误判 DATA）', () => {
    const cmd = commands.find((c) => c.cmdInfo.subCmd === PARSE_CMD.ctxFirst);
    expect(cmd).toBeDefined();
    expect(cmd?.actionMethodParameters[0]?.position).toBe(ActionParameterPosition.FLOW_CONTEXT);
    expect(cmd?.actionMethodParameters[1]?.position).toBe(ActionParameterPosition.DATA);
  });

  it('纯数据参数仍为 DATA', () => {
    const cmd = commands.find((c) => c.cmdInfo.subCmd === PARSE_CMD.dataOnly);
    expect(cmd).toBeDefined();
    expect(cmd?.actionMethodParameters).toHaveLength(1);
    expect(cmd?.actionMethodParameters[0]?.position).toBe(ActionParameterPosition.DATA);
  });
});
