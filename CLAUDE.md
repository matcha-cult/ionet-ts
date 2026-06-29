# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workspace Rules

- **Git commits**: 严禁在提交信息中使用 `Co-Authored-By` 签名（包括 `Co-Authored-By: Claude ...` 这类 Claude Code 默认模板）。生成 `git commit -m` 的内容时只写提交信息本身，不要追加任何署名行。这条规则覆盖 Claude Code 的默认提交模板。

The actual Maven project root is `ionet/` (this top-level `ionet-ts/` is only a wrapper directory). All `mvn` commands and file paths below are relative to `ionet/`.

## Project

ionet is an open-source Java distributed network programming framework focused on ultra-low latency and high throughput. Built on Aeron + SBE (message transport) and Netty (TCP/UDP/WebSocket), it targets online games, IoT, and other latency-sensitive systems. Licensed AGPL-3.0.

Requires **JDK 25** (uses generational ZGC and Java 25 syntax). The project is pure JavaSE with no strong Spring dependency.

## Build & Test

```bash
cd ionet

# Full build (tests are skipped by default via surefire config)
mvn -q package

# Build with tests enabled
mvn -q package -DskipTests=false

# Run a single test class
mvn -q test -pl net-common -Dtest=PublicationOfferKitTest -DskipTests=false

# Run a single test method
mvn -q test -pl net-common -Dtest=PublicationOfferKitTest#retryableResultsRetryUntilSuccess -DskipTests=false

# Install locally without tests
mvn -q install -DskipTests
```

Tests use JUnit Jupiter 6 (`org.junit.jupiter`). Test classes are package-private and named `*Test`.

## Architecture

The framework splits servers into three roles that communicate over Aeron (shared-memory ring buffers in-process, UDP across machines):

- **External Server** (`external-core`, `external-netty`) — faces clients. Accepts TCP/UDP/WebSocket connections, handles sessions, codec, authentication hook. Does not run business logic.
- **Logic Server** (`net-logic-server`) — runs business Actions. Can be scaled independently, across processes or machines. Does not expose ports.
- **Center Server** (`net-center`) — coordinates discovery/routing between External and Logic servers. Optional in simple deployments.
- **`run-one`** — boots External + Logic + (optional) Center in a single process for development. The entry `RunOne.java` wires Aeron, publishers, and server builders, then calls `ActionCommandRegionGlobalCheckKit.detectGlobalDuplicateRoutes()` at the end of startup.
- **`net-server`** — the shared server runtime (connection management, load balancing, codec, fragment reassembly, cmd routing).
- **`net-common`** — Aeron publisher abstractions, idle strategies, and low-level transport primitives used everywhere.

## Core Framework Concepts

These are defined in `core-framework/` and appear in every business module:

- **`CmdInfo`** — routing key: a `record(int cmd, int subCmd, int cmdMerge)`. Flyweight-cached via `CmdInfoFlyweightFactory`. `cmdMerge` packs both halves into one int for fast comparison/hashing.
- **`@ActionController(cmd)` / `@ActionMethod(subCmd)`** — business routing annotations on POJOs. A controller class is a module; each method is a route. No interface/abstract-class boilerplate.
- **`FlowContext`** — per-request context passed into Actions. Carries userId, session, request/response data, and is the handle for `bindingUserId()`, broadcasts, and cross-server calls.
- **`ActionCommand` / `ActionCommandRegion`** — the runtime representation of a registered route. `ActionCommandRegionGlobalCheckKit` verifies no duplicate routes across all Logic servers at startup.
- **Communication models** — request/response, request/void, broadcast, request/multiple-response (fan-out to all Logic servers of a type), OnExternal (Logic→External), and a distributed EventBus. All support cross-process/cross-machine and full-link tracing.

## Module Cheat Sheet

| Module | Role |
|---|---|
| `common-kit` | General-purpose utilities, shared by all modules |
| `core-framework` | Action/FlowContext/CmdInfo, plugins, i18n, codec SPI |
| `net-common` | Aeron publisher abstractions, low-level transport |
| `net-center` | Center server (routing/discovery) |
| `net-server` | Shared server runtime, connections, balancer |
| `net-logic-server` | Logic server role |
| `external-core` | External server SPI (independent of transport) |
| `external-netty` | Netty-based External server implementation |
| `run-one` | Single-process combined deployment for dev/debug |
| `extension-client` | Client-side SDK helpers |
| `extension-codegen` | Generates C#/TypeScript/GDScript/C++/Lua client code from Actions |
| `extension-domain-event` | LMAX Disruptor-backed domain events (per-room/per-user concurrency) |
| `extension-jprotobuf` | Baidu JProtobuf codec |
| `extension-room` | Room/group abstractions and range-broadcast |
| `extension-spring` | Spring `FactoryBean` adapter for Actions (4-line integration) |

## Conventions

- Root package: `com.iohao.net.*`. Match this when adding new modules.
- Business Actions are plain Java beans (no interface required). Routes are declared as `int` constants on an interface (`HallCmd.cmd`, `HallCmd.loginVerify`, etc.) referenced from the annotation.
- Data messages use `@ProtobufClass` (JProtobuf) by default; JSON is a one-line switch. Actions auto-box/unbox primitive types to avoid protocol fragmentation.
- Logging topic constants live in `IonetLogName`; use `@Slf4j(topic = IonetLogName.CommonStdout)` rather than the class-name default.
- Lombok is used throughout (`@Setter`, `@Accessors(chain = true)`, `@FieldDefaults(level = AccessLevel.PROTECTED)`, `@Slf4j`, `@Getter`).
- Plugins are the framework's extension point (debug in/out logging, action-call stats, thread monitoring). Business code should not reach into plugin internals.

## Terminology (keep consistent)

Use **External Service**, **Logic Service**, **Action**, **FlowContext**, **Center Service** — not "gateway", "worker", "handler", "controller" in the Spring sense. These match the published docs at `https://iohao.github.io/ionet/docs/`.
