import manifest from './data/voice-preview-manifest.json';
import sampleScript from './data/voice-preview-sample.md?raw';
import { voicePreviewStoragePrefix } from './voice-preview-prefix';

export { voicePreviewStoragePrefix };

export const voiceMediaBase = 'https://f.no.mt';

export type VoiceProvider = 'gemini' | 'elevenlabs';

export type VoicePreviewEntry = {
  provider: VoiceProvider;
  voiceName: string;
  voiceId: string;
  style: string;
  durationSeconds: number;
  objectKey: string;
};

export const voicePreviewEntries = manifest as VoicePreviewEntry[];

export const voicePreviewSampleScript = sampleScript.trimEnd();

export function voicePreviewMediaUrl(objectKey: string) {
  return `${voiceMediaBase}/${objectKey}`;
}

export function voicePreviewCatalog(provider: VoiceProvider) {
  return voicePreviewEntries
    .filter((entry) => entry.provider === provider)
    .sort((left, right) => left.voiceName.localeCompare(right.voiceName, 'zh-CN'));
}

export function voicePreviewComparisonRows() {
  const gemini = voicePreviewCatalog('gemini');
  const elevenlabs = voicePreviewCatalog('elevenlabs');
  const rowCount = Math.max(gemini.length, elevenlabs.length);
  return Array.from({ length: rowCount }, (_, index) => ({
    gemini: gemini[index],
    elevenlabs: elevenlabs[index],
  }));
}
