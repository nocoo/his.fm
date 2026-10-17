import { describe, expect, it } from 'vitest';
import { themeIds } from '../shared/appearance';
import { defaultCoverFrame, themeCoverFrameSrc, themes } from './themes';

describe('theme cover frames', () => {
  it('falls back to the shared brand frame when a theme has no override', () => {
    for (const id of themeIds) {
      expect(themes[id].coverFrame).toBeUndefined();
      expect(themeCoverFrameSrc(id)).toBe(defaultCoverFrame);
    }
  });
});
