# 端口三合一方案可行性评估报告

> 评估对象：`ai-docs/port-consolidation-3in1.md`（:3001 ionet HTTP / :3002 ionet WS 并入 :3000 NestJS 单 listener）
> 评估日期：2026-07-28
> 评估方法：对文档每条核心技术断言做源码级核验（ionet-ts 框架侧、idle-matcha 应用侧、依赖库 node_modules 实物、两仓库文档），叠加独立架构审查。

> **勘误（2026-07-29 运行时验证后补记）**：本报告的修正 ★1/§三-A2 建议的「模块侧注入 HttpAdapterHost、
> onModuleInit 拉取 http.Server」在跨仓库 workspace 链接部署下不可用——应用侧与框架侧解析到两份物理
> @nestjs/core，类令牌注入静默降级为 undefined（静态核验无法发现，vitest 单仓库单副本亦掩盖之）。
> 终版改为应用侧推送（`app.get(IonetModule).attachHttpServer(app.getHttpServer())`）。另在冒烟验证中
> 发现并修复 core-framework ActionCommandParser 元数据键位读取的既有缺陷。
> 详见 `port-consolidation-3in1.md` §〇 实施记录第 7、8 条。

---

## 总体结论

**方案可行，设计高质量，可按其「改动清单」实施。**

- 12 条核心断言中 10 条完全证实、1 条版本信息偏差（实际风险比文档假设更低）、1 条依赖声明已提前满足。
- 发现 9 处需修正/补充的细节，其中 1 处是文档未点明的真实陷阱（attach 模式启动死锁），其余为类型、路径、文档同步层面的小修。
- 无阻塞项。修正点全部不改变总体架构（HTTP 桥接在应用侧 / WS attach 在框架侧的不对称分工成立）。

---

## 一、断言核验结果

| 文档断言 | 核验结果 |
|---|---|
| 路径命名空间零重叠（REST 第二段均为单词，ionet 要求纯数字） | ✅ 28 个 query + 13 个 compat 控制器全部 `@Controller('api/<单词>...')`，无一为数字；`parsePath` 对 NaN 直接拒绝 |
| 鉴权天然兼容（AuthInOut 从 `data.token` 尽力而为取） | ✅ `auth.inout.ts:48` `fuckIn`，token 取自 `ctx.getRequest()?.data.token`，尽力而为策略，与文档描述逐字一致 |
| WS upgrade 与 express 互不干扰；ws 按 path 过滤 | ✅ ws@8.21 源码核实：`{server}` 模式自动挂 upgrade 监听器；非 `/ws` 路径走 `abortHandshake(socket, 400)` **原生拒绝**（不会挂起），无需手动干预 |
| ws attach 模式 `close()` 不关闭共享 http.Server | ✅ 源码核实：`options.server` 分支只 `_removeListeners()` + 等客户端连接自然关闭，不碰共享 server（`websocket-server.js` close() 双分支实现） |
| `IONET_BAR_SKELETON` 由 @Global IonetModule 导出、可注入 | ✅ forRoot/forRootAsync 均导出该 Symbol；bridge 可直接 `import { IONET_BAR_SKELETON } from '@nbb-ionet/extension-nestjs'`（packages/server 已依赖该包，tsconfig 有 `@nbb-ionet/*` 映射），无需 workspace 协议变更 |
| 全局 JwtAuthGuard + @Public 豁免机制 | ✅ APP_GUARD 注册于 `query.module.ts:29`；`@Public()` = `SetMetadata('isPublic')`（`public.decorator.ts:3`），guard 显式检查放行（`jwt-auth.guard.ts:21+`） |
| skeleton.execute 同形调用、createResponseMessage 信封 | ✅ `createResponseMessage` 在 core-framework `protocol/message.ts:38`，从包根导出；信封 `{data, errorCode, errorMessage, headers}` |
| HttpExternalServer 零改动、其他消费方不受影响 | ✅ 类本身不改；3 个 demos（demo / demo-cluster / demo-mmorpg）直接构造它但走独立端口模式，零影响 |
| 开关语义（IONET_CHANNEL_ENABLED 整体摘除） | ✅ `app.module.ts:68-115` 条件注册；bridge 控制器随同一开关条件进 `controllers` 即可同生共死 |
| extension-nestjs 需「确认/追加 @nestjs/core 依赖」(A2/B5) | ✅ **已满足**：package.json 已声明 `@nestjs/core >=10.0.0` peerDependency（与 @nestjs/common 同策略），HttpAdapterHost 导入合法。无需任何依赖改动 |
| 技术栈版本（隐含于路由正则风险评估） | ❌ **实际为 NestJS 10.4.22 / Express 4.22.1 / path-to-regexp 0.1.13**（pnpm store 实物核实，非 11/5）。`:cmd(\d+)` 命名参数正则在 Express 4 原生支持——风险比文档假设的更低 |
| 空 body → body-parser 产出 `{}`（需 content-length 特判） | ✅ body-parser@1.20.4 源码 `json.js:75`：`if (body.length === 0) return {}`（注释明言 "special-case empty json body"）。特判必要且设计正确；非 JSON content-type 时 parser 跳过、流未消费，裸读回退路径成立 |

---

## 二、必须修正/补充的细节（按严重度）

### ★ 1. attach 模式 `start()` 禁止等待 `listening` 事件（文档遗漏的真实陷阱）

现有 `start()`（`packages/external-server/src/websocket/ws-server.ts:37-42`）通过 `this.wss.on('listening', resolve)` 返回 Promise。ws@8.21 源码核实：attach 模式下 wss 的 `listening` 事件是**共享 server 开始 listen 时的转发**（构造器 `listening: this.emit.bind(this, 'listening')`）。

NestJS 时序为 `NestFactory.create()`（含 onModuleInit → `wsServer.start()`）**先于** `app.listen()`——若 attach 分支复用该等待：onModuleInit 永不返回 → `create()` 不返回 → `app.listen()` 不执行 → `listening` 永不触发 → **启动死锁**。

**修正**：A1 实施时 attach 分支构造 `new WebSocketServer({ server, path })`、挂 connection 监听、启动心跳后**立即 resolve** 并打印 "attached" 日志；standalone 分支逐字不变。

### 2. `WsServerOptions` 类型缺字段（B2 按文档写法会编译失败）

`ionet.interfaces.ts` 的 `WsServerOptions extends ExternalServerOptions { enabled? }` **不含** `path` / `heartbeatInterval`（TS 字面量过量属性检查会拒绝）。文档 B2 计划写 `wsServer: { attachNestServer: true, path: '/ws' }` 将无法通过 `tsc`。

**修正**：A2 将 `WsServerOptions` 改为 extends `WebSocketExternalServerOptions`（或补 `path?`/`heartbeatInterval?` 字段），同时加 `attachNestServer?: boolean` 并把 `port` 放宽为可选。

### 3. `isWrappedData` 是 http-server.ts 文件局部函数、未导出；且语义比直觉宽

定义在 `http-server.ts:9-11`：任意「非 null 非数组对象」都视为 wrapped 并读 `.data`（键可以不存在 → undefined）。即客户端发 `{"foo":1}` → `data: undefined`。

**修正**：bridge 控制器需逐字复刻这 3 行谓词（就地复制 + 注释指向 ground truth `http-server.ts`），不要自行发明「有 data 键才算包裹」的判断。

### 4. 1MB body 上限成为 ionet 协议的新约束

原 :3001 裸读流**无大小限制**；合并后 JSON content-type 请求先过 express.json `1mb` 限制（超限抛 413 PayloadTooLarge，发生在 bridge try/catch 之前，响应形状与原 400/500 契约不同）。协议 payload 远小于 1MB，可接受此变化，但 B1 文件头坑点注释应记录。

**补充**：非 JSON content-type 的裸读流回退路径也要受同一 1MB 上限保护（手动累计字节数超限 → 400 `{"error":"Invalid request body"}`），否则留了个无界读取口子。

### 5. 文件名错误（A1）

实际路径 `packages/external-server/src/websocket/ws-server.ts`，非文档所写 `websocket/websocket-server.ts`。（新增测试的目标路径 `src/websocket-server.test.ts` 是正确的，该文件已存在；测试框架为 **vitest**，非 node:test。）另 `stop()` 现状是「先清心跳定时器再 wss.close()」，attach 模式保持不动即可。

### 6. 三处微小的行为差异（可接受，建议在 §六 矩阵备注）

- 原 `parsePath` 接受 3 段以上（`/api/1/2/extra` 在 :3001 有效）；Express 路由 `:cmd(\d+)/:subCmd(\d+)` 严格两段 → 合并后 404。无客户端会发多余段。
- 非法路径 404 的 body 形状：原 :3001 为 `{"error":"Invalid path format"}`，合并后为 NestJS 默认 404（`{"statusCode":404,"message":"Cannot POST ..."}`）。文档 §八 已自认「404（非信封）」，口径一致。
- chunked 空载（有 transfer-encoding 无 content-length 的空 JSON body）：原版裸读空流 → JSON.parse 失败 400；合并后 body-parser 产出 `{}` → 作为空 data 执行。极边缘场景，记录即可。

### 7. 文档/注释同步清单的补漏与更正（§七）

- 引用 3001/3002 的 md 文件共 **11 处命中**（含 CLAUDE.md 与文档自身）；§七 第三方文档清单基本完整，补漏 `ai-docs/phases/phase-4.md:31`。
- **清单项目录更正**：真正的端口相关 `- [ ]` 项是 `phase-0.md:57` 与 `migration-master-plan.md:155`（两处均为「curl :3001/api/0/1 健康检查待运行时验证」）——实施后改写 3001→3000 并翻 `- [x]`（§八 冒烟第 3 条即完成该验证）；`review-protocol.md:54` 是可复用 review 模板行，仅改写不翻转。（不存在 phase-3.md:661 / phase-5.md:29 的清单项。）
- **B4 env 路径更正**：`.env.example` 只在 idle-matcha 仓库根（`idle-matcha/.env.example`，含 NEST_PORT/IONET_HTTP_PORT/IONET_WS_PORT/SERVER_HOST 四项，且 IONET_CHANNEL_ENABLED 注释块提到 :3001/:3002）；`packages/server/.env.example` 不存在。实际目标 = `packages/server/.env` + 根 `.env.example`。
- **CLAUDE.md 红线精确落点**：边界章节在 `idle-matcha/CLAUDE.md:170-186`（7 条），新例外条款插在 179 行（compat 例外条目末）与 180 行（env 开关条目）之间；另第 ①④⑥ 条（172、180、183 行附近）含 :3001/:3002 字样需同步改写，⑥ 的「:3000 承载范围」需纳入 ionet 协议端点。结构化注释规范依据在同文件 235-244 行。

### 8. 设计文档本身在两个仓库各存一份（字节级相同）

`ionet-ts/ai-docs/port-consolidation-3in1.md` 与 `idle-matcha/ai-docs/port-consolidation-3in1.md` 内容完全一致（diff 核实）；§七 同步清单未覆盖这对孪生副本，且两仓库的 `ai-docs/README.md` 索引均未收录本文档。

**修正**：实施时决定保留一份（建议 ionet-ts 侧，改动清单 A 在框架侧）并在另一仓库留指引，或双份同步更新；顺手补 `ai-docs/README.md` 索引条目。

### 9. 审查中已证伪、无需采纳的顾虑

- 「需手动 abortHandshake 拒绝非 /ws upgrade」→ ws@8.21 原生 400 拒绝（见核验表），A2 测试只需断言非 /ws upgrade 被拒。
- 「@nestjs/core 依赖缺失」→ 已是 peerDep。
- 「Express 5 / path-to-regexp v8 路由正则语法风险」→ 实际是 Express 4，语法原生支持。
- 「停机顺序风险」→ onModuleDestroy 早于 http server 关闭由 NestJS 生命周期保证；attach 模式 `close()` 不主动断开存量 ws 客户端这点与现状（standalone `close()` 同样等待客户端自然关闭、最终由 main.ts 10s 强退兜底）行为等价，非回退。

---

## 三、修正后的执行步骤

按文档 §十 顺序（ionet-ts 先行、idle-matcha 随后、两仓库各自提交），以本清单替换/补充对应条目：

**A（ionet-ts）**

1. **A1**：`packages/external-server/src/websocket/ws-server.ts` 增加 attach 模式。选项类型派生为 `Omit<WebSocketExternalServerOptions, 'port'> & { port?: number; server?: Server }`（构造时断言 port/server 恰有一个，错误信息明确；ws 构造器本身也有同款断言兜底）。`start()`：attach 分支**立即 resolve**（见修正 1）+ "attached" 日志，standalone 分支逐字不变。`port` getter 返回 `options.port ?? -1`。stop()/心跳逻辑不动。
2. **A2**：`ionet.interfaces.ts` 的 `WsServerOptions` extends `WebSocketExternalServerOptions` 并加 `attachNestServer?: boolean`、`port` 放宽可选（修正 2）。`ionet.module.ts` 的 **forRoot 与 forRootAsync 两处** wsServerProvider：inject 追加 `HttpAdapterHost`；`attachNestServer === true` 时取 `adapterHost.httpAdapter.getHttpServer()` 传入 `new WebSocketExternalServer({ ...serverOpts, server })`，剥离 `attachNestServer`/`enabled`（沿用现有解构剥离写法）；拿不到 adapter 抛明确错误。依赖无需改。
3. **A3/测试**：`src/websocket-server.test.ts`（vitest）追加 describe：裸 `http.Server` listen 随机端口 → attach 模式启动 → ws 客户端发 `{cmd,subCmd,data}` 断言信封 → 断言同 server 另一个 `'request'` 监听器（模拟 express）不受影响 → **断言非 `/ws` 路径 upgrade 被拒**。standalone 既有用例保持通过。

**B（idle-matcha）**

4. **B1**：新文件 `packages/server/src/actions/ionet-bridge.controller.ts`。`@Controller('api')` + `@All(':cmd(\\d+)/:subCmd(\\d+)')` + 类级 `@Public()`（首要坑点）。注入 `IONET_BAR_SKELETON`。body 处理按文档 §五-B1 表格：JSON content-type 用 `req.body` + content-length 空 body 特判（undefined）；非 JSON content-type 裸读流 + JSON.parse 失败 400 `{"error":"Invalid request body"}`，**裸读累计 >1MB 也 400**（修正 4）；就地复制 `isWrappedData` 谓词并注释 ground truth（修正 3）。响应：`createResponseMessage` 信封 + `@Res({ passthrough: true })` 设 `errorCode>=400?errorCode:200`；自行 catch → 500 `{"error":"Internal server error"}`，不让异常逃逸到全局 BusinessExceptionFilter。文件头按 idle-matcha CLAUDE.md:235-244 结构化注释规范（作用/输入输出/数据流/复用设计/≥2 坑点），坑点含 @Public 与 1MB 上限。
5. **B2**：`app.module.ts`：删 `IONET_HTTP_PORT`/`IONET_WS_PORT` 常量；IonetModule.forRoot 改 `httpServer: false`、`wsServer: { attachNestServer: true, path: '/ws' }`；`controllers: IONET_CHANNEL_ENABLED ? [HealthController, IonetBridgeController] : [HealthController]`（模块顶层 const，与现有 IonetModule 条件注册同款写法）；头部注释更新。actions/inOuts/redis 逐字不变。
6. **B3**：`main.ts` 启动日志改为同端口端点文案（删 :3001/:3002 行及 `IONET_HTTP_PORT` 读取）；停机钩子注释补 attach 顺序说明；`app.listen(nestPort)` 维持无 host。
7. **B4**：`packages/server/.env` + 根 `.env.example`（路径见修正 7）删 `IONET_HTTP_PORT`/`IONET_WS_PORT`/`SERVER_HOST`（全仓核验仅 app.module.ts:104/109 与 main.ts:94 日志引用，后者随 B3 删除），`NEST_PORT`/`IONET_CHANNEL_ENABLED` 注释更新（含根 .env.example 注释块的 :3001/:3002 字样）。
8. **§七 文档**：CLAUDE.md 红线例外条款（文档给出的条款文本可直接用，落点见修正 7）+ 11 处 md 命中端口表述同步（含漏掉的 phase-4.md 与文档孪生副本处置）+ src 6 文件注释；翻 phase-0.md:57 与 migration-master-plan.md:155 两处 `- [ ]` → `- [x]`（改写端口号后）；补 ai-docs/README.md 索引。

---

## 四、验证清单（沿用文档 §八，全部可执行）

1. **ionet-ts 构建与测试**：ionet-ts 根 `pnpm -w run build` + external-server 包 `pnpm test`（vitest，含新 attach 用例）全绿。
2. **idle-matcha 构建**：idle-matcha 根 `pnpm -w run build` + `packages/server` 下 `tsc -b`，零错误。
3. **冒烟**（启动 server 后）：
   - `curl -s -X POST localhost:3000/api/0/1` → 200 + 信封；
   - 经桥接完成 register/login 取 token 后调一条写操作 → 信封 data 正确（同时验证 @Public 与 AuthInOut 链路）；
   - `curl localhost:3000/api/auth/bootstrap`（REST 查询）与兼容层任一路由 → 行为不变；
   - `wscat -c ws://localhost:3000/ws` 发 `{"cmd":0,"subCmd":1}` → 信封响应；心跳 30s ping 可观察；
   - 非法路径 `POST localhost:3000/api/abc/1` → 404（非信封）；
   - `wscat -c ws://localhost:3000/nope` → 连接被拒（400）。
4. **开关验证**：`IONET_CHANNEL_ENABLED=false` 重启 → `/api/0/1` 404、`/ws` upgrade 失败、:3000 查询层与兼容层正常。
5. **CORS 验证**：带 Origin 头的 OPTIONS/POST 打桥接路由 → 反射 Origin 的 CORS 头存在（Phase 5 前端依赖项）。
6. **提交**：两仓库各自提交，提交信息无 Co-Authored-By 签名（工作区规则）。

---

## 五、残留风险（实施后留意）

| 风险 | 等级 | 说明 |
|---|---|---|
| 桥接遗漏 @Public → 全体写操作 401 | 高 | 冒烟第 3 条第 2 项直接暴露；code review 首查项（与文档 §九 一致） |
| isWrappedData 语义复刻偏差 | 中 | 必须逐字复制「非数组对象即包裹」判定，含 `.data` 不存在的场景 |
| chunked 空载 body 语义偏离 | 低 | 见修正 6 第 3 条，无真实客户端触发路径 |
| 1MB 上限对超大协议 payload | 低 | 当前所有协议 payload 远小于限；已在坑点注释记录 |
| 存量 ws 客户端停机体验 | 低 | 与现状等价（10s 强退兜底），非回退 |
