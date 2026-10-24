import { readdirSync, readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getCategory, renameCategoryId, routeCategories } from '../../worker/categories';
import { buildCategoryRssFeed, buildRssFeed, podcastGuid } from '../../worker/feed';
import { human } from './production-fixture';

let mf: Miniflare;
let db: D1Database;

beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'feed-guid-migration-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
            },
          },
          env: { DB: { type: 'd1', name: 'feed-guid-migration-test' } },
        },
      },
    ],
  });
  db = (await mf.getBindings<Env>()).DB;
  for (const name of readdirSync('migrations')
    .filter((name) => name.endsWith('.sql') && (name < '0024' || name === '0025_episode_structure.sql'))
    .sort()) {
    await db.batch(
      readFileSync(`migrations/${name}`, 'utf8')
        .split(';')
        .filter((sql) => sql.trim())
        .map((sql) => db.prepare(sql)),
    );
  }
});

afterAll(() => mf.dispose());

const insert = (id: string, number: number) =>
  db
    .prepare(`INSERT INTO episodes
  (id,slug,episode_number,title,summary,transcript,show_notes,cover_url,category,tags,duration_seconds,audio_url,status,featured,published_at,created_at,updated_at)
  VALUES (?, ?, ?, '节目', '简介', 'PRIVATE TRANSCRIPT', '', '/images/episode-01.webp', 'learning', '[]', 60, '/media/audio.mp3', 'published', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`)
    .bind(id, id, number)
    .run();

it('preserves existing identities and keeps newly inserted identities stable through metadata corrections', async () => {
  await insert('old-slug', 1);
  await db.batch(
    readFileSync('migrations/0024_rss_guids.sql', 'utf8')
      .split(';')
      .filter((sql) => sql.trim())
      .map((sql) => db.prepare(sql)),
  );
  await insert('new-slug', 2);
  await db.prepare("UPDATE episodes SET slug = 'corrected', category = 'life' WHERE id = 'old-slug'").run();
  const bucket = {
    head: async () => ({ size: 100, httpMetadata: { contentType: 'audio/mpeg' } }),
  } as unknown as R2Bucket;
  let xml = await buildRssFeed(db, 'https://his.fm', 'https://f.no.mt', bucket);
  expect(xml).toContain('<guid isPermaLink="true">https://his.fm/episodes/learning/old-slug</guid>');
  expect(xml).toContain('<guid isPermaLink="false">urn:his.fm:episode:new-slug</guid>');
  expect(xml).toContain('<link>https://his.fm/episodes/life/corrected</link>');
  expect(xml).not.toContain('PRIVATE TRANSCRIPT');
  await db
    .prepare("UPDATE episodes SET slug = 'new-corrected', category = 'life' WHERE id = 'new-slug'")
    .run();
  xml = await buildRssFeed(db, 'https://his.fm', 'https://f.no.mt', bucket);
  expect(xml).toContain('<guid isPermaLink="false">urn:his.fm:episode:new-slug</guid>');
});

it('preserves migrated and newly created category identities through renames', async () => {
  const response = await routeCategories(
    new Request('https://his.fm/admin/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New category', icon: 'book-open', color: 'teal' }),
    }),
    { DB: db } as Env,
    human,
  );
  const { category: created } = (await response.json()) as { category: { id: string } };
  for (const id of ['life', created.id]) {
    const category = await getCategory(db, id);
    const before = await buildCategoryRssFeed(db, 'https://his.fm', 'https://f.no.mt', id, category.name);
    await renameCategoryId(db, human, id, `${id}-renamed`, category.version, category);
    const after = await buildCategoryRssFeed(
      db,
      'https://his.fm',
      'https://f.no.mt',
      `${id}-renamed`,
      category.name,
    );
    const guid = `<podcast:guid>${podcastGuid(`/feeds/${id}.xml`)}</podcast:guid>`;
    expect(before).toContain(guid);
    expect(after).toContain(guid);
    expect(after).toContain(`href="https://his.fm/feeds/${id}-renamed.xml"`);
  }
});
