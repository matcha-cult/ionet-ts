# ioGame 深度分析

> 分析对象：`/home/nbb/projects/ionet-ts/ioGame/`
> 版本：21.34（pom.xml）
> 许可证：AGPL-3.0
> 最近提交：`917a7964` - docs: Translate README to English and add Chinese version

## 1. 整体画像

- **Java 文件数**：824
- **代码行数（LOC）**：约 69,633
- **顶层模块数**：5 个（common / external / net-bolt / run-one / widget）
- **JDK 要求**：21（使用虚拟线程）
- **核心依赖**：Netty、SOFA Bolt（Alipay）、ScaleCube（cluster/discovery）、JProtobuf、FastJSON2、Disruptor、Jakarta Validation、Beetl
- **定位**：ionet 的前身/早期版本（包名从 `com.iohao.game` 演进到 ionet 的 `com.iohao.net`）

## 2. 模块清单与职责

ioGame 的模块拆分粒度比 ionet **粗**，顶层 5 个模块下各自还有子模块：

### 2.1 `common/`（396 个文件）—— 业务框架核心

子模块：
- **common-core**：核心 Action 骨架
  - `com.iohao.game.action.skeleton.core` —— `@ActionController`、`@ActionMethod`、`CmdInfo`、`FlowContext`、`ActionCommand`、`ActionCommandRegion`
  - `com.iohao.game.action.skeleton.protocol` —— 请求/响应协议
  - `com.iohao.game.action.skeleton.ext.spring` —— Spring 集成
  - `com.iohao.game.action.skeleton.eventbus` —— 事件总线
- **common-kit**：工具集
- **common-micro-kit**：微服务相关工具
  - `com.iohao.game.common.kit.concurrent.executor.UserThreadExecutorRegion` —— 玩家线程绑定
- **common-validation**：JSR380 校验

→ ionet 里这一块被拆成了 `common-kit` + `core-framework` + `extension-spring` 等多个模块。ioGame 把 396 个文件塞进一个 common 顶层模块，**职责边界不如 ionet 清晰**。

### 2.2 `external/`（113 个文件）—— 对外服

- **external-core**：`UserSession`、`UserSessions`、对外服核心逻辑
- **external-netty**：Netty 实现的客户端连接层
- 还包含 HTTP 处理器（`HttpFallbackHandler`、`HttpRealIpHandler`，见最新提交 `be699a69`）

### 2.3 `net-bolt/`（146 个文件）—— 基于 SOFA Bolt 的网络层

**这是 ioGame 与 ionet 最大的差异点。**

- **bolt-core**：Bolt 协议封装、`ProcessorSelectorThreadExecutorRegion`、`RequestResponseProcessor`
- **bolt-broker-server**：Broker 网关（= ionet 的 Center Server + External Server 的混合体）
- **bolt-client**：逻辑服的 Broker 客户端

底层用的是 **Alipay SOFA Bolt**（一个基于 Netty 的 RPC 框架），不是 Aeron。

→ 关键差异：
- ioGame 的跨进程通信走 **Bolt RPC + ScaleCube cluster**
- ionet 的跨进程通信走 **Aeron（共享内存 IPC）**

Bolt 在 Node.js 生态没有对等物，但替换为 gRPC 或原生 TCP 相对容易（比 Aeron 简单）。

### 2.4 `widget/`（164 个文件）—— 扩展插件

- **light-game-room**：房间抽象
- **light-domain-event**：Disruptor 领域事件
- **light-profile**：多环境配置
- **light-jprotobuf**：JProtobuf 编解码
- **light-client**：压测客户端
- **generate-code**：多语言客户端代码生成（Beetl 模板）
- **other-tool**：其他工具

→ 对应 ionet 的多个 `extension-*` 模块。命名风格用 `light-*` 前缀。

### 2.5 `run-one/`（5 个文件）—— 单机启动

- **run-one-netty**：单进程组合启动（基于 Netty 全家桶）

## 3. 核心编程模型

### 3.1 Action 路由

与 ionet 几乎一致：

```java
@ActionController(cmd)
public class XxxAction {
    @ActionMethod(subCmd)
    Object method(FlowContext flowContext) { ... }
}
```

注解定义位于：
- `common/common-core/.../annotation/ActionController.java`
- `common/common-core/.../annotation/ActionMethod.java`

### 3.2 CmdInfo 路由键

`common/common-core/.../core/CmdInfo.java` + `CmdKit.java`：
- 同样用位运算合并 cmd + subCmd
- 同样用 `CmdInfoFlyweightFactory` 做 flyweight 缓存
- 实现细节与 ionet 高度一致

### 3.3 FlowContext

`common/common-core/.../core/flow/FlowContext.java`：
- 与 ionet 的 FlowContext 功能相似：userId 绑定、属性系统、请求/响应、跨服调用

### 3.4 通信模型

- request/response（`RequestResponseProcessor`）
- broadcast（`UserSessions.broadcast()`）
- EventBus（`action.skeleton.eventbus`）
- **没有** ionet 的 request/multiple-response、OnExternal 等更精细的模型

→ ioGame 的通信模型比 ionet **少**。ionet 演化过程中增加了更多分布式通信原语。

### 3.5 服务器角色

- **External Server**：客户端连接层
- **Logic Server**：业务逻辑（通过 `BrokerClientApplication` 启动）
- **Broker Server**：中心网关（对应 ionet 的 Center Server）

## 4. 传输层与消息层

### 4.1 SOFA Bolt + Netty

**与 ionet 最大的架构差异。**

- 客户端接入：Netty（external-netty）
- 跨进程通信：SOFA Bolt（基于 Netty 的 RPC）+ ScaleCube（集群发现）
- 没有 Aeron，没有共享内存 IPC

→ 这意味着：
- ioGame **没有** ionet 的"纳秒级端到端延迟"能力
- 但移植到 Node.js 时，**Bolt 这一层相对容易替换**（gRPC、Node 原生 TCP、zeromq 都可以）

### 4.2 协议

- JProtobuf（默认）
- FastJSON2（JSON 支持）
- 自定义协议封装在 `action.skeleton.protocol`（`IntValue`、`BoolValue` 等包装类型）

### 4.3 第三方中间件

- 无 Redis/MQ/ZK 依赖
- ScaleCube 用于 cluster membership / discovery（轻量级，不需要外部 ZK）

## 5. 并发模型

### 5.1 同一玩家同一线程

`UserThreadExecutorRegion`（`common/common-micro-kit/.../concurrent/executor/`）：
- 通过 `userId & executorLength` 位运算选线程
- 对未登录用户回退到 channelId 或 cmd

`ExecutorSelectKit`（`common/common-core/.../kit/`）：
- 封装线程选择逻辑
- 支持虚拟线程（`UserVirtualThreadExecutorRegion`，JDK 19+）

→ 与 ionet 设计一致，但 ioGame 额外支持了**虚拟线程**。

### 5.2 Disruptor

`widget/light-domain-event` 提供 Disruptor 支持：
- `LightDisruptor`、`DisruptorManager`
- 与 ionet 的 `extension-domain-event` 等价

## 6. 扩展机制

- **ActionMethodInOut**：InOut 插件系统（与 ionet 同名）
- **Spring 集成**：`ActionFactoryBeanForSpring`（与 ionet 同名，位于 common-core 内而非独立模块）
- **Codegen**：`widget/generate-code` 用 Beetl 模板
- **Room**：`widget/light-game-room`
- **Domain Event**：`widget/light-domain-event`
- **JSR380 校验**：Jakarta Validation（`@ValidatedGroup`）
- **HTTP 降级处理**：`external` 模块最近新增了 `HttpFallbackHandler`（`be699a69` 提交）

## 7. 关键差异点（vs ionet）

| 维度 | ioGame | ionet |
|---|---|---|
| 包名 | `com.iohao.game` | `com.iohao.net` |
| 跨进程通信 | SOFA Bolt + ScaleCube | Aeron + SBE |
| 性能上限 | 微秒级（Netty RPC） | 纳秒级（Aeron IPC） |
| 模块粒度 | 5 个顶层模块，common 大而全 | 15 个扁平模块，职责清晰 |
| 通信模型 | 基础 4 种 | 6+ 种（含 multiple-response、OnExternal） |
| 虚拟线程支持 | 有 | 无（直接基于 JDK 25 平台线程） |
| 文件大小 | 824 文件 / 69.6k LOC | 736 文件 / 76.5k LOC |
| Spring 集成位置 | 内嵌在 common-core | 独立 `extension-spring` 模块 |
| HTTP 支持 | external 有 HttpFallbackHandler | 无 HTTP 降级（纯游戏服） |
| 成熟度 | 早期版本（v21.34） | 后续演化（v25.5） |

## 8. Node.js 移植友好度

### 8.1 天然契合的部分

- **事件驱动 + 玩家线程亲和** —— Node 单线程模型天然满足
- **Action/FlowContext 模式** —— 直接对应 TS 装饰器
- **Broker 架构** —— 比 Aeron 更容易在 Node.js 中重现（TCP + gRPC 即可）
- **ScaleCube-style 服务发现** —— Node 生态有类似库（如 `swim-js`）

### 8.2 难以移植的部分

- **SOFA Bolt** —— Node.js 无对等物，需要换成 gRPC 或自定义协议
- **ScaleCube cluster** —— 需要评估是否用 NATS/Redis Pub-Sub/自建 gossip
- **Java 反射 + 字节码增强** —— 同样需要 TS 装饰器替代
- **JProtobuf / FastJSON2** —— 用 `protobufjs` + `JSON` 替代

### 8.3 相比 ionet 的移植难度对比

- **优势**：没有 Aeron 这一"Node 移植最大障碍"
- **劣势**：
  - 模块拆分粗，移植时容易一次改太多
  - 通信模型少，未来扩展时还是要回到 ionet 的设计
  - 是 ionet 的早期版本，相当于移植"旧版本"，之后再追平 ionet 的新特性

## 9. 关键文件索引

| 关注点 | 入口文件 |
|---|---|
| Action 注解 | `common/common-core/.../annotation/ActionController.java` |
| CmdInfo | `common/common-core/.../core/CmdInfo.java`、`CmdKit.java` |
| FlowContext | `common/common-core/.../core/flow/FlowContext.java` |
| 玩家线程绑定 | `common/common-micro-kit/.../concurrent/executor/UserThreadExecutorRegion.java` |
| Bolt 协议处理 | `net-bolt/bolt-core/.../processor/RequestResponseProcessor.java` |
| Broker 网关 | `net-bolt/bolt-broker-server/` |
| UserSession | `external/external-core/.../session/UserSession.java` |
| Spring 集成 | `common/common-core/.../ext/spring/ActionFactoryBeanForSpring.java` |
| 单机启动 | `run-one/run-one-netty/` |
| 房间 | `widget/light-game-room/` |
| 领域事件 | `widget/light-domain-event/` |
| Codegen | `widget/generate-code/` |
