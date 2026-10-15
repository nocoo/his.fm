import { narrationStyle } from '@frogie/core/hisfm/narration';
import { z } from 'zod';

export const speechProviderSchema = z.enum(['gemini', 'elevenlabs']);
export type SpeechProvider = z.infer<typeof speechProviderSchema>;
export const speechSelectionSchema = z.strictObject({
  provider: speechProviderSchema,
  voice: z.string().trim().min(1).max(160),
  speakingStyle: z.string().trim().min(1).max(2000),
});
export const speechSettingsSchema = z.strictObject({
  defaultProvider: speechProviderSchema,
  speakingStyle: z.string().trim().min(1).max(2000),
  gemini: z.strictObject({
    model: z.literal('gemini-3.8-flash-tts'),
    voice: z.string().regex(/^[a-zA-Z]{1,80}$/),
  }),
  elevenlabs: z.strictObject({
    model: z.literal('eleven_v4'),
    voice: z.string().regex(/^[a-zA-Z0-9]{1,160}$/),
    stability: z.number().min(0).max(1),
    similarity: z.number().min(0).max(1),
  }),
});
export type SpeechSettings = z.infer<typeof speechSettingsSchema>;
export const defaultSpeechSettings: SpeechSettings = {
  defaultProvider: 'gemini',
  speakingStyle: narrationStyle,
  gemini: { model: 'gemini-3.8-flash-tts', voice: 'Kore' },
  elevenlabs: { model: 'eleven_v4', voice: 'kLhAstPcnnPxqzk6gS5i', stability: 0.5, similarity: 0.75 },
};
export const speechSnapshotSchema = speechSelectionSchema
  .extend({
    model: z.string().min(1).max(100),
    text: z.string().trim().min(1).max(80000),
    stability: z.number().min(0).max(1),
    similarity: z.number().min(0).max(1),
  })
  .superRefine((value, ctx) => {
    if (value.model !== (value.provider === 'gemini' ? 'gemini-3.8-flash-tts' : 'eleven_v4'))
      ctx.addIssue({ code: 'custom', path: ['model'], message: 'Provider and model must match' });
    if (!/^[a-zA-Z0-9]{1,160}$/.test(value.voice))
      ctx.addIssue({ code: 'custom', path: ['voice'], message: 'Invalid voice identifier' });
  });
export type SpeechSnapshot = z.infer<typeof speechSnapshotSchema>;
export function speechCacheContent(input: SpeechSnapshot) {
  const { provider, model, voice, speakingStyle, text, stability, similarity } =
    speechSnapshotSchema.parse(input);
  return JSON.stringify({ provider, model, voice, speakingStyle, text, stability, similarity });
}
export const aiStatusSchema = z.strictObject({
  version: z.string().length(64),
  settings: speechSettingsSchema,
  providers: z.strictObject({
    gemini: z.boolean(),
    elevenlabs: z.boolean(),
    raven: z.boolean(),
    decision: z.boolean(),
  }),
  coordinator: z.strictObject({ provider: z.string(), model: z.string(), thinkingLevel: z.string() }),
  executor: z.strictObject({ provider: z.string(), model: z.string(), thinkingLevels: z.array(z.string()) }),
  decision: z.strictObject({ model: z.string(), maxInputBytes: z.number(), maxBatchQuestions: z.number() }),
});
export type AiStatus = z.infer<typeof aiStatusSchema>;
export const aiUpdateSchema = z
  .strictObject({
    version: z.string().length(64),
    settings: speechSettingsSchema.optional(),
    credentials: z
      .strictObject({
        gemini: z.string().trim().min(1).max(500).nullable().optional(),
        elevenlabs: z.string().trim().min(1).max(500).nullable().optional(),
      })
      .optional(),
  })
  .refine(
    (input) => input.settings !== undefined || Object.keys(input.credentials ?? {}).length > 0,
    'Provide settings or credentials',
  );
export const runtimeRequestSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('settings.read') }),
  z.strictObject({ kind: z.literal('settings.update'), input: aiUpdateSchema }),
]);
export type RuntimeRequest = z.infer<typeof runtimeRequestSchema>;
