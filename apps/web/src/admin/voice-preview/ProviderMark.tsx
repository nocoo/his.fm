import type { CSSProperties } from 'react';
import elevenlabs from '../../brand/providers/elevenlabs.svg';
import gemini from '../../brand/providers/gemini.svg';
import type { VoiceProvider } from '../../shared/voice-samples';

export function ProviderMark({ provider }: { provider: VoiceProvider }) {
  return (
    <span className="appearance-provider-mark" data-provider={provider} aria-hidden="true">
      <span
        data-logo=""
        style={
          { '--provider-logo': `url("${provider === 'gemini' ? gemini : elevenlabs}")` } as CSSProperties
        }
      />
    </span>
  );
}
