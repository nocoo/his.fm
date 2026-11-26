import type { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { version } from '../../../../package.json';
import type { Episode, EpisodeInput, PublicEpisode, PublicEpisodeSummary } from '../../src/shared/episode';
import { PUBLIC_HTML_CACHE_CONTROL } from '../../src/shared/public-cache-policy';
import worker from '../../worker';
import { brief } from './production-fixture';
import {
  buildWorkerRequest,
  createWorkerEnv,
  createWorkerEpisode,
  defaultEpisodeInput,
  jsonBody,
  origin,
  resetWorkerEnv,
  signAccessToken,
} from './worker-fixture';

vi.mock('../../worker/episode-art-pregenerate', () => ({
  pregenerateEpisodeArt: vi.fn().mockResolvedValue(undefined),
}));
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

const input = defaultEpisodeInput;
const body = jsonBody;

let miniflare: Miniflare;
let env: Env;
let privateKey: CryptoKey;
let cookie: string;

const request = (path: string, options: RequestInit = {}) => buildWorkerRequest(path, cookie, options);
const call = (path: string, options: RequestInit = {}, bindings = env) =>
  worker.fetch(request(path, options), bindings);
const create = (changes: Partial<EpisodeInput> = {}) => createWorkerEpisode(env, cookie, changes);
const token = (claims: Record<string, unknown> = {}) => signAccessToken(privateKey, claims);

function publicCache() {
  const entrypoint = { fetch: vi.fn(), invalidate: vi.fn().mockResolvedValue(undefined) };
  const context = {
    exports: { PublicContent: entrypoint },
    waitUntil: vi.fn(),
  } as unknown as ExecutionContext;
  return { entrypoint, context };
}

beforeAll(async () => {
  ({ miniflare, env, privateKey } = await createWorkerEnv('hisfm-test', 'his-fm-test'));
}, 30000);

beforeEach(async () => {
  cookie = await resetWorkerEnv(env);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await miniflare?.dispose();
});

describe('public podcast catalog', () => {
  it('keeps drafts and future episodes private while exposing published content', async () => {
    const episode = await create();
    await create({ slug: 'draft', status: 'draft', publishedAt: null, episodeNumber: undefined });
    await create({ slug: 'future', publishedAt: '2999-01-01T00:00:00.000Z', episodeNumber: undefined });
    const list = await call('/api/episodes');
    const listBody = (await list.json()) as { episodes: PublicEpisodeSummary[] };
    expect(listBody.episodes).toHaveLength(1);
    expect(listBody.episodes[0]).toMatchObject({
      id: episode.id,
      slug: episode.slug,
      title: episode.title,
      category: episode.category,
    });
    expect(listBody.episodes[0]).not.toHaveProperty('showNotes');
    expect(listBody.episodes[0]).not.toHaveProperty('mentions');
    expect(listBody.episodes[0]).not.toHaveProperty('pageSeo');
    const detail = await call(`/api/episodes/${episode.slug}`);
    const { episode: publicEpisode } = (await detail.json()) as { episode: PublicEpisode };
    expect(publicEpisode).toMatchObject({
      id: episode.id,
      canonical: expect.stringContaining(`/episodes/${episode.category}/${episode.slug}`),
      pageSeo: expect.objectContaining({
        title: expect.stringContaining(episode.title),
        canonical: expect.stringContaining(episode.slug),
      }),
    });
    expect((await call('/api/episodes/draft')).status).toBe(404);
    expect((await call('/api/episodes/future')).status).toBe(404);
    expect((await call('/api/episodes/missing')).status).toBe(404);
    expect((await call('/api/episodes')).headers.get('Cache-Control')).toBe('no-store');
  });

  it('redirects legacy episode URLs to category paths', async () => {
    const episode = await create();
    const response = await call(`/episodes/${episode.slug}`);
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toContain(`/episodes/${episode.category}/${episode.slug}`);
    const head = await call(`/episodes/${episode.slug}`, { method: 'HEAD' });
    expect(head.status).toBe(301);
  });

  it('redirects reserved legacy slugs when a published episode uses them', async () => {
    const episode = await create({ slug: 'about' });
    const response = await call('/episodes/about');
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toContain(`/episodes/${episode.category}/about`);
  });

  it('updates episode number claims when renumbering manual episodes', async () => {
    const episode = await create({ episodeNumber: 2, slug: 'renumber-me' });
    const response = await call(`/admin/api/episodes/${episode.id}`, {
      method: 'PUT',
      ...body({
        ...input,
        version: episode.version,
        slug: 'renumber-me',
        episodeNumber: 4,
        category: 'learning',
      }),
    });
    expect(response.status).toBe(200);
    expect(
      await env.DB.prepare(
        'SELECT category, episode_number AS episodeNumber FROM episode_number_claims WHERE holder_kind = ? AND holder_id = ?',
      )
        .bind('episode', episode.id)
        .first<{ category: string; episodeNumber: number }>(),
    ).toEqual({ category: 'learning', episodeNumber: 4 });
  });

  it('updates episodes without touching claims when number and category stay the same', async () => {
    const episode = await create({ episodeNumber: 30, slug: 'stable-number' });
    const response = await call(`/admin/api/episodes/${episode.id}`, {
      method: 'PUT',
      ...body({
        ...input,
        version: episode.version,
        slug: 'stable-number',
        episodeNumber: 30,
        title: '新标题',
      }),
    });
    expect(response.status).toBe(200);
  });

  it('retries manual episode creation after claim races', async () => {
    for (let number = 1; number <= 7; number++) {
      await env.DB.prepare(
        'INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind) VALUES (?, ?, ?, ?)',
      )
        .bind(input.category, number, `holder-${number}`, 'episode')
        .run();
    }
    await env.DB.prepare(
      'INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind) VALUES (?, ?, ?, ?)',
    )
      .bind(input.category, 8, 'blocked-eight', 'episode')
      .run();
    const response = await call('/admin/api/episodes', {
      method: 'POST',
      ...body({ ...input, episodeNumber: undefined, slug: 'race-episode' }),
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { episode: Episode }).episode.episodeNumber).toBe(9);
  });

  it('does not move episode claims when a stale episode update conflicts', async () => {
    const episode = await create({ episodeNumber: 31, slug: 'stale-claim' });
    const before = await env.DB.prepare(
      'SELECT category, episode_number AS episodeNumber FROM episode_number_claims WHERE holder_kind = ? AND holder_id = ?',
    )
      .bind('episode', episode.id)
      .first<{ category: string; episodeNumber: number }>();
    const response = await call(`/admin/api/episodes/${episode.id}`, {
      method: 'PUT',
      ...body({ ...input, version: 999, slug: 'stale-claim', episodeNumber: 99, category: 'learning' }),
    });
    expect(response.status).toBe(409);
    expect(
      await env.DB.prepare(
        'SELECT category, episode_number AS episodeNumber FROM episode_number_claims WHERE holder_kind = ? AND holder_id = ?',
      )
        .bind('episode', episode.id)
        .first<{ category: string; episodeNumber: number }>(),
    ).toEqual(before);
  });

  it('returns conflict when deleting a stale episode version', async () => {
    const episode = await create({
      status: 'draft',
      publishedAt: null,
      episodeNumber: 24,
      slug: 'stale-delete',
    });
    const response = await call(`/admin/api/episodes/${episode.id}?version=999`, { method: 'DELETE' });
    expect(response.status).toBe(409);
  });

  it('rejects duplicate slugs within a category when creating episodes', async () => {
    await create({ slug: 'shared-slug', episodeNumber: 22 });
    const response = await call('/admin/api/episodes', {
      method: 'POST',
      ...body({ ...input, slug: 'shared-slug', episodeNumber: 23 }),
    });
    expect(response.status).toBe(409);
  });

  it('rejects duplicate slugs within a category when updating episodes', async () => {
    await create({ slug: 'slug-a', episodeNumber: 20 });
    const second = await create({ slug: 'slug-b', episodeNumber: 21 });
    const response = await call(`/admin/api/episodes/${second.id}`, {
      method: 'PUT',
      ...body({ ...input, version: second.version, slug: 'slug-a', episodeNumber: 21 }),
    });
    expect(response.status).toBe(409);
  });

  it('rejects duplicate numbers when creating manual episodes', async () => {
    await create({ episodeNumber: 11, slug: 'first-eleven' });
    const response = await call('/admin/api/episodes', {
      method: 'POST',
      ...body({ ...input, episodeNumber: 11, slug: 'second-eleven' }),
    });
    expect(response.status).toBe(409);
  });

  it('blocks duplicate episode numbers across productions and manual episodes', async () => {
    const manual = await call('/admin/api/episodes', {
      method: 'POST',
      ...body({ ...input, slug: 'manual-one', episodeNumber: 1 }),
    });
    expect(manual.status).toBe(201);
    const duplicate = await call('/admin/api/productions', {
      method: 'POST',
      ...body({ ...brief, category: input.category, slug: 'production-one', episodeNumber: 1 }),
    });
    expect(duplicate.status).toBe(409);
  });

  it('redirects renamed category segments on nested episode URLs', async () => {
    const episode = await create();
    await env.DB.prepare('INSERT INTO category_id_aliases (alias, category_id) VALUES (?, ?)')
      .bind('legacy-category', episode.category)
      .run();
    const response = await call(`/episodes/legacy-category/${episode.slug}`);
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toContain(`/episodes/${episode.category}/${episode.slug}`);
  });

  it('resolves nested public episode API paths', async () => {
    const episode = await create();
    const nested = await call(`/api/episodes/${episode.category}/${episode.slug}`);
    expect(nested.status).toBe(200);
    const legacy = await call(`/api/episodes/${episode.slug}`);
    expect(legacy.status).toBe(200);
    expect(((await nested.json()) as { episode: Episode }).episode.slug).toBe(episode.slug);
  });

  it('uses the same legacy slug winner for API, redirects and ambiguous slugs', async () => {
    const sharedSlug = 'shared-legacy-slug';
    const older = await create({
      slug: sharedSlug,
      category: 'life',
      episodeNumber: 1,
      publishedAt: '2026-01-01T08:00:00.000Z',
      title: '较早的一期',
    });
    const newer = await create({
      slug: sharedSlug,
      category: 'manager-notes',
      episodeNumber: 2,
      publishedAt: '2026-06-01T08:00:00.000Z',
      title: '较晚的一期',
    });
    const legacyApi = (await (await call(`/api/episodes/${sharedSlug}`)).json()) as { episode: Episode };
    expect(legacyApi.episode.id).toBe(older.id);
    const redirect = await call(`/episodes/${sharedSlug}`);
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get('Location')).toBe(`${origin}/episodes/${older.category}/${older.slug}`);
    expect(newer.id).not.toBe(older.id);
  });

  it('stores structured episode content and keeps omitted collections intact', async () => {
    const episode = await create();
    const structured = {
      ...input,
      version: episode.version,
      lead: '开场的一段话。',
      researchNote: '公司自报的数据按据称处理。',
      credits: '本期旁白：测试音色。',
      body: '补充段落。',
      topics: [
        {
          title: '第一个主题',
          detail: '展开说明。',
          sourceUrls: ['https://example.com/source'],
        },
        { title: '第二个主题', detail: '', sourceUrls: [] },
      ],
      mentions: [{ name: '示例来源', description: '一句话说明。', url: 'https://example.com/report' }],
    };
    const updated = await call(`/admin/api/episodes/${episode.id}`, {
      method: 'PUT',
      ...body(structured),
    });
    expect(updated.status).toBe(200);
    const saved = ((await updated.json()) as { episode: Episode }).episode;
    expect(saved.lead).toBe('开场的一段话。');
    expect(saved.topics).toHaveLength(2);
    expect(saved.topics[0]?.sourceUrls).toEqual(['https://example.com/source']);
    expect(saved.mentions).toEqual(structured.mentions);

    const { topics: _topics, mentions: _mentions, ...withoutCollections } = input;
    const partial = await call(`/admin/api/episodes/${episode.id}`, {
      method: 'PUT',
      ...body({
        ...withoutCollections,
        version: saved.version,
        title: '改过标题',
        lead: '新的导语。',
        researchNote: structured.researchNote,
        credits: structured.credits,
        body: structured.body,
      }),
    });
    const kept = ((await partial.json()) as { episode: Episode }).episode;
    expect(kept.title).toBe('改过标题');
    expect(kept.topics).toHaveLength(2);
    expect(kept.mentions).toEqual(structured.mentions);

    const publicDetail = (await (await call(`/api/episodes/${episode.slug}`)).json()) as {
      episode: PublicEpisode;
    };
    expect(publicDetail.episode.topics[0]?.title).toBe('第一个主题');
    expect(publicDetail.episode.researchNote).toContain('据称');
  });

  it('keeps mentions and the episode body on the detail endpoint and out of the catalogue', async () => {
    const episode = await create();
    const listed = (await (await call('/api/episodes')).json()) as { episodes: PublicEpisodeSummary[] };
    expect(listed.episodes[0]).not.toHaveProperty('mentions');
    expect(listed.episodes[0]).not.toHaveProperty('topics');
    const detail = (await (await call(`/api/episodes/${episode.slug}`)).json()) as { episode: PublicEpisode };
    expect(detail.episode.mentions).toEqual(input.mentions);
    expect(detail.episode.topics).toEqual(input.topics);
    expect(detail.episode).not.toHaveProperty('transcript');
  });

  it('rejects duplicate manual episode numbers when creating productions', async () => {
    const first = await call('/admin/api/productions', { method: 'POST', ...body(brief) });
    expect(first.status).toBe(201);
    const duplicate = await call('/admin/api/productions', {
      method: 'POST',
      ...body({ ...brief, slug: 'another-slug', episodeNumber: brief.episodeNumber }),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: '该栏目下已有相同期数' });
  });

  it('rejects unknown category feeds and supports site seo HEAD', async () => {
    expect((await call('/feeds/unknown-category.xml')).status).toBe(404);
    expect((await call('/api/site-seo', { method: 'HEAD' })).status).toBe(200);
  });

  it('serves robots, sitemap, site seo and category feeds', async () => {
    const episode = await create();
    const robots = await call('/robots.txt');
    expect(robots.status).toBe(200);
    const robotsBody = await robots.text();
    expect(robotsBody).toContain(`${origin}/sitemap.xml`);
    for (const path of ['/admin', '/login', '/api/']) expect(robotsBody).toContain(`Disallow: ${path}`);
    const sitemap = await call('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect(await sitemap.text()).toContain(`/episodes/${episode.category}/${episode.slug}`);
    const siteSeo = await call('/api/site-seo');
    expect(siteSeo.status).toBe(200);
    expect(((await siteSeo.json()) as { seo: { defaultTitle: string } }).seo.defaultTitle).toContain(
      'his.fm',
    );
    const categoryFeed = await call(`/feeds/${episode.category}.xml`);
    expect(categoryFeed.status).toBe(200);
    expect(await categoryFeed.text()).toContain('<itunes:author>');
  });

  it('keeps empty and explicitly hidden pages out of the sitemap and restores populated programme pages', async () => {
    const saved = await env.DB.prepare('SELECT name, seo FROM categories WHERE id = ?')
      .bind('learning')
      .first<{ name: string; seo: string }>();
    if (!saved) throw new Error('Missing category fixture');
    try {
      await env.DB.prepare('UPDATE categories SET name = ?, seo = ? WHERE id = ?')
        .bind('Programme title', JSON.stringify({ description: 'Public programme introduction' }), 'learning')
        .run();
      await create({ category: 'learning', episodeNumber: 1, slug: 'draft-only', status: 'draft' });
      await create({
        category: 'learning',
        episodeNumber: 2,
        slug: 'future-only',
        publishedAt: '2999-01-01T00:00:00Z',
      });
      const emptyResponse = await call('/episodes?category=learning');
      expect(emptyResponse.status).toBe(404);
      expect(await emptyResponse.text()).toContain('<meta name="robots" content="noindex, follow"');
      const emptySitemap = await (await call('/sitemap.xml')).text();
      expect(emptySitemap).not.toContain(`<loc>${origin}/episodes</loc>`);
      expect(emptySitemap).not.toContain('category=learning');
      expect(emptySitemap).not.toContain('draft-only');
      expect(emptySitemap).not.toContain('future-only');

      const published = await create({ category: 'learning', episodeNumber: 3, slug: 'published-programme' });
      const hidden = await create({
        category: 'learning',
        episodeNumber: 4,
        slug: 'hidden-episode',
        seo: { noindex: true },
      });
      const populated = await (await call('/episodes?category=learning')).text();
      expect(populated).toContain('<meta name="robots" content="index, follow"');
      expect(populated).toContain('aria-label="播客栏目"');
      expect(populated).toContain('href="/episodes?category=learning"');
      expect(populated).toContain('aria-current="page"');
      const sitemap = await (await call('/sitemap.xml')).text();
      expect(sitemap).toContain(`<loc>${origin}/episodes</loc>`);
      expect(sitemap).toContain(`<loc>${origin}/episodes?category=learning</loc>`);
      expect(sitemap).toContain(`/episodes/learning/${published.slug}`);
      expect(sitemap).not.toContain(`/episodes/learning/${hidden.slug}`);

      await env.DB.prepare('UPDATE categories SET seo = ? WHERE id = ?')
        .bind(JSON.stringify({ noindex: true }), 'learning')
        .run();
      expect(await (await call('/episodes?category=learning')).text()).toContain(
        '<meta name="robots" content="noindex, follow"',
      );
      expect(await (await call('/sitemap.xml')).text()).not.toContain('category=learning');
    } finally {
      await env.DB.prepare('UPDATE categories SET name = ?, seo = ? WHERE id = ?')
        .bind(saved.name, saved.seo, 'learning')
        .run();
    }
  });

  it('renders published public content and safely bootstraps only public data', async () => {
    const episode = await create({
      lead: '开场的一段导语。',
      researchNote: '',
      credits: '',
      body: '',
      topics: [{ title: 'Listen closely', detail: '第一个主题的说明。', sourceUrls: [] }],
    });
    await create({ slug: 'private-draft', episodeNumber: 99, title: 'PRIVATE DRAFT', status: 'draft' });
    for (const path of ['/', '/episodes', '/about', `/episodes/${episode.category}/${episode.slug}`]) {
      const response = await call(path);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('<h1');
      expect(html).not.toContain('<div id="root"></div>');
      expect(html).not.toContain('PRIVATE DRAFT');
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).not.toContain('"transcript":');
      const bootstrap = html.match(
        /<script id="public-data" type="application\/json"(?: nonce="[^"]+")?>(.*?)<\/script>/s,
      );
      expect(bootstrap).not.toBeNull();
      const data = JSON.parse(bootstrap?.[1] ?? '{}');
      expect(data.site).not.toHaveProperty('updatedBy');
      expect(data.appearance).not.toHaveProperty('updatedBy');
      const episodeCategories = new Set(
        (data.episodes as Array<{ category: string }>).map((item) => item.category),
      );
      for (const category of data.categories as Array<{ id: string }>) {
        expect(episodeCategories.has(category.id)).toBe(true);
      }
      if (path.includes(episode.slug)) {
        expect(html).toContain('开场的一段导语。');
        expect(html).toContain('<h3>Listen closely</h3>');
      }
    }
    const home = await (await call('/?theme=interval')).text();
    expect(home).toContain('imageSrcSet=');
    expect(home).toContain('media="(max-width: 760px)"');
    expect(home).toContain('max(calc(100vw - 48px), 370px)');
    const homeResponse = await call('/');
    expect(homeResponse.headers.get('Server-Timing')).toMatch(/load;dur=/);
    expect(await (await call('/', { method: 'HEAD' })).text()).toBe('');
  });

  it('returns real public 404s, keeps local tooling reachable and adds security headers', async () => {
    for (const path of [
      '/feed',
      '/missing',
      '/episodes/episodes',
      '/episodes/unknown',
      '/episodes/life/unknown',
    ]) {
      const response = await call(path);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain('noindex, follow');
    }
    expect((await call('/@vite/client')).status).toBe(200);
    expect((await call('/login')).status).toBe(200);
    const response = await call('/');
    expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
    expect(response.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin-allow-popups');
    expect(response.headers.get('Content-Security-Policy')).toContain("base-uri 'none'");
    expect(response.headers.get('Content-Security-Policy')).toContain("object-src 'none'");
    const production = await call('/', {}, { ...env, ENVIRONMENT: 'production' });
    const csp = production.headers.get('Content-Security-Policy');
    const nonce = /'nonce-([^']+)'/.exec(csp ?? '')?.[1];
    expect(nonce).toBeTruthy();
    const productionHtml = await production.text();
    expect(productionHtml).toContain(`<script nonce="${nonce}"`);
    expect(productionHtml.match(/<script(?![^>]*\bnonce=)/g)).toBeNull();
    expect(productionHtml.match(/\son[a-z]+=/g)).toBeNull();
    expect(productionHtml).toMatch(/<link rel="stylesheet" href="\/assets\/[^"]+\.css"/);
    expect(productionHtml).not.toContain('data-defer-style');
    expect(productionHtml.indexOf('<style id="public-critical">')).toBeLessThan(
      productionHtml.indexOf('<link rel="stylesheet"'),
    );
    for (const url of ['http://his.fm/about?x=1', 'https://www.his.fm/about?x=1']) {
      const redirect = await worker.fetch(new Request(url), env);
      expect(redirect.status).toBe(308);
      expect(redirect.headers.get('Location')).toBe('https://his.fm/about?x=1');
    }
  });

  it('redirects public trailing slashes before selecting the HTML shell', async () => {
    for (const path of ['/about', '/episodes', '/episodes/life/test', '/login']) {
      const response = await call(`${path}/?theme=interval`);
      expect(response.status).toBe(308);
      expect(response.headers.get('Location')).toBe(`${origin}${path}?theme=interval`);
    }
  });

  it('keeps the public cache behind the gateway and gives every cached HTML read a fresh nonce', async () => {
    const { entrypoint, context } = publicCache();
    const template =
      '<html><script nonce="__HISFM_CSP_NONCE__">trusted()</script><h1>Cached public content</h1></html>';
    entrypoint.fetch.mockImplementation(
      async () =>
        new Response(template, {
          headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'public, max-age=60',
            'CF-Cache-Status': 'HIT',
          },
        }),
    );
    const nonces = new Set<string>();
    for (const method of ['GET', 'GET', 'HEAD']) {
      const response = await worker.fetch(
        new Request('https://his.fm/?theme=interval', {
          method,
          headers: {
            Cookie: 'private-session=secret',
            Authorization: 'Bearer private-token',
            'Cf-Access-Jwt-Assertion': 'private-jwt',
            Range: 'bytes=0-10',
            'If-None-Match': 'old',
          },
        }),
        { ...env, ENVIRONMENT: 'production' },
        context,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get('X-Public-Cache')).toBe('HIT');
      expect(response.headers.get('Cache-Control')).toBe(PUBLIC_HTML_CACHE_CONTROL);
      const nonce = /'nonce-([^']+)'/.exec(response.headers.get('Content-Security-Policy') ?? '')?.[1];
      expect(nonce).toBeTruthy();
      nonces.add(nonce ?? '');
      const html = await response.text();
      if (method === 'HEAD') expect(html).toBe('');
      else expect(html).toBe(template.replace('nonce="__HISFM_CSP_NONCE__"', `nonce="${nonce}"`));
    }
    expect(nonces.size).toBe(3);
    for (const [forwarded] of entrypoint.fetch.mock.calls) {
      expect(forwarded.url).toBe('https://his.fm/?theme=interval&_hisfm_r=test-revision');
      expect(forwarded.method).toBe('GET');
      expect([...forwarded.headers]).toEqual([]);
    }
    expect(entrypoint.invalidate).not.toHaveBeenCalled();
  });

  it('redirects canonical hosts before cache lookup and never caches private, API or local responses', async () => {
    const { entrypoint, context } = publicCache();
    const production = { ...env, ENVIRONMENT: 'production' };
    for (const url of ['http://his.fm/about?x=1', 'https://www.his.fm/about?x=1']) {
      const response = await worker.fetch(new Request(url), production, context);
      expect(response.status).toBe(308);
      expect(response.headers.get('Location')).toBe('https://his.fm/about?x=1');
    }
    expect((await worker.fetch(new Request('https://his.fm/about/'), production, context)).status).toBe(308);
    expect(
      (await worker.fetch(new Request('https://his.fm/admin/api/episodes'), production, context)).status,
    ).toBe(401);
    expect((await worker.fetch(new Request('https://his.fm/api/episodes'), production, context)).status).toBe(
      200,
    );
    expect(
      (await worker.fetch(new Request('https://his.fm/?utm_source=external'), production, context)).status,
    ).toBe(200);
    expect((await worker.fetch(request('/'), env, context)).status).toBe(200);
    expect(entrypoint.fetch).not.toHaveBeenCalled();
    expect(entrypoint.invalidate).not.toHaveBeenCalled();
    entrypoint.fetch.mockResolvedValueOnce(
      new Response('image', { headers: { 'Content-Type': 'image/webp' } }),
    );
    const image = await worker.fetch(
      new Request('https://his.fm/media/episode-thumbnails/one/1/stillwood/320.webp'),
      production,
      context,
    );
    expect(await image.text()).toBe('image');
    expect(image.headers.get('X-Public-Cache')).toBe('UNKNOWN');
  });

  it('purges after a committed human mutation, not after a rejected write, and exposes purge failures honestly', async () => {
    const { entrypoint, context } = publicCache();
    const production = { ...env, ENVIRONMENT: 'production' };
    const jwt = await token();
    const current = (await (await call('/admin/api/seo')).json()) as { seo: { version: number } };
    const update = (version: number) =>
      worker.fetch(
        new Request('https://his.fm/admin/api/seo', {
          method: 'PUT',
          ...body({ version, defaultTitle: `Cache invalidation ${version}` }),
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://his.fm',
            'Cf-Access-Jwt-Assertion': jwt,
          },
        }),
        production,
        context,
      );
    const changed = await update(current.seo.version);
    expect(changed.status).toBe(200);
    expect(entrypoint.invalidate).toHaveBeenCalledOnce();
    expect(entrypoint.fetch).not.toHaveBeenCalled();
    expect((await update(current.seo.version)).status).toBe(409);
    expect(entrypoint.invalidate).toHaveBeenCalledOnce();
    entrypoint.invalidate.mockRejectedValueOnce(new Error('Purge unavailable'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const committed = await update(current.seo.version + 1);
      expect(committed.status).toBe(200);
      expect(committed.headers.get('X-Public-Cache')).toBe('invalidation-failed');
      const stored = (await (await call('/admin/api/seo')).json()) as {
        seo: { version: number; defaultTitle: string };
      };
      expect(stored.seo.version).toBe(current.seo.version + 2);
      expect(stored.seo.defaultTitle).toBe(`Cache invalidation ${current.seo.version + 1}`);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('public_cache_purge_failed'));
    } finally {
      log.mockRestore();
    }
  });

  it('serves embeddable episode cards for published pages with CORS and cache headers', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4]);
    await env.MEDIA.put('sample.mp3', bytes, { httpMetadata: { contentType: 'audio/mpeg' } });
    const episode = await create({ audioUrl: '/media/sample.mp3' });
    const pageUrl = `${origin}/episodes/${episode.category}/${episode.slug}`;
    const card = await call(`/api/card?url=${encodeURIComponent(pageUrl)}`);
    expect(card.status).toBe(200);
    expect(card.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(card.headers.get('Cache-Control')).toBe('public, max-age=300, stale-while-revalidate=3600');
    const payload = (await card.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      v: 1,
      status: 'published',
      page_url: pageUrl,
      title: episode.title,
      description: episode.summary,
      show: 'his.fm',
      column: '主理人手札',
      episode_label: '主理人手札 EP.07',
      published_at: episode.publishedAt,
      duration: episode.durationSeconds,
      audio: { mime: 'audio/mpeg', bytes: bytes.byteLength },
    });
    expect((payload.audio as { url: string }).url).toContain('sample.mp3');
    expect((await call('/api/card', { method: 'OPTIONS' })).status).toBe(204);
    expect(
      (await call(`/api/card?url=${encodeURIComponent(pageUrl)}`, { method: 'HEAD' })).headers.get(
        'Cache-Control',
      ),
    ).toBe('public, max-age=300, stale-while-revalidate=3600');
    expect((await call('/api/card')).status).toBe(400);
    expect((await call('/api/card?url=https://his.fm/about')).status).toBe(400);
    expect(
      await (
        await call(
          `/api/card?url=${encodeURIComponent(`${origin}/episodes/${episode.category}/missing-slug`)}`,
        )
      ).json(),
    ).toEqual({ v: 1, status: 'not_found' });
    await create({ slug: 'draft-card', status: 'draft', publishedAt: null, episodeNumber: undefined });
    expect(
      (await call(`/api/card?url=${encodeURIComponent(`${origin}/episodes/manager-notes/draft-card`)}`))
        .status,
    ).toBe(404);
  });

  it('includes audio enclosures when episodes have playable media', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 4]);
    await env.MEDIA.put('sample.mp3', bytes, { httpMetadata: { contentType: 'audio/mpeg' } });
    await create({ audioUrl: '/media/sample.mp3' });
    const xml = await (await call('/feed.xml')).text();
    expect(xml).toContain('<enclosure');
    expect(xml).toContain('sample.mp3');
    expect(xml).toContain('type="audio/mpeg"');
    expect(xml).toContain(`length="${bytes.byteLength}"`);
    const categoryXml = await (await call('/feeds/manager-notes.xml')).text();
    expect(categoryXml).toContain('type="audio/mpeg"');
    expect(categoryXml).toContain(`length="${bytes.byteLength}"`);
  });

  it('301 redirects legacy catalogue category aliases but keeps unknown feed ids as 404', async () => {
    await env.DB.prepare('INSERT INTO category_id_aliases (alias, category_id) VALUES (?, ?)')
      .bind('legacy-category-id', 'life')
      .run();
    const feed = await call('/feeds/legacy-category-id.xml');
    expect(feed.status).toBe(301);
    expect(feed.headers.get('Location')).toBe('/feeds/life.xml');
    const catalogue = await call('/episodes?category=legacy-category-id');
    expect(catalogue.status).toBe(301);
    expect(catalogue.headers.get('Location')).toBe('/episodes?category=life');
  });

  it('returns 404 for unknown catalogue categories instead of noindex placeholders', async () => {
    const response = await call('/episodes?category=bogus');
    expect(response.status).toBe(404);
    const html = await response.text();
    expect(html).not.toContain('rel="canonical"');
    expect(
      html.match(/<link rel="alternate" type="application\/rss\+xml" href="https:\/\/[^"]+\/feed\.xml"/g)
        ?.length,
    ).toBe(1);
    expect(html).toContain('<style id="public-critical">');
    const critical = html.match(/<style id="public-critical">([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(critical.length).toBeGreaterThan(1000);
    expect(critical).toContain('.site-header');
  });

  it('301 redirects aliased catalogue categories and keeps populated columns reachable', async () => {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO categories (id, name, icon, color, updated_at, updated_by) VALUES ('look-outside', '看看外面', 'compass', 'teal', datetime('now'), 'test')",
    ).run();
    await env.DB.prepare('INSERT OR IGNORE INTO category_id_aliases (alias, category_id) VALUES (?, ?)')
      .bind('life', 'look-outside')
      .run();
    const redirected = await call('/episodes?category=life&page=2');
    expect(redirected.status).toBe(301);
    expect(redirected.headers.get('Location')).toBe('/episodes?category=look-outside&page=2');
    expect((await call('/episodes?category=life')).status).toBe(301);
    const episode = await create({ category: 'conversations', slug: 'first-conversation', episodeNumber: 1 });
    const conversationPage = await call('/episodes?category=conversations');
    expect(conversationPage.status).toBe(200);
    expect(await conversationPage.text()).toContain(`/episodes/conversations/${episode.slug}`);
    await env.DB.prepare('DELETE FROM episodes WHERE id = ?').bind(episode.id).run();
    expect((await call('/episodes?category=conversations')).status).toBe(404);
  });

  it('redirects aliased catalogue URLs before a public cache HIT can return stale HTML', async () => {
    const production = { ...env, ENVIRONMENT: 'production' };
    const { entrypoint, context } = publicCache();
    entrypoint.fetch.mockResolvedValue(
      new Response('<html>stale</html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    );
    await env.DB.prepare(
      "INSERT OR IGNORE INTO categories (id, name, icon, color, updated_at, updated_by) VALUES ('look-outside', '看看外面', 'compass', 'teal', datetime('now'), 'test')",
    ).run();
    await env.DB.prepare('INSERT OR IGNORE INTO category_id_aliases (alias, category_id) VALUES (?, ?)')
      .bind('life', 'look-outside')
      .run();
    const response = await worker.fetch(request('/episodes?category=life'), production, context);
    expect(response.status).toBe(301);
    expect(entrypoint.fetch).not.toHaveBeenCalled();
  });

  it('keys public cache fetches by the deployed build revision', async () => {
    const production = { ...env, ENVIRONMENT: 'production' };
    const { entrypoint, context } = publicCache();
    entrypoint.fetch.mockResolvedValue(
      new Response('<html>fresh</html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    );
    await worker.fetch(new Request('https://his.fm/'), production, context);
    expect(entrypoint.fetch).toHaveBeenCalledOnce();
    const cacheRequest = entrypoint.fetch.mock.calls[0]?.[0] as Request;
    expect(new URL(cacheRequest.url).searchParams.get('_hisfm_r')).toBe('test-revision');
  });

  it('includes mentions in RSS item descriptions', async () => {
    await env.MEDIA.put('mentions.mp3', new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: 'audio/mpeg' },
    });
    await create({ audioUrl: '/media/mentions.mp3' });
    const feed = await call('/feed.xml');
    expect(feed.status).toBe(200);
    expect(feed.headers.get('Content-Type')).toContain('application/rss+xml');
    expect(feed.headers.get('X-Robots-Tag')).toBe('noindex');
    const xml = await feed.text();
    expect(xml).toContain('本期提到');
    expect(xml).toContain('his.fm — 这档播客的主站。');
    expect(xml).toContain('https://his.fm/');
  });

  it('omits transcript from public episode JSON while admin and agent APIs retain it', async () => {
    const episode = await create();
    expect(episode.transcript.length).toBeGreaterThan(0);
    const listed = (await (await call('/api/episodes')).json()) as { episodes: Record<string, unknown>[] };
    expect(listed.episodes[0]).not.toHaveProperty('transcript');
    const detail = (await (await call(`/api/episodes/${episode.slug}`)).json()) as {
      episode: Record<string, unknown>;
    };
    expect(detail.episode).not.toHaveProperty('transcript');
    const admin = (await (await call(`/admin/api/episodes/${episode.id}`)).json()) as { episode: Episode };
    expect(admin.episode.transcript).toBe(episode.transcript);
  });

  it('serves llms-full, admin site seo and agent seo routes', async () => {
    await create();
    const full = await call('/llms-full.txt');
    expect(full.status).toBe(200);
    expect(await full.text()).toContain('Episodes by category');
    const llms = await call('/llms.txt');
    expect(llms.status).toBe(200);
    expect(llms.headers.get('Cache-Control')).toContain('stale-while-revalidate');
    const llmsBody = await llms.text();
    expect(llmsBody).toContain('## Agent API');
    expect(llmsBody).toContain('李征');
    const seo = await call('/admin/api/seo');
    expect(seo.status).toBe(200);
    const current = (await seo.json()) as { seo: { version: number } };
    const updated = await call('/admin/api/seo', {
      method: 'PUT',
      ...body({ version: current.seo.version, defaultTitle: 'his.fm · SEO 测试' }),
    });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { seo: { defaultTitle: string } }).seo.defaultTitle).toBe(
      'his.fm · SEO 测试',
    );
    expect(
      (
        await call('/admin/api/seo', {
          method: 'PUT',
          ...body({ version: current.seo.version, defaultTitle: 'stale' }),
        })
      ).status,
    ).toBe(409);
  });

  it('redirects legacy episode slug URLs after SEO admin mutations', async () => {
    const episode = await create();
    const response = await call(`/episodes/${episode.slug}`);
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toContain(`/episodes/${episode.category}/${episode.slug}`);
  });

  it('injects SEO tags into public HTML responses', async () => {
    const episode = await create();
    const html = await (await call(`/episodes/${episode.category}/${episode.slug}`)).text();
    expect(html).toContain('property="og:title"');
    expect(html).toContain('application/ld+json');
    expect(html).toContain(episode.title);
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
