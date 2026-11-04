import { describe, expect, it } from 'vitest';
import {
  PUBLIC_CACHE_REVISION_PARAM,
  publicContentRequestUrl,
  stripPublicCacheRevision,
  withPublicCacheRevision,
} from '../../src/shared/public-cache-revision';

describe('public cache revision', () => {
  it('scopes cache URLs by revision without changing the canonical path', () => {
    const url = new URL('https://his.fm/episodes?category=learning&page=2');
    const scoped = withPublicCacheRevision(url, 'abc123def');
    expect(scoped.searchParams.get(PUBLIC_CACHE_REVISION_PARAM)).toBe('abc123def');
    expect(scoped.pathname).toBe('/episodes');
    expect(scoped.searchParams.get('category')).toBe('learning');
    expect(stripPublicCacheRevision(scoped).href).toBe(url.href);
  });

  it('normalizes entrypoint requests back to the public URL', () => {
    const request = new Request('https://his.fm/?_hisfm_r=deploy-1');
    expect(publicContentRequestUrl(request).href).toBe('https://his.fm/');
  });
});
