import manifest from './data/voice-preview-manifest.json';
import sampleScript from './data/voice-preview-sample.md?raw';
import { voicePreviewStoragePrefix } from './voice-preview-prefix';

export { voicePreviewStoragePrefix };

export const voiceMediaBase = 'https://f.no.mt';

export const voiceProviders = ['gemini', 'elevenlabs', 'mai'] as const;
export type VoiceProvider = (typeof voiceProviders)[number];
export const voiceGenders = ['male', 'female', 'non-binary', 'unknown'] as const;
export type VoiceGender = (typeof voiceGenders)[number];

export const voiceProviderInfo = {
  gemini: { name: 'Gemini', model: '3.8 Flash TTS' },
  elevenlabs: { name: 'ElevenLabs', model: 'Eleven v3' },
  mai: { name: 'MAI Voice', model: 'MAI-Voice-2.1' },
} satisfies Record<VoiceProvider, { name: string; model: string }>;

export const voiceGenderLabels: Record<VoiceGender, string> = {
  male: '男声',
  female: '女声',
  'non-binary': '非二元',
  unknown: '未标注',
};

const geminiGenders: Record<string, VoiceGender> = {
  Achernar: 'female',
  Achird: 'male',
  Algenib: 'male',
  Algieba: 'male',
  Alnilam: 'male',
  Aoede: 'female',
  Autonoe: 'female',
  Callirrhoe: 'female',
  Charon: 'male',
  Despina: 'female',
  Enceladus: 'male',
  Erinome: 'female',
  Fenrir: 'male',
  Gacrux: 'female',
  Iapetus: 'male',
  Kore: 'female',
  Laomedeia: 'female',
  Leda: 'female',
  Orus: 'male',
  Puck: 'male',
  Pulcherrima: 'female',
  Rasalgethi: 'male',
  Sadachbia: 'male',
  Sadaltager: 'male',
  Schedar: 'male',
  Sulafat: 'female',
  Umbriel: 'male',
  Vindemiatrix: 'female',
  Zephyr: 'female',
  Zubenelgenubi: 'male',
};

export type VoicePreviewEntry = {
  provider: VoiceProvider;
  voiceName: string;
  voiceId: string;
  style: string;
  durationSeconds: number;
  objectKey: string;
};

export const voicePreviewEntries = manifest as VoicePreviewEntry[];

export type VoicePreviewVoice = VoicePreviewEntry & { gender: VoiceGender; traits: string[] };

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
  if (entry.provider === 'gemini') return geminiGenders[entry.voiceName] ?? 'unknown';
  const token = entry.style.split(',')[0].trim();
  return voiceGenders.find((gender) => gender === token) ?? 'unknown';
}

export function voicePreviewCatalog(entries: VoicePreviewEntry[] = voicePreviewEntries) {
  const catalogs = voiceProviders.map((provider) =>
    entries
      .filter((entry) => entry.provider === provider)
      .sort((left, right) => left.voiceName.localeCompare(right.voiceName, 'en')),
  );
  return Array.from({ length: Math.max(...catalogs.map((catalog) => catalog.length)) }, (_, index) =>
    catalogs.flatMap((catalog) => {
      const entry = catalog[index];
      if (!entry) return [];
      const traits = entry.style.split(',').map((trait) => trait.trim());
      if (voiceGenders.some((gender) => gender === traits[0])) traits.shift();
      return [
        {
          ...entry,
          gender: voicePreviewGender(entry),
          traits: entry.provider === 'mai' ? ['中文', '高保真'] : traits.filter(Boolean),
        },
      ];
    }),
  ).flat();
}

export function voicePreviewResults(entries: VoicePreviewVoice[], filters: VoicePreviewFilters) {
  const query = filters.query.trim().toLowerCase();
  const matching = entries.filter(
    (entry) =>
      (filters.provider === 'all' || entry.provider === filters.provider) &&
      `${entry.voiceName} ${entry.voiceId} ${entry.style} ${entry.traits.join(' ')} ${voiceGenderLabels[entry.gender]} ${voiceProviderInfo[entry.provider].name} ${voiceProviderInfo[entry.provider].model}`
        .toLowerCase()
        .includes(query),
  );
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
