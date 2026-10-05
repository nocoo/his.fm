import type { PromptSet } from '@his-fm/contracts';
import { type Questions, type SystemOneRequest, TypeSafeClient } from '@typesafe-ai/sdk';
import { z } from 'zod';
import type { Config } from './config.ts';

export type DecisionRequest = (
  request: SystemOneRequest<Questions>,
) => Promise<{ answers: Record<string, unknown> }>;
export type DecisionInput = {
  prompts: Pick<PromptSet, 'decisionPlan' | 'decisionThinking'>;
  role: 'writer' | 'reviewer';
  revision: number;
  inputBytes: number;
  availableResident: boolean;
  availableTask?: boolean;
  taskType?: 'research' | 'translation' | 'outline' | 'draft' | 'revision' | 'review';
  complexity?: 'simple' | 'moderate' | 'complex';
  scope?: 'production' | 'general';
};
export type AssignmentPlan = {
  reuse: boolean;
  lifetime: 'resident' | 'task';
  thinkingLevel: 'low' | 'medium' | 'high';
};
export const requestBytes = (request: unknown) => Buffer.byteLength(JSON.stringify(request));

export function assertDecisionBudget(request: SystemOneRequest<Questions>, config: Config['decision']) {
  const count = Object.keys(request.questions).length;
  if (
    count < 2 ||
    count > Math.min(12, config.maxBatchQuestions) ||
    requestBytes(request) > Math.min(16384, config.maxInputBytes)
  )
    throw new Error('决策请求超出固定预算。');
}

function choose(raw: unknown, candidates: string[]) {
  const answer = z
    .object({
      type: z.literal('choice'),
      choice: z.string(),
      confidence: z.number().min(0).max(1),
      probabilities: z.record(z.string(), z.number().min(0).max(1)),
    })
    .parse(raw);
  if (
    !candidates.includes(answer.choice) ||
    Object.keys(answer.probabilities).length !== candidates.length ||
    candidates.some((candidate) => answer.probabilities[candidate] === undefined) ||
    Math.abs(Object.values(answer.probabilities).reduce((total, value) => total + value, 0) - 1) > 0.02
  )
    throw new Error('决策结果无效。');
  return answer.choice;
}

export function decisions(config: Config, request?: DecisionRequest) {
  const client = new TypeSafeClient({
    baseURL: config.decision.baseUrl,
    apiKey: config.decision.apiKey,
    defaultModel: config.decision.model,
    timeout: config.decision.timeoutMs,
    retry: { maxRetries: 0 },
    logLevel: 'off',
    fetch: (input, init) => {
      if (
        typeof init?.body !== 'string' ||
        Buffer.byteLength(init.body) > Math.min(16384, config.decision.maxInputBytes)
      )
        throw new Error('决策编码请求超出固定预算。');
      return fetch(input, { ...init, redirect: 'error' });
    },
  });
  const send = request ?? ((input) => client.systemOne(input));
  return async (input: DecisionInput): Promise<AssignmentPlan> => {
    const plans: Record<string, Pick<AssignmentPlan, 'reuse' | 'lifetime'>> = input.role === 'reviewer'
      ? {
          create_resident: { reuse: false, lifetime: 'resident' },
          create_task: { reuse: false, lifetime: 'task' },
          ...(input.availableResident
            ? { reuse_resident: { reuse: true, lifetime: 'resident' as const } }
            : {}),
        }
      : { create_task: { reuse: false, lifetime: 'task' } };
    if (input.availableTask) plans.reuse_task = { reuse: true, lifetime: 'task' };
    const levels = [...new Set(config.executor.thinkingLevels)];
    const payload: SystemOneRequest<Questions> = {
      model: config.decision.model,
      state: {
        role: input.role,
        revision: input.revision,
        inputBytes: input.inputBytes,
        availableResident: input.availableResident,
        availableTask: input.availableTask ?? false,
        taskType: input.taskType ?? (input.role === 'reviewer' ? 'review' : 'draft'),
        complexity: input.complexity ?? 'moderate',
        scope: input.scope ?? 'general',
      },
      questions: {
        plan: {
          type: 'choice',
          instructions: input.prompts.decisionPlan,
          criteria: Object.fromEntries(Object.keys(plans).map((key) => [key, key])),
        },
        thinking: {
          type: 'choice',
          instructions: input.prompts.decisionThinking,
          criteria: Object.fromEntries(levels.map((level) => [level, level])),
        },
      },
    };
    assertDecisionBudget(payload, config.decision);
    const response = await send(payload);
    const plan = plans[choose(response.answers.plan, Object.keys(plans))] as Pick<
      AssignmentPlan,
      'reuse' | 'lifetime'
    >;
    return {
      ...plan,
      thinkingLevel: choose(response.answers.thinking, levels) as AssignmentPlan['thinkingLevel'],
    };
  };
}
