import { describe, expect, it } from 'vitest';
import { deferPublicStylesheets } from '../../worker/public-shell-head';

describe('public shell head', () => {
  it('loads stylesheets asynchronously after preload', () => {
    const html = deferPublicStylesheets(
      '<html><head><link rel="stylesheet" href="/assets/index.css" crossorigin></head></html>',
    );
    expect(html).toContain('rel="preload" as="style"');
    expect(html).toContain('onload="this.onload=null;this.rel=\'stylesheet\'"');
    expect(html).toContain('<noscript><link rel="stylesheet"');
    expect(html.match(/<link rel="stylesheet"/g)?.length).toBe(1);
  });
});
