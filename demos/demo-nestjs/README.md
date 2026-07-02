# @nbb-ionet/demo-nestjs

**Phase 4** NestJS 集成示例 - 展示如何将 ionet 集成到 NestJS 项目中。

## 功能展示

- **IonetModule**：使用 `forRoot()` 配置 ionet
- **Action 自动注册**：通过 `actions` 选项注册 Action
- **InOut 插件**：在 NestJS 中使用 ionet 的 InOut 插件
- **与 NestJS 控制器共存**：ionet 的 HTTP/WS 服务与 NestJS 控制器并行运行
- **依赖注入**：Action 可以注入 NestJS 的 Service
- **双协议支持**：HTTP + WebSocket External Server

## 运行

```bash
# 从项目根目录运行
pnpm --filter demo-nestjs start

# 或进入目录运行
cd demos/demo-nestjs
pnpm start
```

## 预期输出

```text
=== NestJS + ionet Demo ===

✓ NestJS app initialized
✓ HTTP server started on http://localhost:8080
✓ WebSocket server started on ws://localhost:8081

ionet Endpoints:
  HTTP:  POST /api/{cmd}/{subCmd}
  WS:    Send JSON: { "cmd": number, "subCmd": number, "data": any }

NestJS Endpoints:
  GET    http://localhost:3000/

Try:
  curl -X POST http://localhost:8080/api/1/1 -H "Content-Type: application/json" -d '{"data":"Alice"}'
  curl -X POST http://localhost:8080/api/1/2 -H "Content-Type: application/json" -d '{"data":12345}'

Press Ctrl+C to stop servers
```

## API 测试

### 1. NestJS 默认路由

```bash
curl http://localhost:3000/

# 响应: NestJS + ionet Demo Server
```

### 2. ionet - Hello（cmd=1, subCmd=1）

```bash
curl -X POST http://localhost:8080/api/1/1 \
  -H "Content-Type: application/json" \
  -d '{"data":"Alice"}'

# 响应: {"data":"Hello, Alice!"}
```

### 3. ionet - 获取用户信息（cmd=1, subCmd=2）

```bash
curl -X POST http://localhost:8080/api/1/2 \
  -H "Content-Type: application/json" \
  -d '{"data":12345}'

# 响应: {"data":{"userId":12345,"name":"User12345","level":124}}
```

### 4. WebSocket 测试

```javascript
const ws = new WebSocket('ws://localhost:8081');
ws.onopen = () => {
  ws.send(JSON.stringify({
    cmd: 1,
    subCmd: 1,
    data: 'Alice'
  }));
};
ws.onmessage = (e) => console.log(e.data);
// 输出: {"data":"Hello, Alice!"}
```

## 代码示例

### 定义 Action

```typescript
import { ActionController, ActionMethod } from '@nbb-ionet/core-framework';

const HALL_CMD = {
  cmd: 1,
  hello: 1,
  getUserInfo: 2,
} as const;

@ActionController(HALL_CMD.cmd)
class HallAction {
  @ActionMethod(HALL_CMD.hello)
  hello(name: string): string {
    return `Hello, ${name}!`;
  }

  @ActionMethod(HALL_CMD.getUserInfo)
  getUserInfo(userId: number): { userId: number; name: string; level: number } {
    return {
      userId,
      name: `User${userId}`,
      level: Math.floor(userId / 100) + 1,
    };
  }
}
```

### 配置 IonetModule

```typescript
import { Module } from '@nestjs/common';
import { IonetModule } from '@nbb-ionet/extension-nestjs';
import { DebugInOut } from '@nbb-ionet/core-framework';

@Module({
  imports: [
    IonetModule.forRoot({
      actions: [HallAction],
      inOuts: [new DebugInOut()],
      httpServer: {
        port: 8080,
        host: 'localhost',
      },
      wsServer: {
        port: 8081,
        host: 'localhost',
      },
      redis: false, // 或配置 Redis 连接
    }),
  ],
})
class AppModule {}
```

### 使用依赖注入（进阶）

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
class UserService {
  async findById(userId: number) {
    // 从数据库查询用户
    return { userId, name: `User${userId}`, level: 1 };
  }
}

@ActionController(1)
class HallAction {
  constructor(private readonly userService: UserService) {}

  @ActionMethod(2)
  async getUserInfo(userId: number) {
    return this.userService.findById(userId);
  }
}
```

## 端口配置

| 服务               | 端口 | 说明                         |
|--------------------|------|------------------------------|
| NestJS             | 3000 | NestJS 默认 HTTP 服务        |
| ionet HTTP         | 8080 | ionet Action HTTP 服务       |
| ionet WebSocket    | 8081 | ionet Action WebSocket 服务  |

可以在 `IonetModule.forRoot()` 中修改端口配置。

## 项目结构

```text
demo-nestjs/
├── src/
│   └── main.ts           # 入口，定义 AppModule 和 HallAction
├── package.json
├── tsconfig.json
└── README.md
```

## 依赖

- `@nbb-ionet/core-framework` - 核心框架
- `@nbb-ionet/extension-nestjs` - NestJS 适配层
- `@nestjs/common` - NestJS 核心
- `@nestjs/core` - NestJS 核心
- `@nestjs/platform-express` - Express 适配器
- `reflect-metadata` - 装饰器元数据

## 与纯 ionet 的区别

| 特性     | 纯 ionet         | NestJS + ionet     |
|----------|------------------|--------------------|
| 框架     | 无框架           | NestJS             |
| 依赖注入 | 手动             | 自动（IoC）        |
| 模块化   | 手动组织         | NestJS Module      |
| 配置管理 | 环境变量         | NestJS Config      |
| 数据库   | 手动集成         | TypeORM/Prisma     |
| 适用场景 | 轻量、高性能     | 企业级、复杂业务   |

## 故障排查

### 端口冲突

```text
Error: listen EADDRINUSE: address already in use :::8080
```

**解决**：修改 `IonetModule.forRoot()` 中的端口配置。

### 装饰器不生效

**检查**：

- 确保 `tsconfig.json` 中启用了 `experimentalDecorators` 和 `emitDecoratorMetadata`
- 确保导入了 `reflect-metadata`

### Action 未注册

**检查**：

- Action 类是否添加了 `@ActionController` 装饰器
- Action 方法是否添加了 `@ActionMethod` 装饰器
- Action 类是否在 `IonetModule.forRoot({ actions: [...] })` 中注册

## 下一步

- [demo](../demo/) - 了解 ionet 基础功能
- [demo-cluster](../demo-cluster/) - 学习分布式集群部署
- 阅读 [Phase 4 设计文档](../../ai-docs/phase4-extensions.md)
