import type { AssistantMessage, Models } from '@earendil-works/pi-ai';
import { estimateContextTokens } from '@earendil-works/pi-ai/utils/estimate';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import { DEFAULT_COMPACTION_POLICY } from '@earendil-works/pi-durable';

export const CONTEXT_BLOCKED = 'hisfm_context_compaction_required';
export const CONTEXT_FAILURE =
  '上下文压缩未完成，已暂停本次任务并保留完整历史；未继续请求模型，请修复压缩后再重试。';

export function contextModels(models: Models): Models {
  // Pi Durable uses completeSimple for summaries and streamSimple for task generation.
  const completeSimple: Models['completeSimple'] = (model, context, options) =>
    models.completeSimple(model, context, { ...options, reasoning: 'low' });
  const streamSimple: Models['streamSimple'] = (model, context, options) => {
    const tokens = estimateContextTokens(normalizeContext(context)).tokens;
    const reserve = Math.max(DEFAULT_COMPACTION_POLICY.reserveTokens, model.maxTokens + 4096);
    if (model.contextWindow > 0 && tokens > model.contextWindow - reserve) {
      const error: AssistantMessage = {
        role: 'assistant',
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: Date.now(),
        stopReason: 'error',
        errorMessage: CONTEXT_BLOCKED,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: 'error', reason: 'error', error });
      stream.end();
      return stream;
    }
    return models.streamSimple(model, context, options);
  };
  return new Proxy(models, {
    get(target, key) {
      if (key === 'completeSimple') return completeSimple;
      if (key === 'streamSimple') return streamSimple;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
