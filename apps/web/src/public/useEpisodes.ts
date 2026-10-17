import { useCallback, useEffect, useState } from 'react';
import type { PublicCategory } from '../shared/category';
import type { PublicEpisode } from '../shared/episode';
import { getCategories, getEpisodes } from './model';
import { usePublicData } from './PublicData';

export function useEpisodes() {
  const initial = usePublicData();
  const [episodes, setEpisodes] = useState<PublicEpisode[]>(initial?.episodes ?? []);
  const [categories, setCategories] = useState<PublicCategory[]>(initial?.categories ?? []);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!initial);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter explicitly restarts the request.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(!initial);
    setError('');
    Promise.all([getEpisodes(controller.signal), getCategories(controller.signal)])
      .then(([episodes, categories]) => {
        setEpisodes(episodes);
        setCategories(categories);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '暂时无法加载节目。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [attempt, initial]);
  return { episodes, categories, error, loading, retry };
}
