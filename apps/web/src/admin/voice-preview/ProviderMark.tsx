import type { CSSProperties } from 'react';
import elevenlabs from '../../brand/providers/elevenlabs.svg';
import gemini from '../../brand/providers/gemini.svg';
import { type VoiceProvider, voiceProviderDefinition } from '../../shared/voice-samples';

const providerLogos = {
  gemini,
  elevenlabs,
} as const;

export function ProviderMark({ provider }: { provider: VoiceProvider }) {
  const definition = voiceProviderDefinition(provider);
  const { mark } = definition;

  if (mark.kind === 'microsoft') {
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

  if (mark.kind === 'initials') {
    return (
      <span
        className="voice-provider-icon voice-provider-initials"
        data-provider={provider}
        aria-hidden="true"
        style={{ background: mark.background } as CSSProperties}
      >
        <span>{mark.text}</span>
      </span>
    );
  }

  const logo = providerLogos[mark.asset];
  return (
    <span className="voice-provider-icon" data-provider={provider} aria-hidden="true">
      <span data-logo="" style={{ '--provider-logo': `url("${logo}")` } as CSSProperties} />
    </span>
  );
}
