import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sourceImportsNodeBuiltin } from './node-builtin-imports';

const webRoot = fileURLToPath(new URL('../..', import.meta.url));
const clientRoots = ['src/shared', 'src/components', 'src/public', 'src/brand'];

function listSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(path));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry) || entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue;
    files.push(path);
  }
  return files;
}

describe('node builtin import detection', () => {
  it.each([
    ["import { randomBytes } from 'node:crypto'", true],
    ['import "node:fs"', true],
    ["export { readFileSync } from 'node:fs'", true],
    ["const fs = await import('node:fs')", true],
    ['require("node:path")', true],
    ["import { formatReading } from '../publication-format'", false],
    ['const hint = "node:fs is documented but not imported"', false],
  ])('detects node built-ins in %s', (snippet, expected) => {
    expect(sourceImportsNodeBuiltin(snippet)).toBe(expected);
  });
});

describe('client-shared modules', () => {
  it('does not import node: built-ins under browser bundles', () => {
    const offenders: string[] = [];
    for (const root of clientRoots) {
      const absoluteRoot = join(webRoot, root);
      for (const file of listSourceFiles(absoluteRoot)) {
        const source = readFileSync(file, 'utf8');
        if (sourceImportsNodeBuiltin(source)) offenders.push(file.replace(`${webRoot}/`, ''));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('renders speaker-labelled reading HTML without Node crypto', async () => {
    const { formatReading, sanitizeReadingIdPrefix } = await import('../../src/shared/publication-format');
    const html = formatReading('**主播：** 问题。', { idPrefix: 'client-smoke' });
    expect(html).toContain('data-speaker="主播"');
    expect(html).toContain(`id="${sanitizeReadingIdPrefix('client-smoke')}-0"`);
  });
});
