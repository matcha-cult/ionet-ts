# @nbb-ionet/extension-codegen

从服务端 Action 定义自动生成多语言客户端代码（TypeScript / C# / GDScript / Lua）。

## 安装

```bash
pnpm add @nbb-ionet/extension-codegen
```

## 快速开始

```typescript
import 'reflect-metadata';
import { scanActions, TypeScriptCodeGenerator } from '@nbb-ionet/extension-codegen';
import { HallAction } from './actions/hall-action';

// 扫描 Action 类，提取路由元数据
const actions = scanActions([HallAction]);

// 生成 TypeScript 客户端代码
const generator = new TypeScriptCodeGenerator();
const code = generator.generate(actions);

console.log(code);
// 输出:
// export const Commands = {
//   HallAction: {
//     cmd: 1,
//     login: 1,
//     ...
//   },
// } as const;
//
// export interface HallActionLoginRequest { ... }
// export interface HallActionLoginResponse { ... }
```

## API

### scanActions(actions)

扫描装饰器标注的 Action 类，提取 `cmd`、`subCmd`、参数类型、返回类型等元数据。

```typescript
function scanActions(actions: Function[]): ActionCommandInfo[]
```

返回结构：

```typescript
interface ActionCommandInfo {
  cmd: number;
  controllerName: string;
  methods: ActionMethodInfo[];
}

interface ActionMethodInfo {
  methodName: string;
  subCmd: number;
  parameterTypes: string[];
  returnType: string;
}
```

### 代码生成器

所有生成器实现 `CodeGenerator` 接口：

```typescript
interface CodeGenerator {
  generate(actions: ActionCommandInfo[]): string;
  readonly language: string;
  readonly fileExtension: string;
}
```

| 生成器 | 语言 | 文件扩展名 |
|---|---|---|
| `TypeScriptCodeGenerator` | TypeScript | `.ts` |
| `CSharpCodeGenerator` | C# | `.cs` |
| `GDScriptCodeGenerator` | GDScript | `.gd` |
| `LuaCodeGenerator` | Lua | `.lua` |

## License

AGPL-3.0
