import { useCallback, useEffect, useRef, useState } from 'react';
import type { StorageCleanupResult, StorageObject } from '../../shared/storage';
import { getEnvironment } from '../environment';
import { errorMessage } from '../model';
import { useUnsavedChanges } from '../production/useUnsavedChanges';
import { storageService } from './service';

export function useStorage() {
  const [environment] = useState(getEnvironment);
  const [objects, setObjects] = useState<StorageObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cleaning, setCleaning] = useState(false);
  const [results, setResults] = useState<StorageCleanupResult['results']>([]);
  const controller = useRef<AbortController | null>(null);
  useUnsavedChanges(cleaning);

  const scan = useCallback(async () => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setLoading(true);
    setComplete(false);
    setError('');
    setSelected(new Set());
    setObjects([]);
    const scanned = new Map<string, StorageObject>();
    let cursor: string | null = null;
    try {
      do {
        const page = await storageService.scan(cursor, active.signal, environment);
        if (active.signal.aborted) return;
        for (const object of page.objects) scanned.set(object.key, object);
        setObjects([...scanned.values()]);
        if (page.cursor && page.cursor === cursor) throw new Error('扫描游标未推进，请重新扫描');
        cursor = page.cursor;
      } while (cursor);
      setComplete(true);
    } catch (cause) {
      if (!active.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (!active.signal.aborted) setLoading(false);
    }
  }, [environment]);

  useEffect(() => {
    void scan();
    return () => controller.current?.abort();
  }, [scan]);

  async function cleanup() {
    setCleaning(true);
    setError('');
    setResults([]);
    const items = objects.filter((object) => selected.has(object.key) && object.state === 'unused');
    const collected: StorageCleanupResult['results'] = [];
    try {
      for (let start = 0; start < items.length; start += 25) {
        const batch = await storageService.cleanup(
          items.slice(start, start + 25).map(({ key, version }) => ({ key, version })),
          environment,
        );
        collected.push(...batch.results);
        setResults([...collected]);
        const deleted = new Set(
          collected.filter((item) => item.status === 'deleted').map((item) => item.key),
        );
        setObjects((current) => current.filter((object) => !deleted.has(object.key)));
        setSelected((current) => new Set([...current].filter((key) => !deleted.has(key))));
      }
      await scan();
      return true;
    } catch (cause) {
      setComplete(false);
      setError(`${errorMessage(cause)}。已完成的批次保留；请重新扫描核对结果。`);
      return false;
    } finally {
      setCleaning(false);
    }
  }

  function toggle(key: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  return {
    objects,
    loading,
    complete,
    error,
    selected,
    cleaning,
    results,
    scan,
    cleanup,
    toggle,
    setSelected,
  };
}
