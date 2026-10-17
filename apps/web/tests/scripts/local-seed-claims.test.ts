import { readdirSync, readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { nextEpisodeNumberInCategory, reserveEpisodeNumberClaim } from '../../worker/episode-numbering';

let mf: Miniflare;
let db: D1Database;

beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'local-seed-claims-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
            },
          },
          env: {
            DB: { type: 'd1', name: 'local-seed-claims' },
            ENVIRONMENT: { type: 'json', value: 'local' },
          },
        },
      },
    ],
  });
  db = (await mf.getBindings<Env>()).DB;
  for (const name of readdirSync(new URL('../../migrations/', import.meta.url)).sort()) {
    if (!name.endsWith('.sql')) continue;
    await db.batch(
      readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')
        .split(';')
        .filter((sql) => sql.trim())
        .map((sql) => db.prepare(sql)),
    );
  }
}, 30000);

afterAll(() => mf.dispose());

beforeEach(async () => {
  await db.batch([db.prepare('DELETE FROM episode_number_claims'), db.prepare('DELETE FROM episodes')]);
});

describe('local seed episode number claims', () => {
  it('misreports free numbers when preview episodes lack claim rows', async () => {
    const now = '2026-09-24T08:00:00.000Z';
    await db
      .prepare(
        `INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, show_notes, cover_url, category, tags, duration_seconds, audio_url, status, featured, published_at, created_at, updated_at, version, write_id)
         VALUES (?, ?, 1, '预览', '摘要', '正文', '节目单', '/images/episode-01.webp', 'life', '[]', 600, NULL, 'published', 0, ?, ?, ?, 1, ?)`,
      )
      .bind('local-episode-01', 'preview-life', now, now, now, crypto.randomUUID())
      .run();
    expect(await nextEpisodeNumberInCategory(db, 'life')).toBe(1);
  });

  it('matches seed/import behavior when claim rows mirror inserted episodes', async () => {
    const now = '2026-09-24T08:00:00.000Z';
    const episodeId = 'local-episode-02';
    await db
      .prepare(
        `INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, show_notes, cover_url, category, tags, duration_seconds, audio_url, status, featured, published_at, created_at, updated_at, version, write_id)
         VALUES (?, ?, 1, '预览', '摘要', '正文', '节目单', '/images/episode-01.webp', 'life', '[]', 600, NULL, 'published', 0, ?, ?, ?, 1, ?)`,
      )
      .bind(episodeId, 'preview-life-claimed', now, now, now, crypto.randomUUID())
      .run();
    await db
      .prepare(
        'INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind) VALUES (?, ?, ?, ?)',
      )
      .bind('life', 1, episodeId, 'episode')
      .run();
    expect(await nextEpisodeNumberInCategory(db, 'life')).toBe(2);
    const episodeNumber = await reserveEpisodeNumberClaim(db, 'life', 'imported-production', 'production');
    expect(episodeNumber).toBe(2);
  });
});
