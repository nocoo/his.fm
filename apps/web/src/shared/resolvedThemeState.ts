import type { AdminAppearanceThemeStatus } from './adminAppearanceTheme';
import type { ThemeId } from './appearance';

const fallbackTheme: ThemeId = 'interval';

export type ResolvedThemeState = {
  themeId: ThemeId;
  loading: boolean;
  resolved: boolean;
  error: string | null;
};

export function resolveThemeId(
  appearanceId: ThemeId | undefined,
  adminTheme: ThemeId | null,
  override?: ThemeId,
): ThemeId {
  return override ?? appearanceId ?? adminTheme ?? fallbackTheme;
}

export function buildResolvedThemeState(input: {
  override?: ThemeId;
  appearanceId?: ThemeId;
  adminStatus: AdminAppearanceThemeStatus;
  adminTheme: ThemeId | null;
  adminErrorMessage: string | null;
}): ResolvedThemeState {
  if (input.override) {
    return {
      themeId: input.override,
      loading: false,
      resolved: true,
      error: null,
    };
  }
  if (input.appearanceId) {
    return {
      themeId: input.appearanceId,
      loading: false,
      resolved: true,
      error: null,
    };
  }
  if (input.adminStatus === 'ready' && input.adminTheme) {
    return {
      themeId: input.adminTheme,
      loading: false,
      resolved: true,
      error: null,
    };
  }
  if (input.adminStatus === 'loading' || input.adminStatus === 'idle') {
    return {
      themeId: fallbackTheme,
      loading: true,
      resolved: false,
      error: null,
    };
  }
  if (input.adminStatus === 'error') {
    return {
      themeId: fallbackTheme,
      loading: false,
      resolved: false,
      error: input.adminErrorMessage ?? '外观主题未能加载，请稍后重试。',
    };
  }
  return {
    themeId: fallbackTheme,
    loading: false,
    resolved: false,
    error: null,
  };
}
