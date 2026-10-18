import { afterEach, expect, it, vi } from 'vitest';
import { categoryService } from './service';

afterEach(() => vi.unstubAllGlobals());
it('uses explicit IDs, versions and authenticated owner requests', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ categories: [] })));
  vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  await categoryService.list(signal);
  expect(fetcher.mock.calls.at(-1)?.[1].signal).toBe(signal);
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ category: { id: 'test' } })));
  await categoryService.get('a/b');
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe('/admin/api/categories/a%2Fb');
  const input = {
    name: 'Test',
    icon: 'mic' as const,
    color: 'blue' as const,
    seo: {},
  };
  await categoryService.save(input);
  expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify(input) });
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ category: { id: 'test' } })));
  await categoryService.save(input, 'test', 2);
  expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({
    method: 'PUT',
    body: JSON.stringify({ ...input, version: 2 }),
  });
  await categoryService.save(input, 'test', 3, 'renamed');
  expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({
    body: JSON.stringify({ ...input, version: 3, nextId: 'renamed' }),
  });
  await categoryService.save(input, 'test', 4, 'test');
  expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ body: JSON.stringify({ ...input, version: 4 }) });
  fetcher.mockResolvedValue(new Response(null, { status: 204 }));
  await categoryService.remove('test', 3);
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe('/admin/api/categories/test?version=3');
});
