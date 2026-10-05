import type { PromptSet } from '@his-fm/contracts';

export const executorTools = ['read', 'write', 'edit', 'bash', 'submit_result'];
export function workPolicy(prompts: PromptSet, role: string) {
  return role === 'speech'
    ? prompts.speech
    : [prompts.executor, role === 'reviewer' ? prompts.reviewer : '', prompts.editorial, prompts.boundary]
        .filter(Boolean)
        .join('\n');
}
