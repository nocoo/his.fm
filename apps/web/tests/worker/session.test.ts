import { describe, expect, it } from 'vitest';
import { enrichSession } from '../../worker/session';

describe('worker/session', () => {
  it('merges author profile into the admin session', async () => {
    const fetchFn = async () =>
      new Response(JSON.stringify({ name: 'Zheng Li', avatar: 'https://img.example/a.png' }), {
        status: 200,
      });
    await expect(
      enrichSession({ user: { email: 'editor@example.com' }, mode: 'access' }, fetchFn),
    ).resolves.toEqual({
      user: {
        email: 'editor@example.com',
        name: 'Zheng Li',
        avatar: 'https://img.example/a.png',
      },
      mode: 'access',
    });
  });

  it('keeps auth session when profile lookup fails', async () => {
    const fetchFn = async () => new Response('missing', { status: 404 });
    await expect(
      enrichSession({ user: { email: 'editor@example.com' }, mode: 'local' }, fetchFn),
    ).resolves.toEqual({
      user: { email: 'editor@example.com', name: null, avatar: null },
      mode: 'local',
    });
  });
});
