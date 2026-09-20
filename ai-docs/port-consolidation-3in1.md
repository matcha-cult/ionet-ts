# 端口三合一方案：:3001 / :3002 并入 :3000

> 状态：**已实施**（2026-07-29）。实施与原设计的偏差见下方「〇、实施记录」；可行性核验见 `port-consolidation-3in1-feasibility.md`。
> 关联红线：CLAUDE.md「ionet Action 与 NestJS 边界」条款——例外条款已随代码同批补入（见 §7）。

---

## 〇、实施记录（2026-07-29 落地）

评估核验了本文档全部核心断言（源码级 + 依赖库实物），以下为实施时的修正（均已落地）：

1. **生产前提更正**：生产同样走 TypeScript External Server，@nbb-ionet 仅 WS 侧为生产能力——
   原「生产走 Java External Server」表述作废（§一 非目标第 2 条已改）。assertNotProduction 红线
   **功能保留**（NestJS 嵌入形态 dev-only），错误文案中的 Java 指引为历史遗留。
   生产拓扑形态（WS 独立进程 vs attach 同进程）待定；框架 standalone/attach 双模能力均已就位。
2. **A1 更正**：实际文件为 `websocket/ws-server.ts`。attach 模式 `start()` **立即 resolve**——
   ws 的 `listening` 事件转发自共享 server 的 listen，晚于 NestJS onModuleInit，等待会与之死锁。
   `stop()` 先 terminate 全部客户端再 `wss.close()`（attach 的 close 只等连接自然断开，30s 心跳永不放手）。
3. **A2 更正**：`HttpAdapterHost.getHttpServer()` 在 provider 工厂阶段为 **undefined**
   （NestApplication 构造晚于工厂执行）——初版改为 IonetModule 注入 HttpAdapterHost、onModuleInit 取
   server 并经 `wsServer.start(skeleton, server)` 注入（此项在运行时验证后再次修正，见第 7 条）。
   `WsServerOptions` 改 extends
   `WebSocketExternalServerOptions`（补 path/heartbeatInterval，否则 B2 显式 path 编译失败）。
   `@nestjs/core` 已是 peerDependency，无需追加。
4. **B1 更正**：body 分流按 `req.is('application/json')` 而非 `req.body === undefined`——
   body-parser@1.20.4 在类型检查前执行 `req.body = req.body || {}`，后者是死分支，
   误用会让「无 CT 头的 JSON POST」静默丢 token；路由用 `@Post` 而非 `@All`（防 OPTIONS 执行 Action）；
   非法 JSON（JSON CT）在中间件层即抛 `entity.parse.failed`、到不了控制器 catch——
   main.ts 紧随 body parser 注册错误重塑中间件（仅 `/api/{数字}/{数字}`：400 / 413 信封）。
   `isWrappedData` 为 http-server.ts 文件局部函数（未导出），桥接侧逐字复制并注释 ground truth。
5. **开发开关（新增 B2）**：`IONET_STANDALONE_PORTS=true` 恢复独立 :3001 HTTP + :3002 WS（开发调试旧形态），
   桥接端点并存（三传输共享 skeleton）；默认 false 三合一。生产安全由 assertNotProduction 红线兜底，不依赖默认值。
6. **§六 矩阵备注**：`/api/1/2/extra`（原 :3001 接受）合并后 404；非法路径 404 为 NestJS 形状（§八 已自认非信封）；
   JSON CT 标量 body（如 `"str"`）原 200、合并后经 strict parser 为 400 信封；
   body 统一受 1mb 上限（原 :3001 裸读无限制）：超限 JSON CT → 413 信封、裸读回退 → 400；
   chunked 空载经 `{}` → `isWrappedData` 解包收敛为 data undefined（与原语义一致）。
   空 body（CL=0 / 无 CL 无 TE）特判为 undefined——与 ground truth 的 `if (body)` 保护一致（§五-B1 原论述正确）。
7. **接线方式再修正（第 3 条终版：应用侧推送）**：运行时启动失败暴露跨仓库 pnpm workspace 链接
   （idle-matcha 经 `workspace:*` 引入 `../ionet-ts/packages/*`）使应用侧与框架侧解析到**两份物理的
   @nestjs/core**（`node -e` 实证 `HttpAdapterHost` 类对象 `!==`，inode 不同）。@nestjs/core 的类令牌
   注入跨副本静默降级为 undefined（`@Optional()` 吞掉），模块侧拉取 HttpAdapterHost 在此部署形态下
   永远失败（vitest 单仓库内单副本故测试通过、生产双副本失败）。终版：IonetModule 暴露
   `attachHttpServer(server: Server)` setter，main.ts 在 `app.init()` 之前
   `app.get(IonetModule).attachHttpServer(app.getHttpServer())`——IonetModule 类来自同一 workspace
   符号链接副本、http.Server 为 node 内置，二者身份安全。端到端测试与 main.ts 同形。
8. **core-framework 既有缺陷修复（冒烟验证发现，与三合一无关）**：
   `DefaultActionCommandParser.extractParameters/extractReturnType` 对 `design:paramtypes` 做
   **单参读**（method 函数本身），而 tsc emitDecoratorMetadata 以 `(prototype, methodName)` 为键存储
   ——读取永远 undefined → FlowContext 参数一律误判 DATA，形如 `method(ctx, data)` 的 Action 第一实参
   被错填 data（`ctx.getUserId is not a function`，全部鉴权保护写操作中招；Phase 3 清单自标「待运行时
   验证」，register/login 无 ctx 参数恰好幸存）。改为三参读 + 单参回退，新增回归测试
   （core-framework 98/98）。冒烟矩阵随后全绿：register/login 取 token → 带 token 建角 200 →
   无 token 走协议层鉴权错误信封（非 NestJS 403）。

---

## 一、背景与目标

当前 server 进程暴露三个 HTTP/WS listener：

| 端口 | 环境变量 | listener 归属 | 职责 |
|---|---|---|---|
| :3000 | `NEST_PORT` | NestJS（platform-express，单 http.Server） | 67 条只读查询 + GM 鉴权接口 + 60 条写操作兼容层（`src/compat/`）+ health + 管理 API；带 CORS（origin 反射）、1mb body 解析、全局 JwtAuthGuard（APP_GUARD）、BusinessExceptionFilter |
| :3001 | `IONET_HTTP_PORT` | ionet-ts `HttpExternalServer`（自建 `node:http` listener） | 玩家写操作协议 `POST /api/{cmd}/{subCmd}`（cmd/subCmd 纯数字），响应信封 `createResponseMessage`，**无 CORS** |
| :3002 | `IONET_WS_PORT` | ionet-ts `WebSocketExternalServer`（`ws` 自建 listener，`/ws` 路径 + 30s 心跳） | 同协议的 WS 通道 |

**目标**：三端口合一，进程仅保留 `NEST_PORT`（:3000）一个 listener。HTTP 协议端点变为
`POST :3000/api/{cmd}/{subCmd}`，WS 端点变为 `ws://:3000/ws`。

**动机**：
1. 前端（Phase 5）零存量依赖——`packages/client` 未引用任何端口，旧 stock-sim 前端只打 :3000 兼容层，无迁移成本。
2. :3001 当前无 CORS，Phase 5 浏览器前端跨源调用必然失败；合并后自动获得 :3000 的 CORS。
3. 减少端口心智负担与部署面（端口映射、防火墙规则单一化）。

**非目标**：
- 不动兼容层（`src/compat/`）任何路由与语义。
- 不动生产拓扑规划（TS 侧 ionet 通道经 `IonetModule.assertNotProduction` 限定为开发/调试嵌入形态；生产同样走 TS External Server，仅 WS 侧为生产能力，拓扑形态待定）。
- 不改 WS 协议帧格式、心跳机制。
- 不改任何 Action 业务逻辑与 cmd/subCmd 编号。

---

## 二、可行性论证（已核验）

1. **路径命名空间零重叠**。:3000 全部路由第二段为单词（`/api/auth`、`/api/stock-market`、`/api/gm/farm` 等，见 `src/query/`、`src/compat/` 各 `@Controller('api/...')`）；ionet 协议严格要求 `/api/纯数字/纯数字`（`HttpExternalServer.parsePath` 对 `parseInt` 为 NaN 直接拒绝）。同端口按路径分流零歧义。
2. **鉴权天然兼容**。ionet 鉴权由骨架内 `AuthInOut.fuckIn` 承担，token 取自 `ctx.getRequest().data.token`（`src/middleware/auth.inout.ts`，尽力而为策略）。桥接只需以与 `HttpExternalServer` 完全相同的形状调用 `skeleton.execute({cmd, subCmd, data})`，鉴权链路无变化。
3. **WS upgrade 与 express 互不干扰**。express 不监听 http.Server 的 `upgrade` 事件；`ws` 以 `{ server, path: '/ws' }` 挂载时按路径过滤 upgrade 请求。`/ws` 路径与任何 REST 路由无交集。
4. **同进程共享 BarSkeleton**，无分布式问题；`IONET_BAR_SKELETON` 已由 `IonetModule`（`@Global()`）导出，可注入。
5. **开关语义可保持**。`IONET_CHANNEL_ENABLED=false` 整体摘除 IonetModule——HTTP 桥接控制器随同一开关条件注册即可；WS 挂载在 IonetModule 内部，随模块摘除。

---

## 三、总体设计

```
合并后（单 listener :3000，NestJS http.Server）
├── express 路由层（NestJS router）
│   ├── /api/<word>/...        查询层 67 条 + GM + 兼容层 60 条 + /health（不变）
│   └── /api/:cmd(\d+)/:subCmd(\d+)   ★新增 ionet HTTP 桥接控制器 @Public()
│         → skeleton.execute({cmd, subCmd, data}) → createResponseMessage 信封
└── http.Server 'upgrade' 事件
    └── ws { server, path: '/ws' }   ★ionet-ts 新增 attach 模式（WebSocketExternalServer）
          → skeleton.execute（帧格式、心跳不变）
```

**分工原则（为何 HTTP 在应用侧、WS 在框架侧，不对称）**：
- HTTP 桥接必须与 NestJS 路由表/全局 Guard/body parser 共存，属于应用侧关切，放 `packages/server`（NestJS 控制器形态，可被全局中间件链一致地管理）。
- WS upgrade 与 express 完全正交，心跳/连接表/帧编解码是传输实现本身，天然属于 ionet-ts；`ws` 原生支持 `{ server }` 挂载，框架仅需增加一个模式开关，逻辑零复制。

---

## 四、改动清单 A：ionet-ts（/home/nbb/projects/ionet-ts）

> 与 idle-matcha 同属一个 pnpm workspace（idle-matcha/pnpm-workspace.yaml 含 `../ionet-ts/packages/*`），改动后统一在 idle-matcha 根 `pnpm -w run build` 校验。

### A1. `packages/external-server/src/websocket/websocket-server.ts` — 增加 attach 模式

- `WebSocketExternalServerOptions` 扩展：
  - `server?: Server`（`node:http` 的 Server）；与 `port` 二选一。
  - 由于 `ExternalServerOptions.port` 为必填，本接口用 `Omit<ExternalServerOptions, 'port'> & { port?: number; server?: Server }` 派生，并在构造时断言「port 与 server 恰有一个」，否则抛明确错误。
- `start(skeleton)` 分支：
  - attach 模式：`new WebSocketServer({ server: options.server, path: this.path })`；**不**自起 listener、**不**打印 "listening on ws://0.0.0.0:port"，改打印 `WebSocket External Server attached to existing HTTP server at path ${this.path}`。
  - 独立模式：行为与日志逐字不变。
- `stop()`：保持 `wss.close()`。ws 在 attach 模式下 `close()` 只停止处理 upgrade 并断开客户端，**不会关闭共享的 http.Server**（ws 库语义，不持有所有权）——NestJS 停机时由其自行关闭 http server，顺序上 IonetModule.onModuleDestroy 早于 NestJS http server 关闭，天然安全。
- `BaseExternalServer.port` getter：attach 模式下 `options.port` 为 undefined，返回 `options.port ?? -1`（或把 getter 语义标注为「独立模式端口」）。
- 心跳逻辑（`startHeartbeat`/pong/terminate）两种模式完全共用，不改。

### A2. `packages/extension-nestjs` — IonetModule 支持挂载到 NestJS http server

- `ionet.interfaces.ts`：`WsServerOptions` 增加 `attachNestServer?: boolean`；为 true 时 `port` 可省略。
- `ionet.module.ts` 的 wsServerProvider（`forRoot` 与 `forRootAsync` 各一处，**两处同步改**）：
  - inject 追加 `HttpAdapterHost`（来自 `@nestjs/core`，NestJS 框架全局提供；`extension-nestjs` 的 package.json 需确认/追加 `@nestjs/core` 依赖，与 `@nestjs/common` 同版本策略）。
  - 工厂逻辑：`attachNestServer === true` 时，取 `adapterHost.httpAdapter.getHttpServer()`，构造 `new WebSocketExternalServer({ ...serverOpts, server })`；拿不到 adapter 时抛明确错误（「attachNestServer 需要 NestJS HTTP 上下文」）。
  - `attachNestServer` 字段须在透传给 `WebSocketExternalServer` 前剥离（同现有 `enabled` 的解构剥离写法）。
- IonetModule.onModuleInit/onModuleDestroy 流程不变（start/stop 已统一）。
- **新增测试**（`packages/external-server/src/websocket-server.test.ts` 追加用例）：创建裸 `http.Server` listen 随机端口 → attach 模式启动 → ws 客户端发 `{cmd, subCmd, data}` → 断言响应信封；再断言该 http.Server 上另一个 'request' 监听器（模拟 express）不受影响。独立模式既有用例保持通过。

### A3. 兼容性

- `HttpExternalServer` **零改动**（HTTP 传输改由 idle-matcha 应用侧承载）。
- 现有独立端口模式（`{ port }`）行为逐字不变，ionet-ts 其他消费方（若有）不受影响。

---

## 五、改动清单 B：idle-matcha（/home/nbb/projects/idle-matcha）

### B1. 新增 ionet HTTP 桥接控制器

新文件 `packages/server/src/actions/ionet-bridge.controller.ts`（归属：直接进 `AppModule.controllers`，与 HealthController 同档；不新建 Module）。

职责与语义复刻基准：`ionet-ts/packages/external-server/src/http/http-server.ts` 的 `handleRequest`——逐字对齐以下契约：

| 环节 | 原 HttpExternalServer 行为 | 桥接实现要点 |
|---|---|---|
| 路由 | `parsePath`：`/api/数字/数字`，其余 404 | `@Controller('api')` + `@All(':cmd(\\d+)/:subCmd(\\d+)')`（express 路由正则，非数字段不会进入本控制器，天然 404 由 NestJS 兜底） |
| 鉴权 | 骨架内 AuthInOut 从 data.token 取 | 类级 **`@Public()`** 豁免全局 JwtAuthGuard（`src/query/decorators/public.decorator.ts`）；token 随 data 透传，AuthInOut 自然生效。**漏标 @Public 会 401 在 Guard 层——首要坑点** |
| 请求体 | 裸读流 → `codec.decode`（JSON.parse）→ `isWrappedData` 则解包 `.data` | express json parser（main.ts 已全局挂载，1mb）已解析 → `req.body` 为对象。空 body 特判：原语义空 body → `data: undefined`，而 json parser 产出 `{}`——以 `content-length` 为 0/缺失且无 `transfer-encoding` 判定空 body，传 `undefined`。非 JSON Content-Type 时 json parser 不消费流（`req.body === undefined`）→ 裸读流后 JSON.parse，解析失败 400（复刻原版 `Invalid request body`），保持对任意 Content-Type 的宽松兼容。最后同样执行 `isWrappedData` 解包 |
| 执行 | `skeleton.execute({cmd, subCmd, data})` | 注入 `IONET_BAR_SKELETON`（IonetModule 全局导出），同形调用。cmd/subCmd 由路由参数 `parseInt` 得到 |
| 响应 | `createResponseMessage(result)` → `Content-Type: application/json` → `statusCode = errorCode>=400 ? errorCode : 200` | import `createResponseMessage`（`@nbb-ionet/core-framework`）；`@Res({ passthrough: true })` 设置状态码后 return 信封对象（NestJS 序列化，BigInt toJSON polyfill 全局已生效，与原版同进程同语义） |
| 异常 | try/catch → 500 `{"error":"Internal server error"}` | 同形 catch；注意 BusinessExceptionFilter 是全局过滤器——桥接内自行 catch 后返回 500 信封，**不让异常逃逸到过滤器**（否则响应形状偏离 ionet 协议）。skeleton 内部已消化业务错误为信封 errorCode（与 :3001 现状一致），catch 仅兜底传输级意外 |
| 骨架未就绪 | 503 `Service not ready` | 不可能发生（skeleton 为必需注入，DI 失败即启动失败），无需复刻 |

文件头按 CLAUDE.md 注释规范写中文结构化注释（作用/输入输出/数据流/复用设计/≥2 条坑点），并注明「传输层桥接，非新增业务接口；ground truth 为 ionet-ts HttpExternalServer.handleRequest」。

### B2. `packages/server/src/app.module.ts`

- 删除 `IONET_HTTP_PORT` / `IONET_WS_PORT` 常量与相关 env 读取。
- `IonetModule.forRoot` 配置改为：
  - `httpServer: false`（HTTP 传输移交桥接控制器）；
  - `wsServer: { attachNestServer: true, path: '/ws' }`（path 为默认值可省，显式写出更清晰）；
  - actions / inOuts / redis 配置逐字不变。
- `controllers` 改为条件数组：`IONET_CHANNEL_ENABLED ? [HealthController, IonetBridgeController] : [HealthController]`（模块顶层 const，与现有 IonetModule 条件注册同款写法）。
- 头部注释同步更新（见 §7 文档清单）。

### B3. `packages/server/src/main.ts`

- 启动日志：删除 :3001 行；`IONET_CHANNEL_ENABLED !== 'false'` 分支改为打印「ionet 协议端点（同端口）：POST /api/{cmd}/{subCmd}、ws://localhost:${nestPort}/ws」；禁用分支文案保留并更新。
- 停机钩子注释补一句：WS 以 attach 模式共享 http server，onModuleDestroy 先停 ws、NestJS 后关 server（顺序由现有生命周期天然保证）。
- `app.listen(nestPort)` **不加 host 参数**（维持现状绑定全部网卡；原 :3001/:3002 曾按 SERVER_HOST=localhost 绑定，合并后开发机局域网可达性轻微变化，可接受——旧前端调试本就走 :3000）。

### B4. env 清理

- `packages/server/.env` 与 `.env.example`：删除 `IONET_HTTP_PORT`、`IONET_WS_PORT`、`SERVER_HOST`（合并后无任何使用方——核验：仅 app.module.ts ionet server 配置引用）三项；`NEST_PORT` 注释改为「唯一对外服务端口（REST + ionet 协议 HTTP/WS）」。
- `IONET_CHANNEL_ENABLED` 注释更新：false 时「ionet 协议端点（HTTP 桥接 + WS 挂载）整体不存在，60 条写操作仅经兼容层暴露」。

### B5. 依赖

- `packages/server` **无需**新增 `ws` 依赖（WS 逻辑在 ionet-ts 内，其 external-server 包已依赖 ws）。
- ionet-ts `extension-nestjs` 如缺 `@nestjs/core` 依赖则按 A2 补齐。

---

## 六、语义兼容性矩阵（验收基准）

| 场景 | 合并前（:3001/:3002） | 合并后（:3000） | 必须一致 |
|---|---|---|---|
| `POST /api/0/1`（ping） | 200 + 信封 | 同 | ✅ |
| `POST /api/1/2`（login，body 含账密） | 200 + data.token | 同 | ✅ |
| `POST /api/4/5`（买股，body 含 token） | AuthInOut 生效 | 同 | ✅ |
| 业务错误（如余额不足） | 200/4xx + errorCode 信封 | 同（skeleton 产出，传输层不干预） | ✅ |
| 空 body POST | data=undefined 进骨架 | 同（B1 空 body 特判） | ✅ |
| 非法 JSON body | 400 `{"error":"Invalid request body"}` | 同 | ✅ |
| 未注册 cmd/subCmd | 骨架层错误信封 | 同 | ✅ |
| `GET /api/auth/bootstrap`（REST 查询） | :3000 正常 | 不受桥接影响（第二段非数字） | ✅ |
| `POST /api/auth/login`（兼容层） | :3000 正常 | 不受影响 | ✅ |
| `ws://:3000/ws` 发 `{cmd,subCmd,data}` | （原 :3002 行为） | 帧格式/心跳/响应信封逐字同 | ✅ |
| `ws://:3000/其他路径` upgrade | N/A | 拒绝（ws path 过滤） | ✅ |
| `IONET_CHANNEL_ENABLED=false` | :3001/:3002 不存在 | `/api/{数字}/{数字}` 404、`/ws` upgrade 拒绝；兼容层与查询层不受影响 | ✅ |

---

## 七、CLAUDE.md 红线例外条款（随代码同批提交）

CLAUDE.md「ionet Action 与 NestJS 边界（强制）」条款禁止「在 NestJS 侧重新实现、转发或包装 @ActionMethod 提交接口」。本方案的 HTTP 桥接在形态上命中「转发」字面，需像兼容层条款一样补入明确例外。建议在兼容层例外条目后追加：

> - **ionet 协议 HTTP 桥接**（`packages/server/src/actions/ionet-bridge.controller.ts`）：三端口合一决策（`ai-docs/port-consolidation-3in1.md`）——
>   将 `POST /api/{cmd}/{subCmd}` 透传至共享 BarSkeleton，是**传输层桥接而非新增业务接口**：
>   不实现任何 Action 方法体逻辑、不改变路由编号与响应信封，ground truth 为 ionet-ts `HttpExternalServer.handleRequest`。
>   随 `IONET_CHANNEL_ENABLED` 开关与 IonetModule 同生共死。WS 通道经 ionet-ts attach 模式挂载同一 http server（逻辑在框架内，零复制）。

同步更新的存量表述（搜索 `3001` / `3002` / `IONET_HTTP_PORT` / `IONET_WS_PORT`）：
- `CLAUDE.md`：端口相关描述、「HTTP :3001 / WS :3002」字样。
- `packages/server/src/`：`app.module.ts`、`main.ts`、`query/query.module.ts`、`health/health.controller.ts`、`query/guards/jwt-auth.guard.ts`、`compat/compat.module.ts` 中的注释表述。
- `docs/migration-route-map.md`、`ai-docs/phases/phase-0.md`、`phase-3.md`、`phase-5.md`、`ai-docs/phases/phase-3-route-channel-classification.md`、`ai-docs/migration-master-plan.md`、`ai-docs/review-protocol.md`、`ai-docs/nestjs-cli-migration-assessment.md`。
- 若上述文档存在 `- [ ]` 任务项因本次工作完成，按 CLAUDE.md 规则改为 `- [x]`。

---

## 八、验证清单

1. **构建**：idle-matcha 根 `pnpm -w run build`（覆盖两仓库全部 workspace 包）+ `packages/server` 下 `tsc -b`。零错误。
2. **ionet-ts 测试**：external-server 包测试套件全绿（含 A2 新增 attach 用例）。
3. **冒烟（启动 server 后）**：
   - `curl -s -X POST localhost:3000/api/0/1` → 200 + 信封；
   - 经桥接完成 register/login，取 token 后调一条写操作（如背包相关）→ 信封 data 正确；
   - `curl localhost:3000/api/auth/bootstrap`（REST 查询）与兼容层任一路由 → 行为不变；
   - `wscat -c ws://localhost:3000/ws` 发 `{"cmd":0,"subCmd":1}` → 信封响应；心跳 30s ping 可观察；
   - 非法路径 `POST localhost:3000/api/abc/1` → 404（非信封）；
4. **开关验证**：`IONET_CHANNEL_ENABLED=false` 重启 → `/api/0/1` 404、`/ws` upgrade 失败、:3000 查询层与兼容层正常。
5. **CORS 验证**：带 Origin 头的 OPTIONS/POST 打桥接路由 → 反射 Origin 的 CORS 头存在（合并附带收益，Phase 5 前端依赖项）。

## 九、风险与回滚

| 风险 | 等级 | 处置 |
|---|---|---|
| 桥接遗漏 @Public → 全体写操作 401 | 高 | §六 冒烟第 2 条直接暴露；code review 首查项 |
| 空 body 语义偏离（{} vs undefined）导致个别 Action 行为差异 | 中 | §六 矩阵专项；复刻 content-length 判定 |
| express json parser 对非 JSON Content-Type 的行为差异 | 低 | B1 裸读流回退路径已覆盖 |
| ws attach 模式 stop 顺序 | 低 | onModuleDestroy 早于 http server 关闭，NestJS 生命周期天然保证 |
| 回滚 | — | 纯增量改动（框架加模式、应用加控制器）：恢复 app.module.ts 配置 + env 即回三端口，无需数据迁移 |

## 十、实施顺序建议

1. ionet-ts A1 → A2 → A3（测试先行或同步），在 ionet-ts 内自测通过。
2. idle-matcha B1 → B2 → B3 → B4。
3. §七 文档/注释/红线例外条款同批更新。
4. §八 全量验证，构建零错误后提交（两仓库各自提交，提交信息遵循 CLAUDE.md：无 Co-Authored-By 签名）。
