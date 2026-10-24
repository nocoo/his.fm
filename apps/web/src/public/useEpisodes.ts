import { useCallback, useEffect, useState } from 'react';
import type { PublicCategory } from '../shared/category';
import type { PublicEpisode, PublicEpisodeSummary } from '../shared/episode';
import { getCategories, getEpisodeDetail, getEpisodes } from './model';
import { usePublicData } from './PublicData';

export function useEpisodes() {
  const initial = usePublicData();
  const [episodes, setEpisodes] = useState<PublicEpisodeSummary[]>(initial?.episodes ?? []);
  const [categories, setCategories] = useState<PublicCategory[]>(initial?.categories ?? []);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!initial);
  const [hasData, setHasData] = useState(Boolean(initial));
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
        setHasData(true);
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
  return { episodes, categories, error, loading, hasData, retry };
}

function matchesRoute(
  episode: PublicEpisode | undefined,
  category: string | undefined,
  slug: string | undefined,
) {
  if (!episode || !slug) return false;
  return category ? episode.category === category && episode.slug === slug : episode.slug === slug;
}

/**
 * Episode bodies and mention lists are not part of the catalogue payload, so the detail page uses
 * the server-rendered episode when the request already carried it and fetches it otherwise.
 */
export function useEpisodeDetail(category: string | undefined, slug: string | undefined) {
  const initial = usePublicData()?.episode;
  const fromServer = matchesRoute(initial, category, slug) ? initial : undefined;
  const [episode, setEpisode] = useState<PublicEpisode | null>(fromServer ?? null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!fromServer);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Route parameters and the retry counter restart the request.
  useEffect(() => {
    if (matchesRoute(initial, category, slug)) {
      setEpisode(initial ?? null);
      setError('');
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setEpisode(null);
    setError('');
    setLoading(true);
    getEpisodeDetail(category, slug, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setEpisode(value);
        setLoading(false);
        if (!value) setError('');
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : '这期节目暂时无法加载。');
        setLoading(false);
      });
    return () => controller.abort();
  }, [initial, category, slug, attempt]);
  return { episode, error, loading, retry };
}
