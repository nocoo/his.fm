// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appearanceService, type CoverPreviewSource } from './service';
import { useAppearancePreviews } from './useAppearancePreviews';

let vm: ReturnType<typeof useAppearancePreviews>;
let navigate: ReturnType<typeof useNavigate>;
let search: string;
let root: Root;
let container: HTMLDivElement;
const first: CoverPreviewSource = {
  id: 'first',
  title: 'Saved programme',
  version: 7,
  episodeNumber: 2,
  coverUrl: '/media/first.webp',
  categoryName: '生活留白',
};
const second: CoverPreviewSource = { ...first, id: 'second', title: 'Another programme', version: 9 };

function Host() {
  vm = useAppearancePreviews();
  search = useLocation().search;
  navigate = useNavigate();
  return null;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(appearanceService, 'coverSources').mockResolvedValue([first, second]);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(path = '/admin/appearance') {
  await act(async () =>
    root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Host))),
  );
}

it('selects saved cover data immediately and follows URL history without fetching rendered images', async () => {
  await mount('/admin/appearance?theme=interval');
  expect(vm.source).toEqual(first);
  expect(vm.loading).toBe(false);
  await act(async () => vm.setSelected(second.id));
  expect(search).toBe('?theme=interval&production=second');
  expect(vm.source).toEqual(second);
  await act(async () => navigate(-1));
  expect(vm.source).toEqual(first);
  await act(async () => navigate(1));
  expect(vm.source).toEqual(second);
  expect(appearanceService.coverSources).toHaveBeenCalledOnce();
});

it('restores a deep link and refreshes saved metadata without losing the requested programme', async () => {
  await mount('/admin/appearance?production=second');
  expect(vm.source).toEqual(second);
  vi.mocked(appearanceService.coverSources).mockResolvedValue([first, { ...second, version: 10 }]);
  await act(async () => vm.load());
  expect(vm.source?.version).toBe(10);
  expect(search).toBe('?production=second');
});

it('keeps failed reads, empty libraries and unavailable deep links distinct', async () => {
  vi.mocked(appearanceService.coverSources).mockRejectedValueOnce(new Error('Offline'));
  await mount();
  expect(vm.error).toBe('Offline');
  expect(vm.source).toBeUndefined();
  vi.mocked(appearanceService.coverSources).mockResolvedValue([]);
  await act(async () => vm.load());
  expect(vm.error).toBe('');
  expect(vm.selected).toBe('');
  vi.mocked(appearanceService.coverSources).mockResolvedValue([first]);
  await act(async () => vm.load());
  await act(async () => vm.setSelected('removed'));
  expect(vm.source).toBeUndefined();
  expect(vm.error).toContain('所选制作项目不存在');
  await act(async () => vm.load());
  expect(vm.source).toBeUndefined();
  await act(async () => vm.setSelected(first.id));
  expect(vm.error).toBe('');
});

it('ignores catalogue reads after unmount', async () => {
  let releaseSources: (sources: CoverPreviewSource[]) => void = () => {};
  vi.mocked(appearanceService.coverSources).mockImplementationOnce(
    () =>
      new Promise<CoverPreviewSource[]>((resolve) => {
        releaseSources = resolve;
      }),
  );
  await mount();
  const signal = vi.mocked(appearanceService.coverSources).mock.calls[0]?.[0];
  await act(async () => root.unmount());
  expect(signal?.aborted).toBe(true);
  await act(async () => releaseSources([first]));
  expect(vm.sources).toEqual([]);
});
