import { describe, expect, it } from 'vitest';
import { editorialPriority } from '../../src/shared/channel';
import { routeChannel } from '../../worker/channel';
import { human } from './production-fixture';

describe('routeChannel', () => {
  it('returns editorial priority for authorized reads', async () => {
    const response = await routeChannel(new Request('https://example.test/api/agent/channel'), {} as Env, {
      ...human,
      scopes: ['prompts:read'],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ priority: [...editorialPriority] });
  });

  it('rejects legacy channel writes', async () => {
    await expect(
      routeChannel(new Request('https://example.test/api/agent/channel', { method: 'PUT' }), {} as Env, {
        ...human,
        scopes: ['prompts:write'],
      }),
    ).rejects.toMatchObject({ status: 405 });
  });
});
