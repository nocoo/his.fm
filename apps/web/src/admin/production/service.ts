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
  channel: (signal?: AbortSignal) => request<{ channel: ChannelProfile }>('/channel', { signal }),
  saveChannel: (input: Pick<ChannelProfile, 'version' | 'content'>) =>
    request<{ channel: ChannelProfile }>('/channel', json('PUT', input)),
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
  preview: (input: AudioPreviewInput) =>
    request<{ preview: AudioPreview }>('/production-settings/preview', json('POST', input)),
  publish: (
    id: string,
    version: number,
    publication: Pick<Publication, 'platform' | 'url' | 'publishedAt'>,
  ) => request<Result>(`${path(id)}/publications`, json('POST', { ...publication, version })),
  settings: (signal?: AbortSignal) =>
    request<{ settings: ProductionSettings }>('/production-settings', { signal }),
  saveSettings: (settings: Pick<ProductionSettings, 'voice' | 'speakingStyle'>) =>
    request<{ settings: ProductionSettings }>('/production-settings', json('PUT', settings)),
  bumper: (position: 'intro' | 'outro', file: File) =>
    request<{ settings: ProductionSettings }>(`/production-settings/${position}`, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': 'audio/wav' },
    }),
  tokens: (signal?: AbortSignal) => request<{ tokens: AgentTokenRecord[] }>('/agent-tokens', { signal }),
  createToken: (name: string, expiresInDays: number) =>
    request<{ token: string; record: AgentTokenRecord }>(
      '/agent-tokens',
      json('POST', { name, expiresInDays }),
    ),
  revokeToken: (id: string) => request<void>(`/agent-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

import type { ChannelProfile } from '../../shared/channel';
