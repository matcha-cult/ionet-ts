/**
 * smoke 自包含模式的桩服务端：仅用于无头冒烟，实现 PROTOCOL 中客户端实际依赖的语义：
 * §1 文本帧 /ws    §3 请求信封    §4 响应信封（带 reqId 时回显 reqId+kind）
 * §5 推送信封（kind=notification）    §6 缺 token → HTTP 401 拒绝升级
 * §8 错误语义（400/404）    §9 HTTP fallback（响应不带 reqId/kind）
 *
 * 最小 RFC6455 实现（握手 + 掩码帧解析 + 文本帧编码），Node 内置 http/crypto 能力，零 npm 依赖。
 * 注意：本文件属于 smoke（Node 侧），浏览器产物（src/）不引用任何 Node 内置模块。
 */

import { createServer } from 'http';
import type { Server, ServerResponse } from 'http';
import type { Socket } from 'net';
import type { RequestEnvelope } from '../src/client.js';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const STUB_TOKEN = 'smoke-token';
export const STUB_USER_ID = 'stub-user:42';

interface ParsedFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

interface WsSession {
  socket: Socket;
  buffer: Buffer;
  pushUserId?: string;
}

export interface StubIonetServer {
  port: number;
  wsUrl: string;
  httpBase: string;
  close(): Promise<void>;
}

/** bag 请求（30,1）后 80ms 主动推一帧，验证客户端 kind 分流渲染。 */
function notificationFrame(): Record<string, unknown> {
  return {
    kind: 'notification',
    type: 'bag.updated',
    data: { itemId: 'wood', count: 8 },
    timestamp: Date.now(),
    fromUserId: STUB_USER_ID,
  };
}

function dispatchResult(cmd: number, subCmd: number, data: unknown): Record<string, unknown> {
  if (cmd === 1 && subCmd === 1) {
    return { data: { ok: true, route: 'system.ping', t: Date.now() } };
  }
  if (cmd === 30 && subCmd === 1) {
    return {
      data: {
        items: [
          { itemId: 'wood', count: 7 },
          { itemId: 'stone', count: 3 },
        ],
      },
    };
  }
  if (cmd === 30 && subCmd === 2) {
    // 模拟旧服务：响应不带 reqId/kind（PROTOCOL §4 逐字节旧行为）
    return { data: { legacy: true, echo: (data as { marker?: string })?.marker } };
  }
  if (cmd === 30 && subCmd === 3) {
    // echo 路由：按 data.delay 延迟响应，验证并发在途下 reqId 精确配对
    return { data: { echo: (data as { marker?: string; delay?: number })?.marker } };
  }
  return { errorCode: 404, errorMessage: 'Action not registered' };
}

/** 从 TCP 字节流解析掩码客户端帧；单帧更小场景下的最小实现（不做分片重组）。 */
function parseFrame(buffer: Buffer): { frame: ParsedFrame | null; consumed: number } {
  if (buffer.length < 2) return { frame: null, consumed: 0 };
  const first = buffer[0]!;
  const second = buffer[1]!;
  const fin = (first & 0x80) !== 0;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return { frame: null, consumed: 0 };
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return { frame: null, consumed: 0 };
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return { frame: null, consumed: 0 };
    length = Number(big);
    offset += 8;
  }
  let maskKey: Buffer | null = null;
  if (masked) {
    if (buffer.length < offset + 4) return { frame: null, consumed: 0 };
    maskKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buffer.length < offset + length) return { frame: null, consumed: 0 };
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (maskKey !== null) {
    for (let i = 0; i < payload.length; i += 1) {
      payload[i] = payload[i]! ^ maskKey[i % 4]!;
    }
  }
  return { frame: { fin, opcode, payload }, consumed: offset + length };
}

function encodeFrame(payload: string | Uint8Array, opcode: number): Buffer {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
  const first = 0x80 | opcode; // FIN=1，服务端帧不掩码
  const header: number[] = [first];
  if (body.length <= 125) {
    header.push(body.length);
  } else if (body.length <= 0xffff) {
    header.push(126, (body.length >>> 8) & 0xff, body.length & 0xff);
  } else {
    const big = BigInt(body.length);
    header.push(127);
    for (let shift = 56n; shift >= 0n; shift -= 8n) {
      header.push(Number((big >> shift) & 0xffn));
    }
  }
  return Buffer.concat([Buffer.from(header), body]);
}

function writeRaw(socket: Socket, status: number, statusText: string, body: string): void {
  const text = `HTTP/1.1 ${status} ${statusText}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`;
  socket.write(text);
  socket.end();
}

export async function createStubIonetServer(): Promise<StubIonetServer> {
  const sessions = new Set<WsSession>();

  const server: Server = createServer((req, res) => handleHttp(req, res));

  server.on('upgrade', (req, socket) => {
    void handleUpgrade(req, socket as Socket);
  });

  function handleHttp(req: import('http').IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://stub');
    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }
    const match = /^\/api\/(\d+)\/(\d+)$/.exec(url.pathname);
    if (req.method === 'POST' && match !== null) {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        let message: RequestEnvelope;
        try {
          message = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as RequestEnvelope;
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ errorCode: 400, errorMessage: 'Bad frame' }));
          return;
        }
        const data = (message as { data?: unknown }).data;
        const result = dispatchResult(Number(match[1]), Number(match[2]), data);
        // §9：HTTP fallback 响应不产生 reqId/kind；状态码 = errorCode>=400 ? errorCode : 200
        const status = typeof result.errorCode === 'number' && result.errorCode >= 400 ? result.errorCode : 200;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errorCode: 404, errorMessage: 'Not found' }));
  }

  async function handleUpgrade(req: import('http').IncomingMessage, socket: Socket): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://stub');
    if (url.pathname !== '/ws') {
      writeRaw(socket, 404, 'Not Found', 'unknown ws path');
      return;
    }
    const token = url.searchParams.get('token');
    if (token === null || token === '') {
      // §6：缺 token → HTTP 401 拒绝升级（浏览器侧表现为连接失败）
      writeRaw(socket, 401, 'Unauthorized', 'Unauthorized: missing ?token=');
      return;
    }
    const key = String(req.headers['sec-websocket-key'] ?? '');
    const accept = await sha1Base64(key + WS_GUID);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const session: WsSession = { socket, buffer: Buffer.alloc(0), pushUserId: token };
    sessions.add(session);
    socket.on('data', (chunk: Buffer) => {
      session.buffer = Buffer.concat([session.buffer, chunk]);
      drain(session);
    });
    socket.on('close', () => sessions.delete(session));
    socket.on('error', () => sessions.delete(session));
  }

  function drain(session: WsSession): void {
    for (;;) {
      const { frame, consumed } = parseFrame(session.buffer);
      if (frame === null || consumed === 0) return;
      session.buffer = session.buffer.subarray(consumed);
      handleFrame(session, frame);
    }
  }

  function sendText(session: WsSession, text: string): void {
    if (!session.socket.writable) return;
    session.socket.write(encodeFrame(text, 1));
  }

  function handleFrame(session: WsSession, frame: ParsedFrame): void {
    if (frame.opcode === 8) {
      session.socket.write(encodeFrame(Buffer.alloc(0), 8));
      session.socket.end();
      return;
    }
    if (frame.opcode === 9) {
      session.socket.write(encodeFrame(frame.payload, 10));
      return;
    }
    if (frame.opcode === 10) {
      return;
    }
    if (frame.opcode !== 1) {
      sendText(session, JSON.stringify({ errorCode: 400, errorMessage: 'text frames only (JSON codec)' }));
      return;
    }
    let message: RequestEnvelope;
    try {
      message = JSON.parse(frame.payload.toString('utf8')) as RequestEnvelope;
    } catch {
      sendText(session, JSON.stringify({ errorCode: 400, errorMessage: 'Bad frame' }));
      return;
    }
    const { cmd, subCmd, reqId, data } = message;
    const result = dispatchResult(cmd, subCmd, data);
    const legacy = cmd === 30 && subCmd === 2; // 旧服务模拟：不回显 reqId/kind
    const delay = cmd === 30 && subCmd === 3 ? Number((data as { delay?: number })?.delay ?? 0) : 0;
    const envelope = {
      ...result,
      ...(legacy || reqId === undefined ? {} : { reqId, kind: 'response' }),
    };
    setTimeout(() => {
      sendText(session, JSON.stringify(envelope));
      if (cmd === 30 && subCmd === 1) {
        // §5：bag 请求后主动推送一帧，验证 kind=notification 的分流渲染
        sendText(session, JSON.stringify(notificationFrame()));
      }
    }, delay);
  }

  const listener = await new Promise<Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });

  const address = listener.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    port,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    httpBase: `http://127.0.0.1:${port}/api`,
    close: async () => {
      for (const session of sessions) {
        try {
          session.socket.end();
        } catch {
          // 忽略
        }
      }
      sessions.clear();
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    },
  };
}

async function sha1Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Buffer.from(digest).toString('base64');
}
