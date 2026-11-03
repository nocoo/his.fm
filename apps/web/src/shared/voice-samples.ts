import manifest from './data/voice-preview-manifest.json';
import sampleScript from './data/voice-preview-sample.md?raw';
import { voicePreviewStoragePrefix } from './voice-preview-prefix';
import {
  type VoiceProvider,
  type VoiceProviderRegistryEntry,
  voiceProviderDefinition,
  voiceProviderInfo,
  voiceProviderRegistry,
  voiceProviders,
  voiceProvidersWithSamples,
} from './voice-preview-registry';

export {
  type VoiceProvider,
  voicePreviewStoragePrefix,
  voiceProviderDefinition,
  voiceProviderInfo,
  voiceProviderRegistry,
  voiceProviders,
  voiceProvidersWithSamples,
};

export const voiceMediaBase = 'https://f.no.mt';

export const voiceGenders = ['male', 'female', 'non-binary', 'unknown'] as const;
export type VoiceGender = (typeof voiceGenders)[number];

export const voiceGenderLabels: Record<VoiceGender, string> = {
  male: '男声',
  female: '女声',
  'non-binary': '非二元',
  unknown: '未标注',
};

export type VoicePreviewEntry = {
  provider: VoiceProvider;
  voiceName: string;
  voiceId: string;
  gender: VoiceGender;
  style: string;
  durationSeconds: number;
  objectKey: string;
  model?: string;
};

export const voicePreviewEntries = manifest as VoicePreviewEntry[];

export type VoicePreviewVoice = VoicePreviewEntry & { traits: string[] };

export type VoicePreviewFilters = {
  provider: VoiceProvider | 'all';
  gender: VoiceGender | 'all';
  query: string;
};

export const voicePreviewSampleScript = sampleScript.trimEnd();

export function voicePreviewMediaUrl(objectKey: string, cacheVersion?: string | null) {
  const base = `${voiceMediaBase}/${objectKey}`;
  if (!cacheVersion) return base;
  const token = cacheVersion.replace(/^"|"$/g, '');
  if (!token) return base;
  return `${base}?v=${encodeURIComponent(token)}`;
}

export function voicePreviewGender(entry: VoicePreviewEntry): VoiceGender {
  return voiceGenders.includes(entry.gender) ? entry.gender : 'unknown';
}

function voicePreviewTraits(entry: VoicePreviewEntry): string[] {
  const provider = voiceProviderDefinition(entry.provider) as VoiceProviderRegistryEntry;
  if (provider.defaultTraits?.length) return [...provider.defaultTraits];
  const traits = entry.style.split(',').map((trait) => trait.trim());
  if (voiceGenders.some((gender) => gender === traits[0])) traits.shift();
  return traits.filter(Boolean);
}

export function voicePreviewCatalog(entries: VoicePreviewEntry[] = voicePreviewEntries) {
  const catalogs = voiceProviders.map((provider) =>
    entries
      .filter((entry) => entry.provider === provider)
      .sort((left, right) => left.voiceName.localeCompare(right.voiceName, 'en')),
  );
  return Array.from({ length: Math.max(...catalogs.map((catalog) => catalog.length), 0) }, (_, index) =>
    catalogs.flatMap((catalog) => {
      const entry = catalog[index];
      if (!entry) return [];
      return [{ ...entry, traits: voicePreviewTraits(entry) }];
    }),
  ).flat();
}

export function voicePreviewResults(entries: VoicePreviewVoice[], filters: VoicePreviewFilters) {
  const query = filters.query.trim().toLowerCase();
  const matching = entries.filter((entry) => {
    const provider = voiceProviderInfo[entry.provider];
    const model = entry.model ?? provider.model;
    return (
      (filters.provider === 'all' || entry.provider === filters.provider) &&
      `${entry.voiceName} ${entry.voiceId} ${entry.style} ${entry.traits.join(' ')} ${voiceGenderLabels[entry.gender]} ${provider.name} ${model}`
        .toLowerCase()
        .includes(query)
    );
  });
  return {
    filtered: matching.filter((entry) => filters.gender === 'all' || entry.gender === filters.gender),
    matchingCount: matching.length,
    providerCounts: Object.fromEntries(
      voiceProviders.map((provider) => [
        provider,
        entries.filter((entry) => entry.provider === provider).length,
      ]),
    ) as Record<VoiceProvider, number>,
    genderOptions: voiceGenders
      .filter((gender) => entries.some((entry) => entry.gender === gender))
      .map((gender) => ({ gender, count: matching.filter((entry) => entry.gender === gender).length })),
  };
}

export function voicePreviewTraitClass(entry: VoicePreviewVoice, traitIndex: number) {
  const provider = voiceProviderDefinition(entry.provider) as VoiceProviderRegistryEntry;
  if (provider.firstTraitIsLocale && traitIndex === 0) return 'voice-locale-tag';
  return 'voice-style-tag';
}
