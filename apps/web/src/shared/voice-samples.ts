export const voiceSampleTranscript =
  '大家好，欢迎来到 his.fm，面向开发者的 AI 分享频道，今天正式开播。这里会聊模型的新进展，分享编程工具和真实项目里的实践。哪些好用，哪些踩坑，我们一起试。欢迎关注 his.fm，让灵感从耳边出发，在代码里落地。';
export const voiceComparisonStyle =
  'Friendly podcast announcement, natural conversational delivery, brisk pace, approximately 20 seconds.';

export const voiceMediaBase = 'https://f.no.mt';

export function referenceVoiceUrl(fileName: string) {
  return `${voiceMediaBase}/reference/voices/${fileName}.wav`;
}

export const voiceComparisonPairs = [
  {
    id: 'narrative',
    label: '温暖叙述',
    gemini: { voice: 'Charon', name: 'Charon', character: '叙述感', file: 'Charon', durationSeconds: 16.76 },
    elevenlabs: {
      voice: 'JBFqnCBsd6RMkjVDRZzb',
      name: 'George',
      character: '温暖叙述',
      file: 'elevenlabs-George',
    },
  },
  {
    id: 'gentle',
    label: '轻柔清晰',
    gemini: { voice: 'Aoede', name: 'Aoede', character: '轻松', file: 'Aoede', durationSeconds: 18.6 },
    elevenlabs: {
      voice: 'EXAVITQu4vr4xnSDxMaL',
      name: 'Sarah',
      character: '柔和清晰',
      file: 'elevenlabs-Sarah',
    },
  },
  {
    id: 'steady',
    label: '沉稳自然',
    gemini: { voice: 'Orus', name: 'Orus', character: '坚定', file: 'Orus', durationSeconds: 19.72 },
    elevenlabs: {
      voice: 'TX3LPaxmHKxFdv7VOQHJ',
      name: 'Liam',
      character: '自然稳健',
      file: 'elevenlabs-Liam',
    },
  },
] as const;

export const geminiVoiceCatalog = [
  { voice: 'Kore', character: '沉稳坚定', durationSeconds: 19.28 },
  { voice: 'Zephyr', character: '明亮', durationSeconds: 17.28 },
  { voice: 'Puck', character: '活泼', durationSeconds: 16.92 },
  { voice: 'Charon', character: '叙述感', durationSeconds: 16.76 },
  { voice: 'Aoede', character: '轻松', durationSeconds: 18.6 },
  { voice: 'Orus', character: '坚定', durationSeconds: 19.72 },
] as const;

export const elevenlabsVoiceCatalog = [
  {
    voice: 'JBFqnCBsd6RMkjVDRZzb',
    name: 'George',
    character: '温暖叙述',
    file: 'elevenlabs-George',
  },
  {
    voice: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Sarah',
    character: '柔和清晰',
    file: 'elevenlabs-Sarah',
  },
  {
    voice: 'TX3LPaxmHKxFdv7VOQHJ',
    name: 'Liam',
    character: '自然稳健',
    file: 'elevenlabs-Liam',
  },
] as const;

const comparedGeminiVoices = new Set<string>(voiceComparisonPairs.map((pair) => pair.gemini.voice));
const comparedElevenlabsFiles = new Set<string>(voiceComparisonPairs.map((pair) => pair.elevenlabs.file));

export function geminiVoicesBeyondComparisons() {
  return geminiVoiceCatalog.filter((sample) => !comparedGeminiVoices.has(sample.voice));
}

export function elevenlabsVoicesBeyondComparisons() {
  return elevenlabsVoiceCatalog.filter((sample) => !comparedElevenlabsFiles.has(sample.file));
}

export type VoiceProvider = 'gemini' | 'elevenlabs';
