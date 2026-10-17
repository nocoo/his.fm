import { describe, expect, it } from 'vitest';
import { coverErrorHidesSrc } from './FramedCover';

describe('coverErrorHidesSrc', () => {
  it('hides only the image URL that failed', () => {
    expect(coverErrorHidesSrc('/broken.webp', '/broken.webp')).toBe(true);
    expect(coverErrorHidesSrc('/broken.webp', '/valid.webp')).toBe(false);
    expect(coverErrorHidesSrc(null, '/valid.webp')).toBe(false);
  });
});
