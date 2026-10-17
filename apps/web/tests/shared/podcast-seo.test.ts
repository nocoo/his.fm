import { describe, expect, it } from 'vitest';
import { siteSeoSchema, siteSeoUpdateSchema } from '../../src/shared/seo';
import { agentOpenApi } from '../../worker/agent-contract';

describe('podcast SEO settings', () => {
  it('leaves cover and owner email unconfigured without changing existing metadata', () => {
    const existing = {
      siteName: 'Existing show',
      podcastAuthor: 'Existing producer',
      podcastDescription: 'Existing description',
      defaultOgImageUrl: '/images/episode-01.webp',
      itunesCategory: 'Technology',
      itunesExplicit: true,
    };
    expect(siteSeoSchema.parse(existing)).toMatchObject({
      ...existing,
      podcastAuthorType: 'Organization',
      podcastAuthorUrl: '',
      podcastCoverUrl: '',
      podcastOwnerEmail: '',
    });
    expect(siteSeoUpdateSchema.parse({ version: 3, podcastDescription: 'New description' })).toEqual({
      version: 3,
      podcastDescription: 'New description',
    });
    expect(siteSeoUpdateSchema.parse({ version: 3, podcastCoverUrl: '', podcastOwnerEmail: '' })).toEqual({
      version: 3,
      podcastCoverUrl: '',
      podcastOwnerEmail: '',
    });
  });

  it('validates author types without resetting a saved Person on unrelated partial PUTs', () => {
    const current = siteSeoSchema.parse({
      podcastAuthor: 'Confirmed author',
      podcastAuthorType: 'Person',
      podcastAuthorUrl: 'https://author.example.test',
    });
    const { version, ...patch } = siteSeoUpdateSchema.parse({ version: 3, defaultTitle: 'New title' });
    expect(version).toBe(3);
    expect(patch).not.toHaveProperty('podcastAuthorType');
    expect(patch).not.toHaveProperty('podcastAuthorUrl');
    expect(siteSeoSchema.parse({ ...current, ...patch })).toMatchObject({
      podcastAuthor: 'Confirmed author',
      podcastAuthorType: 'Person',
      podcastAuthorUrl: 'https://author.example.test',
      defaultTitle: 'New title',
    });
    expect(siteSeoUpdateSchema.parse({ version: 3, podcastAuthorType: 'Organization' })).toEqual({
      version: 3,
      podcastAuthorType: 'Organization',
    });
    expect(siteSeoSchema.safeParse({ podcastAuthorType: 'Other' }).success).toBe(false);
  });

  it('accepts an optional HTTPS author homepage and explicit clearing without identity defaults', () => {
    expect(siteSeoSchema.parse({}).podcastAuthorUrl).toBe('');
    expect(
      siteSeoSchema.parse({ podcastAuthorUrl: ' https://author.example.test/about ' }).podcastAuthorUrl,
    ).toBe('https://author.example.test/about');
    expect(siteSeoUpdateSchema.parse({ version: 2, podcastAuthorUrl: '' })).toEqual({
      version: 2,
      podcastAuthorUrl: '',
    });
    for (const podcastAuthorUrl of [
      '/about',
      'http://author.example.test',
      'javascript:alert(1)',
      'https://user:password@author.example.test',
      'not a URL',
      'https://author.example.test/'.padEnd(2049, 'a'),
    ])
      expect(siteSeoSchema.safeParse({ podcastAuthorUrl }).success).toBe(false);
  });

  it.each([
    '',
    '/images/podcast-cover.png',
    '/media/covers/show.jpg',
    'https://f.no.mt/images/show.jpeg',
    'https://cdn.example.test/SHOW.PNG?version=2',
  ])('accepts configured PNG/JPEG addresses or an unconfigured cover: %s', (podcastCoverUrl) => {
    expect(siteSeoSchema.safeParse({ podcastCoverUrl }).success).toBe(true);
    expect(siteSeoUpdateSchema.safeParse({ version: 1, podcastCoverUrl }).success).toBe(true);
  });

  it.each([
    '/images/show.webp',
    '/images/show.svg',
    '/images/../private.png',
    '/other/show.png',
    '//cdn.example.test/show.png',
    'http://cdn.example.test/show.png',
    'javascript:alert(1).png',
    'https://user:password@cdn.example.test/show.png',
    'https://cdn.example.test/show.webp?file=show.png',
    'https://[invalid/show.png',
    'not a URL',
  ])('rejects invalid or unsupported podcast cover address: %s', (podcastCoverUrl) => {
    expect(siteSeoSchema.safeParse({ podcastCoverUrl }).success).toBe(false);
  });

  it('accepts an explicitly supplied owner mailbox and allows clearing it', () => {
    expect(siteSeoSchema.parse({ podcastOwnerEmail: ' owner@example.test ' }).podcastOwnerEmail).toBe(
      'owner@example.test',
    );
    expect(siteSeoUpdateSchema.parse({ version: 2, podcastOwnerEmail: '' }).podcastOwnerEmail).toBe('');
  });

  it.each([
    'not-email',
    'Owner <owner@example.test>',
    'owner@example.test\nBcc: other@example.test',
    'a'.repeat(255),
  ])('rejects invalid contact email: %s', (podcastOwnerEmail) => {
    expect(siteSeoSchema.safeParse({ podcastOwnerEmail }).success).toBe(false);
  });

  it('exposes podcast settings through the existing versioned, scope-gated API contract', () => {
    const contract = agentOpenApi('https://his.fm');
    expect(contract.components.schemas.SiteSeo.properties).toHaveProperty('podcastCoverUrl');
    expect(contract.components.schemas.SiteSeo.properties).toHaveProperty('podcastOwnerEmail');
    expect(contract.components.schemas.SiteSeo.properties).toHaveProperty('podcastAuthorType');
    expect(contract.components.schemas.SiteSeo.properties).toHaveProperty('podcastAuthorUrl');
    const seo = contract.paths['/seo'];
    expect(seo.get['x-required-scopes']).toEqual(['prompts:read']);
    expect(seo.put['x-required-scopes']).toEqual(['prompts:write']);
    const input = seo.put.requestBody.content['application/json'].schema;
    expect(input.required).toEqual(['version']);
    expect(input.properties).toHaveProperty('podcastCoverUrl');
    expect(input.properties).toHaveProperty('podcastOwnerEmail');
    expect(input.properties).toHaveProperty('podcastAuthorType');
    expect(input.properties).toHaveProperty('podcastAuthorUrl');
    expect(input.additionalProperties).toBe(false);
  });
});
