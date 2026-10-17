import { describe, expect, it } from 'vitest';
import { resolveThemeId } from './useResolvedThemeId';

describe('resolveThemeId', () => {
  it('prefers explicit overrides, then public appearance, then admin fetch, then interval', () => {
    expect(resolveThemeId('grove', 'stillwood', 'interval')).toBe('interval');
    expect(resolveThemeId('grove', 'stillwood')).toBe('grove');
    expect(resolveThemeId(undefined, 'stillwood')).toBe('stillwood');
    expect(resolveThemeId(undefined, null)).toBe('interval');
  });
});
