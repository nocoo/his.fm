import type { AssistantMessage, Models } from '@earendil-works/pi-ai';
import { estimateContextTokens } from '@earendil-works/pi-ai/utils/estimate';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import { DEFAULT_COMPACTION_POLICY } from '@earendil-works/pi-durable';

export const CONTEXT_BLOCKED = 'hisfm_context_compaction_required';
export const CONTEXT_FAILURE =
  '上下文压缩未完成，已暂停本次任务并保留完整历史；未继续请求模型，请修复压缩后再重试。';

export function contextModels(models: Models, summaryPrompt: () => Promise<string>): Models {
  // Pi Durable uses completeSimple for summaries and streamSimple for task generation.
  const completeSimple: Models['completeSimple'] = async (model, context, options) => {
    const source = context.messages.find((message) => message.role === 'user')?.content;
    const text = typeof source === 'string' ? source : source?.find((part) => part.type === 'text')?.text;
    const end = text?.lastIndexOf('\n</conversation>') ?? -1;
    if (end < 0) throw new Error('压缩输入格式不匹配，已保留原始会话。');
    const focus = text?.indexOf('\n\nAdditional focus:', end) ?? -1;
    return models.completeSimple(
      model,
      {
        messages: [
          { role: 'system', content: await summaryPrompt(), timestamp: Date.now() },
          {
            role: 'user',
            content: `${text?.slice(0, end + '\n</conversation>'.length)}${focus < 0 ? '' : text?.slice(focus)}`,
            timestamp: Date.now(),
          },
        ],
      },
      { ...options, reasoning: 'low' },
    );
  };
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
