import type { Category } from '../src/shared/category';
import type { ChannelProfile } from '../src/shared/channel';
import type { Production, ProductionPrompts } from '../src/shared/production';

export function productionPrompts(
  production: Production,
  channel: ChannelProfile,
  category: Category,
): ProductionPrompts {
  const context = JSON.stringify(
    {
      title: production.title,
      stage: production.stage,
      intent: production.intent,
      targetDurationSeconds: production.targetDurationSeconds,
      sources: production.sources,
      transcript: production.transcript,
      audio: { execution: 'native speech conversation', providers: ['gemini', 'elevenlabs'] },
      feedback: production.events
        .filter((event) => event.feedback)
        .map((event) => ({ action: event.action, feedback: event.feedback })),
    },
    null,
    2,
  );
  const { prompts, ...profile } = channel;
  const editorial = `${prompts.editorial}\n${JSON.stringify({ channel: profile, category }, null, 2)}`;
  const render = (key: 'brief' | 'script' | 'cover' | 'description') =>
    `${editorial}\n${prompts[key]}\n${prompts.boundary}\n${context}`;
  return {
    brief: render('brief'),
    script: render('script'),
    cover: render('cover'),
    description: render('description'),
  };
}
