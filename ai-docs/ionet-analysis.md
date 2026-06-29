# ionet 深度分析

> 分析对象：`/home/nbb/projects/ionet-ts/ionet/`
> 版本：25.5（pom.xml）
> 许可证：AGPL-3.0

## 1. 整体画像

- **Java 文件数**：736
- **代码行数（LOC）**：约 76,523
- **模块数**：15 个 Maven 子模块
- **JDK 要求**：25（使用 record、pattern matching、generational ZGC）
- **核心依赖**：Aeron 1.49.3、Netty 4.1.132、Protobuf 4.33.5、JProtobuf 2.4.23、Disruptor 4.0.0、Spring Context 7.0.3（可选）、Beetl 3.20.1（codegen）
- **测试框架**：JUnit Jupiter 6.0.3（注意是 Jupiter 6，不是 5）
- **构建特性**：maven-surefire 默认 `skipTests=true`，需要 `-DskipTests=false` 才能跑测试

## 2. 模块清单与职责

| 模块 | 文件数 | 职责 | 关键包/类 |
|---|---:|---|---|
| **common-kit** | 97 | 通用工具（SafeKit、集合、字符串、reflect、版本等） | `com.iohao.net.common.kit.*` |
| **core-framework** | 238 | 框架核心：Action/FlowContext/CmdInfo/Plugin/Codec SPI | `ActionController`、`ActionMethod`、`CmdInfo`、`FlowContext`、`ActionCommand`、`ActionCommandRegion` |
| **net-common** | 79 | Aeron Publisher 抽象、idle strategy、低层传输 | `Publisher*Kit`、`Publication*`、`CoreGlobalConfig` |
| **net-center** | 21 | Center Server（服务发现/路由协调） | `CenterServerBuilder`、`CenterAdapter` |
| **net-server** | 65 | 通用 Server 运行时（连接、负载均衡、编解码、分片） | `NetServerBuilder`、`CmdRegion` |
| **net-logic-server** | 20 | Logic Server 角色 | `LogicServer`、`LogicServerApplication` |
| **external-core** | 65 | External Server 抽象（会话、hook、配置、消息） | `ExternalServer`、`UserSession`、`UserHook` |
| **external-netty** | 44 | Netty 实现的 External Server | Netty pipeline、codec |
| **run-one** | 2 | 单进程组合启动（External + Logic + Center） | `RunOne.java` |
| **extension-client** | 36 | 客户端 SDK 辅助 | 模拟客户端 |
| **extension-codegen** | 5 | 多语言客户端代码生成（TS/C#/GDScript/C++/Lua） | `TypeScriptDocumentGenerate`、`CsharpDocumentGenerate`、`GDScriptDocumentGenerate` |
| **extension-domain-event** | 23 | LMAX Disruptor 领域事件 | `DomainEventApplication`、`DisruptorCreator`、`Topic`、`Eo` |
| **extension-jprotobuf** | 19 | Baidu JProtobuf 编解码 | `@ProtobufClass` 支持 |
| **extension-room** | 20 | 房间/分组抽象、范围广播 | 桌游/房间类游戏支持 |
| **extension-spring** | 2 | Spring `FactoryBean` 适配 | `ActionFactoryBeanForSpring`（4 行集成） |

## 3. 核心编程模型

### 3.1 Action 路由体系

```java
@ActionController(HallCmd.cmd)           // 模块级路由
public class HallAction {
    @ActionMethod(HallCmd.loginVerify)   // 动作级路由
    UserMessage loginVerify(String jwt, FlowContext flowContext) { ... }
}

interface HallCmd {
    int cmd = 1;
    int loginVerify = 1;
    int hello = 2;
}
```

处理链路：
1. **扫描期**：启动时扫描 `@ActionController` 标注的类
2. **注册期**：每个 `@ActionMethod` 方法包装为 `ActionCommand`，注册到 `ActionCommandRegion`
3. **校验期**：`ActionCommandRegionGlobalCheckKit.detectGlobalDuplicateRoutes()` 全局查重（RunOne.java:90）
4. **调用期**：按 CmdInfo 查找 ActionCommand，反射调用

### 3.2 CmdInfo 路由键

`CmdInfo` 是 `record(int cmd, int subCmd, int cmdMerge)`：
- `cmdMerge` 把 cmd 和 subCmd 打包进一个 int（高 16 位 + 低 16 位）
- 通过 `CmdInfoFlyweightFactory` 做 flyweight 缓存，hash/equals 都基于 `cmdMerge`
- 极致性能：路由查找只需一次 int 比较

### 3.3 FlowContext

每个请求的上下文对象，能力包括：
- `bindingUserId(long)` —— 把会话绑定到玩家
- `getUserId()` —— 取当前玩家 ID
- 跨服调用、广播、事件发布
- 属性扩展系统（类似 Netty 的 Attribute）

### 3.4 通信模型

| 模型 | 方向 | 实现位置 |
|---|---|---|
| request/response | 客户端 ↔ 外部服 ↔ 逻辑服 | core-framework |
| request/void | 同上 | core-framework |
| broadcast | 逻辑服 → 客户端群 | external-core |
| request/multiple-response | 逻辑服 → 同类所有逻辑服 | net-logic-server |
| OnExternal | 逻辑服 → 外部服 | external-core |
| EventBus | 跨进程事件总线 | core-framework `communication/eventbus` |

## 4. 传输层与消息层

### 4.1 Aeron + SBE（核心卖点）

- `net-common` 封装了 `Publisher`、`Publication*Kit` —— 统一 Aeron 的 offer 失败重试、idle 策略、drain 策略
- `net-server` / `net-logic-server` / `net-center` 之间全部走 Aeron IPC（共享内存 ring buffer，纳秒级）
- `CoreGlobalConfig.publisherOfferRetryLimit` 控制 offer 重试上限

**为什么 Aeron 难移植**：Aeron 的 Node.js 绑定不存在官方版本。社区方案（如 `aeron.js`）成熟度低。可能的替代：
- 用 node-addon-api 封装 Aeron C++ 库
- 用 zeromq / nanomsg / NNG 替代
- 第一版只跑单进程（worker_threads），跨进程后续再补

### 4.2 Netty 的角色

Netty **只用于 external-netty**（客户端 TCP/UDP/WebSocket 接入）。Logic/Center 之间完全走 Aeron，不走 Netty。

→ 对 Node.js 移植：**Netty 这一层很好替换**（Node 原生 net/dgram/ws 即可），Aeron 这一层才是难点。

### 4.3 协议切换

- 默认用 JProtobuf（Baidu 的轻量 Protobuf）
- 通过 `@ProtobufClass` 注解标注数据类
- JSON 切换是一行代码的事（`DataCodec` SPI）
- 自动装拆箱：基础类型在协议层自动包装为 `IntValue`、`BoolValue` 等，解决协议碎片化

## 5. 并发模型

### 5.1 同一玩家同一线程

ionet 通过自定义的 thread executor 设计，让同一个 userId 的所有请求都由同一个线程消费。这样业务代码可以"假定单线程"，无需加锁。

实现位置：`core-framework` 中的线程执行器扩展点（基于 userId 的 hash 选择 executor）

### 5.2 领域事件（Disruptor）

`extension-domain-event` 用 LMAX Disruptor 实现房间/业务上下文内的并发问题处理：
- `DisruptorCreator` 创建 Disruptor 实例
- `DomainEventApplication` 发布事件
- `Topic` / `Eo` 抽象事件主题

## 6. 扩展机制

### 6.1 Plugin（InOut）

`ActionMethodInOut` 插件系统：
- 插件可插拔、可扩展
- 内置：DebugInOut、action 调用统计、业务线程监控、时段调用统计
- 通过组合定位性能问题

### 6.2 Spring 集成

`extension-spring` 仅 2 个文件，核心是 `ActionFactoryBeanForSpring`：把 Spring 容器里的 bean 作为 Action 实例提供者。"4 行代码集成"即指此。

### 6.3 Codegen

`extension-codegen` 支持为以下目标生成客户端 SDK：
- TypeScript（Vue/React/Cocos 等）
- C#（Unity）
- GDScript（Godot）
- C++（UE）
- Lua

使用 Beetl 模板引擎。

### 6.4 其他扩展点

- JSR380 校验（Jakarta Validation 3.1.1）
- 断言 + 异常机制（业务错误码）
- Action 调试定位（代码即联调文档）
- 全链路 Trace（跨机器、跨进程）

## 7. Node.js 移植友好度

### 7.1 天然契合的部分

- **事件驱动、单线程亲和** —— 与 Node.js 事件循环完美匹配
- **Action 路由模式** —— 直接对应 TS 装饰器 + 反射（`reflect-metadata`）
- **FlowContext** —— 等价于 Node 的 AsyncLocalStorage
- **Plugin/InOut** —— 等价于 Koa-style middleware
- **Module 拆分清晰** —— 15 个模块可以按 TS monorepo 渐进落地

### 7.2 难以移植的部分

- **Aeron + SBE** —— Node.js 无直接对等物，必须重新设计或 native 绑定
- **Java record + 强类型** —— TS 的 record 等价需要自己设计
- **Flyweight 缓存模式** —— TS 的 WeakRef/FinalizationRegistry 行为不同
- **字节码/反射** —— Action 扫描依赖 Java 反射，TS 需要装饰器 + reflect-metadata
- **Lombok** —— TS 用装饰器或 constructor 直接赋值替代
- **Generational ZGC 优化** —— Node 的 V8 GC 不同，性能特性要重新评估
- **Disruptor** —— Node 单线程下 Disruptor 的价值下降，用 Promise/EventEmitter 队列即可

## 8. 关键文件索引

| 关注点 | 入口文件 |
|---|---|
| 整体启动 | `run-one/src/main/java/com/iohao/net/app/RunOne.java` |
| Action 注解 | `core-framework/.../annotations/ActionController.java`、`ActionMethod.java` |
| CmdInfo | `core-framework/.../core/CmdInfo.java` |
| FlowContext | `core-framework/.../core/flow/FlowContext.java` |
| ActionCommand | `core-framework/.../core/ActionCommand.java` |
| Aeron 封装 | `net-common/.../Publisher*Kit.java` |
| External Server | `external-core/.../ExternalServer.java` |
| Plugin SPI | `core-framework/.../ActionMethodInOut.java` |
| Domain Event | `extension-domain-event/.../DomainEventApplication.java` |
| Spring 集成 | `extension-spring/.../ActionFactoryBeanForSpring.java` |
