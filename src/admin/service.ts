import type { Episode, EpisodeInput } from '../shared/episode';

export type Session = { user: { email: string }; mode: 'local' | 'access' };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/admin/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    let message = response.status === 401 ? '登录已失效，请重新登录' : '暂时无法完成操作，请稍后重试';
    try {
      const body: { error?: unknown } = await response.json();
      if (typeof body.error === 'string') message = body.error;
    } catch {}
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const adminService = {
  session: (signal?: AbortSignal) => request<Session>('/session', { signal }),
  login: () => request<Session>('/dev-login', { method: 'POST' }),
  logout: () => request<void>('/logout', { method: 'POST' }),
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
  update: (id: string, input: EpisodeInput) =>
    request<{ episode: Episode }>(`/episodes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  remove: (id: string) => request<void>(`/episodes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
