// @vitest-environment happy-dom
import type { PromptSlotTable } from '@his-fm/contracts';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../service';
import { slotInputs } from './model';
import { type MigrationPreview, promptSlotsService } from './service';
import { usePromptSlots } from './usePromptSlots';

vi.mock('../production/useUnsavedChanges', () => ({ useUnsavedChanges: vi.fn() }));
vi.mock('../environment', () => ({ getEnvironment: () => 'local' }));

let vm: ReturnType<typeof usePromptSlots>;
let root: Root;
let container: HTMLDivElement;
const initial: PromptSlotTable = {
  version: 3,
  initialized: true,
  slots: [
    {
      id: 'editor',
      title: '编辑',
      body: 'saved',
      order: 0,
      enabled: true,
      mode: 'override',
      version: 1,
      updatedAt: 'now',
      updatedBy: 'owner',
    },
  ],
};
const preview: MigrationPreview = {
  version: 0,
  legacyVersion: 11,
  initialized: false,
  slots: slotInputs(initial),
  unmappedHeadings: [],
};
const storageKey = 'hisfm-prompt-slots-draft:local:channel';

function Host({ categoryId = null, active = true }: { categoryId?: string | null; active?: boolean }) {
  vm = usePromptSlots(categoryId, active);
  return null;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(promptSlotsService, 'get').mockResolvedValue(structuredClone(initial));
  vi.spyOn(promptSlotsService, 'save').mockResolvedValue({ ...initial, version: 4 });
  vi.spyOn(promptSlotsService, 'dryRun').mockResolvedValue(preview);
  vi.spyOn(promptSlotsService, 'apply').mockResolvedValue(initial);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mount = async (props: Parameters<typeof Host>[0] = {}) => {
  await act(async () => root.render(createElement(Host, props)));
};
const edit = async (body = 'draft') => {
  await act(async () => vm.setSlots(vm.slots.map((slot) => ({ ...slot, body }))));
};

it('loads a table without running or applying migration and saves all drafts at collection version', async () => {
  await mount();
  expect(vm.dirty).toBe(false);
  expect(promptSlotsService.dryRun).not.toHaveBeenCalled();
  expect(promptSlotsService.apply).not.toHaveBeenCalled();
  await edit();
  expect(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}')).toMatchObject({
    version: 3,
    slots: [{ body: 'draft' }],
  });
  vi.mocked(promptSlotsService.save).mockResolvedValue({
    ...initial,
    version: 4,
    slots: [{ ...initial.slots[0], body: 'draft', version: 2 }],
  });
  const resetKey = vm.resetKey;
  await act(async () => {
    expect(await vm.save()).toBe(true);
  });
  expect(promptSlotsService.save).toHaveBeenCalledWith(null, 3, [
    { ...slotInputs(initial)[0], body: 'draft' },
  ]);
  expect(vm.table?.version).toBe(4);
  expect(vm.dirty).toBe(false);
  expect(vm.resetKey).toBe(resetKey);
  expect(sessionStorage.getItem(storageKey)).toBeNull();
});

it('detects changed collection versions before writing, retains drafts and supports explicit full replacement', async () => {
  await mount();
  await edit();
  const latest = { ...initial, version: 8, slots: [{ ...initial.slots[0], body: 'external change' }] };
  vi.mocked(promptSlotsService.get).mockResolvedValue(latest);
  await act(async () => {
    expect(await vm.save()).toBe(false);
  });
  expect(promptSlotsService.save).not.toHaveBeenCalled();
  expect(vm.conflict).toEqual(latest);
  expect(vm.slots[0].body).toBe('draft');
  expect(vm.error).toContain('全部草稿已保留');
  await act(async () => {
    expect(await vm.save(8)).toBe(true);
  });
  expect(promptSlotsService.save).toHaveBeenCalledWith(null, 8, expect.any(Array));
});

it('retains edits made while an older save is in flight and advances their collection version', async () => {
  await mount();
  await edit('first draft');
  let resolve: (table: PromptSlotTable) => void = () => {};
  vi.mocked(promptSlotsService.save).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  let saving: Promise<boolean> = Promise.resolve(false);
  await act(async () => {
    saving = vm.save();
  });
  expect(vm.pending).toBe(true);
  await edit('newer draft');
  await act(async () => {
    expect(await vm.save()).toBe(false);
    await vm.dryRun();
    resolve({ ...initial, version: 4, slots: [{ ...initial.slots[0], body: 'first draft' }] });
    expect(await saving).toBe(true);
  });
  expect(vm.slots[0].body).toBe('newer draft');
  expect(vm.dirty).toBe(true);
  expect(vm.table?.version).toBe(4);
  expect(JSON.parse(sessionStorage.getItem(storageKey) ?? '{}')).toMatchObject({
    version: 4,
    slots: [{ body: 'newer draft' }],
  });
  expect(promptSlotsService.dryRun).not.toHaveBeenCalled();
});

it('preserves failed writes and fetches a conflict after a race, including failed conflict refreshes', async () => {
  await mount();
  await edit();
  vi.mocked(promptSlotsService.save).mockRejectedValueOnce(new ApiError('conflict', 409));
  await act(async () => {
    expect(await vm.save()).toBe(false);
  });
  expect(vm.conflict?.version).toBe(3);
  expect(vm.slots[0].body).toBe('draft');
  vi.mocked(promptSlotsService.get)
    .mockResolvedValueOnce(initial)
    .mockRejectedValueOnce(new Error('offline'));
  vi.mocked(promptSlotsService.save).mockRejectedValueOnce(new ApiError('retry conflict', 409));
  await act(async () => {
    expect(await vm.save()).toBe(false);
  });
  expect(vm.error).toBe('retry conflict');
  vi.mocked(promptSlotsService.get).mockResolvedValue(initial);
  vi.mocked(promptSlotsService.save).mockRejectedValueOnce(new Error('write failed'));
  await act(async () => {
    expect(await vm.save()).toBe(false);
  });
  expect(vm.error).toBe('write failed');
  expect(vm.pending).toBe(false);
  expect(sessionStorage.getItem(storageKey)).toContain('draft');
});

it('restores empty, oversized and stale drafts without silently adopting a newer collection', async () => {
  const slots = [{ ...slotInputs(initial)[0], title: '', body: '中'.repeat(120001) }];
  sessionStorage.setItem(storageKey, JSON.stringify({ version: 2, slots }));
  await mount();
  expect(vm.slots).toEqual(slots);
  expect(vm.valid).toBe(false);
  expect(vm.notice).toContain('已恢复');
  expect(vm.conflict?.version).toBe(3);
  await act(async () => {
    expect(await vm.save()).toBe(false);
  });
  await act(async () => vm.replace(initial));
  expect(vm.slots).toEqual(slotInputs(initial));
  expect(vm.conflict).toBeNull();
  expect(vm.resetKey).toBe(1);
  expect(vm.dirty).toBe(false);
  expect(sessionStorage.getItem(storageKey)).toBeNull();
});

it('keeps channel and a category named channel in distinct draft namespaces', async () => {
  sessionStorage.setItem(
    storageKey,
    JSON.stringify({ version: 3, slots: [{ ...slotInputs(initial)[0], body: 'channel draft' }] }),
  );
  await mount({ categoryId: 'channel' });
  expect(vm.slots[0].body).toBe('saved');
  await edit('category draft');
  expect(sessionStorage.getItem('hisfm-prompt-slots-draft:local:category:channel')).toContain(
    'category draft',
  );
  expect(sessionStorage.getItem(storageKey)).toContain('channel draft');
});

it('leaves uninitialized collections locked until an explicit preview and apply', async () => {
  vi.mocked(promptSlotsService.get).mockResolvedValue({ version: 0, initialized: false, slots: [] });
  await mount();
  await act(async () => {
    expect(await vm.save()).toBe(false);
    expect(await vm.apply()).toBe(false);
  });
  expect(promptSlotsService.apply).not.toHaveBeenCalled();
  await act(async () => vm.dryRun());
  expect(vm.preview).toEqual(preview);
  await act(async () => {
    expect(await vm.apply()).toBe(true);
  });
  expect(promptSlotsService.apply).toHaveBeenCalledWith(null, preview);
  expect(vm.table?.initialized).toBe(true);
  expect(vm.preview).toBeNull();
  expect(vm.dirty).toBe(false);
});

it('invalidates stale migration previews and retains errors without automatic retry or apply', async () => {
  await mount();
  vi.mocked(promptSlotsService.dryRun).mockRejectedValueOnce(new Error('preview failed'));
  await act(async () => vm.dryRun());
  expect(vm.error).toBe('preview failed');
  await act(async () => vm.dryRun());
  vi.mocked(promptSlotsService.apply).mockRejectedValueOnce(new ApiError('stale', 409));
  await act(async () => {
    expect(await vm.apply()).toBe(false);
  });
  expect(vm.preview).toBeNull();
  expect(vm.error).toContain('迁移预览已过期');
  await act(async () => vm.dryRun());
  vi.mocked(promptSlotsService.apply).mockRejectedValueOnce(new Error('apply failed'));
  await act(async () => {
    expect(await vm.apply()).toBe(false);
  });
  expect(vm.preview).toEqual(preview);
  expect(vm.error).toBe('apply failed');
  vi.mocked(promptSlotsService.dryRun).mockResolvedValue({ ...preview, initialized: true });
  await act(async () => vm.dryRun());
  await act(async () => {
    expect(await vm.apply()).toBe(false);
  });
  expect(promptSlotsService.apply).toHaveBeenCalledTimes(2);
});

it('saves only the active editor shortcut and never saves during composition', async () => {
  await mount({ active: false });
  await edit();
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
  });
  expect(promptSlotsService.save).not.toHaveBeenCalled();
  await mount({ active: true });
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, isComposing: true }));
  });
  expect(promptSlotsService.save).not.toHaveBeenCalled();
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
  });
  expect(promptSlotsService.save).toHaveBeenCalledTimes(1);
});

it('reports loading and storage failures without losing the editable server snapshot', async () => {
  vi.mocked(promptSlotsService.get).mockRejectedValueOnce(new Error('read failed'));
  await mount();
  expect(vm.error).toBe('read failed');
  expect(vm.table).toBeNull();
  sessionStorage.setItem(storageKey, 'not json');
  await act(async () => vm.load());
  expect(vm.table).toEqual(initial);
  expect(vm.notice).toContain('浏览器草稿暂不可用');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage full');
  });
  await edit();
  expect(vm.notice).toContain('浏览器草稿暂不可用');
  expect(vm.slots[0].body).toBe('draft');
});
