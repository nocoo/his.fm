import { readdirSync, readFileSync } from 'node:fs';
import { Miniflare } from 'miniflare';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertCategoryIdAvailable } from '../../worker/categories';
import {
  assertEpisodeNumberAvailable,
  deleteHolderEpisodeNumberClaims,
  insertEpisodeNumberClaim,
  nextEpisodeNumberInCategory,
  reserveEpisodeNumberClaim,
  resolveEpisodeNumberForCreate,
  resolveEpisodePatchEpisodeNumber,
  resolveProductionPatchEpisodeNumber,
  setHolderEpisodeNumberClaim,
} from '../../worker/episode-numbering';
import { HttpError } from '../../worker/http';

let mf: Miniflare;
let db: D1Database;

beforeAll(async () => {
  mf = new Miniflare({
    workers: [
      {
        config: {
          name: 'episode-numbering-test',
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' },
            },
          },
          env: {
            DB: { type: 'd1', name: 'episode-numbering' },
            ENVIRONMENT: { type: 'json', value: 'local' },
          },
        },
      },
    ],
  });
  const env = await mf.getBindings<Env>();
  db = env.DB;
  for (const name of readdirSync(new URL('../../migrations/', import.meta.url)).sort()) {
    if (!name.endsWith('.sql')) continue;
    await db.batch(
      readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8')
        .split(';')
        .filter((sql) => sql.trim())
        .map((sql) => db.prepare(sql)),
    );
  }
});

beforeEach(async () => {
  await db.batch(
    ['episode_number_claims', 'episodes', 'productions'].map((table) => db.prepare(`DELETE FROM ${table}`)),
  );
});

afterAll(() => mf.dispose());

describe('episode_number_claims', () => {
  it('allocates the next free number across holder kinds', async () => {
    await insertEpisodeNumberClaim(db, 'life', 1, 'production-1', 'production').run();
    expect(await nextEpisodeNumberInCategory(db, 'life')).toBe(2);
    const episodeNumber = await reserveEpisodeNumberClaim(db, 'life', 'episode-1', 'episode');
    expect(episodeNumber).toBe(2);
  });

  it('rejects explicit numbers that are already claimed', async () => {
    await insertEpisodeNumberClaim(db, 'life', 3, 'holder-a', 'episode').run();
    await expect(assertEpisodeNumberAvailable(db, 'life', 3)).rejects.toMatchObject({ status: 409 });
    await expect(reserveEpisodeNumberClaim(db, 'life', 'holder-b', 'production', 3)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('resolves patch numbers when categories change', async () => {
    await insertEpisodeNumberClaim(db, 'life', 4, 'production-2', 'production').run();
    const next = await resolveProductionPatchEpisodeNumber(
      db,
      { id: 'production-2', category: 'life', episodeNumber: 4 },
      { category: 'learning' },
    );
    expect(next).toBe(1);
    const episodeNext = await resolveEpisodePatchEpisodeNumber(
      db,
      { id: 'episode-2', category: 'life', episodeNumber: 2 },
      { episodeNumber: 5 },
    );
    expect(episodeNext).toBe(5);
  });

  it('updates and deletes claims', async () => {
    await insertEpisodeNumberClaim(db, 'life', 1, 'holder', 'episode').run();
    await setHolderEpisodeNumberClaim(db, 'episode', 'holder', 'learning', 2);
    await expect(assertEpisodeNumberAvailable(db, 'learning', 2)).rejects.toMatchObject({ status: 409 });
    await deleteHolderEpisodeNumberClaims(db, 'episode', 'holder').run();
    expect(await nextEpisodeNumberInCategory(db, 'learning')).toBe(1);
  });

  it('allows the same id to claim numbers in different categories for episode and production', async () => {
    await setHolderEpisodeNumberClaim(db, 'episode', 'shared-id', 'life', 1);
    await setHolderEpisodeNumberClaim(db, 'production', 'shared-id', 'learning', 1);
    expect(
      await db
        .prepare('SELECT COUNT(*) AS n FROM episode_number_claims WHERE holder_id = ?')
        .bind('shared-id')
        .first<{ n: number }>(),
    ).toEqual({ n: 2 });
  });

  it('rejects invalid episode numbers', async () => {
    await expect(assertEpisodeNumberAvailable(db, 'life', 0)).rejects.toBeInstanceOf(HttpError);
  });

  it('skips excluded holders and resolves create helpers', async () => {
    await insertEpisodeNumberClaim(db, 'life', 6, 'production-6', 'production').run();
    expect(await nextEpisodeNumberInCategory(db, 'life', { productionId: 'production-6' })).toBe(7);
    expect(await resolveEpisodeNumberForCreate(db, 'life', 7)).toBe(7);
    expect(
      await resolveEpisodePatchEpisodeNumber(db, { id: 'episode-6', category: 'life', episodeNumber: 6 }, {}),
    ).toBe(6);
    await expect(
      assertEpisodeNumberAvailable(db, 'life', 6, { productionId: 'production-6' }),
    ).resolves.toBeUndefined();
  });

  it('treats the current holder as available when excluded', async () => {
    await insertEpisodeNumberClaim(db, 'life', 8, 'episode-8', 'episode').run();
    await expect(
      assertEpisodeNumberAvailable(db, 'life', 8, { episodeId: 'episode-8' }),
    ).resolves.toBeUndefined();
    expect(await resolveEpisodeNumberForCreate(db, 'life')).toBe(9);
  });

  it('retries auto reservations after claim races', async () => {
    await insertEpisodeNumberClaim(db, 'life', 1, 'other', 'episode').run();
    const episodeNumber = await reserveEpisodeNumberClaim(db, 'life', 'winner', 'production');
    expect(episodeNumber).toBe(2);
  });

  it('increments until it finds a free number in the category', async () => {
    await insertEpisodeNumberClaim(db, 'life', 1, 'first', 'episode').run();
    await insertEpisodeNumberClaim(db, 'life', 2, 'second', 'episode').run();
    expect(await nextEpisodeNumberInCategory(db, 'life')).toBe(3);
  });

  it('keeps the current production number when patches omit numbering fields', async () => {
    await insertEpisodeNumberClaim(db, 'life', 9, 'production-9', 'production').run();
    expect(
      await resolveProductionPatchEpisodeNumber(
        db,
        { id: 'production-9', category: 'life', episodeNumber: 9 },
        {},
      ),
    ).toBe(9);
    expect(await resolveEpisodeNumberForCreate(db, 'life')).toBe(10);
  });

  it('reserves explicit numbers when they are still available', async () => {
    expect(await reserveEpisodeNumberClaim(db, 'life', 'explicit', 'production', 15)).toBe(15);
  });

  it('surfaces duplicate production reservations for the same holder', async () => {
    await reserveEpisodeNumberClaim(db, 'life', 'dup-holder', 'production', 5);
    await expect(reserveEpisodeNumberClaim(db, 'life', 'dup-holder', 'production', 6)).rejects.toThrow();
  });

  it('walks past occupied numbers during auto reservation', async () => {
    for (const [holder, number] of [
      ['a', 10],
      ['b', 11],
      ['c', 12],
    ] as const) {
      await insertEpisodeNumberClaim(db, 'life', number, holder, 'episode').run();
    }
    expect(await reserveEpisodeNumberClaim(db, 'life', 'winner', 'production')).toBe(13);
    expect(await resolveEpisodeNumberForCreate(db, 'life', 14)).toBe(14);
  });
});

describe('assertCategoryIdAvailable', () => {
  it('rejects ids reserved by legacy aliases for new identifiers', async () => {
    await db
      .prepare('INSERT INTO category_id_aliases (alias, category_id) VALUES (?, ?)')
      .bind('legacy-slot', 'life')
      .run();
    await expect(assertCategoryIdAvailable(db, 'legacy-slot')).rejects.toMatchObject({ status: 409 });
    await expect(assertCategoryIdAvailable(db, 'life', 'life')).resolves.toBeUndefined();
  });
});
