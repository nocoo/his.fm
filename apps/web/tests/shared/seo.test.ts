import { describe, expect, it } from 'vitest';
import { parseSeoOverride, siteSeoSchema, siteSeoUpdateSchema } from '../../src/shared/seo';

describe('seo', () => {
  it('parses overrides and applies site defaults', () => {
    expect(parseSeoOverride('{"title":"x","noindex":true}')).toEqual({ title: 'x', noindex: true });
    expect(parseSeoOverride('not-json')).toEqual({});
    expect(siteSeoSchema.parse({}).defaultTitle).toContain('his.fm');
    expect(siteSeoSchema.safeParse({ defaultOgImageUrl: 'https://f.no.mt/x.webp' }).success).toBe(true);
    expect(siteSeoSchema.safeParse({ defaultOgImageUrl: 'ftp://bad' }).success).toBe(false);
    expect(siteSeoSchema.safeParse({ defaultOgImageUrl: '/images/hero.webp' }).success).toBe(true);
    expect(siteSeoSchema.safeParse({ defaultOgImageUrl: '/media/../secret' }).success).toBe(false);
    expect(parseSeoOverride({ title: 'ok' })).toEqual({ title: 'ok' });
    expect(parseSeoOverride(null)).toEqual({});
  });

  it('defaults to brand share artwork and allows clearing the saved site image', () => {
    expect(siteSeoSchema.parse({}).defaultOgImageUrl).toBe('/brand/share.jpg');
    expect(siteSeoSchema.parse({ defaultOgImageUrl: '' }).defaultOgImageUrl).toBe('');
    expect(siteSeoUpdateSchema.parse({ version: 1, defaultOgImageUrl: '' })).toEqual({
      version: 1,
      defaultOgImageUrl: '',
    });
    expect(siteSeoSchema.parse({ defaultOgImageUrl: '/brand/share.jpg' }).defaultOgImageUrl).toBe(
      '/brand/share.jpg',
    );
    expect(siteSeoUpdateSchema.parse({ version: 1, defaultOgImageUrl: '/brand/share.jpg' })).toEqual({
      version: 1,
      defaultOgImageUrl: '/brand/share.jpg',
    });
    expect(siteSeoSchema.safeParse({ defaultOgImageUrl: '/brand/../private.jpg' }).success).toBe(false);
    expect(parseSeoOverride({ ogImageUrl: '' })).toEqual({});
  });
});
