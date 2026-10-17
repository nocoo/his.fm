import { useEffect, useState } from 'react';

export function useReferenceSample(url: string) {
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setAvailable(false);
    void fetch(url, { method: 'HEAD', mode: 'cors' })
      .then((response) => {
        if (!cancelled) {
          setAvailable(response.ok);
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailable(false);
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return { ready, available };
}
