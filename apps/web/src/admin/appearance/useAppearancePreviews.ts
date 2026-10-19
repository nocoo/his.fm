import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../model';
import { appearanceService, type CoverPreviewSource } from './service';

export function useAppearancePreviews() {
  const [sources, setSources] = useState<CoverPreviewSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    setSources([]);
    try {
      const items = await appearanceService.coverSources(signal);
      if (signal?.aborted) return;
      setSources(items);
    } catch (cause) {
      if (!signal?.aborted) setError(errorMessage(cause));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { sources, loading, error, load };
}
