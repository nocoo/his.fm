import { hasScope } from '@his-fm/contracts';
import type { z } from 'zod';
import {
  type Episode,
  type EpisodeInput,
  episodeCreateSchema,
  episodeDisplaySchema,
  episodeUpdateSchema,
  type PublicEpisode,
  type PublicEpisodeSummary,
  projectPublicEpisode,
  projectPublicEpisodeSummary,
} from '../src/shared/episode';

type EpisodeUpdate = z.infer<typeof episodeUpdateSchema>;

import { withShareArtwork } from '../src/shared/episode-art';
import type { Actor } from '../src/shared/production';
import { parseSeoOverride } from '../src/shared/seo';
import { requireScope } from './authorization';
import { getCategory } from './categories';
import {
  batchInsertWithEpisodeNumberClaim,
  deleteHolderEpisodeNumberClaims,
  episodeClaimReplaceStatements,
  resolveEpisodePatchEpisodeNumber,
} from './episode-numbering';
import { findPublishedEpisodeBySlug, resolveCategoryAlias } from './episode-public';
import { HttpError, json } from './http';
import { readJson } from './production-body';
import { getSiteSeo } from './seo-store';

async function categoryNames(db: D1Database) {
  const categories = await db.prepare('SELECT id, name FROM categories').all<{ id: string; name: string }>();
  return new Map(categories.results.map((row) => [row.id, row.name]));
}

async function projectPublishedEpisode(db: D1Database, episode: Episode, origin: string) {
  const [site, names] = await Promise.all([getSiteSeo(db), categoryNames(db)]);
  return withShareArtwork(
    projectPublicEpisode(episode, origin, {
      site,
      categoryName: names.get(episode.category) ?? episode.category,
    }),
    origin,
  );
}

type EpisodeRow = Omit<
  Episode,
  | 'episodeNumber'
  | 'showNotes'
  | 'coverUrl'
  | 'durationSeconds'
  | 'audioUrl'
  | 'publishedAt'
  | 'createdAt'
  | 'updatedAt'
  | 'tags'
  | 'mentions'
  | 'seo'
  | 'featured'
> & {
  source_production_id: string | null;
  episode_number: number;
  show_notes: string;
  cover_url: string;
  duration_seconds: number;
  audio_url: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  tags: string;
  mentions: string;
  seo: string;
  featured: number;
};

function fromRow(row: EpisodeRow): Episode {
  return {
    id: row.id,
    version: row.version,
    sourceProductionId: row.source_production_id,
    slug: row.slug,
    episodeNumber: row.episode_number,
    title: row.title,
    summary: row.summary,
    transcript: row.transcript,
    showNotes: row.show_notes,
    coverUrl: row.cover_url,
    category: row.category,
    tags: JSON.parse(row.tags),
    mentions: JSON.parse(row.mentions),
    seo: parseSeoOverride(row.seo),
    durationSeconds: row.duration_seconds,
    audioUrl: row.audio_url,
    status: row.status,
    featured: Boolean(row.featured),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function readPublishedEpisodes(db: D1Database): Promise<Episode[]> {
  const result = await db
    .prepare(
      "SELECT * FROM episodes WHERE status = 'published' AND published_at <= ? ORDER BY published_at DESC, episode_number DESC",
    )
    .bind(new Date().toISOString())
    .all<EpisodeRow>();
  return result.results.map(fromRow);
}

type EpisodeLookup = { category?: string; slug?: string; id?: string };

async function fetchPublishedRow(db: D1Database, lookup: EpisodeLookup) {
  const now = new Date().toISOString();
  if (lookup.category && lookup.slug) {
    const category = await resolveCategoryAlias(db, lookup.category);
    return db
      .prepare(
        "SELECT * FROM episodes WHERE category = ? AND slug = ? AND status = 'published' AND published_at <= ?",
      )
      .bind(category, lookup.slug, now)
      .first<EpisodeRow>();
  }
  if (lookup.slug) {
    const hit = await findPublishedEpisodeBySlug(db, lookup.slug);
    if (!hit) return null;
    return db
      .prepare(
        "SELECT * FROM episodes WHERE category = ? AND slug = ? AND status = 'published' AND published_at <= ?",
      )
      .bind(hit.category, hit.slug, now)
      .first<EpisodeRow>();
  }
  return null;
}

export async function listPublishedEpisodeSummaries(db: D1Database): Promise<PublicEpisodeSummary[]> {
  return (await readPublishedEpisodes(db)).map(projectPublicEpisodeSummary);
}

export async function listAllEpisodes(db: D1Database, actor?: Actor): Promise<Episode[]> {
  if (!actor) throw new HttpError(403, 'Missing scope: episodes:read');
  requireScope(actor, 'episodes:read');
  const result = await db
    .prepare('SELECT * FROM episodes ORDER BY updated_at DESC, episode_number DESC')
    .all<EpisodeRow>();
  return result.results.map(fromRow);
}

export async function getEpisode(
  db: D1Database,
  key: string,
  publishedOnly: boolean,
  actor?: Actor,
  options: { category?: string; origin?: string } = {},
): Promise<Episode | PublicEpisode> {
  const origin = options.origin ?? 'https://his.fm';
  if (!publishedOnly) {
    if (!actor) throw new HttpError(403, 'Missing scope: episodes:read');
    requireScope(actor, 'episodes:read');
    const row = await db.prepare('SELECT * FROM episodes WHERE id = ?').bind(key).first<EpisodeRow>();
    if (!row) throw new HttpError(404, '这期节目不存在');
    return fromRow(row);
  }
  const row = await fetchPublishedRow(db, { category: options.category, slug: key });
  if (!row) throw new HttpError(404, '这期节目不存在');
  return projectPublishedEpisode(db, fromRow(row), origin);
}

export async function listPublishedEpisodesInCategory(db: D1Database, categoryId: string) {
  const category = await resolveCategoryAlias(db, categoryId);
  const result = await db
    .prepare(
      "SELECT * FROM episodes WHERE category = ? AND status = 'published' AND published_at <= ? ORDER BY published_at DESC, episode_number DESC",
    )
    .bind(category, new Date().toISOString())
    .all<EpisodeRow>();
  return result.results.map(fromRow);
}

async function readInput(request: Request, update: boolean) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, '请提交 JSON 格式的节目内容');
  }
  const maxBytes = 512000;
  if (Number(request.headers.get('Content-Length')) > maxBytes) throw new HttpError(413, '节目内容过长');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '节目内容不能为空');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, '节目内容过长');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, '节目内容不是有效的 JSON');
  }
  const parsed = (update ? episodeUpdateSchema : episodeCreateSchema).safeParse(data);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? '请检查节目内容');
  return parsed.data;
}

function inputValues(input: EpisodeInput) {
  return [
    input.slug,
    input.episodeNumber,
    input.title,
    input.summary,
    input.transcript,
    input.showNotes,
    input.coverUrl,
    input.category,
    JSON.stringify(input.tags),
    JSON.stringify(input.mentions),
    JSON.stringify(input.seo ?? {}),
    input.durationSeconds,
    input.audioUrl,
    input.status,
    Number(input.featured),
    input.publishedAt,
  ];
}

export async function mutateEpisode(request: Request, db: D1Database, actor: Actor, id?: string) {
  const respond = (row: EpisodeRow, status = 200) =>
    json(
      { episode: hasScope(actor, 'episodes:read') ? fromRow(row) : { id: row.id, version: row.version } },
      status,
    );
  if (
    !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) ||
    (request.method !== 'POST' && !id) ||
    (request.method === 'POST' && id)
  )
    throw new HttpError(405, '不支持这个请求方式');
  requireScope(actor, request.method === 'DELETE' ? 'episodes:delete' : 'episodes:write');
  const current = id
    ? await db.prepare('SELECT * FROM episodes WHERE id = ?').bind(id).first<EpisodeRow>()
    : null;
  if (id && !current) throw new HttpError(404, '这期节目不存在');
  if (request.method === 'PATCH') {
    const input = await readJson(request, episodeDisplaySchema);
    const row = await db
      .prepare(
        'UPDATE episodes SET featured = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? RETURNING *',
      )
      .bind(Number(input.featured), new Date().toISOString(), id, input.version)
      .first<EpisodeRow>();
    if (!row) throw new HttpError(409, '节目已被修改，请刷新后重试');
    return respond(row);
  }
  if (current?.source_production_id)
    throw new HttpError(409, '这期节目由制作流程管理，请进入制作任务修改和重新审核');
  if (request.method === 'DELETE') {
    if (!id) throw new HttpError(404, '这期节目不存在');
    const raw = new URL(request.url).searchParams.get('version');
    const version = Number(raw);
    if (!raw || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(version))
      throw new HttpError(400, '请提供节目版本');
    const deleted = await db
      .prepare(
        'DELETE FROM episodes WHERE id = ? AND version = ? AND source_production_id IS NULL RETURNING id',
      )
      .bind(id, version)
      .first<{ id: string }>();
    if (!deleted) throw new HttpError(409, '节目已被修改，请刷新后重试');
    await deleteHolderEpisodeNumberClaims(db, 'episode', id).run();
    return new Response(null, { status: 204 });
  }
  const input = await readInput(request, Boolean(id));
  if (
    input.status === 'published' ||
    current?.status === 'published' ||
    input.publishedAt !== (current?.published_at ?? null)
  )
    requireScope(actor, 'episodes:publish');
  await getCategory(db, input.category);
  const now = new Date().toISOString();
  if (id && current) {
    const episodeNumber = await resolveEpisodePatchEpisodeNumber(
      db,
      {
        id: current.id,
        category: current.category,
        episodeNumber: current.episode_number,
      },
      { category: input.category, episodeNumber: input.episodeNumber },
    );
    const payload = { ...input, episodeNumber };
    const claimChanged = current.category !== input.category || current.episode_number !== episodeNumber;
    const { version: expectedVersion } = input as EpisodeUpdate;
    const newVersion = expectedVersion + 1;
    const writeId = crypto.randomUUID();
    const statements = [
      db
        .prepare(
          'UPDATE episodes SET slug = ?, episode_number = ?, title = ?, summary = ?, transcript = ?, show_notes = ?, cover_url = ?, category = ?, tags = ?, mentions = ?, seo = ?, duration_seconds = ?, audio_url = ?, status = ?, featured = ?, published_at = ?, updated_at = ?, write_id = ?, version = version + 1 WHERE id = ? AND version = ? AND source_production_id IS NULL',
        )
        .bind(...inputValues(payload), now, writeId, id, expectedVersion),
    ];
    if (claimChanged) {
      statements.push(
        ...episodeClaimReplaceStatements(db, id, newVersion, writeId, input.category, episodeNumber),
      );
    }
    try {
      const results = await db.batch(statements);
      if (results[0].meta.changes !== 1) throw new HttpError(409, '节目已被修改，请刷新后重试');
      const row = await db.prepare('SELECT * FROM episodes WHERE id = ?').bind(id).first<EpisodeRow>();
      if (!row) throw new HttpError(409, '节目已被修改，请刷新后重试');
      return respond(row);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const message = error instanceof Error ? error.message : '';
      if (/UNIQUE constraint failed/.test(message)) {
        throw new HttpError(409, '该栏目下已有相同期数或链接名称');
      }
      /* v8 ignore next */
      throw error;
    }
  }

  const newId = crypto.randomUUID();
  const writeId = crypto.randomUUID();
  const row = await batchInsertWithEpisodeNumberClaim<EpisodeRow>(
    db,
    input.category,
    newId,
    (episodeNumber) =>
      db
        .prepare(
          'INSERT INTO episodes (slug, episode_number, title, summary, transcript, show_notes, cover_url, category, tags, mentions, seo, duration_seconds, audio_url, status, featured, published_at, created_at, updated_at, write_id, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
        )
        .bind(...inputValues({ ...input, episodeNumber }), now, now, writeId, newId),
    input.episodeNumber,
  );
  return respond(row, 201);
}
