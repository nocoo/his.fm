import type { ProductionSettings } from './production';

export const voiceSampleTranscript =
  '大家好，欢迎来到 his.fm，面向开发者的 AI 分享频道，今天正式开播。这里会聊模型的新进展，分享编程工具和真实项目里的实践。哪些好用，哪些踩坑，我们一起试。欢迎关注 his.fm，让灵感从耳边出发，在代码里落地。';

export const elevenVoiceSamples = [
  { voice: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', character: '温暖叙述' },
  { voice: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', character: '柔和清晰' },
  { voice: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', character: '自然稳健' },
];

export const voiceSamples: {
  voice: ProductionSettings['voice'];
  character: string;
  durationSeconds: number;
  url: string;
}[] = [
  {
    voice: 'Kore',
    character: '沉稳坚定',
    durationSeconds: 19.28,
    url: 'https://f.no.mt/reference/voices/Kore.wav',
  },
  {
    voice: 'Zephyr',
    character: '明亮',
    durationSeconds: 17.28,
    url: 'https://f.no.mt/reference/voices/Zephyr.wav',
  },
  {
    voice: 'Puck',
    character: '活泼',
    durationSeconds: 16.92,
    url: 'https://f.no.mt/reference/voices/Puck.wav',
  },
  {
    voice: 'Charon',
    character: '叙述感',
    durationSeconds: 16.76,
    url: 'https://f.no.mt/reference/voices/Charon.wav',
  },
  {
    voice: 'Aoede',
    character: '轻松',
    durationSeconds: 18.6,
    url: 'https://f.no.mt/reference/voices/Aoede.wav',
  },
  {
    voice: 'Orus',
    character: '坚定',
    durationSeconds: 19.72,
    url: 'https://f.no.mt/reference/voices/Orus.wav',
  },
];
