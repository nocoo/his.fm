import type { CSSProperties } from 'react';
import elevenlabs from '../../brand/providers/elevenlabs.svg';
import gemini from '../../brand/providers/gemini.svg';
import type { VoiceProvider } from '../../shared/voice-samples';

export function ProviderMark({ provider }: { provider: VoiceProvider }) {
  if (provider === 'mai') {
    return (
      <span className="voice-provider-icon" data-provider={provider} aria-hidden="true">
        <span className="voice-microsoft-mark">
          <i />
          <i />
          <i />
          <i />
        </span>
      </span>
    );
  }
  const logo = provider === 'gemini' ? gemini : elevenlabs;
  return (
    <span className="voice-provider-icon" data-provider={provider} aria-hidden="true">
      <span data-logo="" style={{ '--provider-logo': `url("${logo}")` } as CSSProperties} />
    </span>
  );
}
