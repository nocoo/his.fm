import { describe, expect, it } from 'vitest';
import {
  deferPublicStylesheets,
  preparePublicShellHead,
  publicCriticalCssForTests,
} from '../../worker/public-shell-head';

describe('public shell head', () => {
  it('inlines critical CSS before the deferred stylesheet so the full bundle wins', () => {
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
    expect(html.indexOf('<style id="public-critical">')).toBeLessThan(
      html.indexOf('<link rel="preload" as="style"'),
    );
  });

  it('promotes preloaded stylesheets without inline event handlers', () => {
    const html = preparePublicShellHead(
      '<html><head><link rel="stylesheet" href="/assets/index.css" crossorigin></head><body></body></html>',
    );
    expect(html).toContain('data-defer-style');
    expect(html.includes('onload=')).toBe(false);
    expect(html.match(/<link rel="stylesheet"/g)?.length).toBe(1);
    expect(html).toContain('crossorigin></noscript>');
    expect(html).toMatch(
      /<script>\(function\(\)\{var links=document\.querySelectorAll\("link\[data-defer-style\]"\)/,
    );
    expect(html.indexOf('data-defer-style')).toBeLessThan(html.indexOf('<script>(function()'));
    expect(html.indexOf('<script>(function()')).toBeLessThan(html.indexOf('</head>'));
  });

  it('defers stylesheets alone when critical CSS is not involved', () => {
    const html = deferPublicStylesheets(
      '<html><head><link rel="stylesheet" href="/assets/index.css" crossorigin></head></html>',
    );
    expect(html).toContain('rel="preload" as="style"');
    expect(html).toContain('data-defer-style');
    expect(html).not.toContain('<style id="public-critical">');
    expect(html.includes('onload=')).toBe(false);
  });

  it('leaves documents without stylesheets untouched', () => {
    expect(deferPublicStylesheets('<html><head></head></html>')).toBe('<html><head></head></html>');
    expect(deferPublicStylesheets('<link rel="stylesheet">')).toBe('<link rel="stylesheet">');
  });

  it('adds the promotion script when the shell template has no closing head tag', () => {
    const html = preparePublicShellHead('<html><link rel="stylesheet" href="/assets/index.css"></html>');
    expect(html.indexOf('<style id="public-critical">')).toBeLessThan(
      html.indexOf('<link rel="preload" as="style"'),
    );
    expect(html).toContain('<script>(function()');
  });
});
