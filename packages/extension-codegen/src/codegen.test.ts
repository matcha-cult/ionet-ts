import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { scanActions, TypeScriptCodeGenerator, CSharpCodeGenerator, GDScriptCodeGenerator, LuaCodeGenerator } from '../src/index.js';
import { ActionController, ActionMethod } from '@nbb-ionet/core-framework';

const HALL_CMD = { cmd: 1, loginVerify: 1, hello: 2 } as const;

@ActionController(HALL_CMD.cmd)
class HallAction {
  @ActionMethod(HALL_CMD.loginVerify)
  loginVerify(jwt: string): { id: number; nickname: string } {
    return { id: 1, nickname: jwt };
  }

  @ActionMethod(HALL_CMD.hello)
  hello(name: string): string {
    return `Hello ${name}`;
  }
}

const CHAT_CMD = { cmd: 2, sendMessage: 1, getMessages: 2 } as const;

@ActionController(CHAT_CMD.cmd)
class ChatAction {
  @ActionMethod(CHAT_CMD.sendMessage)
  sendMessage(message: string): boolean {
    return true;
  }

  @ActionMethod(CHAT_CMD.getMessages)
  getMessages(roomId: number): string[] {
    return [];
  }
}

describe('Action Scanner', () => {
  it('应该正确扫描 Action 定义', () => {
    const actions = scanActions([HallAction, ChatAction]);

    expect(actions.length).toBe(2);

    const hallAction = actions.find(a => a.cmd === 1);
    expect(hallAction).toBeDefined();
    expect(hallAction?.controllerName).toBe('HallAction');
    expect(hallAction?.methods.length).toBe(2);

    const loginMethod = hallAction?.methods.find(m => m.methodName === 'loginVerify');
    expect(loginMethod).toBeDefined();
    expect(loginMethod?.subCmd).toBe(1);
  });
});

describe('TypeScript Code Generator', () => {
  it('应该生成正确的 TypeScript 代码', () => {
    const generator = new TypeScriptCodeGenerator();
    const actions = scanActions([HallAction]);
    const code = generator.generate(actions);

    expect(code).toContain('export const Commands');
    expect(code).toContain('HallAction:');
    expect(code).toContain('cmd: 1');
    expect(code).toContain('loginVerify: 1');
    expect(code).toContain('hello: 2');
    expect(code).toContain('export interface HallActionLoginVerifyRequest');
    expect(code).toContain('export interface HallActionLoginVerifyResponse');
  });
});

describe('TypeScript Code Generator · Response 与线协议对齐（任务 3）', () => {
  it('Response 接口不含 cmd/subCmd，含 data 与可选 errorCode/errorMessage/reqId/kind', () => {
    const code = new TypeScriptCodeGenerator().generate(scanActions([HallAction]));
    const start = code.indexOf('export interface HallActionLoginVerifyResponse');
    const block = code.slice(start, code.indexOf('}', start));
    expect(block).toContain('data:');
    expect(block).toContain('errorCode?: number;');
    expect(block).toContain('errorMessage?: string;');
    expect(block).toContain('reqId?: string | number;');
    expect(block).toContain("kind?: 'response' | 'notification';");
    expect(block).not.toContain('cmd:');
    expect(block).not.toContain('subCmd:');
  });

  it('Request 接口保持 { cmd, subCmd, data }', () => {
    const code = new TypeScriptCodeGenerator().generate(scanActions([HallAction]));
    const start = code.indexOf('export interface HallActionLoginVerifyRequest');
    const block = code.slice(start, code.indexOf('}', start));
    expect(block).toContain('cmd: 1;');
    expect(block).toContain('subCmd: 1;');
    expect(block).toContain('data:');
  });

  it('Response 字段集与 ws-server 的响应构造一致', () => {
    const code = new TypeScriptCodeGenerator().generate(scanActions([HallAction]));
    for (const field of ['data', 'errorCode', 'errorMessage', 'reqId', 'kind']) {
      expect(code).toContain(field);
    }
    expect(code).toContain('响应不回显 cmd/subCmd');
  });
});

describe('C# Code Generator · Response 与线协议对齐（任务 3）', () => {
  it('Response 类不含 Cmd/SubCmd 属性，含 Data/ErrorCode/ReqId/Kind', () => {
    const code = new CSharpCodeGenerator().generate(scanActions([HallAction]));
    const block = code
      .split('public class ')
      .find((section) => section.startsWith('HallActionLoginVerifyResponse'))!;
    expect(block).not.toContain('Cmd { get; set; }');
    expect(block).not.toContain('SubCmd { get; set; }');
    expect(block).toContain('Data { get; set; }');
    expect(block).toContain('ErrorCode');
    expect(block).toContain('ReqId');
    expect(block).toContain('Kind');
  });
});

describe('C# Code Generator', () => {
  it('应该生成正确的 C# 代码', () => {
    const generator = new CSharpCodeGenerator();
    const actions = scanActions([HallAction]);
    const code = generator.generate(actions);

    expect(code).toContain('namespace Ionet.Generated');
    expect(code).toContain('public static class Commands');
    expect(code).toContain('public static class HallAction');
    expect(code).toContain('public const int Cmd = 1');
    expect(code).toContain('public const int LoginVerify = 1');
    expect(code).toContain('public class HallActionLoginVerifyRequest');
  });
});

describe('GDScript Code Generator', () => {
  it('应该生成正确的 GDScript 代码', () => {
    const generator = new GDScriptCodeGenerator();
    const actions = scanActions([HallAction]);
    const code = generator.generate(actions);

    expect(code).toContain('extends Node');
    expect(code).toContain('class_name Commands');
    expect(code).toContain('const HallAction_CMD = 1');
    expect(code).toContain('const HallAction_LOGINVERIFY = 1');
    expect(code).toContain('class HallActionLoginVerifyRequest');
  });
});

describe('Lua Code Generator', () => {
  it('应该生成正确的 Lua 代码', () => {
    const generator = new LuaCodeGenerator();
    const actions = scanActions([HallAction]);
    const code = generator.generate(actions);

    expect(code).toContain('local Commands = {}');
    expect(code).toContain('Commands.HallAction = {');
    expect(code).toContain('cmd = 1');
    expect(code).toContain('loginVerify = 1');
    expect(code).toContain('function Commands.newHallActionLoginVerifyRequest(data)');
    expect(code).toContain('return Commands');
  });
});

describe('生成代码可编译验证', () => {
  it('TypeScript 代码应该包含正确的结构', () => {
    const generator = new TypeScriptCodeGenerator();
    const actions = scanActions([HallAction, ChatAction]);
    const code = generator.generate(actions);

    expect(code).toContain('export const Commands');
    expect(code).toContain('export interface');
    expect(code).toContain('cmd:');
    expect(code).toContain('subCmd:');
  });
});
