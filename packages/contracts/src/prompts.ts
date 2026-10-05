import { z } from 'zod';

export const promptLabels = {
  coordinator: '主控协调',
  executor: '通用执行',
  reviewer: '独立审校',
  speech: '语音任务',
  voiceComparison: '音色对比风格',
  capabilities: '执行环境说明',
  network: '网络与代理',
  decisionPlan: '会话复用决策',
  decisionThinking: '思考强度决策',
  compaction: '上下文压缩',
  editorial: '创作优先级',
  boundary: '素材边界',
  brief: '选题与研究',
  script: '逐字稿',
  cover: '封面原图',
  description: '摘要与发布简介',
} as const;
export type PromptKey = keyof typeof promptLabels;
export const promptKeys = Object.keys(promptLabels) as PromptKey[];
export const promptLimit = (key: string) =>
  key === 'content'
    ? 30000
    : key === 'voiceComparison'
      ? 2000
      : key === 'decisionPlan' || key === 'decisionThinking'
        ? 1500
        : 12000;
export const promptSetSchema = z
  .record(z.enum(promptKeys), z.string().trim().min(1).max(12000))
  .superRefine((prompts, ctx) => {
    for (const key of promptKeys)
      if (prompts[key].length > promptLimit(key))
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${promptLabels[key]}最多 ${promptLimit(key)} 字`,
        });
  });
export type PromptSet = z.infer<typeof promptSetSchema>;
