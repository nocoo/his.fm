import { toast } from '@nocoo/basalt';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Production } from '../../shared/production';
import { errorMessage } from '../model';
import { ApiError } from '../service';
import { productionService } from './service';

export function useProduction(id: string) {
  const [production, setProduction] = useState<Production | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const mutating = useRef(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const result = await productionService.get(id, signal);
        if (!signal?.aborted)
          setProduction((current) =>
            !current || result.production.version >= current.version ? result.production : current,
          );
        setError('');
        setConflict(false);
        return true;
      } catch (cause) {
        if (!signal?.aborted) setError(errorMessage(cause));
        return false;
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [id],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function mutate(operation: () => Promise<{ production: Production }>, message: string) {
    if (mutating.current) return false;
    mutating.current = true;
    setPending(true);
    setError('');
    try {
      const result = await operation();
      setProduction((current) =>
        !current || result.production.version >= current.version ? result.production : current,
      );
      setConflict(false);
      toast.success(message);
      return true;
    } catch (cause) {
      setError(errorMessage(cause));
      setConflict(cause instanceof ApiError && cause.status === 409);
      return false;
    } finally {
      mutating.current = false;
      setPending(false);
    }
  }
  return { production, loading, pending, error, conflict, reload: load, mutate };
}
