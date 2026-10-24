import { scopePresets } from '@his-fm/contracts';
import type { Episode } from '../../src/shared/episode';
import type { Actor, Production } from '../../src/shared/production';

export const human: Actor = { kind: 'human', name: 'editor@his.fm' };
export const agent: Actor = { kind: 'agent', name: 'Hermes (test-token)', scopes: scopePresets.editor };
export const fullAgent: Actor = {
  kind: 'agent',
  name: 'Scoped owner (test-token)',
  scopes: scopePresets.owner,
};
export const brief = {
  title: '下一条提示之前，先吃饭',
  slug: 'dinner-before-the-prompt',
  episodeNumber: 8,
  category: 'life' as const,
  tags: ['日常'],
  targetDurationSeconds: 600,
  sources: [
    { id: 'source-1', type: 'text' as const, title: '观察笔记', content: '一段可核实的成年程序员日常材料。' },
  ],
  intent: '从晚饭被工作消息打断的场景切入。',
  mentions: [],
};
export function fixture(changes: Partial<Production> = {}): Production {
  const now = '2026-09-25T00:00:00.000Z';
  return {
    ...brief,
    id: 'production-test',
    version: 1,
    stage: 'draft',
    transcript: '',
    scriptVersion: 0,
    summary: '',
    lead: '',
    researchNote: '',
    credits: '',
    body: '',
    topics: [],
    assets: { cover: null, audio: null },
    approvals: { brief: null, script: null, final: null },
    publications: [],
    events: [],
    createdAt: now,
    updatedAt: now,
    ...changes,
  };
}
export function readyFixture(changes: Partial<Production> = {}): Production {
  const approval = { at: '2026-09-25T00:00:00.000Z', by: human.name };
  return fixture({
    stage: 'ready',
    scriptVersion: 1,
    transcript: '这里是 his.fm。今晚先好好吃饭。',
    lead: '从一顿晚饭聊工作边界。',
    summary: '今晚先好好吃饭。',
    topics: [
      { title: '晚饭为什么会被消息打断', detail: '从一条下班后的消息说起。', sourceUrls: [] },
      { title: '把边界说清楚', detail: '团队里怎样约定响应时间。', sourceUrls: [] },
      { title: '留一点自己的时间', detail: '晚上还能做什么。', sourceUrls: [] },
    ],
    approvals: { brief: approval, script: approval, final: approval },
    assets: {
      cover: {
        key: 'cover.png',
        url: 'https://f.no.mt/cover.png',
        mimeType: 'image/png',
        size: 100,
        scriptVersion: 1,
        createdAt: approval.at,
      },
      audio: {
        key: 'audio.wav',
        url: 'https://f.no.mt/audio.wav',
        mimeType: 'audio/wav',
        size: 1000,
        scriptVersion: 1,
        createdAt: approval.at,
        durationSeconds: 600,
      },
    },
    ...changes,
  });
}

export function episodeFixture(changes: Partial<Episode> = {}): Episode {
  return {
    id: 'episode-test',
    version: 1,
    title: brief.title,
    slug: brief.slug,
    episodeNumber: brief.episodeNumber,
    category: brief.category,
    tags: [],
    mentions: [],
    seo: {},
    summary: 'A saved library episode.',
    transcript: '',
    lead: '',
    researchNote: '',
    credits: '',
    body: '',
    topics: [],
    coverUrl: 'https://f.no.mt/cover.png',
    audioUrl: null,
    durationSeconds: 0,
    featured: false,
    status: 'published',
    publishedAt: '2026-09-25T00:00:00Z',
    createdAt: '2026-09-25T00:00:00Z',
    updatedAt: '2026-09-25T00:00:00Z',
    ...changes,
  };
}
