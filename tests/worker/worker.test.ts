import { readdirSync, readFileSync } from 'node:fs';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { version } from '../../package.json';
import type { Episode, EpisodeInput } from '../../src/shared/episode';
import worker from '../../worker';

const origin = 'https://hisfm.dev.hexly.ai';
const issuer = 'https://nocoo.cloudflareaccess.com';
const audience = '41ef6d396f8256e97999ba1d1f11e15f6e7e5e788fce46f54016fd1d9710f726';
const input: EpisodeInput = {
  slug: 'leave-a-note',
  episodeNumber: 7,
  title: '给明天留一张纸条',
  summary: '记录今天停下来的位置。',
  transcript: '今天先到这里，明天从下一步开始。',
  showNotes: '00:00 从停下来的地方继续',
  coverUrl: '/images/episode-01.webp',
  category: 'work',
  tags: ['工作节奏'],
  durationSeconds: 600,
  audioUrl: null,
  status: 'published',
  featured: false,
  publishedAt: '2026-09-01T08:00:00.000Z',
};

let miniflare: Miniflare;
let env: Env;
let privateKey: CryptoKey;
let cookie: string;

function request(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (cookie && !headers.has('Cookie')) headers.set('Cookie', cookie);
  if (options.method && options.method !== 'GET') headers.set('Origin', origin);
  return new Request(`${origin}${path}`, { ...options, headers });
}

function call(path: string, options: RequestInit = {}, bindings = env) {
  return worker.fetch(request(path, options), bindings);
}

function body(data: unknown) {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

async function create(changes: Partial<EpisodeInput> = {}) {
  const response = await call('/admin/api/episodes', { method: 'POST', ...body({ ...input, ...changes }) });
  expect(response.status).toBe(201);
  return ((await response.json()) as { episode: Episode }).episode;
}

async function token(claims: Record<string, unknown> = {}) {
  return new SignJWT({
    email: 'editor@example.com',
    sub: 'editor-1',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience(audience)
    .sign(privateKey);
}

beforeAll(async () => {
  miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: 'hisfm-test',
          type: 'worker',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': {
                type: 'esm',
                contents: 'export default { fetch() { return new Response("asset"); } }',
              },
            },
          },
          env: {
            DB: { type: 'd1', name: 'his-fm-test' },
            MEDIA: { type: 'r2', name: 'his-fm-test' },
            ENVIRONMENT: { type: 'json', value: 'local' },
            ASSETS: {
              type: 'fetcher',
              handler: () =>
                new MiniflareResponse('<html>his.fm</html>', { headers: { 'Content-Type': 'text/html' } }),
            },
          },
        },
      },
    ],
  });
  env = await miniflare.getBindings<Env>();
  const directory = new URL('../../migrations/', import.meta.url);
  for (const name of readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await env.DB.batch(
      readFileSync(new URL(name, directory), 'utf8')
        .split(';')
        .filter((statement) => statement.trim())
        .map((statement) => env.DB.prepare(statement)),
    );
  }
  const keyPair = await generateKeyPair('RS256', { extractable: true });
  privateKey = keyPair.privateKey;
  const publicJwk = await exportJWK(keyPair.publicKey);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ keys: [{ ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    ),
  );
}, 30000);

beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM episodes'), env.DB.prepare('DELETE FROM local_sessions')]);
  cookie = '';
  const response = await call('/admin/api/dev-login', { method: 'POST' });
  expect(response.status).toBe(200);
  cookie = response.headers.get('Set-Cookie')?.split(';')[0] ?? '';
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await miniflare?.dispose();
});

describe('public podcast catalog', () => {
  it('keeps drafts and future episodes private while exposing published content', async () => {
    const episode = await create();
    await create({ slug: 'draft', status: 'draft', publishedAt: null });
    await create({ slug: 'future', publishedAt: '2999-01-01T00:00:00.000Z' });
    const list = await call('/api/episodes');
    expect(await list.json()).toEqual({ episodes: [episode] });
    expect((await call('/api/episodes/draft')).status).toBe(404);
    expect((await call('/api/episodes/future')).status).toBe(404);
    expect((await call('/api/episodes/missing')).status).toBe(404);
    expect(await (await call(`/api/episodes/${episode.slug}`)).json()).toEqual({ episode });
    expect((await call('/api/episodes')).headers.get('Cache-Control')).toBe('no-store');
  });

  it('checks database liveness and handles public asset and unknown routes', async () => {
    expect(await (await call('/api/live')).json()).toEqual({
      status: 'ok',
      service: 'his.fm',
      version,
      revision: 'test-revision',
    });
    expect(await (await call('/about')).text()).toContain('his.fm');
    for (const path of ['/api/live', '/api/episodes', '/api/episodes/test']) {
      expect((await call(path, { method: 'POST' })).status).toBe(405);
    }
    expect((await call('/api/unknown')).status).toBe(404);
    expect((await call('/api')).status).toBe(404);
  });
});

describe('editor CRUD', () => {
  it('creates, reads, edits, unpublishes and deletes a podcast in D1', async () => {
    const episode = await create();
    expect(episode.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(episode.createdAt).toBeTruthy();
    expect(await (await call('/admin/api/episodes')).json()).toEqual({ episodes: [episode] });
    expect(await (await call(`/admin/api/episodes/${episode.id}`)).json()).toEqual({ episode });
    const updated = await call(`/admin/api/episodes/${episode.id}`, {
      method: 'PUT',
      ...body({
        ...input,
        title: '今晚先到这里',
        status: 'draft',
        publishedAt: null,
        featured: true,
        audioUrl: 'https://media.his.fm/episode.mp3',
      }),
    });
    const result = (await updated.json()) as { episode: Episode };
    expect(result.episode).toMatchObject({
      id: episode.id,
      title: '今晚先到这里',
      status: 'draft',
      featured: true,
      createdAt: episode.createdAt,
    });
    expect(await (await call('/api/episodes')).json()).toEqual({ episodes: [] });
    expect((await call(`/admin/api/episodes/${episode.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/admin/api/episodes/${episode.id}`)).status).toBe(404);
  });

  it('enforces unique slugs and leaves existing content intact on conflicts', async () => {
    const original = await create();
    const other = await create({ slug: 'other' });
    const duplicate = await call('/admin/api/episodes', { method: 'POST', ...body(input) });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: '这个链接名称已被另一集使用' });
    expect((await call(`/admin/api/episodes/${other.id}`, { method: 'PUT', ...body(input) })).status).toBe(
      409,
    );
    expect(
      ((await (await call(`/admin/api/episodes/${original.id}`)).json()) as { episode: Episode }).episode,
    ).toEqual(original);
  });

  it('validates bodies, immutable IDs, and published timestamps', async () => {
    for (const invalid of [
      { ...input, title: '' },
      { ...input, id: 'injected-id' },
      { ...input, publishedAt: null },
      { ...input, coverUrl: 'javascript:alert(1)' },
    ]) {
      expect((await call('/admin/api/episodes', { method: 'POST', ...body(invalid) })).status).toBe(400);
    }
    expect(
      (
        await call('/admin/api/episodes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{',
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('/admin/api/episodes', { method: 'POST', headers: { 'Content-Type': 'application/json' } }))
        .status,
    ).toBe(400);
    expect((await call('/admin/api/episodes', { method: 'POST', body: '{}' })).status).toBe(415);
    expect((await call('/admin/api/episodes', { method: 'POST' })).status).toBe(415);
  });

  it('bounds declared and streamed body sizes', async () => {
    expect(
      (
        await call('/admin/api/episodes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': '600000' },
          body: '{}',
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await call('/admin/api/episodes', {
          method: 'POST',
          ...body({ ...input, transcript: 'a'.repeat(512001) }),
        })
      ).status,
    ).toBe(413);
  });

  it('rejects cross-origin changes and unsupported routes', async () => {
    const crossOrigin = new Request(`${origin}/admin/api/episodes`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: 'https://elsewhere.example', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect((await worker.fetch(crossOrigin, env)).status).toBe(403);
    expect((await call('/admin/api/episodes', { method: 'PATCH' })).status).toBe(405);
    expect((await call('/admin/api/episodes/no-id', { method: 'POST' })).status).toBe(405);
    expect((await call('/admin/api/episodes/no-id', { method: 'PUT', ...body(input) })).status).toBe(404);
    expect((await call('/admin/api/episodes/no-id', { method: 'DELETE' })).status).toBe(404);
    expect((await call('/admin/api/missing')).status).toBe(404);
    expect((await call('/admin/api')).status).toBe(404);
    const page = await call('/admin/episodes');
    expect(page.status).toBe(200);
    expect(page.headers.get('Cache-Control')).toBe('no-store');
  });

  it('hides unexpected storage errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await env.DB.prepare('ALTER TABLE episodes RENAME TO episodes_backup').run();
    try {
      const response = await call('/admin/api/episodes', { method: 'POST', ...body(input) });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: '暂时无法完成操作，请稍后重试' });
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('request_failed'));
    } finally {
      await env.DB.prepare('ALTER TABLE episodes_backup RENAME TO episodes').run();
    }
    spy.mockRestore();
  });
});

describe('local login boundaries', () => {
  it('uses revocable hashed sessions and secure cookies', async () => {
    expect(await (await call('/admin/api/session')).json()).toEqual({
      user: { email: 'editor@his.fm' },
      mode: 'local',
    });
    const rawToken = cookie.split('=')[1];
    const stored = await env.DB.prepare('SELECT token_hash FROM local_sessions').first<{
      token_hash: string;
    }>();
    expect(stored?.token_hash).not.toBe(rawToken);
    expect(stored?.token_hash).toHaveLength(64);
    const login = await call('/admin/api/dev-login', { method: 'POST' });
    expect(login.headers.get('Set-Cookie')).toContain('HttpOnly; SameSite=Strict; Max-Age=28800; Secure');
    const response = await call('/admin/api/logout', { method: 'POST' });
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(await response.json()).toEqual({ redirect: '/admin' });
    expect((await call('/admin/api/session')).status).toBe(401);
  });

  it('rejects absent, forged, expired sessions and login CSRF', async () => {
    cookie = '';
    expect((await call('/admin/api/session')).status).toBe(401);
    expect((await call('/admin')).status).toBe(200);
    cookie = 'unrelated=1; hisfm_local_session=forged';
    expect((await call('/admin/api/session')).status).toBe(401);
    const login = await call('/admin/api/dev-login', { method: 'POST' });
    cookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? '';
    await env.DB.prepare('UPDATE local_sessions SET expires_at = 0').run();
    expect((await call('/admin/api/session')).status).toBe(401);
    const invalid = new Request(`${origin}/admin/api/dev-login`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
    });
    expect((await worker.fetch(invalid, env)).status).toBe(403);
  });

  it('allows loopback development without Secure on HTTP and denies remote hosts', async () => {
    const local = new Request('http://127.0.0.1:7057/admin/api/dev-login', {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:7057' },
    });
    const login = await worker.fetch(local, env);
    expect(login.status).toBe(200);
    expect(login.headers.get('Set-Cookie')).not.toContain('; Secure');
    for (const host of ['his.fm', 'hisfm.dev.hexly.ai.evil.example']) {
      const remote = new Request(`https://${host}/admin/api/dev-login`, {
        method: 'POST',
        headers: { Origin: `https://${host}` },
      });
      expect((await worker.fetch(remote, env)).status).toBe(404);
    }
    expect(
      (await call('/admin/api/dev-login', { method: 'POST' }, { ...env, ENVIRONMENT: 'production' })).status,
    ).toBe(404);
  });
});

describe('Cloudflare Access verification', () => {
  it('accepts a signed identity, then routes logout through Access', async () => {
    const production = { ...env, ENVIRONMENT: 'production' };
    const headers = { 'Cf-Access-Jwt-Assertion': await token() };
    const session = await call('/admin/api/session', { headers }, production);
    expect(await session.json()).toEqual({ user: { email: 'editor@example.com' }, mode: 'access' });
    expect(await (await call('/admin/api/logout', { method: 'POST', headers }, production)).json()).toEqual({
      redirect: '/cdn-cgi/access/logout',
    });
  });

  it('fails closed for missing or invalid JWT claims and never trusts an email header', async () => {
    const production = { ...env, ENVIRONMENT: 'production' };
    for (const jwt of [
      '',
      'not-a-jwt',
      await token({ exp: 1 }),
      await token({ exp: undefined }),
      await token({ email: undefined }),
      await token({ email: '  ' }),
      await token({ email: 42 }),
      await token({ sub: undefined }),
    ]) {
      expect(
        (
          await call(
            '/admin/api/session',
            {
              headers: {
                'Cf-Access-Jwt-Assertion': jwt,
                'Cf-Access-Authenticated-User-Email': 'owner@his.fm',
              },
            },
            production,
          )
        ).status,
      ).toBe(401);
    }
    const wrongAudience = await new SignJWT({ email: 'owner@his.fm', sub: 'owner' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(issuer)
      .setAudience('another-app')
      .setExpirationTime('5m')
      .sign(privateKey);
    const wrongIssuer = await new SignJWT({ email: 'owner@his.fm', sub: 'owner' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer('https://another.cloudflareaccess.com')
      .setAudience(audience)
      .setExpirationTime('5m')
      .sign(privateKey);
    for (const jwt of [wrongAudience, wrongIssuer]) {
      expect(
        (await call('/admin/api/episodes', { headers: { 'Cf-Access-Jwt-Assertion': jwt } }, production))
          .status,
      ).toBe(401);
    }
    for (const path of ['/admin', '/admin/episodes', '/admin/unknown']) {
      const page = await call(path, {}, production);
      expect(page.status).toBe(302);
      expect(page.headers.get('Location')).toContain(
        'https://nocoo.cloudflareaccess.com/cdn-cgi/access/login/his.fm',
      );
    }
  });
});

describe('R2 media', () => {
  it('streams content with metadata, cache headers and conditional requests', async () => {
    await env.MEDIA.put('covers/test.webp', 'image-content', { httpMetadata: { contentType: 'image/webp' } });
    const response = await call('/media/covers/test.webp');
    expect(await response.text()).toBe('image-content');
    expect(response.headers.get('Content-Type')).toBe('image/webp');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(
      (
        await call('/media/covers/test.webp', {
          headers: { 'If-None-Match': response.headers.get('ETag') ?? '' },
        })
      ).status,
    ).toBe(304);
    expect(await (await call('/media/covers/test.webp', { method: 'HEAD' })).text()).toBe('');
  });

  it('rejects absent or invalid media keys and methods', async () => {
    expect((await call('/media/missing')).status).toBe(404);
    expect((await call('/media/')).status).toBe(404);
    expect((await call('/media/test..webp')).status).toBe(404);
    expect((await call('/media/%00')).status).toBe(404);
    expect((await call('/media/test.webp', { method: 'POST' })).status).toBe(405);
  });
});
