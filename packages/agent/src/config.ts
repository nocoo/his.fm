import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { Model } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { speechSettingsSchema } from '@his-fm/contracts';
import { z } from 'zod';

export const environmentSchema = z.enum(['local', 'production']);
export type Environment = z.infer<typeof environmentSchema>;
const endpoint = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    );
  });
const role = {
  provider: z.literal('raven'),
  contextWindow: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
};
export const configSchema = z.strictObject({
  schemaVersion: z.literal(1),
  configRevision: z.string().length(64),
  speech: speechSettingsSchema,
  speechKeys: z.strictObject({ gemini: z.string().max(500), elevenlabs: z.string().max(500) }),
  providers: z.strictObject({
    raven: z.strictObject({
      api: z.literal('openai-completions'),
      baseUrl: endpoint,
      apiKey: z.string().min(1),
    }),
  }),
  coordinator: z.strictObject({ ...role, model: z.literal('gpt-6-astra'), thinkingLevel: z.literal('high') }),
  executor: z.strictObject({
    ...role,
    model: z.literal('gpt-6.1-sol'),
    thinkingLevels: z.array(z.enum(['low', 'medium', 'high'])).min(1),
  }),
  decision: z.strictObject({
    baseUrl: endpoint,
    apiKey: z.string().min(1),
    model: z.literal('jev-latest'),
    maxInputBytes: z.number().int().positive().max(16384),
    maxBatchQuestions: z.number().int().min(2).max(12),
    timeoutMs: z.number().int().positive().max(35000),
  }),
  websites: z.strictObject({
    local: z.strictObject({ baseUrl: endpoint, token: z.string(), stationId: z.string().min(1).max(160) }),
    production: z.strictObject({
      baseUrl: endpoint,
      token: z.string(),
      stationId: z.string().min(1).max(160),
    }),
  }),
  runtime: z.strictObject({
    maxConcurrentAssignments: z.number().int().min(1).max(20),
    maxRevisionRounds: z.number().int().min(1).max(20),
    maxTaskMinutes: z.number().positive().max(120),
    workspaceRoot: z.string().refine(isAbsolute),
  }),
});
export type Config = z.infer<typeof configSchema>;

export async function loadConfig(path = join(homedir(), '.config/his.fm/config.json')): Promise<Config> {
  try {
    return configSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    throw new Error('本机配置无效或无法读取，请检查配置字段；密钥未输出。');
  }
}

export function website(config: Config, environment: Environment) {
  const site = config.websites[environment];
  const url = new URL(site.baseUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (environment === 'local' && !local) ||
    (environment === 'production' && (local || url.protocol !== 'https:'))
  )
    throw new Error('网站环境与地址不匹配。');
  if (!site.token) throw new Error('当前网站尚未配置主控令牌。');
  return site;
}

export function configuredModels(config: Config) {
  const models = createModels();
  const provider = config.providers.raven;
  const entries: Model<'openai-completions'>[] = [config.coordinator, config.executor].map((selection) => ({
    id: selection.model,
    name: selection.model,
    provider: selection.provider,
    api: provider.api,
    baseUrl: provider.baseUrl,
    reasoning: true,
    input: ['text'],
    contextWindow: selection.contextWindow,
    maxTokens: selection.maxTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }));
  models.setProvider(
    createProvider({
      id: 'raven',
      baseUrl: provider.baseUrl,
      models: entries,
      api: openAICompletionsApi(),
      auth: { apiKey: { name: 'raven', resolve: async () => ({ auth: { apiKey: provider.apiKey } }) } },
    }),
  );
  return models;
}
