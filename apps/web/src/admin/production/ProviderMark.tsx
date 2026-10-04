import type { SpeechProvider } from '@his-fm/contracts';
import type { CSSProperties } from 'react';
import elevenlabs from '../../brand/providers/elevenlabs.svg';
import gemini from '../../brand/providers/gemini.svg';

export function ProviderMark({ provider }: { provider: SpeechProvider }) {
  return (
    <span className="studio-provider-mark" data-provider={provider} aria-hidden="true">
      <span
        style={
          { '--provider-logo': `url("${provider === 'gemini' ? gemini : elevenlabs}")` } as CSSProperties
        }
      />
    </span>
  );
}
