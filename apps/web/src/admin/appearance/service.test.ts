import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture, readyFixture } from '../../../tests/worker/production-fixture';
import { appearanceService } from './service';

afterEach(() => vi.unstubAllGlobals());

describe('appearance service', () => {
  it('lists only saved production covers, newest first, without using seeded episode samples', async () => {
    const older = readyFixture({ id: 'older', version: 7 });
    const newer = readyFixture({ id: 'newer', version: 11, updatedAt: '2026-10-01T00:00:00Z' });
    const request = vi.fn().mockResolvedValue(Response.json({ productions: [older, fixture(), newer] }));
    vi.stubGlobal('fetch', request);
    const signal = new AbortController().signal;
    await expect(appearanceService.coverSources(signal)).resolves.toEqual(
      [newer, older].map(({ id, title, version, episodeNumber }) => ({ id, title, version, episodeNumber })),
    );
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith('/admin/api/productions', expect.objectContaining({ signal }));
    request.mockResolvedValue(Response.json({ productions: [] }));
    await expect(appearanceService.coverSources()).resolves.toEqual([]);
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
