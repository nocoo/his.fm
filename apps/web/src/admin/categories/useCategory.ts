import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { type Category, type CategoryInput, categoryInputSchema } from '../../shared/category';
import { getEnvironment } from '../environment';
import { errorMessage } from '../model';
import { useUnsavedChanges } from '../production/useUnsavedChanges';
import { ApiError } from '../service';
import { categoryService } from './service';

const empty: CategoryInput = { name: '', icon: 'mic', color: 'blue', prompt: '' };
const draftSchema = z.object({
  value: categoryInputSchema.extend({ name: z.string(), prompt: z.string() }),
  nextId: z.string().optional(),
  version: z.number().int().positive().optional(),
});
export function useCategory(id: string, promptOnly = false) {
  const [saved, setSaved] = useState<Category | null>(null);
  const [value, setValue] = useState<CategoryInput>(empty);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(id !== 'new');
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState<Category | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [version, setVersion] = useState<number | undefined>();
  const [nextId, setNextId] = useState('');
  const storageKey = `hisfm-category-draft:${getEnvironment()}:${id}${promptOnly ? ':prompt' : ''}`;
  const [ready, setReady] = useState(false);
  const dirty =
    JSON.stringify(value) !==
      JSON.stringify(
        saved ? { name: saved.name, icon: saved.icon, color: saved.color, prompt: saved.prompt } : empty,
      ) ||
    (id !== 'new' && saved !== null && nextId.trim() !== saved.id);
  useUnsavedChanges(dirty);
  const replace = (category: Category) => {
    setSaved(category);
    setVersion(category.version);
    setValue({ name: category.name, icon: category.icon, color: category.color, prompt: category.prompt });
    setNextId(category.id);
    setConflict(null);
    setError('');
    setResetKey((key) => key + 1);
  };
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError('');
      try {
        const result = id === 'new' ? null : await categoryService.get(id, signal);
        if (!signal?.aborted) {
          setSaved(result?.category ?? null);
          setVersion(result?.category.version);
          setNextId(result?.category.id ?? '');
          setValue(
            result
              ? {
                  name: result.category.name,
                  icon: result.category.icon,
                  color: result.category.color,
                  prompt: result.category.prompt,
                }
              : empty,
          );
          try {
            const text = sessionStorage.getItem(storageKey);
            if (text) {
              const draft = draftSchema.safeParse(JSON.parse(text));
              if (draft.success) {
                setValue(draft.data.value);
                setNextId(draft.data.nextId ?? result?.category.id ?? '');
                setVersion(draft.data.version);
                if (result && draft.data.version !== result.category.version) setConflict(result.category);
              }
            }
          } catch {
            setError('浏览器草稿暂不可用，请及时保存。');
          }
          setReady(true);
        }
      } catch (cause) {
        if (!signal?.aborted) setError(errorMessage(cause));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [id, storageKey],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (!ready) return;
    try {
      if (dirty) sessionStorage.setItem(storageKey, JSON.stringify({ value, nextId, version }));
      else sessionStorage.removeItem(storageKey);
    } catch {
      setError('浏览器草稿暂不可用，请及时保存。');
    }
  }, [value, nextId, version, ready, dirty, storageKey]);
  async function save(expectedVersion = version) {
    const parsed = categoryInputSchema.safeParse(value);
    if (pending || !parsed.success) return null;
    setPending(true);
    setError('');
    try {
      const latest = id === 'new' ? null : (await categoryService.get(id)).category;
      const value = latest
        ? promptOnly
          ? { name: latest.name, icon: latest.icon, color: latest.color, prompt: parsed.data.prompt }
          : { ...parsed.data, prompt: latest.prompt }
        : parsed.data;
      const result = await categoryService.save(
        value,
        id === 'new' ? undefined : id,
        expectedVersion,
        id === 'new' ? undefined : nextId.trim(),
      );
      setSaved(result.category);
      setVersion(result.category.version);
      setNextId(result.category.id);
      setValue(value);
      setConflict(null);
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        setError('栏目已保存，但浏览器草稿清理失败。');
      }
      return result.category;
    } catch (cause) {
      setError(errorMessage(cause));
      if (cause instanceof ApiError && cause.status === 409) {
        try {
          setConflict((await categoryService.get(id)).category);
        } catch {}
      }
      return null;
    } finally {
      setPending(false);
    }
  }
  return {
    saved,
    value,
    setValue,
    nextId,
    setNextId,
    error,
    loading,
    pending,
    conflict,
    dirty,
    resetKey,
    save,
    replace,
    load,
  };
}
