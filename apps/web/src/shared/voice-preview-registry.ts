export type VoiceProviderMark =
  | { kind: 'logo'; asset: 'gemini' | 'elevenlabs' }
  | { kind: 'microsoft' }
  | { kind: 'initials'; text: string; background?: string };

export type VoiceProviderRegistryEntry = {
  id: string;
  name: string;
  model: string;
  description: string;
  mark: VoiceProviderMark;
  defaultTraits?: readonly string[];
  firstTraitIsLocale?: boolean;
};

export const voiceProviderRegistry = [
  {
    id: 'gemini',
    name: 'Gemini',
    model: '3.8 Flash TTS',
    description: 'Google Gemini Flash 预生成样片。',
    mark: { kind: 'logo', asset: 'gemini' },
    firstTraitIsLocale: false,
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    model: 'Eleven v3',
    description: 'ElevenLabs 预生成样片。',
    mark: { kind: 'logo', asset: 'elevenlabs' },
    firstTraitIsLocale: true,
  },
  {
    id: 'mai',
    name: 'MAI Voice',
    model: 'MAI-Voice-2.1',
    description: 'Microsoft Azure MAI 高保真中文样片。',
    mark: { kind: 'microsoft' },
    defaultTraits: ['中文', '高保真'],
    firstTraitIsLocale: false,
  },
  {
    id: 'doubao',
    name: '豆包',
    model: '豆包 语音合成',
    description: '预生成样片，收录后在此试听。',
    mark: { kind: 'initials', text: '豆', background: 'hsl(24 85% 48%)' },
    firstTraitIsLocale: false,
  },
  {
    id: 'fish',
    name: 'Fish Audio',
    model: 'Drama 3',
    description: '本地 Drama 3 模型预生成样片，收录后在此试听。',
    mark: { kind: 'initials', text: 'F', background: 'hsl(210 70% 42%)' },
    firstTraitIsLocale: false,
  },
] as const satisfies readonly VoiceProviderRegistryEntry[];

export type VoiceProvider = (typeof voiceProviderRegistry)[number]['id'];

export const voiceProviders = voiceProviderRegistry.map((entry) => entry.id);

const registryById = Object.fromEntries(voiceProviderRegistry.map((entry) => [entry.id, entry])) as Record<
  VoiceProvider,
  (typeof voiceProviderRegistry)[number]
>;

export function voiceProviderDefinition(provider: VoiceProvider) {
  return registryById[provider];
}

export const voiceProviderInfo = Object.fromEntries(
  voiceProviderRegistry.map((entry) => [entry.id, { name: entry.name, model: entry.model }]),
) as Record<VoiceProvider, { name: string; model: string }>;

export function voiceProvidersWithSamples(counts: Record<VoiceProvider, number>) {
  return voiceProviderRegistry.filter((entry) => counts[entry.id] > 0).map((entry) => entry.id);
}
