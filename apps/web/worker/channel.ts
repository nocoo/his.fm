import { promptSetSchema } from '@his-fm/contracts';
import { defaultPrompts } from '@his-fm/contracts/prompt-defaults';
import { type ChannelProfile, channelUpdateSchema, editorialPriority } from '../src/shared/channel';
import type { Actor } from '../src/shared/production';
import defaultContent from './channel-default.md?raw';
import { HttpError, json } from './http';
import { readJson } from './production-body';
import { requireHuman } from './production-model';

export async function getChannel(db: D1Database): Promise<ChannelProfile> {
  await db
    .prepare(
      'INSERT INTO channel_profile (id, version, content, prompts, updated_at, updated_by) VALUES (1, 1, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
    )
    .bind(defaultContent.trim(), JSON.stringify(defaultPrompts), new Date().toISOString(), 'his.fm')
    .run();
  await db
    .prepare('UPDATE channel_profile SET prompts = ?, version = version + 1 WHERE id = 1 AND prompts IS NULL')
    .bind(JSON.stringify(defaultPrompts))
    .run();
  const channel = await db
    .prepare(
      'SELECT version, content, prompts, updated_at AS updatedAt, updated_by AS updatedBy FROM channel_profile WHERE id = 1',
    )
    .first<Omit<ChannelProfile, 'prompts'> & { prompts: string }>();
  if (!channel) throw new HttpError(503, '全局提示词暂时无法读取，请重试');
  return { ...channel, prompts: promptSetSchema.parse(JSON.parse(channel.prompts)) };
}

export async function routeChannel(request: Request, env: Env, actor: Actor): Promise<Response> {
  if (request.method === 'GET')
    return json({ channel: await getChannel(env.DB), priority: editorialPriority });
  requireHuman(actor);
  if (request.method !== 'PUT') throw new HttpError(405, '全局提示词使用 GET 读取、PUT 更新');
  const input = await readJson(request, channelUpdateSchema);
  await getChannel(env.DB);
  const channel = await env.DB.prepare(
    'UPDATE channel_profile SET content = COALESCE(?, content), prompts = COALESCE(?, prompts), version = version + 1, updated_at = ?, updated_by = ? WHERE id = 1 AND version = ? RETURNING version, content, prompts, updated_at AS updatedAt, updated_by AS updatedBy',
  )
    .bind(
      input.content ?? null,
      input.prompts ? JSON.stringify(input.prompts) : null,
      new Date().toISOString(),
      actor.name,
      input.version,
    )
    .first<Omit<ChannelProfile, 'prompts'> & { prompts: string }>();
  if (!channel) throw new HttpError(409, '全局提示词已在别处更新。你的草稿已保留，请对照最新版本后保存。');
  return json({
    channel: { ...channel, prompts: promptSetSchema.parse(JSON.parse(channel.prompts)) },
    priority: editorialPriority,
  });
}
