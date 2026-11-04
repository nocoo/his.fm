import { describe, expect, it } from 'vitest';
import { iso8601Duration } from '../../src/shared/duration-iso8601';

describe('iso8601Duration', () => {
  it('formats podcast durations', () => {
    expect(iso8601Duration(0)).toBeUndefined();
    expect(iso8601Duration(Number.NaN)).toBeUndefined();
    expect(iso8601Duration(45)).toBe('PT45S');
    expect(iso8601Duration(3600)).toBe('PT1H');
    expect(iso8601Duration(90)).toBe('PT1M30S');
    expect(iso8601Duration(3661)).toBe('PT1H1M1S');
  });
});
