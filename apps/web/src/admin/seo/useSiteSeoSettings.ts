import { useCallback, useEffect, useState } from 'react';
import type { SiteSeo, SiteSeoRecord } from '../../shared/seo';
import { errorMessage } from '../model';
import { useUnsavedChanges } from '../production/useUnsavedChanges';
import { ApiError } from '../service';
import { siteSeoService } from './service';

export function useSiteSeoSettings() {
  const [saved, setSaved] = useState<SiteSeoRecord | null>(null);
  const [value, setValue] = useState<SiteSeo | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const dirty = Boolean(
    saved &&
      value &&
      JSON.stringify((({ version: _v, updatedAt: _a, updatedBy: _b, ...data }) => data)(saved)) !==
        JSON.stringify(value),
  );
  useUnsavedChanges(dirty);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    setPending(true);
    try {
      const result = await siteSeoService.read(signal);
      if (signal?.aborted) return;
      setSaved(result.seo);
      const { version: _version, updatedAt: _updatedAt, updatedBy: _updatedBy, ...data } = result.seo;
      setValue(data);
      setConflict(false);
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause));
    } finally {
      if (!signal?.aborted) setPending(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function save() {
    if (!saved || !value || pending || !dirty || conflict) return;
    setPending(true);
    setError('');
    try {
      const result = await siteSeoService.save({ ...value, version: saved.version });
      setSaved(result.seo);
      const { version: _version, updatedAt: _updatedAt, updatedBy: _updatedBy, ...data } = result.seo;
      setValue(data);
    } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof ApiError && cause.status === 409) setConflict(true);
    } finally {
      setPending(false);
    }
  }

  return { saved, value, setValue, error, pending, conflict, dirty, load, save };
}
