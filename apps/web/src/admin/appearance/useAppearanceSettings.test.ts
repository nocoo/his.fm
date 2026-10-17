import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('useAppearanceSettings', () => {
  it('save publishes the saved theme to the shared admin store', () => {
    const source = readFileSync(new URL('./useAppearanceSettings.ts', import.meta.url), 'utf8');
    const saveStart = source.indexOf('async function save');
    expect(saveStart).toBeGreaterThan(-1);
    const saveBody = source.slice(saveStart, saveStart + 600);
    expect(saveBody).toContain('publishAdminAppearanceTheme(result.appearance.theme)');
  });
});
