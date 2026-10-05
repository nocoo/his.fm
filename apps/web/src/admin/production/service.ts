import type { AiStatus, aiUpdateSchema } from '@his-fm/contracts';
import type { z } from 'zod';
import type {
  AgentTokenRecord,
  AudioGeneration,
  AudioPreview,
  AudioPreviewInput,
  Production,
  ProductionAction,
  ProductionBrief,
  ProductionSettings,
  Publication,
} from '../../shared/production';
import { request } from '../service';

const path = (id: string) => `/productions/${encodeURIComponent(id)}`;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
type Result = { production: Production };
export const productionService = {
  ai: (signal?: AbortSignal) => request<{ config: AiStatus }>('/ai-settings', { signal }),
  saveAi: (input: z.infer<typeof aiUpdateSchema>) =>
    request<{ config: AiStatus }>('/ai-settings', json('PUT', input)),
  channel: (signal?: AbortSignal) => request<{ channel: ChannelProfile }>('/channel', { signal }),
  saveChannel: (
    input: Pick<ChannelProfile, 'version'> & Partial<Pick<ChannelProfile, 'content' | 'prompts'>>,
  ) => request<{ channel: ChannelProfile }>('/channel', json('PUT', input)),
  list: (signal?: AbortSignal) => request<{ productions: Production[] }>('/productions', { signal }),
  get: (id: string, signal?: AbortSignal) => request<Result>(path(id), { signal }),
  create: (brief: ProductionBrief) => request<Result>('/productions', json('POST', brief)),
  update: (
    id: string,
    version: number,
    fields: Partial<ProductionBrief> & { transcript?: string; summary?: string; description?: string },
  ) => request<Result>(path(id), json('PUT', { ...fields, version })),
  action: (id: string, action: ProductionAction) =>
    request<Result>(`${path(id)}/actions`, json('POST', action)),
  remove: (id: string, version: number) =>
    request<void>(`${path(id)}?version=${version}`, { method: 'DELETE' }),
  cover: (id: string, version: number, file: File) =>
    request<Result>(`${path(id)}/assets/cover?version=${version}`, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    }),
  audio: (id: string, input: AudioGeneration) => request<Result>(`${path(id)}/audio`, json('POST', input)),
  preview: async (input: AudioPreviewInput) => {
    let result = await request<{ preview?: AudioPreview; jobId?: string }>(
      '/production-settings/preview',
      json('POST', input),
    );
    const jobId = result.jobId;
    for (let attempt = 0; !result.preview && jobId && attempt < 300; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      result = await request<{ preview?: AudioPreview; jobId?: string }>(
        `/production-settings/preview/${jobId}`,
      );
    }
    if (!result.preview) throw new Error('主控仍在生成试听，可在对话面板查看进度并稍后重试。');
    return { preview: result.preview };
  },
  publish: (
    id: string,
    version: number,
    publication: Pick<Publication, 'platform' | 'url' | 'publishedAt'>,
  ) => request<Result>(`${path(id)}/publications`, json('POST', { ...publication, version })),
  settings: (signal?: AbortSignal) =>
    request<{ settings: ProductionSettings }>('/production-settings', { signal }),
  tokens: (signal?: AbortSignal) => request<{ tokens: AgentTokenRecord[] }>('/agent-tokens', { signal }),
  createToken: (name: string, expiresInDays: number) =>
    request<{ token: string; record: AgentTokenRecord }>(
      '/agent-tokens',
      json('POST', { name, expiresInDays }),
    ),
  revokeToken: (id: string) => request<void>(`/agent-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

import type { ChannelProfile } from '../../shared/channel';
