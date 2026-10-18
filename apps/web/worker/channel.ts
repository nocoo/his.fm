import { type PromptSlot, promptKeys, promptSetSchema, synthesizePromptSlots } from '@his-fm/contracts';
import { type ChannelProfile, editorialPriority } from '../src/shared/channel';
import type { Actor } from '../src/shared/production';
import { requireScope } from './authorization';
import { HttpError, json } from './http';
import { channelDefault as defaultContent, defaultPrompts } from './prompt-defaults';

export async function getChannel(db: D1Database): Promise<ChannelProfile> {
  await db
    .prepare(
      'INSERT INTO channel_profile (id, version, content, prompts, updated_at, updated_by) VALUES (1, 1, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
    )
    .bind(defaultContent.trim(), JSON.stringify(defaultPrompts), new Date().toISOString(), 'his.fm')
    .run();
  await db
    .prepare(
      'UPDATE channel_profile SET prompts = ?, version = version + 1 WHERE id = 1 AND prompts IS NULL AND prompt_slots IS NULL',
    )
    .bind(JSON.stringify(defaultPrompts))
    .run();
  const channel = await db
    .prepare(
      'SELECT version, content, prompts, prompt_slots, updated_at AS updatedAt, updated_by AS updatedBy FROM channel_profile WHERE id = 1',
    )
    .first<Omit<ChannelProfile, 'prompts'> & { prompts: string; prompt_slots: string | null }>();
  if (!channel) throw new HttpError(503, '全局提示词暂时无法读取，请重试');
  const { prompt_slots, ...profile } = channel;
  if (prompt_slots !== null) {
    const body = synthesizePromptSlots(JSON.parse(prompt_slots) as PromptSlot[]);
    return {
      ...profile,
      content: body,
      prompts: Object.fromEntries(promptKeys.map((key) => [key, body])) as ChannelProfile['prompts'],
    };
  }
  return { ...profile, prompts: promptSetSchema.parse(JSON.parse(channel.prompts)) };
}

export async function routeChannel(request: Request, env: Env, actor: Actor): Promise<Response> {
  if (request.method === 'GET') {
    requireScope(actor, 'prompts:read');
    return json({ channel: await getChannel(env.DB), priority: editorialPriority });
  }
  requireScope(actor, 'prompts:write');
  throw new HttpError(405, '旧提示词字段已只读，请使用 /channel/prompt-slots');
}
