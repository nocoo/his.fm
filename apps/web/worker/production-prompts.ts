import { type PromptSlotInput, synthesizePromptSlots } from '@his-fm/contracts';
import type { Production, ProductionPrompts } from '../src/shared/production';

export function productionPrompts(production: Production, slots: PromptSlotInput[]): ProductionPrompts {
  const context = JSON.stringify(
    {
      title: production.title,
      stage: production.stage,
      intent: production.intent,
      targetDurationSeconds: production.targetDurationSeconds,
      sources: production.sources,
      transcript: production.transcript,
      feedback: production.events
        .filter((event) => event.feedback)
        .map((event) => ({ action: event.action, feedback: event.feedback })),
    },
    null,
    2,
  );
  const guidance = `${synthesizePromptSlots(slots)}\n${context}`;
  return { brief: guidance, script: guidance, cover: guidance, description: guidance };
}
