import { createHash } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { coverLayouts } from '../../src/shared/cover-composition';
import { type Episode, projectPublicEpisode } from '../../src/shared/episode';
import { type ArtRecord, artLocation, artVersion, withShareArtwork } from '../../src/shared/episode-art';
import { artRecords, currentArtPrefixes } from '../../worker/episode-art-cache';
import { fixture, readyFixture } from './production-fixture';

const record: ArtRecord = {
  id: 'episode /一',
  title: '今晚先吃饭',
  episodeNumber: 8,
  coverUrl: 'https://f.no.mt/cover.png',
  categoryName: '生活',
  resource: 'episodes',
};
let mf: Miniflare;
let db: D1Database;

beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'episode-art-cache-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
            },
          },
          env: { DB: { type: 'd1', name: 'episode-art-cache-test' } },
        },
      },
    ],
  });
  db = (await mf.getBindings<{ DB: D1Database }>()).DB;
  await db.batch(
    [
      'CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT)',
      'CREATE TABLE episodes (id TEXT PRIMARY KEY, title TEXT, episode_number INTEGER, cover_url TEXT, category TEXT)',
      'CREATE TABLE productions (id TEXT PRIMARY KEY, data TEXT)',
      'CREATE TABLE site_appearance (id INTEGER PRIMARY KEY, theme TEXT, version INTEGER, updated_at TEXT, updated_by TEXT)',
      "INSERT INTO site_appearance VALUES (1, 'stillwood', 1, '', '')",
      "INSERT INTO categories VALUES ('life', '生活'), ('work', '工作')",
    ].map((sql) => db.prepare(sql)),
  );
}, 30000);

beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM episodes'),
    db.prepare('DELETE FROM productions'),
    db.prepare("UPDATE site_appearance SET theme = 'stillwood'"),
    db
      .prepare('INSERT INTO episodes VALUES (?, ?, ?, ?, ?)')
      .bind(record.id, record.title, record.episodeNumber, record.coverUrl, 'life'),
    db.prepare("INSERT INTO episodes VALUES ('work-episode', '工作节目', 1, '/images/work.webp', 'work')"),
    db
      .prepare('INSERT INTO productions VALUES (?, ?)')
      .bind('production-test', JSON.stringify(readyFixture())),
    db
      .prepare('INSERT INTO productions VALUES (?, ?)')
      .bind('no-cover', JSON.stringify(fixture({ id: 'no-cover' }))),
    db
      .prepare('INSERT INTO productions VALUES (?, ?)')
      .bind('work-production', JSON.stringify(readyFixture({ id: 'work-production', category: 'work' }))),
  ]);
});
afterAll(() => mf.dispose());

describe('versioned managed episode artwork descriptors', () => {
  it('hashes the explicit JPEG descriptor with SHA-256 and separates every square input', async () => {
    const expected = createHash('sha256')
      .update(
        JSON.stringify([
          'jpeg-v1',
          record.coverUrl,
          'stillwood',
          record.title,
          8,
          '生活',
          coverLayouts.stillwood.frameDigest,
        ]),
      )
      .digest('hex');
    expect(await artVersion(record, 'stillwood')).toBe(expected);
    expect(await artVersion({ ...record }, 'stillwood')).toBe(expected);
    for (const changed of [
      { coverUrl: `${record.coverUrl}?version=2` },
      { title: '新的标题' },
      { episodeNumber: 9 },
      { categoryName: '新栏目' },
    ]) {
      expect(await artVersion({ ...record, ...changed }, 'stillwood')).not.toBe(expected);
    }
    expect(await artVersion(record, 'interval')).not.toBe(expected);
    expect(await artVersion({ ...record, title: 'a,1', categoryName: 'b' }, 'stillwood')).not.toBe(
      await artVersion({ ...record, title: 'a', categoryName: '1,b' }, 'stillwood'),
    );
  });

  it.each(['stillwood', 'alpine-bloom'] as const)(
    'invalidates pre-lockup %s artwork without changing share artwork',
    async (theme) => {
      const oldVersion = createHash('sha256')
        .update(JSON.stringify(['jpeg-v1', record.coverUrl, theme, record.title, 8, '生活']))
        .digest('hex');
      const location = await artLocation(record, theme);
      expect(location.version).not.toBe(oldVersion);
      expect(location.key).toContain(`/${theme}/${location.version}/`);
      expect(await artVersion(record, null)).toBe(
        createHash('sha256')
          .update(JSON.stringify(['jpeg-v1', record.coverUrl]))
          .digest('hex'),
      );
    },
  );

  it('versions share images only by original cover, independently of copy and saved theme', async () => {
    const version = await artVersion(record, null);
    expect(version).toBe(
      createHash('sha256')
        .update(JSON.stringify(['jpeg-v1', record.coverUrl]))
        .digest('hex'),
    );
    expect(
      await artVersion({ ...record, title: '另一个标题', episodeNumber: 999, categoryName: '工作' }, null),
    ).toBe(version);
    expect(await artVersion({ ...record, coverUrl: '/media/next.webp' }, null)).not.toBe(version);
  });

  it('keeps every output size under a versioned resource/id/kind/theme managed prefix', async () => {
    const square = await artLocation(record, 'stillwood');
    const large = await artLocation(record, 'stillwood', 3000);
    const share = await artLocation(record, null, 3000);
    const encoded = encodeURIComponent(record.id);
    expect(square).toEqual({
      prefix: `rendered/episodes/${encoded}/art/stillwood/${square.version}/`,
      key: `rendered/episodes/${encoded}/art/stillwood/${square.version}/1400.jpg`,
      version: expect.stringMatching(/^[a-f0-9]{64}$/),
      url: `/episodes/${encoded}/art.jpg?v=${square.version}`,
    });
    expect(large).toEqual({
      ...square,
      key: `${square.prefix}3000.jpg`,
      url: `${square.url}&size=3000`,
    });
    expect(share).toEqual({
      prefix: `rendered/episodes/${encoded}/share/stillwood/${share.version}/`,
      key: `rendered/episodes/${encoded}/share/stillwood/${share.version}/1200.jpg`,
      version: expect.stringMatching(/^[a-f0-9]{64}$/),
      url: `/episodes/${encoded}/share.jpg?v=${share.version}`,
    });
    const production = await artLocation({ ...record, resource: 'productions' }, 'interval');
    expect(production.prefix).toContain(`rendered/productions/${encoded}/art/interval/`);
    expect(production.key).not.toBe(square.key);
  });

  it('versions only the automatic share URL without overriding custom SEO artwork or mutating the record', async () => {
    const origin = 'https://his.fm';
    const episode = projectPublicEpisode(
      {
        ...record,
        slug: 'dinner',
        version: 1,
        summary: '晚饭',
        transcript: '',
        lead: '',
        researchNote: '',
        credits: '',
        body: '',
        topics: [],
        category: 'life',
        tags: [],
        mentions: [],
        seo: {},
        durationSeconds: 0,
        audioUrl: null,
        status: 'published',
        featured: false,
        publishedAt: '2020-01-01T00:00:00.000Z',
        createdAt: '',
        updatedAt: '',
      } satisfies Episode,
      origin,
    );
    const automatic = `${origin}/episodes/${encodeURIComponent(record.id)}/share.jpg`;
    episode.pageSeo.ogImageUrl = automatic;
    const versioned = await withShareArtwork(episode, origin);
    expect(versioned.pageSeo.ogImageUrl).toBe(`${automatic}?v=${await artVersion(record, null)}`);
    expect(episode.pageSeo.ogImageUrl).toBe(automatic);
    expect(await withShareArtwork(versioned, origin)).toBe(versioned);
    const custom = { ...episode, pageSeo: { ...episode.pageSeo, ogImageUrl: 'https://f.no.mt/custom.jpg' } };
    expect(await withShareArtwork(custom, origin)).toBe(custom);
  });
});

describe('current artwork references', () => {
  it('loads both resource types and excludes productions without a cover', async () => {
    const records = await artRecords(db);
    expect(records).toHaveLength(4);
    expect(records).toContainEqual(record);
    expect(records).toContainEqual({
      id: 'production-test',
      title: readyFixture().title,
      episodeNumber: 8,
      coverUrl: 'https://f.no.mt/cover.png',
      categoryName: '生活',
      resource: 'productions',
    });
  });

  it('filters each resource by ID, category or no filter without leaking unrelated records', async () => {
    for (const resource of ['episodes', 'productions'] as const) {
      const all = await artRecords(db, { resource });
      expect(all).toHaveLength(2);
      expect(all.every((item) => item.resource === resource)).toBe(true);
      expect(await artRecords(db, { resource, id: all[0].id })).toEqual([all[0]]);
      expect(await artRecords(db, { resource, category: 'work' })).toEqual([
        expect.objectContaining({ resource, categoryName: '工作' }),
      ]);
      expect(await artRecords(db, { resource, id: 'missing' })).toEqual([]);
      expect(await artRecords(db, { resource, category: 'missing' })).toEqual([]);
      expect(await artRecords(db, { resource, id: all[0].id, category: 'missing' })).toEqual([all[0]]);
    }
  });

  it('protects all sizes of current square/share records but not old square themes or versions', async () => {
    const prefixes = await currentArtPrefixes(db);
    expect(prefixes).toHaveLength(8);
    const square = await artLocation(record, 'stillwood', 3000);
    const share = await artLocation(record, null);
    expect(prefixes).toContain(square.prefix);
    expect(prefixes).toContain(share.prefix);
    await db.prepare("UPDATE site_appearance SET theme = 'interval'").run();
    const next = await currentArtPrefixes(db);
    expect(next).not.toContain(square.prefix);
    expect(next).toContain(share.prefix);
    await db
      .prepare('UPDATE episodes SET cover_url = ? WHERE id = ?')
      .bind('/media/new.png', record.id)
      .run();
    expect(await currentArtPrefixes(db)).not.toContain(share.prefix);
  });

  it.each(['episodes', 'productions'] as const)('rejects partial %s reference results', async (resource) => {
    const unavailable = {
      prepare: () => ({ all: async () => ({ success: false, results: [] }) }),
    } as unknown as D1Database;
    await expect(artRecords(unavailable, { resource })).rejects.toMatchObject({ status: 503 });
  });

  it('rejects malformed production JSON instead of silently dropping its references', async () => {
    await db.prepare("UPDATE productions SET data = '{' WHERE id = 'production-test'").run();
    await expect(currentArtPrefixes(db)).rejects.toThrow(/malformed JSON/);
  });
});
