import { describe, expect, it } from 'vitest';
import { themeIds } from '../shared/appearance';
import { defaultCoverFrame, themeCoverFrameSrc, themes } from './themes';

describe('theme cover frames', () => {
  it('maps every theme to its design-system overlay SVG', () => {
    for (const id of themeIds) {
      expect(themes[id].coverFrame).toBe(`/brand/frames/${id}.svg`);
      expect(themeCoverFrameSrc(id)).toBe(`/brand/frames/${id}.svg`);
    }
  });

  it('keeps the legacy interval frame as the global fallback path', () => {
    expect(defaultCoverFrame).toBe('/brand/cover-frame.svg');
  });
});
