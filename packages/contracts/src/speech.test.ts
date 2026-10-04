import { expect, it } from 'vitest';
import { defaultSpeechSettings, speechCacheContent, speechSnapshotSchema } from './speech.ts';

it('validates provider/model identity and hashes the same fields independently of insertion order', () => {
  const input = {
    provider: 'gemini' as const,
    model: defaultSpeechSettings.gemini.model,
    voice: 'Kore',
    speakingStyle: 'calm',
    text: '你好',
    stability: 0.5,
    similarity: 0.75,
  };
  expect(speechSnapshotSchema.parse(input)).toEqual(input);
  const reordered = Object.fromEntries(Object.entries(input).reverse()) as typeof input;
  expect(speechCacheContent(input)).toBe(speechCacheContent(reordered));
  expect(speechSnapshotSchema.safeParse({ ...input, model: 'eleven_v4' }).success).toBe(false);
  expect(speechSnapshotSchema.safeParse({ ...input, voice: 'bad/voice' }).success).toBe(false);
  expect(
    speechSnapshotSchema.safeParse({
      ...input,
      provider: 'elevenlabs',
      model: 'eleven_v4',
      voice: 'voice123',
    }).success,
  ).toBe(true);
});
