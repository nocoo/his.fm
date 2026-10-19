// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { themeIds } from '../../shared/appearance';
import * as transport from '../service';
import { appearanceService, type CoverPreviewSource } from './service';
import { useAppearancePreviews } from './useAppearancePreviews';

let vm: ReturnType<typeof useAppearancePreviews>;
let root: Root;
let container: HTMLDivElement;
const first: CoverPreviewSource = { id: 'first', title: 'Saved programme', version: 7, episodeNumber: 2 };
const second: CoverPreviewSource = { ...first, id: 'second', title: 'Another programme', version: 9 };
const image = new Blob(['png'], { type: 'image/png' });

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
  vi.spyOn(transport, 'downloadCover').mockResolvedValue(image);
  let next = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:preview-${++next}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
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

it('renders all themes from the same saved production without persisting an appearance change', async () => {
  await mount();
  expect(vm.source).toEqual(first);
  expect(vm.loading).toBe(false);
  expect(transport.downloadCover).toHaveBeenCalledTimes(8);
  expect(vi.mocked(transport.downloadCover).mock.calls).toEqual(
    themeIds.map((theme) => ['productions', first.id, first.version, theme]),
  );
  expect(Object.values(vm.previews ?? {}).every((preview) => preview.status === 'ready')).toBe(true);
  await act(async () => vm.setSelected(second.id));
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(8);
  expect(vm.source).toEqual(second);
  expect(transport.downloadCover).toHaveBeenLastCalledWith('productions', second.id, 9, 'alpine-bloom');
  await act(async () => root.unmount());
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(16);
});

it('serializes renders across rapid selection changes and discards abandoned results', async () => {
  let release: (blob: Blob) => void = () => {};
  vi.mocked(transport.downloadCover).mockImplementationOnce(
    () =>
      new Promise<Blob>((resolve) => {
        release = resolve;
      }),
  );
  await mount();
  expect(transport.downloadCover).toHaveBeenCalledOnce();
  await act(async () => vm.setSelected(second.id));
  expect(vm.previews).toBeUndefined();
  expect(transport.downloadCover).toHaveBeenCalledOnce();
  await act(async () => release(image));
  expect(transport.downloadCover).toHaveBeenCalledTimes(9);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(8);
  expect(vm.source).toEqual(second);
  expect(Object.values(vm.previews ?? {}).every((preview) => preview.status === 'ready')).toBe(true);
});

it('shows generation failures and refreshes saved versions while preserving the selected programme', async () => {
  vi.mocked(transport.downloadCover).mockRejectedValueOnce(new transport.ApiError('Render busy', 503));
  await mount();
  expect(vm.previews?.grove).toEqual({ status: 'error', message: 'Render busy' });
  expect(vm.previews?.interval?.status).toBe('ready');
  await act(async () => vm.setSelected(second.id));
  vi.mocked(appearanceService.coverSources).mockResolvedValue([first, { ...second, version: 10 }]);
  await act(async () => vm.load());
  expect(vm.selected).toBe(second.id);
  expect(transport.downloadCover).toHaveBeenLastCalledWith('productions', second.id, 10, 'alpine-bloom');
  expect(Object.values(vm.previews ?? {}).every((preview) => preview.status === 'ready')).toBe(true);
});

it('does not invent covers for an empty library, missing selection or failed catalogue read', async () => {
  vi.mocked(appearanceService.coverSources).mockRejectedValueOnce(new Error('Offline'));
  await mount();
  expect(vm.error).toBe('Offline');
  expect(vm.source).toBeUndefined();
  expect(transport.downloadCover).not.toHaveBeenCalled();
  vi.mocked(appearanceService.coverSources).mockResolvedValue([]);
  await act(async () => vm.load());
  expect(vm.error).toBe('');
  expect(vm.selected).toBe('');
  expect(transport.downloadCover).not.toHaveBeenCalled();
  vi.mocked(appearanceService.coverSources).mockResolvedValue([first]);
  await act(async () => vm.load());
  await act(async () => vm.setSelected('removed'));
  expect(vm.previews).toBeUndefined();
  await act(async () => vm.load());
  expect(vm.selected).toBe(first.id);
});

it('ignores catalogue reads and render responses after unmount', async () => {
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
  expect(transport.downloadCover).not.toHaveBeenCalled();
  root = createRoot(container);
  let fail: (cause: Error) => void = () => {};
  vi.mocked(transport.downloadCover).mockImplementationOnce(
    () =>
      new Promise<Blob>((_, reject) => {
        fail = reject;
      }),
  );
  await mount();
  await act(async () => root.unmount());
  await act(async () => fail(new Error('Closed')));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(transport.downloadCover).toHaveBeenCalledOnce();
});
