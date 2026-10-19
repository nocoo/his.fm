import { useCallback, useEffect, useRef, useState } from 'react';
import { type ThemeId, themeIds } from '../../shared/appearance';
import { errorMessage } from '../model';
import { downloadCover } from '../service';
import { appearanceService, type CoverPreviewSource } from './service';

export type CoverPreview =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error'; message: string };

export function useAppearancePreviews() {
  const [sources, setSources] = useState<CoverPreviewSource[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState<{
    source: CoverPreviewSource;
    covers: Partial<Record<ThemeId, CoverPreview>>;
  } | null>(null);
  const queue = useRef(Promise.resolve());
  const source = sources.find((item) => item.id === selected);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    setSources([]);
    try {
      const items = await appearanceService.coverSources(signal);
      if (signal?.aborted) return;
      setSources(items);
      setSelected((current) => (items.some((item) => item.id === current) ? current : (items[0]?.id ?? '')));
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

  useEffect(() => {
    if (!source) return;
    let active = true;
    const urls: string[] = [];
    const update = (theme: ThemeId, preview: CoverPreview) => {
      setGeneration((current) => ({
        source,
        covers: { ...(current?.source === source ? current.covers : {}), [theme]: preview },
      }));
    };
    // The renderer accepts one job per isolate, even when the user switches programmes.
    queue.current = queue.current.then(async () => {
      for (const theme of themeIds) {
        if (!active) return;
        update(theme, { status: 'loading' });
        try {
          const image = await downloadCover('productions', source.id, source.version, theme);
          if (!active) return;
          const url = URL.createObjectURL(image);
          urls.push(url);
          update(theme, { status: 'ready', url });
        } catch (cause) {
          if (!active) return;
          update(theme, { status: 'error', message: errorMessage(cause) });
        }
      }
    });
    return () => {
      active = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [source]);

  return {
    sources,
    source,
    selected,
    setSelected,
    previews: generation?.source === source ? generation?.covers : undefined,
    loading,
    error,
    load,
  };
}
