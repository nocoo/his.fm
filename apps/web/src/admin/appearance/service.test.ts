import { afterEach, describe, expect, it, vi } from 'vitest';
import { episodeFixture, fixture, readyFixture } from '../../../tests/worker/production-fixture';
import { appearanceService } from './service';

afterEach(() => vi.unstubAllGlobals());

describe('appearance service', () => {
  it('uses the unified library order and relation-based deduplication for the latest four covers', async () => {
    const production = readyFixture({ updatedAt: '2026-10-03T00:00:00Z' });
    const episodes = [1, 2, 4, 5].map((number) =>
      episodeFixture({
        id: String(number),
        episodeNumber: number,
        updatedAt: `2026-10-0${number}T00:00:00Z`,
      }),
    );
    const snapshot = episodeFixture({ sourceProductionId: production.id, updatedAt: '2026-10-06T00:00:00Z' });
    const request = vi
      .fn()
      .mockImplementation((path: string) =>
        Promise.resolve(
          Response.json(
            path.endsWith('/categories')
              ? { categories: [{ id: 'life', name: '生活留白' }] }
              : path.endsWith('/episodes')
                ? { episodes: [...episodes, snapshot] }
                : { productions: [production, fixture({ id: 'coverless' })] },
          ),
        ),
      );
    vi.stubGlobal('fetch', request);
    const signal = new AbortController().signal;
    await expect(appearanceService.coverSources(signal)).resolves.toEqual(
      [episodes[3], episodes[2], production, episodes[1]].map((row) => ({
        id: `${row === production ? 'production' : 'episode'}:${row.id}`,
        title: row.title,
        episodeNumber: row.episodeNumber,
        coverUrl: 'https://f.no.mt/cover.png',
        categoryName: '生活留白',
      })),
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenCalledWith('/admin/api/productions', expect.objectContaining({ signal }));
    expect(request).toHaveBeenCalledWith('/admin/api/episodes', expect.objectContaining({ signal }));
    expect(request).toHaveBeenCalledWith('/admin/api/categories', expect.objectContaining({ signal }));
    request.mockClear();
    request.mockImplementation(() =>
      Promise.resolve(Response.json({ productions: [], episodes: [], categories: [] })),
    );
    await expect(appearanceService.coverSources()).resolves.toEqual([]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('includes standalone episodes even when productions have no covers and uses library category labels', async () => {
    const request = vi.fn().mockImplementation(() =>
      Promise.resolve(
        Response.json({
          productions: [fixture()],
          episodes: [episodeFixture()],
          categories: [],
        }),
      ),
    );
    vi.stubGlobal('fetch', request);
    await expect(appearanceService.coverSources()).resolves.toMatchObject([
      { id: 'episode:episode-test', categoryName: 'life', coverUrl: 'https://f.no.mt/cover.png' },
    ]);
  });

  it('keeps episode and category read failures visible instead of returning an incomplete library', async () => {
    for (const failed of ['episodes', 'categories']) {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockImplementation((path: string) =>
            Promise.resolve(
              path.endsWith(`/${failed}`)
                ? Response.json({ error: `${failed} read failed` }, { status: 503 })
                : Response.json({ productions: [readyFixture()], episodes: [], categories: [] }),
            ),
          ),
      );
      await expect(appearanceService.coverSources()).rejects.toThrow(`${failed} read failed`);
    }
  });

  it('reads with cancellation and saves the exact expected version', async () => {
    const appearance = {
      theme: 'stillwood',
      version: 4,
      updatedAt: '2026-09-26T00:00:00Z',
      updatedBy: 'owner',
    };
    const request = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ appearance })));
    vi.stubGlobal('fetch', request);
    const signal = new AbortController().signal;
    await expect(appearanceService.read(signal)).resolves.toEqual({ appearance });
    expect(request).toHaveBeenLastCalledWith(
      '/admin/api/appearance',
      expect.objectContaining({ signal, credentials: 'same-origin' }),
    );
    await expect(appearanceService.save({ theme: 'stillwood', version: 3 })).resolves.toEqual({ appearance });
    expect(request).toHaveBeenLastCalledWith(
      '/admin/api/appearance',
      expect.objectContaining({ method: 'PUT', body: '{"theme":"stillwood","version":3}' }),
    );
  });
  it('uses the selected environment and preserves version conflicts and transport errors', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'production' });
    const request = vi.fn().mockResolvedValue(Response.json({ error: '外观设置已更新' }, { status: 409 }));
    vi.stubGlobal('fetch', request);
    await expect(appearanceService.save({ theme: 'grove', version: 1 })).rejects.toMatchObject({
      status: 409,
      message: '外观设置已更新',
    });
    expect(request).toHaveBeenCalledWith(
      '/admin/remote-api/appearance',
      expect.objectContaining({ headers: { 'Content-Type': 'application/json', 'X-Hisfm-Remote': '1' } }),
    );
    request.mockRejectedValue(new Error('offline'));
    await expect(appearanceService.read()).rejects.toThrow('offline');
  });
});
