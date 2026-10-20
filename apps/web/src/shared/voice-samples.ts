import manifest from './data/voice-preview-manifest.json';
import sampleScript from './data/voice-preview-sample.md?raw';
import { voicePreviewStoragePrefix } from './voice-preview-prefix';

export { voicePreviewStoragePrefix };

export const voiceMediaBase = 'https://f.no.mt';

export type VoiceProvider = 'gemini' | 'elevenlabs';

export type VoicePreviewGender = '男声' | '女声';

export type VoicePreviewUsageCategoryId = 'learning' | 'manager-notes';

export type VoicePreviewEntry = {
  provider: VoiceProvider;
  voiceName: string;
  voiceId: string;
  style: string;
  gender: VoicePreviewGender;
  model: string;
  usageCategoryId?: VoicePreviewUsageCategoryId;
  durationSeconds: number;
  objectKey: string;
};

const voicePreviewUsageCategoryNames: Record<VoicePreviewUsageCategoryId, string> = {
  learning: '每日手冲',
  'manager-notes': '主理人手札',
};

export function voicePreviewUsageLabel(entry: VoicePreviewEntry) {
  if (!entry.usageCategoryId) return null;
  return voicePreviewUsageCategoryNames[entry.usageCategoryId];
}

export function voicePreviewDescriptorBadges(entry: VoicePreviewEntry) {
  if (entry.provider === 'gemini') {
    return entry.style ? [entry.style] : [];
  }
  const parts = entry.style
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];
  const first = parts[0].toLowerCase();
  if (first === 'male' || first === 'female' || first === 'non-binary') {
    return parts.slice(1);
  }
  return parts;
}

export const voicePreviewEntries = manifest as VoicePreviewEntry[];

export const voicePreviewSampleScript = sampleScript.trimEnd();

export function voicePreviewMediaUrl(objectKey: string, cacheVersion?: string | null) {
  const base = `${voiceMediaBase}/${objectKey}`;
  if (!cacheVersion) return base;
  const token = cacheVersion.replace(/^"|"$/g, '');
  if (!token) return base;
  return `${base}?v=${encodeURIComponent(token)}`;
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
