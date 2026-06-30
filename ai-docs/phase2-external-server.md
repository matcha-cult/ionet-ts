# Phase 2 · External Server 抽象

> 目标：实现 External Server 接入层，让 BarSkeleton 能通过真实协议（HTTP/WebSocket/TCP）接收请求并返回响应。Phase 1 是纯内存调用，Phase 2 接入网络。

---

## 0. 协议抽象层

### 任务清单

- [ ] **P2-0.1**: 设计 `ProtocolCodec` 接口（encode/decode）
- [ ] **P2-0.2**: 实现 JSON 协议编解码（最简单，开发调试用）
- [ ] **P2-0.3**: 设计 `RequestMessage` / `ResponseMessage` 协议消息类
- [ ] **P2-0.4**: 设计 `FlowAttachment` 扩展（让 FlowContext 能承载协议特定数据）

### 验收标准
- ProtocolCodec 可独立单元测试
- JSON 编解码往返一致性测试

---

## 1. HTTP External Server

### 任务清单

- [ ] **P2-1.1**: 设计 `ExternalServer` 接口（start/stop/getFlowContextFactory）
- [ ] **P2-1.2**: 实现 `HttpExternalServer`（基于 Node.js http 模块）
- [ ] **P2-1.3**: 路由映射：HTTP path → CmdInfo（例如 `/api/1/2` → cmd=1, subCmd=2）
- [ ] **P2-1.4**: Request/Response 转换：HTTP body ↔ RequestMessage/ResponseMessage
- [ ] **P2-1.5**: Session 管理（基于 cookie 或 header token）
- [ ] **P2-1.6**: 错误处理：Action 异常 → HTTP 状态码映射

### 验收标准
```bash
$ curl -X POST http://localhost:8080/api/1/1 -H 'Content-Type: application/json' -d '"Alice"'
{"id":478,"nickname":"Alice"}
```

---

## 2. WebSocket External Server

### 任务清单

- [ ] **P2-2.1**: 实现 `WebSocketExternalServer`（基于 ws 库）
- [ ] **P2-2.2**: 连接管理：握手、心跳、断线检测
- [ ] **P2-2.3**: 消息分发：接收消息 → 解析 CmdInfo → 调用 BarSkeleton → 响应
- [ ] **P2-2.4**: 广播支持：`FlowContext.broadcast()` 推送到指定连接
- [ ] **P2-2.5**: 二进制消息支持（为 Phase 4 Protobuf 预留）

### 验收标准
- WebSocket 客户端可连接并收发 JSON 消息
- 服务端可主动推送消息到指定客户端

---

## 3. TCP External Server（可选）

### 任务清单

- [ ] **P2-3.1**: 实现 `TcpExternalServer`（基于 Node.js net 模块）
- [ ] **P2-3.2**: 长度前缀协议（4 字节长度 + payload）
- [ ] **P2-3.3**: 粘包/半包处理
- [ ] **P2-3.4**: 连接池管理

### 验收标准
- TCP 客户端可连接并收发长度前缀编码的消息

---

## 4. FlowContext 扩展

### 任务清单

- [ ] **P2-4.1**: 扩展 FlowContext 支持 Session（userId 绑定到 session）
- [ ] **P2-4.2**: 实现 `bindingUserId()` 持久化（写入 session store）
- [ ] **P2-4.3**: 实现 `FlowContext.getServer()`（返回 ExternalServer 信息）
- [ ] **P2-4.4**: 拆分 FlowContext 为多个 capability 接口（FlowAttachment, FlowUserId, FlowBroadcast...）

### 验收标准
- userId 绑定后，后续请求可通过 session 自动识别
- FlowContext 的 capability 接口可独立类型检查

---

## 5. InOut 插件扩展

### 任务清单

- [ ] **P2-5.1**: 实现 `SessionInOut`（自动从 session 恢复 userId）
- [ ] **P2-5.2**: 实现 `AccessLogInOut`（类 nginx access log 格式）
- [ ] **P2-5.3**: 实现 `RateLimitInOut`（基于内存的简单限流）

### 验收标准
- 三个 InOut 插件可注册到 BarSkeleton 并按顺序执行

---

## 6. 集成 Demo

### 任务清单

- [ ] **P2-6.1**: 更新 demo 包，启动 HTTP + WebSocket 双协议 ExternalServer
- [ ] **P2-6.2**: 写 HTTP API 调用示例（curl 或 fetch）
- [ ] **P2-6.3**: 写 WebSocket 客户端示例（浏览器或 Node.js）
- [ ] **P2-6.4**: 写 README 演示如何跑起来

### 验收标准
```bash
# HTTP
$ curl http://localhost:8080/api/1/1 -d '"Alice"'
{"id":478,"nickname":"Alice"}

# WebSocket
$ node ws-client.js
> connected
> send: {"cmd":1,"subCmd":1,"data":"Alice"}
< recv: {"id":478,"nickname":"Alice"}
```

---

## Phase 2 范围外（明确不做）

| 项 | 原因 | 推迟到 |
|---|---|---|
| UDP | 复杂度高，需要可靠传输 | Phase 3 |
| Protobuf 编解码 | 单独模块 | Phase 4 |
| 分布式 Logic Server | 需要 Center Server | Phase 3 |
| 全链路 Trace | 需要跨进程上下文 | Phase 3 |
| JSR380 校验 | 需要 schema 设计 | Phase 2 末尾或 Phase 3 |

---

## 风险与回退点

| 风险 | 触发条件 | 回退方案 |
|---|---|---|
| Node.js HTTP 性能不足 | QPS 低于预期 | 考虑 Bun 或 Fastify |
| WebSocket 广播复杂 | 需要大规模广播 | 引入 Redis Pub/Sub |
| Session 存储扩展性 | 单机内存不足 | 切换到 Redis session store |

---

**Phase 2 状态：⏳ 待开始**
