import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readCss = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

function splitSelectors(selector: string) {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selector.length; index++) {
    const character = selector[index];
    if (character === '(' || character === '[') depth++;
    else if (character === ')' || character === ']') depth--;
    else if (character === ',' && depth === 0) {
      parts.push(selector.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts.map(normalize).filter(Boolean);
}

function parseRules(css: string) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '');
  const rules = new Map<string, Map<string, string>>();
  let index = 0;
  while (index < source.length) {
    const open = source.indexOf('{', index);
    if (open < 0) break;
    const selector = normalize(source.slice(index, open));
    let depth = 0;
    let cursor = open;
    for (; cursor < source.length; cursor++) {
      if (source[cursor] === '{') depth++;
      else if (source[cursor] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    if (cursor >= source.length) throw new Error(`Unterminated block: ${selector}`);
    if (!selector.startsWith('@')) {
      const declarations = new Map<string, string>();
      for (const part of source.slice(open + 1, cursor).split(';')) {
        const colon = part.indexOf(':');
        if (colon < 0) continue;
        const property = part.slice(0, colon).trim();
        if (property) declarations.set(property, normalize(part.slice(colon + 1)));
      }
      for (const single of splitSelectors(selector)) {
        const existing = rules.get(single) ?? new Map<string, string>();
        for (const [property, value] of declarations) existing.set(property, value);
        rules.set(single, existing);
      }
    }
    index = cursor + 1;
  }
  return rules;
}

const shell = parseRules(readCss('../../src/public/public-critical-shell.css'));
const full = parseRules(readCss('../../src/public/public.css'));

const selectorAllowlist = new Set(['html[data-public-theme]', 'html[data-public-theme] body']);

describe('public critical shell', () => {
  it('parses the shell and the full bundle', () => {
    expect(shell.size).toBeGreaterThan(20);
    expect(full.size).toBeGreaterThan(100);
  });

  it('repeats public.css declarations exactly so first paint matches the hydrated page', () => {
    const divergences: string[] = [];
    for (const [selector, declarations] of shell) {
      if (selectorAllowlist.has(selector)) continue;
      const reference = full.get(selector);
      if (!reference) {
        divergences.push(`${selector}: missing from public.css`);
        continue;
      }
      for (const [property, value] of declarations) {
        if (!reference.has(property)) divergences.push(`${selector} ${property}: only in the shell`);
        else if (reference.get(property) !== value)
          divergences.push(`${selector} ${property}: ${value} !== public.css ${reference.get(property)}`);
      }
    }
    expect(divergences).toEqual([]);
  });

  it('keeps the shipped critical bundle generated from the current sources', () => {
    const result = spawnSync(process.execPath, ['scripts/generate-public-critical.mjs', '--check'], {
      cwd: new URL('../../', import.meta.url),
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
