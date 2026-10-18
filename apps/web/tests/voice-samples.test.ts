import { describe, expect, it } from 'vitest';
import {
  elevenlabsVoiceCatalog,
  elevenlabsVoicesBeyondComparisons,
  geminiVoiceCatalog,
  geminiVoicesBeyondComparisons,
  referenceVoiceUrl,
  voiceComparisonPairs,
} from '../src/shared/voice-samples';

describe('voice reference catalog', () => {
  it('maps gemini voices to CDN reference keys', () => {
    for (const sample of geminiVoiceCatalog) {
      expect(referenceVoiceUrl(sample.voice)).toBe(`https://f.no.mt/reference/voices/${sample.voice}.wav`);
    }
    for (const pair of voiceComparisonPairs) {
      expect(referenceVoiceUrl(pair.gemini.file)).toContain(pair.gemini.voice);
    }
  });

  it('maps elevenlabs voices to CDN reference keys', () => {
    for (const sample of elevenlabsVoiceCatalog) {
      expect(referenceVoiceUrl(sample.file)).toBe(`https://f.no.mt/reference/voices/${sample.file}.wav`);
    }
    expect(elevenlabsVoiceCatalog.map((sample) => sample.name)).toEqual(['George', 'Sarah', 'Liam']);
  });

  it('deduplicates catalog voices already shown in comparison pairs', () => {
    const comparedGemini = voiceComparisonPairs.map((pair) => pair.gemini.voice);
    for (const voice of comparedGemini) {
      expect(geminiVoicesBeyondComparisons().some((sample) => sample.voice === voice)).toBe(false);
    }
    expect(geminiVoicesBeyondComparisons().map((sample) => sample.voice)).toEqual(['Kore', 'Zephyr', 'Puck']);

    const comparedElevenlabs = voiceComparisonPairs.map((pair) => pair.elevenlabs.file);
    for (const file of comparedElevenlabs) {
      expect(elevenlabsVoicesBeyondComparisons().some((sample) => sample.file === file)).toBe(false);
    }
    expect(elevenlabsVoicesBeyondComparisons()).toHaveLength(0);
  });
});
