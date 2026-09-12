/**
 * 浏览器演示页逻辑：token 输入 → 连接 → 发只读 Action（默认 (30,1) item 背包）→ 渲染响应与推送帧。
 * 仅用 DOM 原生 API；与 src/client.ts 同受浏览器红线约束（零 Node 内置）。
 */

import {
  BrowserIonetClient,
  DEFAULT_HEARTBEAT_ROUTE,
  isSuccess,
  type ConnectionState,
  type NotificationEnvelope,
  type ResponseEnvelope,
} from './client.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (element === null) throw new Error('element not found: #' + id);
  return element as T;
};

const tokenInput = $<HTMLInputElement>('token-input');
const wsUrlInput = $<HTMLInputElement>('ws-url-input');
const httpBaseInput = $<HTMLInputElement>('http-base-input');
const tokenHint = $<HTMLDivElement>('token-hint');
const btnConnect = $<HTMLButtonElement>('btn-connect');
const statusBadge = $<HTMLSpanElement>('status-badge');
const statusDetail = $<HTMLDivElement>('status-detail');
const cmdInput = $<HTMLInputElement>('req-cmd');
const subCmdInput = $<HTMLInputElement>('req-subcmd');
const payloadInput = $<HTMLTextAreaElement>('req-payload');
const btnSend = $<HTMLButtonElement>('btn-send');
const btnSendHttp = $<HTMLButtonElement>('btn-send-http');
const responseView = $<HTMLPreElement>('response-view');
const pushList = $<HTMLUListElement>('push-list');
const heartbeatView = $<HTMLDivElement>('heartbeat-view');
const logView = $<HTMLDivElement>('log-view');

const TOKEN_KEY = 'ionet-demo-token';
const WS_URL_KEY = 'ionet-demo-ws-url';
const HTTP_BASE_KEY = 'ionet-demo-http-base';

let client: BrowserIonetClient | null = null;

function defaultWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname || 'localhost'}:8081/ws`;
}

tokenInput.value = localStorage.getItem(TOKEN_KEY) ?? '';
wsUrlInput.value = localStorage.getItem(WS_URL_KEY) ?? defaultWsUrl();
httpBaseInput.value = localStorage.getItem(HTTP_BASE_KEY) ?? `${window.location.protocol}//${window.location.hostname || 'localhost'}:8080/api`;

function refreshTokenHint(): void {
  const missing = tokenInput.value.trim() === '';
  tokenHint.hidden = !missing;
}

function appendLog(...messages: unknown[]): void {
  const message = messages.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' ');
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logView.appendChild(line);
  while (logView.childElementCount > 60) logView.firstElementChild?.remove();
}

function setStatus(state: ConnectionState, detail?: string): void {
  statusBadge.textContent = state;
  statusBadge.className = 'badge badge-' + state;
  statusDetail.textContent = detail ?? '';
  btnConnect.textContent = state === 'open' ? '断开连接' : '连接';
  btnSend.disabled = state !== 'open';
}

function renderResponse(response: ResponseEnvelope): void {
  const ok = isSuccess(response);
  const lines: string[] = [];
  lines.push(ok ? '✔ 响应成功' : `✘ errorCode=${response.errorCode}：${response.errorMessage ?? ''}`);
  lines.push('reqId 回显：' + String(response.reqId ?? '（无，旧协议服务）'));
  lines.push('kind：' + String(response.kind ?? '（无）'));
  lines.push('数据：' + JSON.stringify(response.data, null, 2));
  responseView.textContent = lines.join('\n');
}

function renderNotification(notification: NotificationEnvelope): void {
  const item = document.createElement('li');
  const route = notification.type ?? `(${notification.cmd},${notification.subCmd})`;
  item.textContent = `[${new Date(notification.timestamp ?? Date.now()).toLocaleTimeString()}] 推送 type=${route} from=${notification.fromUserId ?? '-'} data=${JSON.stringify(notification.data)}`;
  pushList.prepend(item);
  while (pushList.childElementCount > 30) pushList.lastElementChild?.remove();
}

function updateHeartbeat(): void {
  if (client === null) {
    heartbeatView.textContent = '应用层心跳（1,1 system.ping，15s/次）：未连接';
    return;
  }
  if (client.lastHeartbeatAckAt === null) {
    heartbeatView.textContent = `应用层心跳（${DEFAULT_HEARTBEAT_ROUTE.cmd},${DEFAULT_HEARTBEAT_ROUTE.subCmd}，15s/次）：等待首个回执…`;
    return;
  }
  const err = client.lastHeartbeatErrorCode === undefined || client.lastHeartbeatErrorCode === 0
    ? '成功'
    : `errorCode=${client.lastHeartbeatErrorCode}（链路存活）`;
  heartbeatView.textContent = `应用层心跳：${client.heartbeatCount} 次回执，最近 ${new Date(client.lastHeartbeatAckAt).toLocaleTimeString()}，${err}`;
}

function parsePayload(): unknown {
  const text = payloadInput.value.trim();
  if (text === '') return undefined;
  try {
    return text === 'undefined' ? undefined : (JSON.parse(text) as unknown);
  } catch {
    appendLog('载荷不是合法 JSON，将按原始字符串发送');
    return text;
  }
}

function ensureClient(): BrowserIonetClient {
  const token = tokenInput.value.trim();
  const url = wsUrlInput.value.trim() || defaultWsUrl();
  const clientInstance = new BrowserIonetClient({
    url,
    token,
    heartbeat: { ...DEFAULT_HEARTBEAT_ROUTE, intervalMs: 15_000 },
    onNotification: (notification) => {
      appendLog('收到推送帧（kind=notification）');
      renderNotification(notification);
    },
    onStateChange: (state, detail) => {
      setStatus(state, detail);
      if (state === 'open') {
        appendLog('已连接并完成握手鉴权');
        const next = new Date(Date.now() + 15_000);
        heartbeatView.textContent = `应用层心跳（1,1 system.ping，15s/次）：下一次 ${next.toLocaleTimeString()}`;
      }
    },
    log: appendLog,
  });
  client = clientInstance;
  return clientInstance;
}

btnConnect.addEventListener('click', () => {
  localStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
  localStorage.setItem(WS_URL_KEY, wsUrlInput.value.trim());
  const token = tokenInput.value.trim();
  if (token !== '' && client !== null) {
    client.setToken(token); // 重连时重新携带（可能已更换的）token
  }
  if (client !== null && client.getState() === 'open') {
    client.close();
    return;
  }
  refreshTokenHint();
  const instance = client !== null && client.getState() !== 'closed' && client.getState() !== 'idle'
    ? client // 重连状态：复用实例
    : ensureClient();
  if (instance.getState() === 'idle') {
    void instance.connect().catch((error: Error) => {
      appendLog('连接失败：' + error.message);
    });
  }
});

btnSend.addEventListener('click', () => {
  if (client === null || client.getState() !== 'open') return;
  const cmd = Number(cmdInput.value) || 30;
  const subCmd = Number(subCmdInput.value) || 1;
  const payload = parsePayload();
  responseView.textContent = `发送 (${cmd},${subCmd}) …`;
  void client
    .request(cmd, subCmd, payload, {})
    .then((response) => {
      renderResponse(response);
      appendLog(`(${cmd},${subCmd}) → ${isSuccess(response) ? '成功' : 'errorCode=' + String(response.errorCode)}`);
    })
    .catch((error: Error) => {
      responseView.textContent = '请求失败：' + error.message;
    });
});

btnSendHttp.addEventListener('click', () => {
  const cmd = Number(cmdInput.value) || 30;
  const subCmd = Number(subCmdInput.value) || 1;
  const payload = parsePayload();
  const base = httpBaseInput.value.trim();
  localStorage.setItem(HTTP_BASE_KEY, base);
  responseView.textContent = `HTTP fallback：POST ${base.replace(/\/$/, '')}/${cmd}/${subCmd} …`;
  if (client === null) ensureClient();
  void client!
    .requestHttp(base, cmd, subCmd, payload, { bearerToken: tokenInput.value.trim() })
    .then((response) => {
      renderResponse(response);
      appendLog(`HTTP (${cmd},${subCmd}) → ${isSuccess(response) ? '成功' : 'errorCode=' + String(response.errorCode)}`);
    })
    .catch((error: Error) => {
      responseView.textContent = 'HTTP fallback 失败：' + error.message;
    });
});

tokenInput.addEventListener('input', refreshTokenHint);
refreshTokenHint();
setStatus('idle', '输入 token 后连接；无 token 时服务端会在握手阶段以 HTTP 401 拒绝（PROTOCOL §6）');
heartbeatView.textContent = '应用层心跳（1,1 system.ping，15s/次）：未连接';
