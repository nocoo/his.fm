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

it('keeps preview read-only and applies only the explicitly inspected collection and legacy versions', async () => {
  const preview = {
    version: 0,
    legacyVersion: 11,
    initialized: false,
    slots: [],
    unmappedHeadings: ['unknown'],
  };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(preview)));
  vi.stubGlobal('fetch', fetcher);
  expect(await promptSlotsService.dryRun(null)).toEqual(preview);
  expect(fetcher).toHaveBeenLastCalledWith(
    '/admin/api/channel/prompt-slots/migration/dry-run',
    expect.not.objectContaining({ method: 'POST' }),
  );
  await promptSlotsService.apply('a/b', preview);
  expect(fetcher).toHaveBeenLastCalledWith(
    '/admin/api/categories/a%2Fb/prompt-slots/migration/apply',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ version: 0, legacyVersion: 11 }) }),
  );
});

it('reads old whole fields without offering a legacy mutation path', async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          channel: { content: 'legacy channel', prompts: { editorial: 'legacy editorial' } },
        }),
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  expect(await promptSlotsService.legacy(null)).toEqual([
    { title: '旧版全局创作原则（只读）', body: 'legacy channel' },
    { title: '创作优先级（只读）', body: 'legacy editorial' },
  ]);
  fetcher.mockImplementation(
    async () => new Response(JSON.stringify({ category: { prompt: 'legacy category' } })),
  );
  expect(await promptSlotsService.legacy('a/b')).toEqual([
    { title: '旧版栏目提示词（只读）', body: 'legacy category' },
  ]);
  expect(fetcher).toHaveBeenLastCalledWith(
    '/admin/api/categories/a%2Fb',
    expect.not.objectContaining({ method: 'PUT' }),
  );
});
