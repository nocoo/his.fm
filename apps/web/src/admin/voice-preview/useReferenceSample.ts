import { useEffect, useReducer, useState } from 'react';

type ReferenceSample = {
  status: 'loading' | 'available' | 'missing' | 'error';
  playbackUrl: string;
};

export function useReferenceSample(url: string) {
  const [attempt, retry] = useReducer((value: number) => value + 1, 0);
  const [sample, setSample] = useState<ReferenceSample>({ status: 'loading', playbackUrl: url });
  // biome-ignore lint/correctness/useExhaustiveDependencies: Retrying must recheck the same URL.
  useEffect(() => {
    let cancelled = false;
    setSample({ status: 'loading', playbackUrl: url });
    void fetch(url, { method: 'HEAD', mode: 'cors' })
      .then((response) => {
        if (cancelled) return;
        const token = response.headers.get('ETag')?.replace(/^"|"$/g, '').trim();
        setSample({
          status: response.ok ? 'available' : response.status === 404 ? 'missing' : 'error',
          playbackUrl:
            response.ok && token
              ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(token)}`
              : url,
        });
      })
      .catch(() => {
        if (!cancelled) setSample({ status: 'error', playbackUrl: url });
      });
    return () => {
      cancelled = true;
    };
  }, [url, attempt]);
  return { ...sample, retry };
}
