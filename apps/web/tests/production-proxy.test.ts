import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as nodeSetTimeout } from 'node:timers';
import type { Connect, ViteDevServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { run, remoteFetch } = vi.hoisted(() => ({ run: vi.fn(), remoteFetch: vi.fn<typeof fetch>() }));
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: run }) };
});

import { productionProxy } from '../scripts/production-proxy';

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {
    throw new Error('Promise not initialized');
  };
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

let server: Server;
let origin: string;
let port: number;

type Result = { status: number; headers: IncomingHttpHeaders; body: string };
function send(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string | undefined>;
    body?: Buffer | string;
    partial?: boolean;
  } = {},
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const headers = Object.fromEntries(
      Object.entries({ 'X-Hisfm-Remote': '1', Origin: origin, ...options.headers }).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? 'GET',
        headers,
        setHost: !Object.hasOwn(options.headers ?? {}, 'Host'),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          if (options.partial) request.destroy();
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString(),
          });
        });
      },
    );
    request.on('error', reject);
    if (options.partial) request.write(options.body);
    else request.end(options.body);
  });
}

beforeEach(async () => {
  run.mockReset().mockResolvedValue({ stdout: 'test.payload.signature\n', stderr: '' });
  remoteFetch
    .mockReset()
    .mockImplementation(
      async () => new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }),
    );
  vi.stubGlobal('fetch', remoteFetch);
  let handler: Connect.NextHandleFunction | undefined;
  const plugin = productionProxy();
  if (typeof plugin.configureServer !== 'function') throw new Error('Missing development hook');
  Reflect.apply(plugin.configureServer, undefined, [
    {
      middlewares: {
        use: (middleware: Connect.NextHandleFunction) => {
          handler = middleware;
        },
      },
    } as unknown as ViteDevServer,
  ]);
  server = createServer((request, response) =>
    handler?.(request, response, () => {
      response.statusCode = 404;
      response.end('next');
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('local production proxy', () => {
  it('is a serve-only plugin and leaves unrelated routes alone', async () => {
    expect(productionProxy().apply).toBe('serve');
    expect(await send('/admin/api/session', { headers: { 'X-Hisfm-Remote': undefined } })).toMatchObject({
      status: 404,
      body: 'next',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('uses a fixed remote API and server token without forwarding browser credentials or remote cookies', async () => {
    remoteFetch.mockResolvedValueOnce(
      new Response('result', {
        status: 201,
        headers: {
          'Content-Type': 'application/custom',
          'Set-Cookie': 'private=remote',
          Location: 'https://evil.example',
          'Access-Control-Allow-Origin': '*',
        },
      }),
    );
    const response = await send('/admin/remote-api/episodes?q=one%20two', {
      headers: {
        Cookie: 'browser=private',
        Authorization: 'Bearer browser',
        'CF-Access-Jwt-Assertion': 'browser',
      },
    });
    expect(response).toMatchObject({
      status: 201,
      body: 'result',
      headers: { 'content-type': 'application/custom', 'cache-control': 'no-store' },
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers.location).toBeUndefined();
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    const [url, init] = remoteFetch.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://his.fm/admin/api/episodes?q=one%20two');
    expect(init?.redirect).toBe('manual');
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
      accept: 'application/json',
      cookie: 'CF_Authorization=test.payload.signature',
      origin: 'https://his.fm',
    });
    expect(run).toHaveBeenCalledWith(
      'cloudflared',
      ['access', 'token', '--app=https://his.fm/admin'],
      expect.objectContaining({ timeout: 5000, maxBuffer: 65536, windowsHide: true }),
    );
    expect(response.body).not.toContain('test.payload.signature');
  });

  it('forwards mutation bytes and content type while replacing the origin', async () => {
    const response = await send('/admin/remote-api/episodes/example', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{"title":"example"}',
    });
    expect(response.status).toBe(200);
    const init = remoteFetch.mock.calls[0]?.[1];
    expect(init?.method).toBe('PUT');
    expect(new Headers(init?.headers).get('Origin')).toBe('https://his.fm');
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
    expect(new Headers(init?.headers).get('Content-Length')).toBe('19');
    expect(Buffer.from(init?.body as Uint8Array).toString()).toBe('{"title":"example"}');
  });

  it('preserves empty responses and HTTP error status without access cookies', async () => {
    remoteFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await send('/admin/remote-api/episodes/example', { method: 'DELETE' })).toMatchObject({
      status: 204,
      body: '',
    });
    remoteFetch.mockResolvedValueOnce(new Response('{"error":"Conflict"}', { status: 409 }));
    expect(await send('/admin/remote-api/episodes/example', { method: 'PUT' })).toMatchObject({
      status: 409,
      body: '{"error":"Conflict"}',
    });
  });

  it.each([
    'evil.example',
    'hisfm.dev.hexly.ai.evil.example',
    'localhost@evil.example',
    'localhost:7000/path',
    'localhost.',
    '',
    '[invalid',
  ])('rejects untrusted Host %s', async (host) => {
    expect((await send('/admin/remote-api/session', { headers: { Host: host } })).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['localhost:7056', '127.0.0.1:27056', '[::1]:7056', 'hisfm.dev.hexly.ai'])(
    'accepts allowed local Host %s',
    async (host) => {
      expect(
        (await send('/admin/remote-api/session', { headers: { Host: host, Origin: undefined } })).status,
      ).toBe(200);
    },
  );

  it('requires the explicit remote marker even for GET and rejects OPTIONS preflight', async () => {
    expect(
      (await send('/admin/remote-api/session', { headers: { 'X-Hisfm-Remote': undefined } })).status,
    ).toBe(403);
    expect((await send('/admin/remote-api/session', { headers: { 'X-Hisfm-Remote': '0' } })).status).toBe(
      403,
    );
    expect((await send('/admin/remote-api/session', { method: 'OPTIONS' })).status).toBe(405);
    expect(run).not.toHaveBeenCalled();
  });

  it('requires the exact local origin for mutations and refuses foreign read origins', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(
        (await send('/admin/remote-api/episodes', { method, headers: { Origin: undefined } })).status,
      ).toBe(403);
      expect(
        (await send('/admin/remote-api/episodes', { method, headers: { Origin: 'https://evil.example' } }))
          .status,
      ).toBe(403);
    }
    expect((await send('/admin/remote-api/session', { headers: { Origin: 'null' } })).status).toBe(403);
    expect(
      (
        await send('/admin/remote-api/session', {
          method: 'POST',
          headers: { Host: 'hisfm.dev.hexly.ai', Origin: 'http://hisfm.dev.hexly.ai' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send('/admin/remote-api/session', {
          method: 'POST',
          headers: { Host: 'hisfm.dev.hexly.ai', Origin: 'https://hisfm.dev.hexly.ai' },
        })
      ).status,
    ).toBe(200);
  });

  it.each([
    '..',
    '.',
    '%2e%2e',
    '%2F%2Fevil.example',
    '%5c..',
    '%252e%252e',
    '%00',
    '%1f',
    '%7f',
    '%invalid',
    '..\\outside',
    'session#fragment',
  ])('rejects path injection %s', async (segment) => {
    expect((await send(`/admin/remote-api/${segment}`)).status).toBe(400);
    expect(remoteFetch).not.toHaveBeenCalled();
  });

  it('rejects an oversized declared request before reading a token', async () => {
    const response = await send('/admin/remote-api/upload', {
      method: 'POST',
      headers: { 'Content-Length': String(9 * 1024 * 1024 + 1) },
    });
    expect(response.status).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });

  it('bounds chunked uploads and supports the exact limit', async () => {
    const limit = 9 * 1024 * 1024;
    expect(
      (await send('/admin/remote-api/upload', { method: 'POST', body: Buffer.alloc(limit + 1) })).status,
    ).toBe(413);
    expect(run).not.toHaveBeenCalled();
    expect(
      (await send('/admin/remote-api/upload', { method: 'POST', body: Buffer.alloc(limit) })).status,
    ).toBe(200);
    expect(remoteFetch.mock.calls[0]?.[1]?.body).toHaveLength(limit);
  });

  it.each([
    ['/productions/example/assets/audio?version=2', 'PUT', 172865536],
    ['/storage', 'POST', 25 * 1024 * 1024],
  ])('bounds larger media uploads for %s only', async (path, method, limit) => {
    expect(
      (
        await send(`/admin/remote-api${path}`, {
          method,
          headers: { 'Content-Length': String(limit + 1), Connection: 'close' },
        })
      ).status,
    ).toBe(413);
    expect(run).not.toHaveBeenCalled();
    const body = Buffer.alloc(10 * 1024 * 1024);
    expect(
      (await send(`/admin/remote-api${path}`, { method, headers: { 'Content-Type': 'audio/wav' }, body }))
        .status,
    ).toBe(200);
    const init = remoteFetch.mock.calls[0]?.[1];
    expect(init?.body).toHaveLength(body.byteLength);
    expect(new Headers(init?.headers).get('Content-Length')).toBe(String(body.byteLength));
  });

  it.each([
    ['/productions/example/assets/audio/extra', 'PUT'],
    ['/productions/example/assets/audio', 'POST'],
    ['/storage/cleanup', 'POST'],
    ['/storage', 'PUT'],
  ])('keeps the default upload bound for %s %s', async (path, method) => {
    expect(
      (
        await send(`/admin/remote-api${path}`, {
          method,
          headers: { 'Content-Length': String(9 * 1024 * 1024 + 1) },
        })
      ).status,
    ).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });

  it('preserves byte ranges and validators without leaking upstream cookies', async () => {
    remoteFetch.mockResolvedValueOnce(
      new Response('wav', {
        status: 206,
        headers: {
          'Content-Type': 'audio/wav',
          'Content-Length': '3',
          'Content-Range': 'bytes 44-46/100',
          'Accept-Ranges': 'bytes',
          ETag: '"media-version"',
          'Last-Modified': 'Wed, 14 Oct 2026 00:00:00 GMT',
          'Content-Disposition': 'inline',
          'Set-Cookie': 'secret=upstream',
        },
      }),
    );
    const response = await send('/admin/remote-api/storage/object?key=audio.wav', {
      headers: { Range: 'bytes=44-46', 'If-Range': '"media-version"' },
    });
    expect(response).toMatchObject({
      status: 206,
      body: 'wav',
      headers: {
        'content-length': '3',
        'content-range': 'bytes 44-46/100',
        'accept-ranges': 'bytes',
        etag: '"media-version"',
        'last-modified': 'Wed, 14 Oct 2026 00:00:00 GMT',
        'content-disposition': 'inline',
      },
    });
    expect(response.headers['set-cookie']).toBeUndefined();
    const headers = new Headers(remoteFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Range')).toBe('bytes=44-46');
    expect(headers.get('If-Range')).toBe('"media-version"');
    remoteFetch.mockResolvedValueOnce(
      new Response(null, { status: 304, headers: { ETag: '"media-version"' } }),
    );
    expect(
      (
        await send('/admin/remote-api/storage/object?key=audio.wav', {
          headers: { 'If-None-Match': '"media-version"' },
        })
      ).status,
    ).toBe(304);
    expect(new Headers(remoteFetch.mock.calls[1]?.[1]?.headers).get('If-None-Match')).toBe('"media-version"');
  });

  it('does not advertise compressed upstream lengths after fetch decompression', async () => {
    remoteFetch.mockResolvedValueOnce(
      new Response('decoded body', {
        headers: { 'Content-Encoding': 'gzip', 'Content-Length': '40' },
      }),
    );
    const response = await send('/admin/remote-api/storage/object?key=text.txt');
    expect(response.body).toBe('decoded body');
    expect(response.headers['content-length']).toBeUndefined();
    expect(response.headers['content-encoding']).toBeUndefined();
  });

  it('maps all upstream redirects to reauthentication without exposing the redirect', async () => {
    remoteFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://nocoo.cloudflareaccess.com/cdn-cgi/access/login?token=private' },
      }),
    );
    const response = await send('/admin/remote-api/session');
    expect(response.status).toBe(401);
    expect(response.headers.location).toBeUndefined();
    expect(response.body).not.toContain('private');
    expect(remoteFetch).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'not-a-jwt', 'test.payload.signature; evil=cookie', 'a'.repeat(16385)])(
    'never accepts malformed application token output',
    async (token) => {
      run.mockResolvedValueOnce({ stdout: token, stderr: 'sensitive' });
      const response = await send('/admin/remote-api/session');
      expect(response.status).toBe(401);
      expect(response.body).not.toContain('sensitive');
      expect(remoteFetch).not.toHaveBeenCalled();
    },
  );

  it('suppresses cloudflared and network exception details', async () => {
    run.mockRejectedValueOnce(new Error('secret cached token output'));
    const missing = await send('/admin/remote-api/session');
    expect(missing.status).toBe(401);
    expect(missing.body).not.toContain('secret');
    remoteFetch.mockRejectedValueOnce(new Error('sensitive upstream detail'));
    const offline = await send('/admin/remote-api/session');
    expect(offline.status).toBe(502);
    expect(offline.body).not.toContain('sensitive');
  });

  it('opens only the fixed quiet Access login and suppresses all command output', async () => {
    run.mockResolvedValueOnce({ stdout: 'secret-jwt', stderr: 'secret-login-url' });
    expect(await send('/admin/remote-connect', { method: 'POST' })).toMatchObject({
      status: 200,
      body: '{"connected":true}',
    });
    expect(run).toHaveBeenCalledWith(
      'cloudflared',
      ['access', 'login', '--quiet', 'https://his.fm/admin'],
      expect.objectContaining({ timeout: 120000, windowsHide: true }),
    );
    expect(remoteFetch).not.toHaveBeenCalled();
    expect((await send('/admin/remote-connect')).status).toBe(405);
  });

  it('returns a safe login error and allows retry', async () => {
    run.mockRejectedValueOnce(new Error('secret-login-url'));
    const response = await send('/admin/remote-connect', { method: 'POST' });
    expect(response.status).toBe(401);
    expect(response.body).not.toContain('secret');
    expect((await send('/admin/remote-connect', { method: 'POST' })).status).toBe(200);
  });
});

describe('proxy lifecycle protections', () => {
  it('deduplicates concurrent login requests and starts a fresh login after completion', async () => {
    const login = deferred<{ stdout: string; stderr: string }>();
    run.mockReturnValueOnce(login.promise);
    let seen = 0;
    server.on('request', () => {
      seen += 1;
    });
    const first = send('/admin/remote-connect', { method: 'POST' });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const second = send('/admin/remote-connect', { method: 'POST' });
    await vi.waitFor(() => expect(seen).toBe(2));
    expect(run).toHaveBeenCalledTimes(1);
    login.resolve({ stdout: 'suppressed', stderr: '' });
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect((await send('/admin/remote-connect', { method: 'POST' })).status).toBe(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('rejects oversized login requests without launching a browser', async () => {
    const response = await send('/admin/remote-connect', {
      method: 'POST',
      headers: { 'Content-Length': String(9 * 1024 * 1024 + 1) },
    });
    expect(response.status).toBe(413);
    expect(run).not.toHaveBeenCalled();
  });

  it('times out upstream requests and incomplete uploads', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) =>
      nodeSetTimeout(callback, delay === 30000 ? 25 : delay, ...args),
    );
    remoteFetch.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('upstream details')));
        }),
    );
    const stalled = await send('/admin/remote-api/session');
    expect(stalled.status).toBe(504);
    expect(stalled.body).not.toContain('details');
    const upload = await send('/admin/remote-api/upload', {
      method: 'POST',
      headers: { 'Content-Length': '10' },
      body: 'a',
      partial: true,
    });
    expect(upload.status).toBe(504);
  });

  it('allows a longer deadline for bounded full audio uploads', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const response = await send('/admin/remote-api/productions/example/assets/audio?version=1', {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/wav' },
      body: 'test wav',
    });
    expect(response.status).toBe(200);
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 120000);
  });

  it('cancels an upstream request when the browser disconnects', async () => {
    const cancelled = deferred<void>();
    remoteFetch.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            cancelled.resolve();
            reject(new Error('cancelled'));
          });
        }),
    );
    const request = httpRequest({
      host: '127.0.0.1',
      port,
      path: '/admin/remote-api/session',
      headers: { 'X-Hisfm-Remote': '1' },
    });
    request.on('error', () => undefined);
    request.end();
    await vi.waitFor(() => expect(remoteFetch).toHaveBeenCalledTimes(1));
    request.destroy();
    await cancelled.promise;
  });

  it('handles an interrupted upload without requesting remote access', async () => {
    const interrupted = deferred<void>();
    const request = httpRequest({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: '/admin/remote-api/upload',
      headers: { 'X-Hisfm-Remote': '1', Origin: origin, 'Content-Length': '10' },
    });
    request.on('error', () => undefined);
    server.once('request', (incoming) => {
      incoming.once('error', () => interrupted.resolve());
      queueMicrotask(() => request.destroy());
    });
    request.write('a');
    await interrupted.promise;
    expect(remoteFetch).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('terminates a failed stream after headers without writing a second response', async () => {
    remoteFetch.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('partial data'));
            nodeSetTimeout(() => controller.error(new Error('private upstream error')), 20);
          },
        }),
      ),
    );
    await expect(send('/admin/remote-api/session')).rejects.toThrow();
  });
});
