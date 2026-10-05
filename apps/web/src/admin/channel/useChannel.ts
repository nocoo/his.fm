import { type PromptKey, promptLimit } from '@his-fm/contracts';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import type { ChannelProfile } from '../../shared/channel';
import { getEnvironment } from '../environment';
import { errorMessage } from '../model';
import { productionService } from '../production/service';
import { useUnsavedChanges } from '../production/useUnsavedChanges';
import { ApiError } from '../service';

const draftSchema = z.object({ version: z.number().int().positive(), content: z.string() });
type Key = 'content' | PromptKey;
const readContent = (channel: ChannelProfile, key: Key) =>
  key === 'content' ? channel.content : channel.prompts[key];

export function useChannel(key: Key = 'content', active = true) {
  const [channel, setChannel] = useState<ChannelProfile | null>(null);
  const [content, setContent] = useState('');
  const [version, setVersion] = useState(1);
  const [conflict, setConflict] = useState<ChannelProfile | null>(null);
  const [error, setError] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const storageKey = `hisfm-channel-draft:${getEnvironment()}${key === 'content' ? '' : `:${key}`}`;
  const dirty = Boolean(channel && content !== readContent(channel, key));
  useUnsavedChanges(dirty);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setError('');
      try {
        const result = await productionService.channel(signal);
        if (signal?.aborted) return;
        setChannel(result.channel);
        setContent(readContent(result.channel, key));
        setVersion(result.channel.version);
        try {
          const saved = sessionStorage.getItem(storageKey);
          const draft = saved ? draftSchema.safeParse(JSON.parse(saved)) : null;
          if (draft?.success && draft.data.content !== readContent(result.channel, key)) {
            setContent(draft.data.content);
            setVersion(draft.data.version);
            setDraftNotice('已恢复此标签页中未保存的草稿。');
            if (draft.data.version !== result.channel.version) setConflict(result.channel);
          }
        } catch {
          setDraftNotice('浏览器草稿暂时不可用，请及时保存到工作室。');
        }
      } catch (cause) {
        if (!signal?.aborted) setError(errorMessage(cause));
      }
    },
    [storageKey, key],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    if (!channel) return;
    try {
      if (dirty) sessionStorage.setItem(storageKey, JSON.stringify({ content, version }));
      else sessionStorage.removeItem(storageKey);
    } catch {
      setDraftNotice('浏览器草稿暂时不可用，请及时保存到工作室。');
    }
  }, [channel, dirty, content, version, storageKey]);
  const save = useCallback(
    async (expectedVersion = version) => {
      if (pending || !dirty || !content.trim() || content.length > promptLimit(key)) return;
      setPending(true);
      setError('');
      try {
        const latest = (await productionService.channel()).channel;
        if (
          latest.version !== expectedVersion &&
          (!channel || readContent(latest, key) !== readContent(channel, key))
        ) {
          setConflict(latest);
          setError('提示词已在别处更新。你的草稿已保留，请对照最新版本后保存。');
          return;
        }
        const result = await productionService.saveChannel({
          version: latest.version,
          ...(key === 'content' ? { content } : { prompts: { ...latest.prompts, [key]: content } }),
        });
        setChannel(result.channel);
        setVersion(result.channel.version);
        setContent((current) => (current === content ? readContent(result.channel, key) : current));
        setConflict(null);
        setDraftNotice('');
      } catch (cause) {
        setError(errorMessage(cause));
        if (cause instanceof ApiError && cause.status === 409) {
          try {
            setConflict((await productionService.channel()).channel);
          } catch {}
        }
      } finally {
        setPending(false);
      }
    },
    [version, pending, dirty, content, key, channel],
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
  }, [save, conflict, active]);
  function replaceWithSaved(value: ChannelProfile) {
    setChannel(value);
    setVersion(value.version);
    setContent(readContent(value, key));
    setConflict(null);
    setError('');
    setDraftNotice('');
    setResetKey((key) => key + 1);
  }
  return {
    channel,
    content,
    setContent,
    version,
    conflict,
    conflictContent: conflict ? readContent(conflict, key) : '',
    error,
    draftNotice,
    pending,
    dirty,
    resetKey,
    load,
    save,
    replaceWithSaved,
  };
}
