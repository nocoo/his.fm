import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicContent } from '../../worker/entry';

const mocks = vi.hoisted(() => ({ response: vi.fn() }));
vi.mock('../../worker/public-cache', () => ({ publicContentResponse: mocks.response }));
vi.mock('../../worker/index', () => ({ default: {} }));
vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class {
    ctx: ExecutionContext;
    env: Env;
    constructor(ctx: ExecutionContext, env: Env) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

beforeEach(() => vi.resetAllMocks());

describe('public content entrypoint', () => {
  it('renders using the entrypoint environment and the normalized gateway request', async () => {
    const env = {} as Env;
    const entrypoint = new PublicContent({} as ExecutionContext, env);
    const request = new Request('https://his.fm/');
    const response = new Response('public');
    mocks.response.mockResolvedValueOnce(response);
    expect(await entrypoint.fetch(request)).toBe(response);
    expect(mocks.response).toHaveBeenCalledWith(request, env);
  });

  it('purges the owning entrypoint cache and checks the native result', async () => {
    const purge = vi.fn().mockResolvedValue({ success: true });
    const context = { cache: { purge } } as unknown as ExecutionContext;
    const entrypoint = new PublicContent(context, {} as Env);
    await expect(entrypoint.invalidate()).resolves.toBeUndefined();
    expect(purge).toHaveBeenCalledExactlyOnceWith({ purgeEverything: true });
    purge.mockResolvedValueOnce({ success: false, errors: [{ message: 'Rate limited' }] });
    await expect(entrypoint.invalidate()).rejects.toThrow('Rate limited');
    purge.mockRejectedValueOnce(new Error('Network failure'));
    await expect(entrypoint.invalidate()).rejects.toThrow('Network failure');
  });

  it('reports a missing cache runtime instead of claiming successful invalidation', async () => {
    const entrypoint = new PublicContent({} as ExecutionContext, {} as Env);
    await expect(entrypoint.invalidate()).rejects.toThrow('Workers Cache is unavailable');
  });
});
