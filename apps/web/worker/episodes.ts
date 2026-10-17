import { hasScope } from '@his-fm/contracts';
import {
  type Episode,
  type EpisodeInput,
  episodeDisplaySchema,
  episodeCreateSchema,
  episodeInputSchema,
  episodeUpdateSchema,
} from '../src/shared/episode';
import type { Actor } from '../src/shared/production';
import { requireScope } from './authorization';
import { getCategory } from './categories';
import { resolveEpisodeNumberForCreate, resolveEpisodePatchEpisodeNumber } from './episode-numbering';
import { HttpError, json } from './http';
import { readJson } from './production-body';

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
    durationSeconds: row.duration_seconds,
    audioUrl: row.audio_url,
    status: row.status,
    featured: Boolean(row.featured),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listEpisodes(db: D1Database, publishedOnly: boolean, actor?: Actor) {
  if (!publishedOnly) {
    if (!actor) throw new HttpError(403, 'Missing scope: episodes:read');
    requireScope(actor, 'episodes:read');
  }
  const query = publishedOnly
    ? "SELECT * FROM episodes WHERE status = 'published' AND published_at <= ? ORDER BY published_at DESC, episode_number DESC"
    : 'SELECT * FROM episodes ORDER BY updated_at DESC, episode_number DESC';
  const statement = db.prepare(query);
  const result = await (publishedOnly
    ? statement.bind(new Date().toISOString())
    : statement
  ).all<EpisodeRow>();
  return result.results.map(fromRow);
}

export async function getEpisode(db: D1Database, key: string, publishedOnly: boolean, actor?: Actor) {
  if (!publishedOnly) {
    if (!actor) throw new HttpError(403, 'Missing scope: episodes:read');
    requireScope(actor, 'episodes:read');
  }
  const statement = publishedOnly
    ? db
        .prepare("SELECT * FROM episodes WHERE slug = ? AND status = 'published' AND published_at <= ?")
        .bind(key, new Date().toISOString())
    : db.prepare('SELECT * FROM episodes WHERE id = ?').bind(key);
  const row = await statement.first<EpisodeRow>();
  if (!row) throw new HttpError(404, '这期节目不存在');
  return fromRow(row);
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
    const raw = new URL(request.url).searchParams.get('version');
    const version = Number(raw);
    if (!raw || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(version))
      throw new HttpError(400, '请提供节目版本');
    const deleted = await db
      .prepare(
        'DELETE FROM episodes WHERE id = ? AND version = ? AND source_production_id IS NULL RETURNING id',
      )
      .bind(id, version)
      .first();
    if (!deleted) throw new HttpError(409, '节目已被修改，请刷新后重试');
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
  const episodeNumber = id && current
    ? await resolveEpisodePatchEpisodeNumber(
        db,
        {
          id: current.id,
          category: current.category,
          episodeNumber: current.episode_number,
        },
        { category: input.category, episodeNumber: input.episodeNumber },
      )
    : await resolveEpisodeNumberForCreate(db, input.category, input.episodeNumber);
  const payload = { ...input, episodeNumber };
  const now = new Date().toISOString();
  try {
    const statement = id
      ? db
          .prepare(
            'UPDATE episodes SET slug = ?, episode_number = ?, title = ?, summary = ?, transcript = ?, show_notes = ?, cover_url = ?, category = ?, tags = ?, duration_seconds = ?, audio_url = ?, status = ?, featured = ?, published_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ? AND source_production_id IS NULL RETURNING *',
          )
          .bind(...inputValues(payload), now, id, 'version' in input ? input.version : null)
      : db
          .prepare(
            'INSERT INTO episodes (slug, episode_number, title, summary, transcript, show_notes, cover_url, category, tags, duration_seconds, audio_url, status, featured, published_at, created_at, updated_at, id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
          )
          .bind(...inputValues(payload), now, now, crypto.randomUUID());
    const row = await statement.first<EpisodeRow>();
    if (!row) throw new HttpError(409, '节目已被修改，请刷新后重试');
    return respond(row, id ? 200 : 201);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: episodes\.slug/.test(error.message)) {
      throw new HttpError(409, '这个链接名称已被另一集使用');
    }
    if (error instanceof Error && /UNIQUE constraint failed: episodes\.category/.test(error.message)) {
      throw new HttpError(409, '该栏目下已有相同期数');
    }
    throw error;
  }
}
