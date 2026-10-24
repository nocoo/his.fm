import type { ThemeId } from '../shared/appearance';
import type { Episode, EpisodeInput } from '../shared/episode';
import { getEnvironment } from './environment';

export type Session = {
  user: { email: string; name: string | null; avatar: string | null };
  mode: 'local' | 'access';
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function requestResponse(
  path: string,
  init: RequestInit = {},
  target: 'selected' | 'local' | 'production' = 'selected',
): Promise<Response> {
  const remote =
    import.meta.env.DEV &&
    target !== 'local' &&
    (target === 'production' || getEnvironment() === 'production');
  const response = await fetch(`${remote ? '/admin/remote-api' : '/admin/api'}${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(remote ? { 'X-Hisfm-Remote': '1' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    let message = response.status === 401 ? '登录已失效，请重新登录' : '暂时无法完成操作，请稍后重试';
    try {
      const body: { error?: unknown } = await response.json();
      if (typeof body.error === 'string') message = body.error;
    } catch {}
    throw new ApiError(message, response.status);
  }
  return response;
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  target: 'selected' | 'local' | 'production' = 'selected',
): Promise<T> {
  const response = await requestResponse(path, init, target);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function downloadCover(
  resource: 'productions' | 'episodes',
  id: string,
  version: number,
  theme: ThemeId,
): Promise<Blob> {
  const response = await requestResponse(
    `/${resource}/${encodeURIComponent(id)}/cover.png?theme=${theme}&version=${version}`,
    { headers: { Accept: 'image/png' } },
  );
  if (response.headers.get('Content-Type') !== 'image/png') {
    throw new ApiError('服务器未返回封面图片，请重新登录后重试', response.status);
  }
  return response.blob();
}

export const adminService = {
  session: (signal?: AbortSignal) => request<Session>('/session', { signal }, 'local'),
  login: () => request<Session>('/dev-login', { method: 'POST' }, 'local'),
  logout: () => request<void>('/logout', { method: 'POST' }, 'local'),
  list: (signal?: AbortSignal) => request<{ episodes: Episode[] }>('/episodes', { signal }),
  get: (id: string, signal?: AbortSignal) =>
    request<{ episode: Episode }>(`/episodes/${encodeURIComponent(id)}`, {
      signal,
    }),
  create: (input: EpisodeInput) =>
    request<{ episode: Episode }>('/episodes', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: string, input: EpisodeInput, version: number) =>
    request<{ episode: Episode }>(`/episodes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...input, version }),
    }),
  remove: (id: string, version: number) =>
    request<void>(`/episodes/${encodeURIComponent(id)}?version=${version}`, { method: 'DELETE' }),
};

export async function connectProduction(): Promise<void> {
  try {
    await request<Session>('/session', {}, 'production');
    return;
  } catch (cause) {
    if (!(cause instanceof ApiError) || cause.status !== 401) throw cause;
  }
  const response = await fetch('/admin/remote-connect', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'X-Hisfm-Remote': '1' },
  });
  if (!response.ok) throw new ApiError('生产登录未完成，请重试', response.status);
  await request<Session>('/session', {}, 'production');
}
