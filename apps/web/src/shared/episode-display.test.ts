import { describe, expect, it } from 'vitest';
import { formatEpisodeLabel, formatEpisodeNumber } from './episode-display';

describe('episode display labels', () => {
  it('pads episode numbers and prefixes category names', () => {
    expect(formatEpisodeNumber(7)).toBe('EP.07');
    expect(formatEpisodeLabel('主理人手札', 12)).toBe('主理人手札 EP.12');
  });
});
