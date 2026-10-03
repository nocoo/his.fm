import { useCallback, useEffect, useState } from 'react';
import type { Episode } from '../shared/episode';
import { getEpisodes } from './model';

export function useEpisodes() {
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter intentionally restarts this cancellable request.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    getEpisodes(controller.signal)
      .then(setEpisodes)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '暂时无法加载节目。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt]);
  return { episodes, error, loading, retry };
}
