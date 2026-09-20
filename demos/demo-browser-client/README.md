# demo-browser-client · 浏览器参考客户端

在浏览器里与 ionet 服务交互的最小参考客户端。**零框架依赖**：本包源码不 import 任何框架
workspace 包（核心包运行时依赖 Node 内置 async_hooks 模块，浏览器加载即炸），也不引用任何
Node 内置模块——只用平台原生 **WebSocket + fetch**。线协议语义以仓库根 `PROTOCOL.md` 为唯一真相。

## 能力清单（对应着 PROTOCOL 条款）

| 能力 | 条款 | 实现位置 |
|---|---|---|
| 连接 `/ws`、文本帧 JSON | §1/§2 | `src/client.ts` |
| 请求信封（cmd/subCmd/data/headers/traceId/reqId） | §3 | `src/client.ts` |
| 按 reqId 精确配对响应，支持并发在途；旧服务（响应不带 reqId）按最早在途回退 | §4/§4.1 | `src/client.ts` |
| `kind=notification` 推送分流，不当作响应 | §5 | `src/client.ts` |
| 握手鉴权：`?token=<jwt>` 查询参数；无 token 给出可见 401 提示 | §6 | `src/client.ts` + `index.html` |
| 应用层心跳：定时 `(1,1) system.ping`（可配置；收到回执计存活） | §7 | `src/client.ts` |
| 错误语义：`errorCode !== 0` 统一判失败 | §8 | `src/client.ts` `isSuccess()` |
| HTTP fallback：`POST {prefix}/{cmd}/{subCmd}`（响应不带 reqId/kind） | §9 | `src/client.ts` `requestHttp()` |
| 断线自动重连，重连重新携带（可能已更换的）token | 任务要求 7 | `src/client.ts` |

## 目录结构

```text
demo-browser-client/
├── index.html          # 最小 UI（token → 连接 → 发 (30,1) → 渲染响应与推送）
├── src/
│   ├── client.ts       # 浏览器客户端核心（零依赖，纯 Web 平台 API）
│   ├── index.ts        # 公共导出
│   └── main.ts         # 演示页逻辑（DOM）
├── smoke/
│   ├── stub-ws-server.ts  # 冒烟用桩服务端（最小 RFC6455，零 npm 依赖；仅 Node 侧）
│   └── smoke.ts        # 无头冒烟（Node >= 22 内置 WebSocket/fetch）
└── dist/               # tsc 产物（gitignored），index.html 以 ES module 直接加载
```

## 浏览器验证步骤（手工）

1. **安装并构建**：`pnpm install`，然后 `pnpm --filter demo-browser-client run build`（生成 `dist/`）。
2. **起一个 ionet 服务**（任意 demo 或自研服务均可）：确认 WS 端点为 `ws://<host>:<port>/ws`
   （PROTOCOL §1 默认路径 `/ws`）。若服务配置了鉴权钩子，请准备好合法 token。
3. **静态托管本目录**（ES module 不能从 file:// 直接加载）：
   ```bash
   cd demos/demo-browser-client && python3 -m http.server 5173
   # 或 npx serve demos/demo-browser-client
   ```
4. **打开** `http://localhost:5173/`（或 serve 给出的地址）：
   - WS 端点默认 `ws://localhost:8081/ws`（按实际部署修改；若页面经 https 托管则用 `wss:`）。
   - **token 留空时**页面显示醒目红色提示：服务端会在握手阶段以 **HTTP 401** 拒绝（§6）；
     **粘贴 token** 后再点「连接」，提示消失。
5. **连接**：状态徽标转为 `open`，日志出现「已连接并完成握手鉴权」。
6. **发一条只读 Action**：默认 `(30,1)`（item 背包查询），点「WebSocket 发送」→ 响应区渲染
   成功数据、reqId 回显与 kind；也可以改 cmd/subCmd 换其它只读路由。
7. **推送**：服务端主动推送的帧（`kind=notification`）实时出现在「服务端主动推送」列表，
   不进入响应配对。
8. **心跳**：约 15s 内「应用层心跳」显示首次回执；之后每次回执刷新时间与计数。
9. **断线重连**：停掉服务再重启，客户端进入 `reconnecting` 并以退避间隔自动重连；
   重连会重新携带当前 token（在此期间改 token，重连即用新值——服务端不支持时会被 401 拒绝并给出提示）。
10. **HTTP fallback**：点「HTTP fallback 发送」走 `POST {prefix}/{cmd}/{subCmd}`（§9），
    响应不带 reqId/kind，UI 同构展示。

## 无头冒烟（脚本化，任务 2）

```bash
# 自包含模式：起桩服务端（协议语义子集）+ 真实客户端，全自动断言，无需任何外部服务
pnpm --filter demo-browser-client run smoke
# 期望输出末尾：=== SMOKE PASS：N/N 项检查通过 ===

# 外联真实服务模式：对任意已运行的 ionet 服务验证四态
IONET_WS_URL=ws://localhost:8081/ws IONET_TOKEN=<token> \
  pnpm --filter demo-browser-client run smoke
```

可选环境变量（仅外联模式）：`IONET_CMDS`（请求路由，默认 `30,1`）、
`IONET_HEARTBEAT`（默认 `1,1`）、`IONET_PUSH_WAIT_MS`（推送观察窗口，默认 4000）。

自包含模式固定断言：鉴权 401 负向路径（含可见提示）→ token 握手 open →
`(30,1)` 请求/响应配对 → 推送帧 kind 分流 → 3 路并发乱序返回按 reqId 精确配对 →
旧服务（响应不带 reqId）最早在途回退 → 心跳回执 → HTTP fallback（含 404 语义）。

> Node 版本要求：浏览器产物无此要求；冒烟脚本使用 Node 内置全局 WebSocket/fetch，
> 需 Node >= 22（本包 engines 已声明）。

## 红线自查（与甲方验收点对应）

本包源码不 import 任何框架 workspace 包、不引用 Node 内置模块，浏览器产物（`dist/src/`）同样
干净。具体复核命令（框架包名零命中、产物不带 Node 内置前缀）见本次协作的乙方镜像回报
（`ai-docs/collab/protocol_20260913_0108_002-B.md`），两条均给出与结果。
