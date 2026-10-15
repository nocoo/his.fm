import { expect, it } from 'vitest';
import { type PromptSet, promptKeys, promptLimit, promptSetSchema } from './prompts.ts';

const defaultPrompts = Object.fromEntries(promptKeys.map((key) => [key, '外部创作要求'])) as PromptSet;

it('validates the complete Chinese prompt catalogue and rejects missing, unknown or oversized instructions', () => {
  expect(promptSetSchema.parse(defaultPrompts)).toEqual(defaultPrompts);
  for (const key of promptKeys) expect(defaultPrompts[key]).toMatch(/[\u4e00-\u9fff]/);
  expect(promptLimit('content')).toBe(30000);
  for (const key of promptKeys) {
    const missing = { ...defaultPrompts } as Partial<typeof defaultPrompts>;
    delete missing[key];
    expect(promptSetSchema.safeParse(missing).success).toBe(false);
    expect(promptSetSchema.safeParse({ ...defaultPrompts, [key]: ' ' }).success).toBe(false);
    expect(
      promptSetSchema.safeParse({ ...defaultPrompts, [key]: '中'.repeat(promptLimit(key) + 1) }).success,
    ).toBe(false);
  }
  expect(promptSetSchema.safeParse({ ...defaultPrompts, unexpected: 'x' }).success).toBe(false);
});
