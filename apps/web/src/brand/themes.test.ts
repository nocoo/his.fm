import { describe, expect, it } from 'vitest';
import { themeIds } from '../shared/appearance';
import { themeCoverFrameSrc } from './themes';

describe('theme cover frames', () => {
  it('maps every theme to its design-system overlay SVG', () => {
    for (const id of themeIds) {
      expect(themeCoverFrameSrc(id)).toBe(`/brand/frames/${id}.svg`);
    }
  });
});
