import { readdirSync, readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, expect, it } from 'vitest';

const MIGRATION_0027 = '0027_drop_legacy_prompts.sql';
const channelSlots = JSON.stringify([
  {
    id: 'editor',
    title: '编辑',
    body: 'CHANNEL_SLOT_BODY',
    order: 0,
    enabled: true,
    mode: 'override',
    version: 1,
    updatedAt: '2026-10-31T00:00:00.000Z',
    updatedBy: 'migration-test',
  },
]);
const categorySlots = JSON.stringify([
  {
    id: 'editor',
    title: '编辑',
    body: 'CATEGORY_SLOT_BODY',
    order: 0,
    enabled: true,
    mode: 'override',
    version: 1,
    updatedAt: '2026-10-31T00:00:00.000Z',
    updatedBy: 'migration-test',
  },
]);

function applySql(db: D1Database, sql: string) {
  return db.batch(
    sql
      .split(';')
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => db.prepare(statement)),
  );
}

let mf: Miniflare;
let db: D1Database;

beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'migration-0027-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': {
                type: 'esm',
                contents: 'export default { fetch() { return new Response("ok"); } }',
              },
            },
          },
          env: { DB: { type: 'd1', name: 'migration-0027-test' } },
        },
      },
    ],
  });
  db = (await mf.getBindings<Env>()).DB;
  for (const name of readdirSync('migrations')
    .filter((entry) => entry.endsWith('.sql') && entry !== MIGRATION_0027)
    .sort()) {
    await applySql(db, readFileSync(`migrations/${name}`, 'utf8'));
  }

  await db
    .prepare(
      `INSERT INTO channel_profile (
        id, version, content, updated_at, updated_by, prompts, prompt_slots, prompt_slots_version
      ) VALUES (1, 3, 'legacy content', '2026-10-31T00:00:00.000Z', 'owner', '{"brief":"legacy"}', ?, 2)`,
    )
    .bind(channelSlots)
    .run();
  await db
    .prepare(
      `UPDATE categories
       SET prompt_slots = ?, prompt_slots_version = 2
       WHERE id = 'life'`,
    )
    .bind(categorySlots)
    .run();
  await db
    .prepare(
      `INSERT INTO prompt_slot_backups (id, level, resource_id, legacy_version, data, created_at, created_by)
       VALUES ('backup-life', 'category', 'life', 1, '{"slots":[]}', '2026-10-31T00:00:00.000Z', 'owner')`,
    )
    .run();
  await db
    .prepare(`INSERT INTO category_id_aliases (alias, category_id) VALUES ('legacy-life', 'life')`)
    .run();
  await db
    .prepare(
      `INSERT INTO episodes (
        id, slug, episode_number, title, summary, transcript, lead, research_note, credits, body,
        cover_url, category, tags, duration_seconds, status, featured, created_at, updated_at, version, write_id, seo
      ) VALUES (
        'migration-ep', 'migration-ep', 1, '测试', '摘要', '逐字稿', '', '', '', '',
        '/images/episode-01.webp', 'life', '[]', 0, 'draft', 0,
        '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z', 1, 'write-1', '{}'
      )`,
    )
    .run();
});

afterAll(() => mf.dispose());

it('drops legacy prompt columns without breaking foreign keys or slot data', async () => {
  const categoriesBefore =
    (await db.prepare('SELECT COUNT(*) AS count FROM categories').first<{ count: number }>())?.count ?? 0;
  const episodesBefore =
    (await db.prepare('SELECT COUNT(*) AS count FROM episodes').first<{ count: number }>())?.count ?? 0;

  await applySql(db, readFileSync(`migrations/${MIGRATION_0027}`, 'utf8'));

  expect(await db.prepare('SELECT COUNT(*) AS count FROM categories').first<{ count: number }>()).toEqual({
    count: categoriesBefore,
  });
  expect(await db.prepare('SELECT COUNT(*) AS count FROM episodes').first<{ count: number }>()).toEqual({
    count: episodesBefore,
  });
  expect(
    await db.prepare(`SELECT category FROM episodes WHERE id = 'migration-ep'`).first<{ category: string }>(),
  ).toEqual({ category: 'life' });
  expect(
    await db
      .prepare(`SELECT category_id FROM category_id_aliases WHERE alias = 'legacy-life'`)
      .first<{ category_id: string }>(),
  ).toEqual({ category_id: 'life' });

  const channel = await db
    .prepare('SELECT prompt_slots, prompt_slots_version FROM channel_profile WHERE id = 1')
    .first<{ prompt_slots: string; prompt_slots_version: number }>();
  expect(channel).toEqual({ prompt_slots: channelSlots, prompt_slots_version: 2 });

  const life = await db
    .prepare(`SELECT prompt_slots, prompt_slots_version, rss_identity, seo FROM categories WHERE id = 'life'`)
    .first<{
      prompt_slots: string;
      prompt_slots_version: number;
      rss_identity: string;
      seo: string;
    }>();
  expect(life?.prompt_slots).toBe(categorySlots);
  expect(life?.prompt_slots_version).toBe(2);
  expect(life?.rss_identity).toBe('life');

  const categoryColumns = (
    await db.prepare(`PRAGMA table_info(categories)`).all<{ name: string }>()
  ).results.map((row) => row.name);
  expect(categoryColumns).not.toContain('prompt');
  expect(categoryColumns).toEqual(
    expect.arrayContaining([
      'id',
      'name',
      'icon',
      'color',
      'seo',
      'version',
      'updated_at',
      'updated_by',
      'prompt_slots',
      'prompt_slots_version',
      'rss_identity',
    ]),
  );

  const channelColumns = (
    await db.prepare(`PRAGMA table_info(channel_profile)`).all<{ name: string }>()
  ).results.map((row) => row.name);
  expect(channelColumns).not.toContain('content');
  expect(channelColumns).not.toContain('prompts');
  expect(channelColumns).toEqual(
    expect.arrayContaining([
      'id',
      'version',
      'updated_at',
      'updated_by',
      'prompt_slots',
      'prompt_slots_version',
    ]),
  );

  expect(
    await db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='prompt_slot_backups'`)
      .first(),
  ).toBeNull();

  expect((await db.prepare('PRAGMA foreign_key_check').all()).results).toEqual([]);
});
