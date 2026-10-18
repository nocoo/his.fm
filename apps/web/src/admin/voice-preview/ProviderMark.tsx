import type { CSSProperties } from 'react';
import elevenlabs from '../../brand/providers/elevenlabs.svg';
import gemini from '../../brand/providers/gemini.svg';
import type { VoiceProvider } from '../../shared/voice-samples';

export function ProviderMark({ provider }: { provider: VoiceProvider }) {
  const logo = provider === 'gemini' ? gemini : elevenlabs;
  return (
    <span className="appearance-provider-mark" data-provider={provider} aria-hidden="true">
      <span data-logo="" style={{ '--provider-logo': `url("${logo}")` } as CSSProperties} />
    </span>
  );
}
