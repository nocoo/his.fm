import { readFileSync } from 'node:fs';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import sharp from 'sharp';
import { routeEpisodeArt } from '../../worker/episode-art';
import { putR2Fixture, r2FixtureWorker } from './r2-fixtures';

export const origin = 'https://his.fm';
export const coverKey = 'productions/one/cover.webp';

export type AssetOverride = { body: string; status?: number; headers?: Record<string, string> };

export function artRequest(kind = 'art', query = '', method = 'GET', id = 'one') {
  return new Request(`${origin}/episodes/${id}/${kind}.jpg${query}`, { method });
}

export async function callRouteEpisodeArt(
  env: Env,
  kind: 'art' | 'share' = 'art',
  query = '',
  method = 'GET',
  bindings = env,
) {
  const response = await routeEpisodeArt(artRequest(kind, query, method), bindings, 'one', kind);
  return response.status === 302
    ? routeEpisodeArt(
        new Request(new URL(response.headers.get('Location') ?? '', origin), { method }),
        bindings,
        'one',
        kind,
      )
    : response;
}

export async function createTinyWebp() {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: '#336655' } })
    .webp()
    .toBuffer();
}

export function makeMockJpeg(size = 1024) {
  const bytes = new Uint8Array(Math.max(4, size));
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[bytes.length - 2] = 0xff;
  bytes[bytes.length - 1] = 0xd9;
  return bytes;
}

export async function createEpisodeArtEnv(workerName: string) {
  const assetOverrides = new Map<string, AssetOverride>();
  const assetReads: string[] = [];
  const mf = new Miniflare({
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: workerName,
          compatibilityDate: '2026-09-24',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': { type: 'esm', contents: r2FixtureWorker },
            },
          },
          env: {
            DB: { type: 'd1', name: workerName },
            MEDIA: { type: 'r2', name: workerName },
            IMAGES: { type: 'images', dev: { remote: false } },
            ENVIRONMENT: { type: 'json', value: 'production' },
            MEDIA_BASE_URL: { type: 'json', value: 'https://f.no.mt' },
            ASSETS: {
              type: 'fetcher',
              handler: (input) => {
                const path = new URL(input.url).pathname;
                assetReads.push(path);
                const override = assetOverrides.get(path);
                if (override) return new MiniflareResponse(override.body, override);
                try {
                  return new MiniflareResponse(readFileSync(new URL(`../../public${path}`, import.meta.url)));
                } catch {
                  return new MiniflareResponse('Not found', { status: 404 });
                }
              },
            },
          },
        },
      },
    ],
  });
  const env = await mf.getBindings<Env>();
  await env.DB.batch([
    env.DB.prepare(
      'CREATE TABLE episodes (id TEXT PRIMARY KEY, title TEXT, episode_number INTEGER, cover_url TEXT, category TEXT, status TEXT, published_at TEXT)',
    ),
    env.DB.prepare('CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT)'),
    env.DB.prepare("INSERT INTO categories VALUES ('life', '生活')"),
    env.DB.prepare(
      'CREATE TABLE site_appearance (id INTEGER PRIMARY KEY, theme TEXT, version INTEGER, updated_at TEXT, updated_by TEXT)',
    ),
    env.DB.prepare("INSERT INTO site_appearance VALUES (1, 'stillwood', 1, '', '')"),
  ]);
  return { mf, env, assetOverrides, assetReads };
}

export async function resetEpisodeArtEnv(
  mf: Miniflare,
  env: Env,
  assetOverrides: Map<string, AssetOverride>,
  assetReads: string[],
  source?: Uint8Array,
) {
  const cached = await env.MEDIA.list({ prefix: 'rendered/' });
  if (cached.objects.length) await env.MEDIA.delete(cached.objects.map((object) => object.key));
  assetOverrides.clear();
  assetReads.length = 0;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM episodes'),
    env.DB.prepare('INSERT INTO episodes VALUES (?, ?, ?, ?, ?, ?, ?)').bind(
      'one',
      '下班后，慢慢来',
      1,
      `https://f.no.mt/${coverKey}`,
      'life',
      'published',
      '2020-01-01T00:00:00.000Z',
    ),
    env.DB.prepare("UPDATE site_appearance SET theme = 'stillwood'"),
    env.DB.prepare("UPDATE categories SET name = '生活'"),
  ]);
  if (source) await putR2Fixture(mf, coverKey, source);
}
