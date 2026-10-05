import { useCallback, useEffect, useState } from 'react';
import type { PublicCategory } from '../../shared/category';
import { errorMessage } from '../model';
import { categoryService } from './service';

export function useCategories() {
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    setError('');
    setLoading(true);
    try {
      const result = await categoryService.list(signal);
      if (!signal?.aborted) setCategories(result.categories);
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
  return { categories, error, loading, load };
}
