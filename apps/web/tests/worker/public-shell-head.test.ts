import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { preparePublicShellHead, publicCriticalCssForTests } from '../../worker/public-shell-head';

const shellHeadSource = readFileSync(
  fileURLToPath(new URL('../../worker/public-shell-head.ts', import.meta.url)),
  'utf8',
);

describe('public shell head', () => {
  it('inlines critical CSS before the blocking stylesheet so the full bundle wins', () => {
    const html = preparePublicShellHead(
      '<html><head><meta charset="UTF-8" /><link rel="stylesheet" href="/assets/index.css" crossorigin></head><body></body></html>',
    );
    const critical = html.match(/<style id="public-critical">([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(critical.length).toBeGreaterThan(1000);
    expect(critical).toContain('.site-header');
    expect(critical).toContain('.home-hero');
    expect(critical).toContain('grid-template-columns:1fr');
    expect(critical).toBe(publicCriticalCssForTests());
    expect(html.indexOf('<meta charset')).toBeLessThan(html.indexOf('<style id="public-critical">'));
    expect(html.indexOf('<style id="public-critical">')).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
  });

  it('keeps the full public stylesheet render-blocking without preload promotion', () => {
    const html = preparePublicShellHead(
      '<html><head><link rel="stylesheet" href="/assets/index.css" crossorigin></head><body></body></html>',
    );
    expect(html).toContain('<link rel="stylesheet" href="/assets/index.css" crossorigin>');
    expect(html).not.toContain('data-defer-style');
    expect(html).not.toContain('rel="preload" as="style"');
    expect(html.includes('onload=')).toBe(false);
    expect(html.match(/<link rel="stylesheet"/g)?.length).toBe(1);
    expect(html).not.toMatch(
      /<script>\(function\(\)\{var links=document\.querySelectorAll\("link\[data-defer-style\]"\)/,
    );
  });

  it('leaves documents without stylesheets untouched aside from critical CSS', () => {
    const html = preparePublicShellHead('<html><head></head></html>');
    expect(html).toContain('<style id="public-critical">');
    expect(html).not.toContain('<link rel="stylesheet"');
  });

  it('inlines critical CSS when the shell template has no closing head tag', () => {
    const html = preparePublicShellHead('<html><link rel="stylesheet" href="/assets/index.css"></html>');
    expect(html.indexOf('<style id="public-critical">')).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
  });

  it('does not defer stylesheets with preload promotion or inline handlers', () => {
    expect(shellHeadSource).not.toContain('data-defer-style');
    expect(shellHeadSource).not.toContain('onload=');
    expect(shellHeadSource).not.toMatch(/promoteDeferredStyles/);
  });
});
