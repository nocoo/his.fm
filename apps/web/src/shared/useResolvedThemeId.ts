import { useEffect, useSyncExternalStore } from 'react';
import { errorMessage } from '../admin/model';
import { useOptionalAppearance } from '../public/Appearance';
import {
  getAdminAppearanceThemeSnapshot,
  loadAdminAppearanceTheme,
  retryAdminAppearanceTheme,
  subscribeAdminAppearanceTheme,
} from './adminAppearanceTheme';
import type { ThemeId } from './appearance';
import { buildResolvedThemeState, type ResolvedThemeState } from './resolvedThemeState';

export { resolveThemeId } from './resolvedThemeState';

export type UseResolvedThemeIdResult = ResolvedThemeState & {
  retry: () => void;
};

export function useResolvedThemeId(override?: ThemeId): UseResolvedThemeIdResult {
  const appearance = useOptionalAppearance();
  const adminSnapshot = useSyncExternalStore(
    subscribeAdminAppearanceTheme,
    getAdminAppearanceThemeSnapshot,
    getAdminAppearanceThemeSnapshot,
  );

  useEffect(() => {
    if (appearance || override) return;
    loadAdminAppearanceTheme();
  }, [appearance, override]);

  const state = buildResolvedThemeState({
    override,
    appearanceId: appearance?.id,
    adminStatus: adminSnapshot.status,
    adminTheme: adminSnapshot.theme,
    adminErrorMessage: adminSnapshot.error ? errorMessage(adminSnapshot.error) : null,
  });

  return {
    ...state,
    retry: () => {
      if (override || appearance) return;
      retryAdminAppearanceTheme();
    },
  };
}
