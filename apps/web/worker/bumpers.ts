import { hasScope } from '@his-fm/contracts';
import { z } from 'zod';
import type { Actor } from '../src/shared/production';
import { parseWav } from './audio';
import { requireScope } from './authorization';
import { HttpError, json } from './http';
import { readBytes, readJson } from './production-body';
import { mediaUrl } from './production-store';

export const bumperInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  position: z.enum(['intro', 'outro']),
});
export const bumperUpdateSchema = bumperInputSchema.extend({ version: z.number().int().positive() });
type BumperRow = { id: string; name: string; position: string; version: number; data: string };
const fromRow = ({ data, ...row }: BumperRow) => ({ ...JSON.parse(data), ...row });

export async function routeBumpers(request: Request, env: Env, actor: Actor, id?: string) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    requireScope(actor, 'bumpers:read');
    if (id) {
      const row = await env.DB.prepare('SELECT id, name, position, version, data FROM bumpers WHERE id = ?')
        .bind(id)
        .first<BumperRow>();
      if (!row) throw new HttpError(404, '贴片不存在');
      return json({ bumper: fromRow(row) });
    }
    const rows = await env.DB.prepare(
      'SELECT id, name, position, version, data FROM bumpers ORDER BY name, id',
    ).all<{ id: string; name: string; position: string; version: number; data: string }>();
    return json({ bumpers: rows.results.map(fromRow) });
  }
  if (id && request.method === 'PUT') {
    requireScope(actor, 'bumpers:write');
    const input = await readJson(request, bumperUpdateSchema);
    const row = await env.DB.prepare(
      'UPDATE bumpers SET name = ?, position = ?, version = version + 1 WHERE id = ? AND version = ? RETURNING id, name, position, version, data',
    )
      .bind(input.name, input.position, id, input.version)
      .first<BumperRow>();
    if (!row) throw new HttpError(409, '贴片已被修改或删除，请刷新后重试');
    return json({
      bumper: hasScope(actor, 'bumpers:read') ? fromRow(row) : { id: row.id, version: row.version },
    });
  }
  if (id && request.method === 'DELETE') {
    requireScope(actor, 'bumpers:delete');
    const version = url.searchParams.get('version');
    if (!version || !/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version)))
      throw new HttpError(400, '请提供贴片版本');
    const current = await env.DB.prepare('SELECT id, name, position, version, data FROM bumpers WHERE id = ?')
      .bind(id)
      .first<BumperRow>();
    if (!current) throw new HttpError(404, '贴片不存在');
    const { key, url: media } = JSON.parse(current.data) as { key: string; url: string };
    const sources = [
      ['productions', 'data'],
      ['production_settings', 'data'],
      ['audio_jobs', 'snapshot'],
      ['speech_jobs', 'snapshot'],
    ] as const;
    const references = sources
      .map(
        ([table, column]) =>
          `NOT EXISTS (SELECT 1 FROM ${table} AS source, json_tree(source.${column}) AS ref WHERE ref.type = 'text' AND ref.value IN (?, ?, ?))`,
      )
      .join(' AND ');
    const removed = await env.DB.prepare(
      `DELETE FROM bumpers WHERE id = ? AND version = ? AND ${references} RETURNING id`,
    )
      .bind(id, Number(version), ...sources.flatMap(() => [id, key, media]))
      .first();
    if (!removed) throw new HttpError(409, '贴片已被引用、修改或删除，不能直接删除');
    return new Response(null, { status: 204 });
  }
  if (!id && request.method === 'POST') {
    requireScope(actor, 'bumpers:write');
    const input = bumperInputSchema.safeParse(Object.fromEntries(url.searchParams));
    if (!input.success) throw new HttpError(400, '请填写贴片名称与位置');
    const bytes = await readBytes(request, 3 * 1024 * 1024);
    let durationSeconds: number;
    try {
      const wav = parseWav(bytes);
      if (wav.dataOffset + wav.dataBytes !== bytes.length) throw new Error('Incomplete WAV');
      durationSeconds = wav.durationSeconds;
    } catch {
      throw new HttpError(400, '请上传 24 kHz 单声道 16-bit PCM WAV');
    }
    if (durationSeconds > 30) throw new HttpError(400, '贴片不能超过 30 秒');
    const id = crypto.randomUUID();
    const key = `bumpers/${id}.wav`;
    const object = await env.MEDIA.put(key, bytes, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'audio/wav', cacheControl: 'public, max-age=31536000, immutable' },
    });
    if (!object) throw new HttpError(409, '贴片路径已存在，请重试');
    const data = { key, url: mediaUrl(env, key), durationSeconds, size: bytes.byteLength };
    await env.DB.prepare('INSERT INTO bumpers (id, name, position, data) VALUES (?, ?, ?, ?)')
      .bind(id, input.data.name, input.data.position, JSON.stringify(data))
      .run();
    return json(
      {
        bumper: hasScope(actor, 'bumpers:read')
          ? { id, ...input.data, version: 1, ...data }
          : { id, version: 1 },
      },
      201,
    );
  }
  throw new HttpError(405, '不支持这个请求方式');
}
