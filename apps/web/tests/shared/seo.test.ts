import { describe, expect, it } from 'vitest';
import { parseSeoOverride, siteSeoSchema } from '../../src/shared/seo';

describe('seo', () => {
  it('parses overrides and applies site defaults', () => {
    expect(parseSeoOverride('{"title":"x","noindex":true}')).toEqual({ title: 'x', noindex: true });
    expect(parseSeoOverride('not-json')).toEqual({});
    expect(siteSeoSchema.parse({}).defaultTitle).toContain('his.fm');
    expect(siteSeoSchema.safeParse({ defaultOgImageUrl: 'https://f.no.mt/x.webp' }).success).toBe(true);
    expect(siteSeoSchema.safeParse({ defaultOgImageUrl: 'ftp://bad' }).success).toBe(false);
    expect(parseSeoOverride({ title: 'ok' })).toEqual({ title: 'ok' });
  });
});
