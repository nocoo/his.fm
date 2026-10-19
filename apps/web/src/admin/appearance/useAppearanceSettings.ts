import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { publishAdminAppearanceTheme } from '../../shared/adminAppearanceTheme';
import { type Appearance, type ThemeId, themeIdSchema } from '../../shared/appearance';
import { errorMessage } from '../model';
import { useUnsavedChanges } from '../production/useUnsavedChanges';
import { ApiError } from '../service';
import { appearanceService } from './service';

export function useAppearanceSettings() {
  const [saved, setSaved] = useState<Appearance | null>(null);
  const [params, setParams] = useSearchParams();
  const requested = themeIdSchema.safeParse(params.get('theme'));
  const selected = requested.success ? requested.data : (saved?.theme ?? null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const dirty = Boolean(saved && saved.theme !== selected);
  useUnsavedChanges(dirty);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    setPending(true);
    try {
      const result = await appearanceService.read(signal);
      if (signal?.aborted) return;
      setSaved(result.appearance);
      publishAdminAppearanceTheme(result.appearance.theme);
      setConflict(false);
      return result.appearance;
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause));
    } finally {
      if (!signal?.aborted) setPending(false);
    }
  }, []);

  function setSelected(theme: ThemeId, replace = false) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('theme', theme);
        return next;
      },
      { replace },
    );
  }

  async function reload() {
    const appearance = await load();
    if (appearance) setSelected(appearance.theme, true);
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function save() {
    if (!saved || !selected || pending || !dirty || conflict) return;
    setPending(true);
    setError('');
    try {
      const result = await appearanceService.save({ theme: selected, version: saved.version });
      setSaved(result.appearance);
      publishAdminAppearanceTheme(result.appearance.theme);
    } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof ApiError && cause.status === 409) setConflict(true);
    } finally {
      setPending(false);
    }
  }

  return { saved, selected, setSelected, error, pending, conflict, dirty, load, reload, save };
}
