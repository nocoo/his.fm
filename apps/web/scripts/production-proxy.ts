import { execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { promisify } from 'node:util';
import type { Connect, Plugin } from 'vite';

const application = 'https://his.fm/admin';
const remoteOrigin = 'https://his.fm';
const apiPrefix = '/admin/remote-api';
const connectPath = '/admin/remote-connect';
const maxUploadBytes = 9 * 1024 * 1024;
const run = promisify(execFile);
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', 'hisfm.dev.hexly.ai']);

class ProxyError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function target(request: IncomingMessage): URL | 'connect' | null {
  const raw = request.url ?? '';
  const [path = '', query = ''] = raw.split(/\?(.*)/s, 2);
  if (path !== connectPath && path !== apiPrefix && !path.startsWith(`${apiPrefix}/`)) return null;
  const host = request.headers.host?.toLowerCase() ?? '';
  let local: URL;
  try {
    local = new URL(`http://${host}`);
  } catch {
    throw new ProxyError(403, '只允许从本地开发站点连接');
  }
  if (
    !localHosts.has(local.hostname) ||
    local.host !== host ||
    local.pathname !== '/' ||
    local.username ||
    local.password
  ) {
    throw new ProxyError(403, '只允许从本地开发站点连接');
  }
  if (request.headers['x-hisfm-remote'] !== '1') throw new ProxyError(403, '缺少本地连接标记');
  const origin = `${local.hostname === 'hisfm.dev.hexly.ai' ? 'https' : 'http'}://${host}`;
  const readOnly = request.method === 'GET' || request.method === 'HEAD';
  if ((!readOnly || request.headers.origin) && request.headers.origin !== origin) {
    throw new ProxyError(403, '请从同一个本地站点发起请求');
  }
  if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method ?? '')) {
    throw new ProxyError(405, '不支持这个请求方式');
  }
  if (raw.includes('#') || path.includes('\\')) throw new ProxyError(400, '无效的接口路径');
  for (const segment of path.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new ProxyError(400, '无效的接口路径');
    }
    if (
      decoded === '.' ||
      decoded === '..' ||
      /[\\/%]/.test(decoded) ||
      Array.from(decoded).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    ) {
      throw new ProxyError(400, '无效的接口路径');
    }
  }
  if (path === connectPath) {
    if (request.method !== 'POST') throw new ProxyError(405, '请使用 POST 发起登录');
    return 'connect';
  }
  const url = new URL(remoteOrigin);
  url.pathname = `/admin/api${path.slice(apiPrefix.length)}`;
  url.search = query;
  return url;
}

export async function accessToken(): Promise<string> {
  try {
    const { stdout } = await run('cloudflared', ['access', 'token', `--app=${application}`], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    const token = stdout.trim();
    if (token.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
      throw new Error('Invalid application token');
    }
    return token;
  } catch {
    throw new ProxyError(401, '请先连接线上工作室，完成 Cloudflare Access 登录');
  }
}

function readBody(request: IncomingMessage, signal: AbortSignal): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return Promise.resolve(undefined);
  const declared = request.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxUploadBytes)) {
    request.resume();
    return Promise.reject(new ProxyError(413, '上传内容不能超过 9 MiB'));
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const fail = (error: Error) => {
      cleanup();
      request.resume();
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxUploadBytes) fail(new ProxyError(413, '上传内容不能超过 9 MiB'));
      else chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = () => fail(new ProxyError(400, '无法读取上传内容'));
    const onAbort = () => fail(new ProxyError(504, '线上连接超时，请稍后重试'));
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function json(response: ServerResponse, status: number, data: object) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(data));
}

export function productionProxy(): Plugin {
  let connecting: Promise<void> | null = null;
  async function handle(request: IncomingMessage, response: ServerResponse, next: Connect.NextFunction) {
    let destination: URL | 'connect' | null;
    try {
      destination = target(request);
    } catch (error) {
      const failure = error as ProxyError;
      json(response, failure.status, { error: failure.message });
      return;
    }
    if (!destination) {
      next();
      return;
    }
    if (destination === 'connect') {
      try {
        await readBody(request, AbortSignal.timeout(30000));
        if (!connecting) {
          connecting = run('cloudflared', ['access', 'login', '--quiet', application], {
            encoding: 'utf8',
            timeout: 120000,
            maxBuffer: 64 * 1024,
            windowsHide: true,
          })
            .then(() => undefined)
            .finally(() => {
              connecting = null;
            });
        }
        await connecting;
        json(response, 200, { connected: true });
      } catch (error) {
        json(response, error instanceof ProxyError ? error.status : 401, {
          error: error instanceof ProxyError ? error.message : '登录未完成，请重新连接线上工作室',
        });
      }
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      destination.pathname.endsWith('/production-settings/preview') ? 200000 : 30000,
    );
    const abort = () => controller.abort();
    response.once('close', abort);
    try {
      const body = await readBody(request, controller.signal);
      const token = await accessToken();
      const headers = new Headers({
        Cookie: `CF_Authorization=${token}`,
        Accept: 'application/json',
        Origin: remoteOrigin,
      });
      const contentType = request.headers['content-type'];
      if (contentType) headers.set('Content-Type', contentType);
      const remote = await fetch(destination, {
        method: request.method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
        redirect: 'manual',
        signal: controller.signal,
      });
      if (remote.status >= 300 && remote.status < 400) {
        await remote.body?.cancel();
        throw new ProxyError(401, '线上登录已失效，请重新连接线上工作室');
      }
      response.statusCode = remote.status;
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      const type = remote.headers.get('content-type');
      if (type) response.setHeader('Content-Type', type);
      if (remote.body) await pipeline(Readable.fromWeb(remote.body as ReadableStream), response);
      else response.end();
    } catch (error) {
      if (response.headersSent) response.destroy();
      else if (!response.destroyed) {
        const status = error instanceof ProxyError ? error.status : controller.signal.aborted ? 504 : 502;
        const message =
          error instanceof ProxyError
            ? error.message
            : controller.signal.aborted
              ? '线上连接超时，请稍后重试'
              : '暂时无法连接线上工作室';
        json(response, status, { error: message });
      }
    } finally {
      clearTimeout(timeout);
      response.off('close', abort);
    }
  }
  return {
    name: 'hisfm-local-production-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        void handle(request, response, next);
      });
    },
  };
}
