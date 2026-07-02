# @nbb-ionet/demo

**Phase 1** 基础示例 - 展示 ionet 核心功能的最小可运行示例。

## 功能展示

- **Action 路由**：使用 `@ActionController` 和 `@ActionMethod` 装饰器定义路由
- **InOut 插件链**：
  - `RateLimitInOut` - 速率限制
  - `AccessLogInOut` - 访问日志
  - `SessionInOut` - Session 管理（内存存储）
  - `DebugInOut` - 调试日志
  - `StatActionInOut` - Action 调用统计
- **双协议支持**：HTTP + WebSocket External Server

## 运行

```bash
# 从项目根目录运行
pnpm --filter @nbb-ionet/demo start

# 或进入目录运行
cd demos/demo
pnpm start
```

## 预期输出

```
=== ionet Phase 2 Demo ===

✓ HTTP server started on http://localhost:8080
✓ WebSocket server started on ws://localhost:8081

Endpoints:
  HTTP:  POST /api/{cmd}/{subCmd}
  WS:    Send JSON: { "cmd": number, "subCmd": number, "data": any }

Try:
  curl -X POST http://localhost:8080/api/1/1 -H "Content-Type: application/json" -d '{"data":"Alice"}'
  curl -X POST http://localhost:8080/api/1/2 -H "Content-Type: application/json" -d '{"data":12345}'
  curl -X POST http://localhost:8080/api/1/3 -H "Content-Type: application/json" -d '{"data":999}'
```

## API 测试

### 1. 登录验证（cmd=1, subCmd=1）

```bash
curl -X POST http://localhost:8080/api/1/1 \
  -H "Content-Type: application/json" \
  -d '{"data":"Alice"}'

# 响应: {"data":{"id":501,"nickname":"Alice"}}
```

### 2. Hello（cmd=1, subCmd=2）

```bash
curl -X POST http://localhost:8080/api/1/2 \
  -H "Content-Type: application/json" \
  -d '{"data":12345}'

# 响应: {"data":"hello 12345"}
```

### 3. 获取用户信息（cmd=1, subCmd=3）

```bash
curl -X POST http://localhost:8080/api/1/3 \
  -H "Content-Type: application/json" \
  -d '{"data":999}'

# 响应: {"data":{"userId":999,"name":"User999","level":10}}
```

### 4. WebSocket 测试

```javascript
const ws = new WebSocket('ws://localhost:8081');
ws.onopen = () => {
  ws.send(JSON.stringify({
    cmd: 1,
    subCmd: 2,
    data: 12345
  }));
};
ws.onmessage = (e) => console.log(e.data);
// 输出: {"data":"hello 12345"}
```

## 项目结构

```
demo/
├── src/
│   └── main.ts        # 入口，定义 HallAction 并启动服务器
├── package.json
├── tsconfig.json
└── README.md
```

## 依赖

- `@nbb-ionet/core-framework` - 核心框架
- `@nbb-ionet/external-server` - External Server 实现
- `@nbb-ionet/common-kit` - 工具库

## 下一步

- [demo-cluster](../demo-cluster/) - 学习分布式集群部署
- [demo-nestjs](../demo-nestjs/) - 学习 NestJS 集成
