import { describe, expect, it } from 'vitest';
import { geminiVoiceCatalog, referenceVoiceUrl, voiceComparisonPairs } from '../src/shared/voice-samples';

describe('voice reference catalog', () => {
  it('maps gemini voices to CDN reference keys', () => {
    for (const sample of geminiVoiceCatalog) {
      expect(referenceVoiceUrl(sample.voice)).toBe(`https://f.no.mt/reference/voices/${sample.voice}.wav`);
    }
    for (const pair of voiceComparisonPairs) {
      expect(referenceVoiceUrl(pair.gemini.file)).toContain(pair.gemini.voice);
    }
  });
});
