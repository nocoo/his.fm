import { describe, expect, it } from 'vitest';
import { siteSeoSchema } from '../../src/shared/seo';
import { injectSeoIntoHtml, seoHeadTags } from '../../src/shared/seo-head';
import { resolveSiteDefaults } from '../../src/shared/seo-resolve';

describe('seo-head', () => {
  it('escapes titles and emits canonical, robots and social tags', () => {
    const site = siteSeoSchema.parse({ defaultTitle: 'A & B <test>' });
    const seo = resolveSiteDefaults(site, 'https://his.fm');
    const tags = seoHeadTags({ ...seo, noindex: true });
    expect(tags).toContain('<title>A &amp; B &lt;test&gt;</title>');
    expect(tags).toContain('noindex, follow');
    expect(tags).toContain('rel="canonical" href="https://his.fm/"');
    expect(tags).toContain('property="og:image"');
  });

  it('injects head tags and JSON-LD before closing head', () => {
    const seo = resolveSiteDefaults(siteSeoSchema.parse({}), 'https://his.fm');
    const html = injectSeoIntoHtml('<html><head></head><body></body></html>', seo, [
      { '@type': 'PodcastSeries' },
    ]);
    expect(html).toContain('</head>');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('PodcastSeries');
    expect(injectSeoIntoHtml('<html></html>', seo)).toContain('<title>');
  });

  it('replaces managed head tags instead of appending duplicates', () => {
    const seo = resolveSiteDefaults(siteSeoSchema.parse({ defaultTitle: 'First' }), 'https://his.fm');
    const shell =
      '<html><head><title>Old</title><meta name="description" content="old" /><link rel="canonical" href="https://old.example/" /></head><body></body></html>';
    const html = injectSeoIntoHtml(shell, { ...seo, title: 'Second', description: 'new' });
    expect(html.match(/<title>/g)?.length).toBe(1);
    expect(html).toContain('<title>Second</title>');
    expect(html).not.toContain('Old</title>');
    expect(html).not.toContain('content="old"');
    expect(html).not.toContain('https://old.example/');
  });
});
