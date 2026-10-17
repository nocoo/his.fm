import { describe, expect, it } from 'vitest';
import { buildRobotsTxt } from '../../worker/robots';

describe('robots.txt', () => {
  it('allows crawlers and points to the sitemap', () => {
    expect(buildRobotsTxt('https://his.fm')).toContain('Sitemap: https://his.fm/sitemap.xml');
  });
});
