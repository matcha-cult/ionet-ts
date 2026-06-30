import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { type BarSkeleton, CmdInfo, createResponseMessage } from '@nbb-ionet/core-framework';
import { BaseExternalServer, type ExternalServerOptions } from '../external-server.js';

export interface HttpExternalServerOptions extends ExternalServerOptions {
  pathPrefix?: string;
}

function isWrappedData(value: unknown): value is { data?: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class HttpExternalServer extends BaseExternalServer {
  private server: Server | null = null;
  private readonly pathPrefix: string;
  readonly protocol = 'http';

  constructor(options: HttpExternalServerOptions) {
    super(options);
    this.pathPrefix = options.pathPrefix ?? '/api';
  }

  async start(skeleton: BarSkeleton): Promise<void> {
    this.skeleton = skeleton;
    this.server = createServer((req, res) => this.handleRequest(req, res));

    return new Promise((resolve) => {
      this.server!.listen(this.options.port, this.options.host ?? '0.0.0.0', () => {
        console.log(`HTTP External Server listening on ${this.protocol}://${this.options.host ?? '0.0.0.0'}:${this.options.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.skeleton) {
      res.statusCode = 503;
      res.end('Service not ready');
      return;
    }

    const url = req.url ?? '/';
    const cmdInfo = this.parsePath(url);
    if (!cmdInfo) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Invalid path format' }));
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let data: unknown = undefined;
    if (body) {
      try {
        const decoded = this.codec.decode(body);
        data = isWrappedData(decoded) ? decoded.data : decoded;
      } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid request body' }));
        return;
      }
    }

    try {
      const result = await this.skeleton.execute({
        cmd: cmdInfo.cmd,
        subCmd: cmdInfo.subCmd,
        data,
      });

      const response = createResponseMessage(result);
      res.setHeader('Content-Type', this.codec.contentType);
      res.statusCode = response.errorCode && response.errorCode >= 400 ? response.errorCode : 200;
      res.end(this.codec.encode(response));
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  private parsePath(path: string): CmdInfo | null {
    const urlPath = path.split('?')[0];
    const parts = urlPath.split('/').filter(Boolean);

    if (parts.length < 3) return null;

    const prefix = parts[0];
    if (prefix !== this.pathPrefix.replace(/^\//, '')) return null;

    const cmd = parseInt(parts[1], 10);
    const subCmd = parseInt(parts[2], 10);
    if (isNaN(cmd) || isNaN(subCmd)) return null;

    return CmdInfo.of(cmd, subCmd);
  }
}
