import { describe, expect, it } from 'vitest';
import {
  AUTHOR_PROFILE_ENDPOINT,
  fetchAuthorProfile,
  hashEmail,
  normalizeEmail,
} from '../../worker/author-profile';

const KNOWN_EMAIL = 'architie@gmail.com';
const KNOWN_HASH = '7ba563171c26fb9b82e9f7750840c0455602eb35025192027230bcb40aae1217';

describe('worker/author-profile', () => {
  it('normalizes and hashes email', async () => {
    expect(normalizeEmail('  Architie@Gmail.com  ')).toBe(KNOWN_EMAIL);
    expect(await hashEmail(KNOWN_EMAIL)).toBe(KNOWN_HASH);
    expect(await hashEmail('  ARCHITIE@GMAIL.COM\n')).toBe(KNOWN_HASH);
  });

  it('returns empty profile for blank email', async () => {
    await expect(fetchAuthorProfile('')).resolves.toEqual({ name: null, avatar: null });
    await expect(fetchAuthorProfile('   ')).resolves.toEqual({ name: null, avatar: null });
  });

  it('fetches profile by hash without following redirects', async () => {
    let init: RequestInit | undefined;
    const fetchFn = async (input: RequestInfo | URL, requestInit?: RequestInit) => {
      init = requestInit;
      expect(String(input)).toBe(`${AUTHOR_PROFILE_ENDPOINT}?hash=${KNOWN_HASH}`);
      return new Response(JSON.stringify({ name: 'Zheng Li', avatar: 'https://img.example/a.png' }), {
        status: 200,
      });
    };
    await expect(fetchAuthorProfile(KNOWN_EMAIL, fetchFn)).resolves.toEqual({
      name: 'Zheng Li',
      avatar: 'https://img.example/a.png',
    });
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects insecure avatars and fails soft on errors', async () => {
    const httpAvatar = async () =>
      new Response(JSON.stringify({ name: 'Zheng Li', avatar: 'http://insecure.example/a.png' }), {
        status: 200,
      });
    await expect(fetchAuthorProfile(KNOWN_EMAIL, httpAvatar)).resolves.toEqual({
      name: 'Zheng Li',
      avatar: null,
    });

    const missing = async () => new Response('missing', { status: 404 });
    await expect(fetchAuthorProfile(KNOWN_EMAIL, missing)).resolves.toEqual({
      name: null,
      avatar: null,
    });

    const broken = async () => new Response('not-json', { status: 200 });
    await expect(fetchAuthorProfile(KNOWN_EMAIL, broken)).resolves.toEqual({
      name: null,
      avatar: null,
    });
  });

  it('rejects oversized payloads', async () => {
    const huge = async () =>
      new Response(JSON.stringify({ name: 'A' }), {
        status: 200,
        headers: { 'Content-Length': '100000' },
      });
    await expect(fetchAuthorProfile(KNOWN_EMAIL, huge)).resolves.toEqual({
      name: null,
      avatar: null,
    });
  });
});
