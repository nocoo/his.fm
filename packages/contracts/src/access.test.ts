import { describe, expect, it } from 'vitest';
import { grantsSchema, hasScope, principalSchema, scopePresets, scopes } from './access.ts';

describe('explicit grants', () => {
  it('rejects unknown or duplicate scopes and never grants a bare agent authority', () => {
    expect(grantsSchema.parse([])).toEqual([]);
    expect(grantsSchema.safeParse(['*']).success).toBe(false);
    expect(grantsSchema.safeParse(['productions:read', 'productions:read']).success).toBe(false);
    expect(hasScope({ kind: 'agent', name: 'External' }, 'productions:read')).toBe(false);
    expect(hasScope({ kind: 'agent', name: 'External', scopes: [] }, 'productions:read')).toBe(false);
    expect(
      hasScope({ kind: 'agent', name: 'External', scopes: ['productions:read'] }, 'productions:read'),
    ).toBe(true);
    expect(hasScope({ kind: 'human', name: 'Owner' }, 'productions:approve')).toBe(true);
  });

  it('expands presets to finite validated grants without implicitly granting future capabilities', () => {
    for (const grants of Object.values(scopePresets)) expect(grantsSchema.parse(grants)).toEqual(grants);
    expect(scopePresets.owner).toEqual(scopes);
    expect(scopePresets.coordinator).not.toContain('productions:approve');
    expect(principalSchema.safeParse({ kind: 'agent', name: '', scopes: [] }).success).toBe(false);
  });
});
