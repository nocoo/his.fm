import { readdirSync, readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildImportExampleStatements,
  joinImportExampleSql,
  splitImportExampleCliSql,
} from '../../scripts/import-example-sql.mjs';
import { nextEpisodeNumberInCategory, reserveEpisodeNumberClaim } from '../../worker/episode-numbering';

const exampleImportProduction = {
  id: 'example-how-to-live-better',
  slug: 'how-to-live-better',
  category: 'manager-notes',
  title: '示例',
};

async function runImportExampleSql(
  production: Record<string, unknown>,
  options: { mode: '--local' | '--remote'; now: string; importWriteId: string },
) {
  for (const statement of buildImportExampleStatements(production, options)) {
    const sql = statement.trim().replace(/;+$/, '');
    if (sql) await db.prepare(sql).run();
  }
}

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
  await db.batch([
    db.prepare('DELETE FROM episode_number_claims'),
    db.prepare('DELETE FROM episodes'),
    db.prepare('DELETE FROM productions'),
    db.prepare('DELETE FROM local_seed_runs'),
  ]);
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

  it('parses the concatenated cf d1 import payload after migrate and seed-style claims', async () => {
    const productionId = exampleImportProduction.id as string;
    const now = '2026-09-24T08:00:00.000Z';
    await db
      .prepare(
        'INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind) VALUES (?, ?, ?, ?)',
      )
      .bind('manager-notes', 1, 'local-episode-01', 'episode')
      .run();
    const runCliPayload = async (importWriteId: string) => {
      const sql = joinImportExampleSql(
        buildImportExampleStatements(exampleImportProduction, {
          mode: '--local',
          now,
          importWriteId,
        }),
      );
      const results = await db.batch(splitImportExampleCliSql(sql).map((statement) => db.prepare(statement)));
      expect(results.every((result) => result.success)).toBe(true);
    };
    await runCliPayload('e'.repeat(32));
    expect(
      await db
        .prepare(
          "SELECT CAST(json_extract(data, '$.episodeNumber') AS INTEGER) AS episodeNumber FROM productions WHERE id = ?",
        )
        .bind(productionId)
        .first<{ episodeNumber: number }>(),
    ).toEqual({ episodeNumber: 2 });
    expect(
      await db
        .prepare('SELECT holder_kind AS holderKind FROM episode_number_claims WHERE holder_id = ?')
        .bind(productionId)
        .first<{ holderKind: string }>(),
    ).toEqual({ holderKind: 'production' });
    await runCliPayload('f'.repeat(32));
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM episode_number_claims WHERE holder_id = ?')
        .bind(productionId)
        .first<{ n: number }>(),
    ).toEqual({ n: 1 });
  });

  it('runs import-example SQL on D1 and writes a production claim only on new insert', async () => {
    const productionId = exampleImportProduction.id as string;
    const now = '2026-09-24T08:00:00.000Z';
    await runImportExampleSql(exampleImportProduction, {
      mode: '--remote',
      now,
      importWriteId: 'a'.repeat(32),
    });
    expect(
      await db
        .prepare('SELECT holder_kind AS holderKind FROM episode_number_claims WHERE holder_id = ?')
        .bind(productionId)
        .first<{ holderKind: string }>(),
    ).toEqual({ holderKind: 'production' });
    await runImportExampleSql(exampleImportProduction, {
      mode: '--remote',
      now,
      importWriteId: 'b'.repeat(32),
    });
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM episode_number_claims WHERE holder_id = ?')
        .bind(productionId)
        .first<{ n: number }>(),
    ).toEqual({ n: 1 });
  });

  it('skips import claims when the example production already exists with an episode claim', async () => {
    const productionId = exampleImportProduction.id as string;
    const now = '2026-09-24T08:00:00.000Z';
    const payload = JSON.stringify({ ...exampleImportProduction, episodeNumber: 1 });
    await db
      .prepare(
        'INSERT INTO productions (id, version, stage, data, created_at, updated_at, write_id) VALUES (?, 1, ?, ?, ?, ?, ?)',
      )
      .bind(productionId, 'draft', payload, now, now, crypto.randomUUID())
      .run();
    await db
      .prepare(
        'INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind) VALUES (?, ?, ?, ?)',
      )
      .bind('manager-notes', 1, productionId, 'episode')
      .run();
    await runImportExampleSql(exampleImportProduction, {
      mode: '--remote',
      now,
      importWriteId: 'c'.repeat(32),
    });
    expect(
      await db
        .prepare('SELECT holder_kind AS holderKind FROM episode_number_claims WHERE holder_id = ?')
        .bind(productionId)
        .first<{ holderKind: string }>(),
    ).toEqual({ holderKind: 'episode' });
  });

  it('allocates seed episode numbers from existing claims in the category', async () => {
    await db
      .prepare(
        'INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind) VALUES (?, ?, ?, ?)',
      )
      .bind('manager-notes', 1, 'example-how-to-live-better', 'production')
      .run();
    const id = 'local-episode-01';
    const now = '2026-09-24T08:00:00.000Z';
    await db
      .prepare(
        `INSERT INTO episodes (id, slug, episode_number, title, summary, transcript, show_notes, cover_url, category, tags, duration_seconds, audio_url, status, featured, published_at, created_at, updated_at, version, write_id)
         SELECT ?, ?, (SELECT COALESCE(MAX(episode_number), 0) + 1 FROM episode_number_claims WHERE category = 'manager-notes'), '预览', '摘要', '正文', '节目单', '/images/episode-01.webp', 'manager-notes', '[]', 600, NULL, 'published', 0, ?, ?, ?, 1, ?`,
      )
      .bind(id, 'seed-preview', now, now, now, crypto.randomUUID())
      .run();
    await db
      .prepare(
        `INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind)
         SELECT category, episode_number, id, 'episode' FROM episodes WHERE id = ?`,
      )
      .bind(id)
      .run();
    expect(
      await db
        .prepare('SELECT episode_number AS episodeNumber FROM episodes WHERE id = ?')
        .bind(id)
        .first<{ episodeNumber: number }>(),
    ).toEqual({ episodeNumber: 2 });
  });

  it('allocates the next category number for import-style production rows and claims', async () => {
    for (const [holderId, episodeNumber] of [
      ['seed-ep-1', 1],
      ['seed-ep-2', 2],
    ] as const) {
      await db
        .prepare(
          'INSERT INTO episode_number_claims (category, episode_number, holder_id, holder_kind) VALUES (?, ?, ?, ?)',
        )
        .bind('manager-notes', episodeNumber, holderId, 'episode')
        .run();
    }
    const productionId = exampleImportProduction.id as string;
    const now = '2026-09-24T08:00:00.000Z';
    await runImportExampleSql(exampleImportProduction, {
      mode: '--remote',
      now,
      importWriteId: 'd'.repeat(32),
    });
    expect(
      await db
        .prepare(
          "SELECT CAST(json_extract(data, '$.episodeNumber') AS INTEGER) AS episodeNumber FROM productions WHERE id = ?",
        )
        .bind(productionId)
        .first<{ episodeNumber: number }>(),
    ).toEqual({ episodeNumber: 3 });
    expect(await nextEpisodeNumberInCategory(db, 'manager-notes')).toBe(4);
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
