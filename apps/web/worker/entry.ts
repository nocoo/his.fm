import { WorkerEntrypoint } from 'cloudflare:workers';
import { publicContentResponse } from './public-cache';

export class PublicContent extends WorkerEntrypoint<Env> {
  fetch(request: Request): Promise<Response> {
    return publicContentResponse(request, this.env);
  }

  async invalidate(): Promise<void> {
    if (!this.ctx.cache) throw new Error('Workers Cache is unavailable');
    const result = await this.ctx.cache.purge({ purgeEverything: true });
    if (!result.success) throw new Error(`Public cache purge failed: ${JSON.stringify(result.errors)}`);
  }
}

export { default } from './index';
