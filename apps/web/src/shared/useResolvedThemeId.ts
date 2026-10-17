import { useEffect, useState } from 'react';
import { appearanceService } from '../admin/appearance/service';
import { useOptionalAppearance } from '../public/Appearance';
import type { ThemeId } from './appearance';

const fallbackTheme: ThemeId = 'interval';

export function resolveThemeId(
  appearanceId: ThemeId | undefined,
  adminTheme: ThemeId | null,
  override?: ThemeId,
): ThemeId {
  return override ?? appearanceId ?? adminTheme ?? fallbackTheme;
}

export function useResolvedThemeId(override?: ThemeId): ThemeId {
  const appearance = useOptionalAppearance();
  const [adminTheme, setAdminTheme] = useState<ThemeId | null>(null);

  useEffect(() => {
    if (appearance) return;
    const controller = new AbortController();
    appearanceService
      .read(controller.signal)
      .then(({ appearance: value }) => {
        if (!controller.signal.aborted) setAdminTheme(value.theme);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAdminTheme(fallbackTheme);
      });
    return () => controller.abort();
  }, [appearance]);

  return resolveThemeId(appearance?.id, adminTheme, override);
}
