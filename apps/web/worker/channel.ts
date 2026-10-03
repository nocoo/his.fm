import { type ChannelProfile, channelUpdateSchema, editorialPriority } from '../src/shared/channel';
import type { Actor } from '../src/shared/production';
import defaultContent from './channel-default.md?raw';
import { HttpError, json } from './http';
import { readJson } from './production-body';
import { requireHuman } from './production-model';

export async function getChannel(db: D1Database): Promise<ChannelProfile> {
  await db
    .prepare(
      'INSERT INTO channel_profile (id, version, content, updated_at, updated_by) VALUES (1, 1, ?, ?, ?) ON CONFLICT DO NOTHING',
    )
    .bind(defaultContent.trim(), new Date().toISOString(), 'his.fm')
    .run();
  const channel = await db
    .prepare(
      'SELECT version, content, updated_at AS updatedAt, updated_by AS updatedBy FROM channel_profile WHERE id = 1',
    )
    .first<ChannelProfile>();
  if (!channel) throw new HttpError(503, '全局提示词暂时无法读取，请重试');
  return channel;
}

export async function routeChannel(request: Request, env: Env, actor: Actor): Promise<Response> {
  if (request.method === 'GET')
    return json({ channel: await getChannel(env.DB), priority: editorialPriority });
  requireHuman(actor);
  if (request.method !== 'PUT') throw new HttpError(405, '全局提示词使用 GET 读取、PUT 更新');
  const input = await readJson(request, channelUpdateSchema);
  await getChannel(env.DB);
  const channel = await env.DB.prepare(
    'UPDATE channel_profile SET content = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = 1 AND version = ? RETURNING version, content, updated_at AS updatedAt, updated_by AS updatedBy',
  )
    .bind(input.content, new Date().toISOString(), actor.name, input.version)
    .first<ChannelProfile>();
  if (!channel) throw new HttpError(409, '全局提示词已在别处更新。你的草稿已保留，请对照最新版本后保存。');
  return json({ channel, priority: editorialPriority });
}
