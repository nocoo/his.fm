import type { Scope } from '@his-fm/contracts';
import type {
  AgentTokenRecord,
  Production,
  ProductionAction,
  ProductionBrief,
  Publication,
} from '../../shared/production';
import { request } from '../service';

const path = (id: string) => `/productions/${encodeURIComponent(id)}`;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });
type Result = { production: Production };
export const productionService = {
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
  audio: (id: string, version: number, file: File) =>
    request<Result>(`${path(id)}/assets/audio?version=${version}`, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': 'audio/wav' },
    }),
  detach: (id: string, version: number, asset: 'audio' | 'cover') =>
    request<Result>(`${path(id)}/assets/${asset}?version=${version}`, { method: 'DELETE' }),
  publish: (
    id: string,
    version: number,
    publication: Pick<Publication, 'platform' | 'url' | 'publishedAt'>,
  ) => request<Result>(`${path(id)}/publications`, json('POST', { ...publication, version })),
  tokens: (signal?: AbortSignal) => request<{ tokens: AgentTokenRecord[] }>('/agent-tokens', { signal }),
  createToken: (name: string, expiresInDays: number, scopes: Scope[]) =>
    request<{ token: string; record: AgentTokenRecord }>(
      '/agent-tokens',
      json('POST', { name, expiresInDays, scopes }),
    ),
  revokeToken: (id: string) =>
    request<void>(`/agent-tokens/${encodeURIComponent(id)}/revoke`, { method: 'POST' }),
  deleteToken: (id: string) => request<void>(`/agent-tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

import type { ChannelProfile } from '../../shared/channel';
