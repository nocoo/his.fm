import { useEffect, useState } from 'react';

function etagToken(etag: string | null) {
  if (!etag) return null;
  const token = etag.replace(/^"|"$/g, '').trim();
  return token || null;
}

export function useReferenceSample(url: string) {
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false);
  const [cacheVersion, setCacheVersion] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setAvailable(false);
    setCacheVersion(null);
    void fetch(url, { method: 'HEAD', mode: 'cors' })
      .then((response) => {
        if (!cancelled) {
          setAvailable(response.ok);
          setCacheVersion(etagToken(response.headers.get('ETag')));
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailable(false);
          setCacheVersion(null);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  const playbackUrl =
    cacheVersion && available
      ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(cacheVersion)}`
      : url;
  return { ready, available, playbackUrl };
}
