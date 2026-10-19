import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { errorMessage } from '../model';
import { appearanceService, type CoverPreviewSource } from './service';

export function useAppearancePreviews() {
  const [sources, setSources] = useState<CoverPreviewSource[]>([]);
  const [params, setParams] = useSearchParams();
  const requested = params.get('production');
  const selected = requested ?? sources[0]?.id ?? '';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const source = sources.find((item) => item.id === selected);

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

  return {
    sources,
    source,
    selected,
    setSelected: (id: string) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set('production', id);
        return next;
      }),
    loading,
    error:
      error ||
      (!loading && requested && !source ? '所选制作项目不存在，或尚未保存封面原图，请选择其他节目。' : ''),
    load,
  };
}
