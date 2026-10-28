import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../../worker/http';
import {
  cacheablePublicRequest,
  freshPublicHtml,
  invalidatesPublicContent,
  publicContentResponse,
} from '../../worker/public-cache';

const mocks = vi.hoisted(() => ({ html: vi.fn(), thumbnail: vi.fn(), feed: vi.fn() }));
vi.mock('../../worker/feed-response', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../worker/feed-response')>()),
  feedResponse: mocks.feed,
}));
vi.mock('../../worker/public-html', () => ({ maybeServePublicHtml: mocks.html }));
vi.mock('../../worker/episode-thumbnails', () => ({ routeEpisodeThumbnail: mocks.thumbnail }));

const env = {} as Env;
const request = (path: string, method = 'GET') => new Request(`https://his.fm${path}`, { method });

beforeEach(() => vi.resetAllMocks());

describe('public cache boundary', () => {
  it('admits only canonical public pages and bounded query variants', () => {
    for (const path of [
      '/',
      '/about',
      '/feed.xml',
      '/feeds/learning.xml',
      '/episodes',
      '/episodes/learning/one',
      '/?theme=stillwood',
      '/episodes?category=learning&theme=interval',
      '/media/episode-thumbnails/one/3/stillwood/320.webp',
    ]) {
      expect(cacheablePublicRequest(request(path)), path).toBe(true);
      expect(cacheablePublicRequest(request(path, 'HEAD')), path).toBe(true);
    }
    for (const path of [
      '/episodes/legacy',
      '/admin',
      '/admin/api/episodes',
      '/login',
      '/api/episodes',
      '/api/agent/episodes',
      '/missing',
      '/feed.xml?anything=1',
      '/feeds/learning.xml?theme=stillwood',
      '/about/',
      '/episodes/learning/one/extra',
      '/?theme=missing',
      '/?theme=interval&theme=grove',
      '/?utm_source=external',
      '/about?category=learning',
      '/episodes?category=',
      '/episodes?category=%3Cscript%3E',
      `/episodes?category=${'a'.repeat(121)}`,
      '/media/episode-thumbnails/one/3/stillwood/320.webp?source=https://example.com/private',
    ])
      expect(cacheablePublicRequest(request(path)), path).toBe(false);
    expect(cacheablePublicRequest(request('/', 'POST'))).toBe(false);
    expect(cacheablePublicRequest(new Request('http://his.fm/'))).toBe(false);
    expect(cacheablePublicRequest(new Request('https://www.his.fm/'))).toBe(false);
    expect(cacheablePublicRequest(new Request('https://hisfm.dev.hexly.ai/'))).toBe(false);
  });

  it('invalidates only successful public-content management mutations', () => {
    for (const prefix of ['/admin/api', '/api/agent'])
      for (const path of [
        '/seo',
        '/appearance',
        '/categories/learning',
        '/episodes/one',
        '/productions/one/publish',
      ])
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
          expect(invalidatesPublicContent(request(`${prefix}${path}`, method), new Response())).toBe(true);
    for (const path of [
      '/api/episodes',
      '/admin/api/storage',
      '/api/agent/agent-tokens',
      '/admin/api/episodes-other',
    ])
      expect(invalidatesPublicContent(request(path, 'POST'), new Response())).toBe(false);
    for (const method of ['GET', 'HEAD', 'OPTIONS'])
      expect(invalidatesPublicContent(request('/admin/api/seo', method), new Response())).toBe(false);
    for (const status of [302, 400, 401, 403, 409, 500])
      expect(invalidatesPublicContent(request('/admin/api/seo', 'PUT'), new Response(null, { status }))).toBe(
        false,
      );
  });

  it('never renders private or unbounded requests inside the cached entrypoint', async () => {
    const response = await publicContentResponse(request('/admin'), env);
    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.html).not.toHaveBeenCalled();
    expect(mocks.thumbnail).not.toHaveBeenCalled();
  });

  it('caches only successful public output, not redirects or missing pages', async () => {
    mocks.html.mockResolvedValueOnce(
      new Response('public', { headers: { 'Cache-Control': 'public, max-age=60' } }),
    );
    const response = await publicContentResponse(request('/'), env);
    expect(await response.text()).toBe('public');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    for (const status of [301, 404]) {
      mocks.html.mockResolvedValueOnce(new Response(null, { status }));
      const missing = await publicContentResponse(request('/episodes/missing'), env);
      expect(missing.status).toBe(status);
      expect(missing.headers.get('Cache-Control')).toBe('no-store');
    }
    mocks.html.mockResolvedValueOnce(null);
    expect((await publicContentResponse(request('/'), env)).status).toBe(404);
  });

  it('routes versioned thumbnails without accepting an arbitrary image source', async () => {
    const input = request('/media/episode-thumbnails/one/3/stillwood/320.webp');
    mocks.thumbnail.mockResolvedValueOnce(
      new Response('webp', { headers: { 'Cache-Control': 'public, max-age=3600' } }),
    );
    const response = await publicContentResponse(input, env);
    expect(mocks.thumbnail).toHaveBeenCalledWith(input, env, 'one', '3', 'stillwood', '320');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(mocks.html).not.toHaveBeenCalled();
  });

  it('routes RSS through the same purgeable entrypoint without rendering HTML', async () => {
    mocks.feed.mockResolvedValue(
      new Response('<rss/>', {
        headers: { 'Cache-Control': 'public, max-age=60', 'Content-Type': 'application/rss+xml' },
      }),
    );
    const input = request('/feed.xml');
    const response = await publicContentResponse(input, env);
    expect(mocks.feed).toHaveBeenCalledWith(input, env);
    expect(await response.text()).toBe('<rss/>');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
    expect(mocks.html).not.toHaveBeenCalled();
  });

  it('keeps validation and infrastructure errors out of the cache', async () => {
    mocks.thumbnail.mockRejectedValueOnce(new HttpError(400, 'invalid width'));
    const invalid = await publicContentResponse(
      request('/media/episode-thumbnails/one/3/stillwood/999.webp'),
      env,
    );
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('Cache-Control')).toBe('no-store');
    expect(await invalid.json()).toEqual({ error: 'invalid width' });
    mocks.html.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(publicContentResponse(request('/'), env)).rejects.toThrow('database unavailable');
  });

  it('adds a new CSP nonce after every cache read and leaves the cached template unchanged', async () => {
    const template = '<script>trusted()</script><script src="/app.js"></script><div>public</div>';
    const cached = new Response(template, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        'Content-Length': '100',
        'Content-Encoding': 'gzip',
        ETag: 'old',
        Age: '10',
      },
    });
    const nonces = new Set<string>();
    for (let i = 0; i < 2; i++) {
      const response = await freshPublicHtml(cached.clone());
      const csp = response.headers.get('Content-Security-Policy') ?? '';
      const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
      expect(nonce).toBeTruthy();
      expect(csp).not.toContain('unsafe-eval');
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('track-collect.nocoo.cloud');
      expect(await response.text()).toBe(template.replaceAll('<script', `<script nonce="${nonce}"`));
      nonces.add(nonce ?? '');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      for (const header of ['Content-Length', 'Content-Encoding', 'ETag', 'Age'])
        expect(response.headers.has(header)).toBe(false);
    }
    expect(nonces.size).toBe(2);
    expect(await cached.text()).toBe(template);
  });

  it('allowlists Traks only when the cached public HTML includes the collector', async () => {
    const template =
      '<script>window.traks=window.traks||function(){}</script><script defer src="https://track-collect.nocoo.cloud/t.js"></script>';
    const response = await freshPublicHtml(
      new Response(template, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    );
    expect(response.headers.get('Content-Security-Policy')).toContain('https://track-collect.nocoo.cloud');
  });
});
