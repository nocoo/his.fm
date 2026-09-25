import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEnvironment, selectEnvironment } from './environment';
import { emptyEpisode } from './model';
import { ApiError, adminService, connectProduction, request } from './service';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllEnvs();
  vi.stubGlobal('localStorage', undefined);
});

function respond(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
}

describe('admin transport', () => {
  it('switches data APIs while keeping local authentication and recovery usable', async () => {
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => saved.get(key),
      setItem: (key: string, value: string) => saved.set(key, value),
    });
    expect(getEnvironment()).toBe('local');
    selectEnvironment('production');
    expect(getEnvironment()).toBe('production');
    respond({ episodes: [] });
    await adminService.list();
    expect(fetchMock.mock.calls[0]).toEqual([
      '/admin/remote-api/episodes',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', 'X-Hisfm-Remote': '1' },
      }),
    ]);
    respond({ mode: 'local' });
    await adminService.session();
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/admin/api/session');
    selectEnvironment('local');
    expect(getEnvironment()).toBe('local');
    vi.stubEnv('DEV', false);
    expect(getEnvironment()).toBe('production');
    selectEnvironment('production');
    expect([...saved.values()]).toEqual(['local']);
    respond({ episodes: [] });
    await adminService.list();
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/admin/api/episodes');
  });
  it('uses cached production identity and logs in only when it expires', async () => {
    respond({ mode: 'access' });
    await connectProduction();
    expect(fetchMock).toHaveBeenCalledOnce();
    respond({ error: 'Expired' }, 401);
    respond({ connected: true });
    respond({ mode: 'access' });
    await connectProduction();
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/admin/remote-api/session',
      '/admin/remote-api/session',
      '/admin/remote-connect',
      '/admin/remote-api/session',
    ]);
  });
  it('preserves transport failures and rejected production login', async () => {
    respond({ error: 'Offline' }, 502);
    await expect(connectProduction()).rejects.toThrow('Offline');
    respond({ error: 'Expired' }, 401);
    respond({}, 401);
    await expect(connectProduction()).rejects.toThrow('生产登录未完成');
    fetchMock.mockRejectedValueOnce(new TypeError('Disconnected'));
    await expect(connectProduction()).rejects.toThrow('Disconnected');
  });
  it('uses same-origin credentials and JSON content type', async () => {
    respond({ ok: true });
    expect(await request('/test')).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/admin/api/test', {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    });
  });
  it('preserves caller headers and cancellation', async () => {
    respond({ ok: true });
    const controller = new AbortController();
    await request('/test', { signal: controller.signal, headers: { 'X-Test': 'value' } });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      signal: controller.signal,
      headers: { 'X-Test': 'value' },
    });
  });
  it('does not parse empty successful responses', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await request('/test')).toBeUndefined();
  });
  it('reports a server validation error with its HTTP status', async () => {
    respond({ error: '链接名称已存在' }, 409);
    await expect(request('/test')).rejects.toMatchObject({
      name: 'ApiError',
      message: '链接名称已存在',
      status: 409,
    });
  });
  it('uses the authentication error for a non-JSON access response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>Sign in</html>', { status: 401 }));
    await expect(request('/test')).rejects.toThrow('登录已失效，请重新登录');
  });
  it('does not render arbitrary server error payloads', async () => {
    respond({ error: { sensitive: true } }, 500);
    await expect(request('/test')).rejects.toThrow('暂时无法完成操作，请稍后重试');
  });
  it('preserves network failures', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Offline'));
    await expect(request('/test')).rejects.toThrow('Offline');
    expect(new ApiError('No', 403)).toBeInstanceOf(Error);
  });
});

describe('episode CRUD adapter', () => {
  it('loads a session and episode collection with an abort signal', async () => {
    const signal = new AbortController().signal;
    respond({ user: { email: 'editor@his.fm' }, mode: 'local' });
    expect((await adminService.session(signal)).mode).toBe('local');
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(signal);
    respond({ episodes: [] });
    expect(await adminService.list(signal)).toEqual({ episodes: [] });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/admin/api/episodes');
  });
  it('logs in and logs out using POST', async () => {
    respond({ user: { email: 'editor@his.fm' }, mode: 'local' });
    await adminService.login();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await adminService.logout();
    expect(fetchMock.mock.calls.map(([path, options]) => [path, options?.method])).toEqual([
      ['/admin/api/dev-login', 'POST'],
      ['/admin/api/logout', 'POST'],
    ]);
  });
  it('encodes resource IDs and supports get/create/update/delete', async () => {
    respond({ episode: emptyEpisode });
    await adminService.get('a/b');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/admin/api/episodes/a%2Fb');
    respond({ episode: emptyEpisode });
    await adminService.create(emptyEpisode);
    expect(fetchMock.mock.calls[1]).toEqual([
      '/admin/api/episodes',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(emptyEpisode) }),
    ]);
    respond({ episode: emptyEpisode });
    await adminService.update('a/b', emptyEpisode);
    expect(fetchMock.mock.calls[2]).toEqual([
      '/admin/api/episodes/a%2Fb',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify(emptyEpisode) }),
    ]);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await adminService.remove('a/b');
    expect(fetchMock.mock.calls[3]).toEqual([
      '/admin/api/episodes/a%2Fb',
      expect.objectContaining({ method: 'DELETE' }),
    ]);
  });
});
