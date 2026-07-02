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
