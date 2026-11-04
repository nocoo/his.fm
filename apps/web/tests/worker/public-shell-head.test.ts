import { describe, expect, it } from 'vitest';
import {
  deferPublicStylesheets,
  preparePublicShellHead,
  publicCriticalCssForTests,
} from '../../worker/public-shell-head';

describe('public shell head', () => {
  it('inlines critical CSS for first paint and defers the full stylesheet', () => {
    const html = preparePublicShellHead(
      '<html><head><link rel="stylesheet" href="/assets/index.css" crossorigin></head><body></body></html>',
    );
    const critical = html.match(/<style id="public-critical">([\s\S]*?)<\/style>/)?.[1] ?? '';
    expect(critical.length).toBeGreaterThan(1000);
    expect(critical).toContain('.site-header');
    expect(critical).toContain('.home-hero');
    expect(critical).toContain('grid-template-columns:1fr');
    expect(critical).toBe(publicCriticalCssForTests());
    expect(html).toContain('rel="preload" as="style"');
    expect(html).toContain('onload="this.onload=null;this.rel=\'stylesheet\'"');
    expect(html.match(/<link rel="stylesheet"/g)?.length).toBe(1);
  });

  it('loads stylesheets asynchronously after preload when critical is absent', () => {
    const html = deferPublicStylesheets(
      '<html><head><link rel="stylesheet" href="/assets/index.css" crossorigin></head></html>',
    );
    expect(html).toContain('rel="preload" as="style"');
    expect(html).not.toContain('<style id="public-critical">');
  });

  it('prepends critical CSS when the shell template has no closing head tag', () => {
    const html = preparePublicShellHead('<html><link rel="stylesheet" href="/assets/index.css"></html>');
    expect(html.startsWith('<style id="public-critical">')).toBe(true);
  });

  it('leaves stylesheet links without href unchanged', () => {
    expect(deferPublicStylesheets('<link rel="stylesheet">')).toBe('<link rel="stylesheet">');
  });
});
