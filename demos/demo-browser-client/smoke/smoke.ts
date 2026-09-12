/**
 * demo-browser-client 无头冒烟（Node >= 22，使用内置全局 WebSocket/fetch）。
 *
 * 两种模式：
 * 1) 自包含（默认）：起本包桩服务端（smoke/stub-ws-server.ts，实现 PROTOCOL §3–§9 客户端依赖语义），
 *    用真实客户端类完整走一遍：连接 → 鉴权（含 401 拒绝路径）→ 请求配对 → 推送分流
 *    → 并发 reqId 精确配对 → 旧服务回退配对 → 应用层心跳 → HTTP fallback。
 * 2) 外联真实服务（设置 IONET_WS_URL）：连真实 ionet 服务验证四态。可选环境变量：
 *    IONET_TOKEN            握手 token（缺省空；空时打印可见提示：服务端会 401）
 *    IONET_CMDS             请求路由 "cmd,subCmd"（默认 30,1）
 *    IONET_HEARTBEAT        心跳路由 "cmd,subCmd"（默认 1,1）
 *    IONET_PUSH_WAIT_MS     推送观察窗口（默认 4000）
 *
 * 运行：pnpm --filter demo-browser-client run smoke
 */

import { BrowserIonetClient, isSuccess, type NotificationEnvelope, type ResponseEnvelope } from '../src/client.js';
import { createStubIonetServer, STUB_TOKEN } from './stub-ws-server.js';

interface Check {
  label: string;
  pass: boolean;
  extra?: string;
}

const checks: Check[] = [];

function record(label: string, pass: boolean, extra?: string): void {
  checks.push({ label, pass, extra });
  console.log((pass ? '  ✓ ' : '  ✗ ') + label + (extra !== undefined ? ' — ' + extra : ''));
}

function assert(condition: unknown, label: string, extra?: string): asserts condition {
  if (!condition) {
    record(label, false, extra);
    throw new Error('断言失败：' + label + (extra !== undefined ? '（' + extra + '）' : ''));
  }
  record(label, true, extra);
}

async function waitFor(condition: () => boolean, timeoutMs: number, stepMs = 25): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return condition();
}

function parseRoute(raw: string | undefined, fallback: { cmd: number; subCmd: number }): { cmd: number; subCmd: number } {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parts = raw.split(',').map((part) => Number(part.trim()));
  const cmd = parts[0];
  const subCmd = parts[1];
  if (!Number.isFinite(cmd) || !Number.isFinite(subCmd)) {
    throw new Error('路由解析失败（应形如 30,1）：' + raw);
  }
  return { cmd, subCmd };
}

async function runSelfContained(): Promise<void> {
  console.log('=== demo-browser-client 无头冒烟（自包含模式：桩服务端 + 真实客户端）===\n');
  const stub = await createStubIonetServer();

  try {
    const states: string[] = [];
    let lastDetail = '';

    // ---- 1. 鉴权负向：无 token → 服务端 401 拒绝升级；客户端可见提示（PROTOCOL §6）----
    console.log('[1] 鉴权负向路径（无 token → 401，含可见提示）');
    const noToken = new BrowserIonetClient({
      url: stub.wsUrl,
      reconnect: { enabled: false },
      requestTimeoutMs: 3_000,
      onStateChange: (state, detail) => {
        states.push(state);
        if (detail !== undefined) lastDetail = detail;
      },
      log: () => undefined,
    });
    let rejected = false;
    try {
      await noToken.connect();
    } catch (error) {
      rejected = true;
      assert(String(error).includes('401'), '缺 token 时 connect() 以 401 语义拒绝', String(error));
    }
    assert(rejected, '无 token 连接被服务端 401 拒绝（升级失败）');
    assert(lastDetail.includes('401'), '可见提示含「401」字样（UI token-hint 同一文案来源）', lastDetail);
    assert(noToken.getState() !== 'open', '无 token 客户端未进入 open');
    noToken.close();

    // ---- 2. 连接 + 鉴权（?token= 查询参数握手，PROTOCOL §6）----
    console.log('\n[2] 连接与鉴权（?token= 握手）');
    const notifications: NotificationEnvelope[] = [];
    const client = new BrowserIonetClient({
      url: stub.wsUrl,
      token: STUB_TOKEN,
      heartbeat: { cmd: 1, subCmd: 1, intervalMs: 300 },
      requestTimeoutMs: 3_000,
      onNotification: (notification) => notifications.push(notification),
      log: () => undefined,
    });
    await client.connect();
    assert(client.getState() === 'open', 'WebSocket 已连接并完成握手（open）', 'url=' + stub.wsUrl);

    // ---- 3. 请求 → 响应配对（PROTOCOL §3/§4.1）----
    console.log('\n[3] 请求 (30,1) 与 reqId 配对响应');
    const bag = await client.request(30, 1, {});
    assert(isSuccess(bag), '(30,1) 响应成功（errorCode 缺失/0）', JSON.stringify(bag.data));
    assert(Array.isArray((bag.data as { items?: unknown })?.items), '响应数据为背包数组', 'bag=' + JSON.stringify(bag.data));
    assert(typeof bag.reqId === 'string' && bag.kind === 'response', '响应回显 reqId 且 kind=response');

    // ---- 4. 推送分流（PROTOCOL §5）：bag 请求后桩服务会主动推一帧 ----
    console.log('\n[4] 推送分流（kind=notification）');
    const gotNotification = await waitFor(() => notifications.length > 0, 2_500);
    assert(gotNotification, '收到服务端主动推送帧');
    if (notifications.length > 0) {
      const note = notifications[0]!;
      assert(note.kind === 'notification', '推送帧 kind=notification', 'type=' + note.type);
      assert(note.type === 'bag.updated', '推送按类型路由渲染', JSON.stringify(note.data));
    }

    // ---- 5. 并发在途：reqId 精确配对（乱序返回）----
    console.log('\n[5] 并发在途 reqId 精确配对（乱序返回）');
    const delays: Array<{ marker: string; delay: number }> = [
      { marker: 'A', delay: 260 },
      { marker: 'B', delay: 20 },
      { marker: 'C', delay: 130 },
    ];
    const concurrent = await Promise.all(
      delays.map(({ marker, delay }) => client.request(30, 3, { marker, delay }))
    );
    const markers = concurrent.map((env) => (env.data as { echo?: string })?.echo);
    assert(markers[0] === 'A' && markers[1] === 'B' && markers[2] === 'C', '乱序返回仍按 reqId 精确配对', markers.join(','));
    assert(concurrent.every((env) => typeof env.reqId === 'string'), '并发响应均回显各自 reqId');

    // ---- 6. 旧服务回退：响应不带 reqId → 按最早在途配对（PROTOCOL §4 旧行为）----
    console.log('\n[6] 旧服务回退（响应不带 reqId → 最早在途配对）');
    const legacy = await Promise.all([
      client.request(30, 2, { marker: 'X' }),
      client.request(30, 2, { marker: 'Y' }),
    ]);
    const legacyMarkers = legacy.map((env) => (env.data as { echo?: string })?.echo);
    assert(legacyMarkers[0] === 'X' && legacyMarkers[1] === 'Y', '旧服务响应按最早在途 FIFO 配对', legacyMarkers.join(','));
    assert(legacy.every((env) => env.reqId === undefined && env.kind === undefined), '旧协议响应不带 reqId/kind（兼容）');

    // ---- 7. 应用层心跳（PROTOCOL §7：定时 (1,1) system.ping，收到回执计存活）----
    console.log('\n[7] 应用层心跳（1,1 system.ping）');
    const gotAck = await waitFor(() => client.heartbeatCount >= 1, 4_000);
    assert(gotAck, '收到心跳回执', 'count=' + client.heartbeatCount);
    assert(client.lastHeartbeatErrorCode === undefined || client.lastHeartbeatErrorCode === 0, '心跳回执 errorCode 成功或缺失');

    // ---- 8. HTTP fallback（PROTOCOL §9）----
    console.log('\n[8] HTTP fallback 通道');
    const httpRes = await fetch(stub.httpBase + '/30/1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: {} }),
    });
    const httpBody = (await httpRes.json()) as ResponseEnvelope;
    assert(httpRes.status === 200, 'HTTP POST /api/30/1 状态码 200（errorCode 缺失=成功）', 'status=' + httpRes.status);
    assert(Array.isArray((httpBody.data as { items?: unknown })?.items), 'HTTP 响应与 WS 同构（data）');
    assert(httpBody.reqId === undefined && httpBody.kind === undefined, 'HTTP 响应不产生 reqId/kind（§9）');

    const http404 = await fetch(stub.httpBase + '/99/1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: {} }),
    });
    const body404 = (await http404.json()) as ResponseEnvelope;
    assert(http404.status === 404 && body404.errorCode === 404, '未注册 Action 走 §8 语义（HTTP 404 + errorCode 404）', 'body=' + JSON.stringify(body404));

    client.close();
  } finally {
    await stub.close();
  }
}

async function runExternal(): Promise<void> {
  const wsUrl = process.env.IONET_WS_URL ?? '';
  const token = process.env.IONET_TOKEN ?? '';
  console.log('=== demo-browser-client 无头冒烟（外联真实服务模式）===\n');
  console.log('  目标：' + wsUrl);
  if (token === '') {
    console.log('  ⚠ 可见提示：未提供 IONET_TOKEN——浏览器无法设置握手请求头，只能走 ?token=；');
    console.log('    服务端会在握手阶段以 HTTP 401 拒绝（PROTOCOL §6）。');
  }
  const requestRoute = parseRoute(process.env.IONET_CMDS, { cmd: 30, subCmd: 1 });
  const heartbeatRoute = parseRoute(process.env.IONET_HEARTBEAT, { cmd: 1, subCmd: 1 });
  const pushWaitMs = Number(process.env.IONET_PUSH_WAIT_MS ?? 4000);

  const notifications: NotificationEnvelope[] = [];
  const client = new BrowserIonetClient({
    url: wsUrl,
    token,
    heartbeat: { ...heartbeatRoute, intervalMs: 3_000 },
    requestTimeoutMs: 10_000,
    onNotification: (notification) => notifications.push(notification),
    log: (message) => console.log('  [log]', message),
  });

  try {
    await client.connect();
    console.log('  ✓ 连接与鉴权（' + (token === '' ? '未携带 token' : '?token=***') + '）→ open');
  } catch (error) {
    console.log('  ✗ 连接/鉴权失败：' + String(error));
    throw error;
  }

  try {
    console.log('\n  请求 (' + requestRoute.cmd + ',' + requestRoute.subCmd + ') …');
    const response = await client.request(requestRoute.cmd, requestRoute.subCmd, {});
    const ok = isSuccess(response);
    console.log('  ' + (ok ? '✓' : '✗') + ' 收到响应：errorCode=' + String(response.errorCode ?? 0) + ' reqId=' + String(response.reqId ?? '-') + ' kind=' + String(response.kind ?? '-'));
    console.log('     data=' + JSON.stringify(response.data));
    assert(ok, '请求响应成功（errorCode 缺失/0）');
  } catch (error) {
    console.log('  ✗ 请求失败：' + String(error));
    throw error;
  }

  const gotAck = await waitFor(() => client.heartbeatCount >= 1, 5_000);
  console.log('  ' + (gotAck ? '✓' : '✗') + ' 应用层心跳（' + heartbeatRoute.cmd + ',' + heartbeatRoute.subCmd + '）回执 count=' + String(client.heartbeatCount));
  if (!gotAck) {
    throw new Error('心跳无回执');
  }

  await new Promise((resolve) => setTimeout(resolve, pushWaitMs));
  console.log('  ' + (notifications.length > 0 ? '✓' : '•') + ' 推送观察窗口 ' + pushWaitMs + 'ms：收到 ' + notifications.length + ' 帧');
  notifications.slice(0, 3).forEach((note) => {
    console.log('      type=' + (note.type ?? '-') + ' data=' + JSON.stringify(note.data));
  });
  if (notifications.length === 0) {
    console.log('     （窗口内无推送：服务端无主动推送时属正常；推送路径的端到端断言见自包含模式 [4]）');
  }

  client.close();
}

async function main(): Promise<void> {
  try {
    if (process.env.IONET_WS_URL !== undefined && process.env.IONET_WS_URL !== '') {
      await runExternal();
    } else {
      await runSelfContained();
      console.log('\n-- 外联真实服务：IONET_WS_URL=ws://<host>/ws IONET_TOKEN=<token> pnpm --filter demo-browser-client run smoke');
    }
    const passed = checks.filter((check) => check.pass).length;
    console.log('\n=== SMOKE PASS：' + passed + '/' + checks.length + ' 项检查通过 ===');
    process.exit(0);
  } catch (error) {
    const passed = checks.filter((check) => check.pass).length;
    console.error('\n=== SMOKE FAIL：' + passed + '/' + checks.length + ' 项检查通过 ===');
    console.error('失败原因：' + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }
}

void main();
