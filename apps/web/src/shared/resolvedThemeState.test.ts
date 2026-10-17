import { describe, expect, it } from 'vitest';
import { buildResolvedThemeState, resolveThemeId } from './resolvedThemeState';

describe('resolveThemeId', () => {
  it('prefers explicit overrides, then public appearance, then admin fetch, then interval', () => {
    expect(resolveThemeId('grove', 'stillwood', 'interval')).toBe('interval');
    expect(resolveThemeId('grove', 'stillwood')).toBe('grove');
    expect(resolveThemeId(undefined, 'stillwood')).toBe('stillwood');
    expect(resolveThemeId(undefined, null)).toBe('interval');
  });
});

describe('buildResolvedThemeState', () => {
  it('resolves immediately for overrides and public appearance', () => {
    expect(
      buildResolvedThemeState({
        override: 'grove',
        adminStatus: 'idle',
        adminTheme: null,
        adminErrorMessage: null,
      }),
    ).toEqual({
      themeId: 'grove',
      loading: false,
      resolved: true,
      error: null,
    });
    expect(
      buildResolvedThemeState({
        appearanceId: 'stillwood',
        adminStatus: 'idle',
        adminTheme: null,
        adminErrorMessage: null,
      }),
    ).toEqual({
      themeId: 'stillwood',
      loading: false,
      resolved: true,
      error: null,
    });
  });

  it('waits for admin appearance before treating interval as resolved', () => {
    expect(
      buildResolvedThemeState({ adminStatus: 'idle', adminTheme: null, adminErrorMessage: null }),
    ).toEqual({
      themeId: 'interval',
      loading: true,
      resolved: false,
      error: null,
    });
    expect(
      buildResolvedThemeState({ adminStatus: 'loading', adminTheme: null, adminErrorMessage: null }),
    ).toEqual({
      themeId: 'interval',
      loading: true,
      resolved: false,
      error: null,
    });
    expect(
      buildResolvedThemeState({ adminStatus: 'ready', adminTheme: 'window-seat', adminErrorMessage: null }),
    ).toEqual({
      themeId: 'window-seat',
      loading: false,
      resolved: true,
      error: null,
    });
  });

  it('surfaces admin load failures without silently locking interval', () => {
    expect(
      buildResolvedThemeState({
        adminStatus: 'error',
        adminTheme: null,
        adminErrorMessage: '网络异常',
      }),
    ).toEqual({
      themeId: 'interval',
      loading: false,
      resolved: false,
      error: '网络异常',
    });
    expect(
      buildResolvedThemeState({
        adminStatus: 'error',
        adminTheme: null,
        adminErrorMessage: null,
      }),
    ).toMatchObject({
      error: '外观主题未能加载，请稍后重试。',
    });
    expect(
      buildResolvedThemeState({
        adminStatus: 'ready',
        adminTheme: null,
        adminErrorMessage: null,
      }),
    ).toEqual({
      themeId: 'interval',
      loading: false,
      resolved: false,
      error: null,
    });
  });
});
