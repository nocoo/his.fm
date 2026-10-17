import { describe, expect, it } from 'vitest';
import {
  collectExtendedReferenceKeys,
  collectMainReferenceKeys,
  collectReferenceKeys,
} from '../../src/shared/storage-references';

const specificCases = [
  '封面参考：/images/episode-01.webp，备用图：https://f.no.mt/uploads/cover.png',
  '/images/a.png:https://f.no.mt/uploads/b.png',
  '以及/images/x.webp和https://f.no.mt/uploads/y.jpg',
  '/images/a.png/media/uploads/b.png',
  'https://f.no.mt/uploads/a,b.png',
  'https://f.no.mt/uploads/a;b.png',
  '路径（uploads/a.png）与「images/b.webp」旁注 /media/uploads/c.jpg',
  '/media/uploads/ref-media-query.png?v=2',
  `备用 /images/ref-image-fragment.webp#preview`,
];

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: T[]): T {
  return items[Math.floor(random() * items.length)];
}

function generateProse(random: () => number): string {
  const keys = [
    'uploads/a,b.png',
    'uploads/a;b.png',
    'uploads/part-one.png',
    'images/hero.webp',
    'media/notes.wav',
  ];
  const prefixes = ['说明', '以及', '参考', '（备注', '「引用」', ''];
  const joins = ['，', '。', '；', '、', ' ', ':', '：', ''];
  const ref = (kind: 'cdn' | 'media' | 'images') => {
    const key = pick(random, keys);
    if (kind === 'cdn') return `https://f.no.mt/${key}${random() > 0.7 ? '?v=2' : ''}`;
    if (kind === 'media') return `/media/${key}${random() > 0.6 ? '#frag' : ''}`;
    return `/images/${key.split('/').pop() ?? 'x.webp'}`;
  };
  const parts = [
    pick(random, prefixes),
    ref(pick(random, ['cdn', 'media', 'images'] as const)),
    pick(random, joins),
    ref('cdn'),
    pick(random, joins),
    ref('images'),
    pick(random, ['以及', '备用图', '']),
    ref('media'),
  ];
  return parts.join('');
}

function buildCorpus(): string[] {
  const random = mulberry32(0x7056);
  const corpus = [...specificCases];
  while (corpus.length < 2041) corpus.push(generateProse(random));
  return corpus;
}

describe('storage reference extraction', () => {
  it('keeps main keys on head for review regressions', () => {
    expect(collectReferenceKeys('/images/a.png:https://f.no.mt/uploads/b.png')).toContain('uploads/b.png');
    expect(collectReferenceKeys('https://f.no.mt/uploads/a,b.png')).toContain('uploads/a,b.png');
    expect(collectReferenceKeys('https://f.no.mt/uploads/a;b.png')).toContain('uploads/a;b.png');
    expect(collectReferenceKeys('/images/a.png/media/uploads/b.png')).toContain('uploads/b.png');
    expect(collectReferenceKeys('/media/uploads/ref-media-query.png?v=2')).toContain(
      'uploads/ref-media-query.png',
    );
    expect(
      collectReferenceKeys('封面参考：/images/episode-01.webp，备用图：https://f.no.mt/uploads/cover.png'),
    ).toEqual(expect.arrayContaining(['images/episode-01.webp', 'uploads/cover.png']));
    expect(collectReferenceKeys('/images/a.png:https://f.no.mt/uploads/b.png')).toContain('images/a.png');
  });

  it('is a superset of main on a large generated prose corpus', () => {
    const corpus = buildCorpus();
    expect(corpus.length).toBeGreaterThanOrEqual(2041);
    for (const text of corpus) {
      const main = new Set(collectMainReferenceKeys(text));
      const head = new Set(collectReferenceKeys(text));
      for (const key of main) expect(head.has(key)).toBe(true);
    }
  });

  it('adds /images/ keys via the extended extractor', () => {
    const text = '仅 /images/episode-01.webp 引用';
    expect(collectMainReferenceKeys(text)).toEqual([]);
    expect(collectExtendedReferenceKeys(text)).toContain('images/episode-01.webp');
    expect(collectReferenceKeys(text)).toContain('images/episode-01.webp');
  });
});
