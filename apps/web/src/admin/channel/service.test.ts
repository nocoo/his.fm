import { afterEach, expect, it, vi } from 'vitest';
import { promptSlotsPath, promptSlotsService } from './service';

afterEach(() => vi.unstubAllGlobals());

it('uses collection versions and direct table responses for channel and encoded category paths', async () => {
  const table = { version: 7, initialized: true, slots: [] };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(table)));
  vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  expect(await promptSlotsService.get(null, signal)).toEqual(table);
  expect(fetcher).toHaveBeenLastCalledWith(
    '/admin/api/channel/prompt-slots',
    expect.objectContaining({ signal, credentials: 'same-origin' }),
  );
  expect(promptSlotsPath('a/b')).toBe('/categories/a%2Fb/prompt-slots');
  await promptSlotsService.get('learning');
  expect(fetcher).toHaveBeenLastCalledWith('/admin/api/categories/learning/prompt-slots', expect.anything());
  expect(await promptSlotsService.save('learning', 7, [])).toEqual(table);
  expect(fetcher).toHaveBeenLastCalledWith(
    '/admin/api/categories/learning/prompt-slots',
    expect.objectContaining({ method: 'PUT', body: JSON.stringify({ version: 7, slots: [] }) }),
  );
});
