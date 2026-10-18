import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { type Category, type CategoryInput, categoryInputSchema } from '../../shared/category';
import { getEnvironment } from '../environment';
import { errorMessage } from '../model';
import { useUnsavedChanges } from '../production/useUnsavedChanges';
import { ApiError } from '../service';
import { categoryService } from './service';

type CategoryMetadata = Omit<CategoryInput, 'prompt'>;
const metadataSchema = categoryInputSchema.omit({ prompt: true });
const empty: CategoryMetadata = { name: '', icon: 'mic', color: 'blue', seo: {} };
const draftSchema = z.object({
  value: metadataSchema.extend({ name: z.string() }),
  nextId: z.string().optional(),
  version: z.number().int().positive().optional(),
});
export function useCategory(id: string) {
  const [saved, setSaved] = useState<Category | null>(null);
  const [value, setValue] = useState<CategoryMetadata>(empty);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(id !== 'new');
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState<Category | null>(null);
  const [version, setVersion] = useState<number | undefined>();
  const [nextId, setNextId] = useState('');
  const storageKey = `hisfm-category-draft:${getEnvironment()}:${id}`;
  const [ready, setReady] = useState(false);
  const dirty =
    JSON.stringify(value) !==
      JSON.stringify(
        saved
          ? {
              name: saved.name,
              icon: saved.icon,
              color: saved.color,
              seo: saved.seo,
            }
          : empty,
      ) ||
    (id !== 'new' && saved !== null && nextId.trim() !== saved.id);
  useUnsavedChanges(dirty);
  const replace = (category: Category) => {
    setSaved(category);
    setVersion(category.version);
    setValue({
      name: category.name,
      icon: category.icon,
      color: category.color,
      seo: category.seo,
    });
    setNextId(category.id);
    setConflict(null);
    setError('');
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
                  seo: result.category.seo,
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
    const parsed = metadataSchema.safeParse(value);
    if (pending || !parsed.success) return null;
    setPending(true);
    setError('');
    try {
      const result = await categoryService.save(
        parsed.data,
        id === 'new' ? undefined : id,
        expectedVersion,
        id === 'new' ? undefined : nextId.trim(),
      );
      setSaved(result.category);
      setVersion(result.category.version);
      setNextId(result.category.id);
      setValue(parsed.data);
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
    save,
    replace,
    load,
  };
}
