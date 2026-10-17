import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coverArtContainRect } from './coverArtFit';

const srcRoot = join(import.meta.dirname, '..');
const cssFiles = [
  'components/FramedCover.css',
  'admin/production/production.css',
  'public/public.css',
  'components/AudioPlayer.css',
];

function framedCoverImageRules(css: string): string[] {
  return [...css.matchAll(/([^{}]*\.framed-cover-image[^{}]*)\{([^}]*)\}/gs)].map(
    ([, selector, body]) => `${selector}{${body}}`,
  );
}

describe('coverFramingConsistency', () => {
  it('uses object-fit contain for framed cover art in every view stylesheet', () => {
    const violations: string[] = [];
    for (const file of cssFiles) {
      const css = readFileSync(join(srcRoot, file), 'utf8');
      for (const rule of framedCoverImageRules(css)) {
        if (/object-fit:\s*cover/.test(rule)) violations.push(`${file}: ${rule}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('letterboxes landscape and portrait art the same way in square frames', () => {
    const landscape = coverArtContainRect(1600, 2400, 1200);
    const portrait = coverArtContainRect(1600, 1200, 2400);
    expect(landscape.width).toBe(1600);
    expect(landscape.height).toBe(800);
    expect(landscape.y).toBe(400);
    expect(portrait.width).toBe(800);
    expect(portrait.height).toBe(1600);
    expect(portrait.x).toBe(400);
  });
});
