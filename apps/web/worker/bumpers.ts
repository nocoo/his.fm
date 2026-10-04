import { z } from 'zod';
import { parseWav } from './audio';
import { HttpError, json } from './http';
import { readBytes } from './production-body';
import { mediaUrl } from './production-store';

export async function routeBumpers(request: Request, env: Env) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const rows = await env.DB.prepare(
      'SELECT id, name, position, version, data FROM bumpers ORDER BY name, id',
    ).all<{ id: string; name: string; position: string; version: number; data: string }>();
    return json({ bumpers: rows.results.map(({ data, ...row }) => ({ ...JSON.parse(data), ...row })) });
  }
  if (request.method === 'POST') {
    const input = z
      .strictObject({ name: z.string().trim().min(1).max(100), position: z.enum(['intro', 'outro']) })
      .safeParse(Object.fromEntries(url.searchParams));
    if (!input.success) throw new HttpError(400, '请填写贴片名称与位置');
    const bytes = await readBytes(request, 3 * 1024 * 1024);
    let durationSeconds: number;
    try {
      durationSeconds = parseWav(bytes).durationSeconds;
    } catch {
      throw new HttpError(400, '请上传 24 kHz 单声道 16-bit PCM WAV');
    }
    if (durationSeconds > 30) throw new HttpError(400, '贴片不能超过 30 秒');
    const id = crypto.randomUUID();
    const key = `bumpers/${id}.wav`;
    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: 'audio/wav', cacheControl: 'public, max-age=31536000, immutable' },
    });
    const data = { key, url: mediaUrl(env, key), durationSeconds, size: bytes.byteLength };
    await env.DB.prepare('INSERT INTO bumpers (id, name, position, data) VALUES (?, ?, ?, ?)')
      .bind(id, input.data.name, input.data.position, JSON.stringify(data))
      .run();
    return json({ bumper: { id, ...input.data, version: 1, ...data } }, 201);
  }
  throw new HttpError(405, '不支持这个请求方式');
}
