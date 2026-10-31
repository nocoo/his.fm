import { type PromptSlotInput, type PromptSlotTable, promptSlotReplaceSchema } from '@his-fm/contracts';
import { useCallback, useEffect, useState } from 'react';
import { getEnvironment } from '../environment';
import { errorMessage } from '../model';
import { useUnsavedChanges } from '../production/useUnsavedChanges';
import { ApiError } from '../service';
import { promptSlotsDraftSchema, slotInputs } from './model';
import { promptSlotsService } from './service';

export function usePromptSlots(categoryId: string | null, active: boolean) {
  const [table, setTable] = useState<PromptSlotTable | null>(null);
  const [slots, setSlots] = useState<PromptSlotInput[]>([]);
  const [version, setVersion] = useState(0);
  const [conflict, setConflict] = useState<PromptSlotTable | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const storageKey = `hisfm-prompt-slots-draft:${getEnvironment()}:${categoryId === null ? 'channel' : `category:${categoryId}`}`;
  const dirty = Boolean(table && JSON.stringify(slots) !== JSON.stringify(slotInputs(table)));
  const valid = promptSlotReplaceSchema.safeParse({ version, slots });
  useUnsavedChanges(dirty);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError('');
      try {
        const result = await promptSlotsService.get(categoryId, signal);
        if (signal?.aborted) return;
        setTable(result);
        setSlots(slotInputs(result));
        setVersion(result.version);
        setConflict(null);
        setNotice('');
        try {
          const text = sessionStorage.getItem(storageKey);
          const draft = text ? promptSlotsDraftSchema.safeParse(JSON.parse(text)) : null;
          if (draft?.success && JSON.stringify(draft.data.slots) !== JSON.stringify(slotInputs(result))) {
            setSlots(draft.data.slots);
            setVersion(draft.data.version);
            setNotice('已恢复此标签页中未保存的草稿。');
            if (draft.data.version !== result.version) setConflict(result);
          }
        } catch {
          setNotice('浏览器草稿暂不可用，请及时保存。');
        }
      } catch (cause) {
        if (!signal?.aborted) setError(errorMessage(cause));
      }
    },
    [categoryId, storageKey],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!table) return;
    try {
      if (dirty) sessionStorage.setItem(storageKey, JSON.stringify({ version, slots }));
      else sessionStorage.removeItem(storageKey);
    } catch {
      setNotice('浏览器草稿暂不可用，请及时保存。');
    }
  }, [table, dirty, version, slots, storageKey]);

  function replace(value: PromptSlotTable) {
    setTable(value);
    setSlots(slotInputs(value));
    setVersion(value.version);
    setConflict(null);
    setError('');
    setNotice('');
    setResetKey((key) => key + 1);
  }

  const save = useCallback(
    async (expectedVersion = version) => {
      const parsed = promptSlotReplaceSchema.safeParse({ version: expectedVersion, slots });
      if (pending || !table || !dirty || !parsed.success) return false;
      setPending(true);
      setError('');
      try {
        const latest = await promptSlotsService.get(categoryId);
        if (latest.version !== expectedVersion) {
          setConflict(latest);
          setError('提示词槽位已在别处更新，全部草稿已保留。请对照最新集合后再保存。');
          return false;
        }
        const result = await promptSlotsService.save(categoryId, latest.version, parsed.data.slots);
        setTable(result);
        setSlots((current) =>
          JSON.stringify(current) === JSON.stringify(slots) ? slotInputs(result) : current,
        );
        setVersion(result.version);
        setConflict(null);
        setNotice('');
        return true;
      } catch (cause) {
        setError(errorMessage(cause));
        if (cause instanceof ApiError && cause.status === 409) {
          try {
            setConflict(await promptSlotsService.get(categoryId));
          } catch {}
        }
        return false;
      } finally {
        setPending(false);
      }
    },
    [categoryId, version, slots, pending, table, dirty],
  );

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        active &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 's' &&
        !event.isComposing
      ) {
        event.preventDefault();
        if (!conflict) void save();
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [active, conflict, save]);

  return {
    table,
    slots,
    setSlots,
    conflict,
    error,
    notice,
    pending,
    dirty,
    valid: valid.success,
    validationError: valid.success
      ? ''
      : '请检查槽位标题、内容长度和技能名称（skills 只能逐行填写技能名）；最多 64 个槽位、总计 400,000 字。',
    resetKey,
    load,
    save,
    replace,
  };
}
