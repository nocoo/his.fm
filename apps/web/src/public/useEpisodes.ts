import { useCallback, useEffect, useState } from 'react';
import type { PublicCategory } from '../shared/category';
import type { PublicEpisode } from '../shared/episode';
import { getCategories, getEpisodes } from './model';

export function useEpisodes() {
  const [episodes, setEpisodes] = useState<PublicEpisode[]>([]);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The retry counter intentionally restarts this cancellable request.
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
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
  }, [attempt]);
  return { episodes, categories, error, loading, retry };
}
