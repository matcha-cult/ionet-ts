import 'reflect-metadata';
import { ActionController, ActionMethod } from '@nbb-ionet/core-framework';
import {
  scanActions,
  TypeScriptCodeGenerator,
  CSharpCodeGenerator,
  GDScriptCodeGenerator,
  LuaCodeGenerator,
} from '@nbb-ionet/extension-codegen';

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

console.log('=== Code Generation Demo ===\n');

const actions = scanActions([HallAction, ChatAction]);

console.log('Scanned Actions:');
for (const action of actions) {
  console.log(`  ${action.controllerName} (cmd=${action.cmd})`);
  for (const method of action.methods) {
    console.log(`    - ${method.methodName} (subCmd=${method.subCmd})`);
  }
}

console.log('\n=== TypeScript ===\n');
const tsGen = new TypeScriptCodeGenerator();
console.log(tsGen.generate(actions));

console.log('\n=== C# ===\n');
const csGen = new CSharpCodeGenerator();
console.log(csGen.generate(actions));

console.log('\n=== GDScript ===\n');
const gdGen = new GDScriptCodeGenerator();
console.log(gdGen.generate(actions));

console.log('\n=== Lua ===\n');
const luaGen = new LuaCodeGenerator();
console.log(luaGen.generate(actions));
