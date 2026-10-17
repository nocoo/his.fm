import { describe, expect, it } from 'vitest';
import { coverArtContainRect } from './coverArtFit';

describe('coverArtContainRect', () => {
  it('letterboxes a wide image with equal side margins', () => {
    const rect = coverArtContainRect(100, 200, 100);
    expect(rect).toEqual({ x: 0, y: 25, width: 100, height: 50 });
  });

  it('letterboxes a tall image with equal horizontal side bands', () => {
    const size = 100;
    const rect = coverArtContainRect(size, 100, 200);
    expect(rect).toEqual({ x: 25, y: 0, width: 50, height: 100 });
    const leftBand = rect.x;
    const rightBand = size - rect.x - rect.width;
    expect(leftBand).toBe(rightBand);
  });
});
