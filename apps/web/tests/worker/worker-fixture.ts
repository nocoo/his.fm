import { readdirSync, readFileSync } from 'node:fs';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Miniflare, Response as MiniflareResponse } from 'miniflare';
import { vi } from 'vitest';
import type { Episode, EpisodeInput } from '../../src/shared/episode';
import worker from '../../worker';

export const origin = 'https://hisfm.dev.hexly.ai';
export const issuer = 'https://nocoo.cloudflareaccess.com';
export const audience = '41ef6d396f8256e97999ba1d1f11e15f6e7e5e788fce46f54016fd1d9710f726';
export const defaultEpisodeInput: EpisodeInput = {
  slug: 'leave-a-note',
  episodeNumber: 7,
  title: '给明天留一张纸条',
  summary: '记录今天停下来的位置。',
  transcript: '今天先到这里，明天从下一步开始。',
  lead: '',
  researchNote: '',
  credits: '',
  body: '',
  topics: [],
  coverUrl: '/images/episode-01.webp',
  category: 'manager-notes',
  tags: ['工作节奏'],
  durationSeconds: 600,
  audioUrl: null,
  status: 'published',
  featured: false,
  publishedAt: '2026-09-01T08:00:00.000Z',
  mentions: [
    {
      name: 'his.fm',
      description: '这档播客的主站。',
      url: 'https://his.fm/',
    },
  ],
  seo: {},
};

export async function createWorkerEnv(workerName: string, dbName: string) {
  const miniflare = new Miniflare({
    workers: [
      {
        config: {
          name: workerName,
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
            DB: { type: 'd1', name: dbName },
            MEDIA: { type: 'r2', name: dbName },
            ENVIRONMENT: { type: 'json', value: 'local' },
            ASSETS: {
              type: 'fetcher',
              handler: () =>
                new MiniflareResponse(
                  '<html><head><link rel="stylesheet" href="/assets/index-test.css" crossorigin></head><body><div id="root"></div></body></html>',
                  {
                    headers: { 'Content-Type': 'text/html' },
                  },
                ),
            },
          },
        },
      },
    ],
  });
  const env = await miniflare.getBindings<Env>();
  const directory = new URL('../../migrations/', import.meta.url);
  for (const name of readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    await env.DB.batch(
      readFileSync(new URL(name, directory), 'utf8')
        .split(';')
        .filter((statement) => statement.trim())
        .map((statement) => env.DB.prepare(statement)),
    );
  }
  const keyPair = await generateKeyPair('RS256', { extractable: true });
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
  return { miniflare, env, privateKey: keyPair.privateKey };
}

export async function resetWorkerEnv(env: Env) {
  await env.DB.batch(
    ['episodes', 'local_sessions', 'productions', 'episode_number_claims', 'agent_tokens'].map((table) =>
      env.DB.prepare(`DELETE FROM ${table}`),
    ),
  );
  const response = await worker.fetch(
    new Request(`${origin}/admin/api/dev-login`, { method: 'POST', headers: { Origin: origin } }),
    env,
  );
  if (response.status !== 200) throw new Error(`Unexpected dev-login status ${response.status}`);
  return response.headers.get('Set-Cookie')?.split(';')[0] ?? '';
}

export function buildWorkerRequest(path: string, cookie: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  if (cookie && !headers.has('Cookie')) headers.set('Cookie', cookie);
  if (options.method && options.method !== 'GET') headers.set('Origin', origin);
  return new Request(`${origin}${path}`, { ...options, headers });
}

export function jsonBody(data: unknown) {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
}

export async function createWorkerEpisode(
  env: Env,
  cookie: string,
  changes: Partial<EpisodeInput> = {},
): Promise<Episode> {
  const response = await worker.fetch(
    buildWorkerRequest('/admin/api/episodes', cookie, {
      method: 'POST',
      ...jsonBody({ ...defaultEpisodeInput, ...changes }),
    }),
    env,
  );
  if (response.status !== 201) throw new Error(`Unexpected create status ${response.status}`);
  return ((await response.json()) as { episode: Episode }).episode;
}

export async function signAccessToken(privateKey: CryptoKey, claims: Record<string, unknown> = {}) {
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
