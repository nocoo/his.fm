import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAdminAppearanceThemeSnapshot,
  loadAdminAppearanceTheme,
  resetAdminAppearanceThemeForTests,
  retryAdminAppearanceTheme,
} from './adminAppearanceTheme';

const read = vi.fn();

vi.mock('../admin/appearance/service', () => ({
  appearanceService: {
    read: (...args: unknown[]) => read(...args),
  },
}));

describe('adminAppearanceTheme', () => {
  beforeEach(() => {
    resetAdminAppearanceThemeForTests();
    read.mockReset();
  });

  afterEach(() => {
    resetAdminAppearanceThemeForTests();
  });

  it('fetches appearance once and shares the resolved theme', async () => {
    read.mockResolvedValue({ appearance: { theme: 'grove' } });
    loadAdminAppearanceTheme();
    loadAdminAppearanceTheme();
    await vi.waitUntil(() => getAdminAppearanceThemeSnapshot().status === 'ready');
    expect(read).toHaveBeenCalledTimes(1);
    expect(getAdminAppearanceThemeSnapshot().theme).toBe('grove');
  });

  it('records errors and retries with a fresh fetch', async () => {
    read
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ appearance: { theme: 'stillwood' } });
    loadAdminAppearanceTheme();
    await vi.waitUntil(() => getAdminAppearanceThemeSnapshot().status === 'error');
    retryAdminAppearanceTheme();
    await vi.waitUntil(() => getAdminAppearanceThemeSnapshot().status === 'ready');
    expect(read).toHaveBeenCalledTimes(2);
    expect(getAdminAppearanceThemeSnapshot().theme).toBe('stillwood');
  });
});
