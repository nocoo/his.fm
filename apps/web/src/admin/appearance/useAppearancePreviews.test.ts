// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { appearanceService, type CoverPreviewSource } from './service';
import { useAppearancePreviews } from './useAppearancePreviews';

let vm: ReturnType<typeof useAppearancePreviews>;
let root: Root;
let container: HTMLDivElement;
const first: CoverPreviewSource = {
  id: 'first',
  title: 'Saved programme',
  episodeNumber: 2,
  coverUrl: '/media/first.webp',
  categoryName: '生活留白',
};
const second: CoverPreviewSource = { ...first, id: 'second', title: 'Another programme' };

function Host() {
  vm = useAppearancePreviews();
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

async function mount() {
  await act(async () => root.render(createElement(Host)));
}

it('loads the recent library covers together without a selected production or rendered image requests', async () => {
  await mount();
  expect(vm.sources).toEqual([first, second]);
  expect(vm.loading).toBe(false);
  expect(appearanceService.coverSources).toHaveBeenCalledOnce();
});

it('refreshes library membership and saved metadata', async () => {
  await mount();
  vi.mocked(appearanceService.coverSources).mockResolvedValue([{ ...second, title: 'Updated title' }]);
  await act(async () => vm.load());
  expect(vm.sources).toEqual([{ ...second, title: 'Updated title' }]);
});

it('distinguishes failed reads from empty libraries and recovers with refresh', async () => {
  vi.mocked(appearanceService.coverSources).mockRejectedValueOnce(new Error('Offline'));
  await mount();
  expect(vm.error).toBe('Offline');
  expect(vm.sources).toEqual([]);
  vi.mocked(appearanceService.coverSources).mockResolvedValue([]);
  await act(async () => vm.load());
  expect(vm.error).toBe('');
  expect(vm.sources).toEqual([]);
  vi.mocked(appearanceService.coverSources).mockResolvedValue([first]);
  await act(async () => vm.load());
  expect(vm.sources).toEqual([first]);
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
