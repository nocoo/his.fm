import { z } from 'zod';
import type { Config } from './config.ts';

const channelSchema = z.object({
  channel: z.object({ version: z.number().int().positive(), content: z.string() }),
});
const productionSchema = z.object({
  production: z
    .object({
      id: z.string(),
      version: z.number().int().positive(),
      stage: z.string(),
      scriptVersion: z.number().int(),
      approvals: z.object({
        script: z.object({ at: z.string(), by: z.string() }).nullable(),
        brief: z.object({ at: z.string(), by: z.string() }).nullable(),
      }),
    })
    .passthrough(),
});
export type Channel = z.infer<typeof channelSchema>['channel'];
export type Production = z.infer<typeof productionSchema>['production'];

export class WebsiteClient {
  readonly site: Config['websites']['local'];
  private readonly request: typeof fetch;
  constructor(site: Config['websites']['local'], request: typeof fetch = fetch) {
    this.site = site;
    this.request = request;
  }
  private async get(path: string) {
    let response: Response;
    try {
      response = await this.request(new URL(`/api/agent/${path}`, this.site.baseUrl), {
        headers: { Authorization: `Bearer ${this.site.token}`, 'X-Hisfm-Station': this.site.stationId },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error('网站读取失败，请稍后重试。');
    }
    if (!response.ok) throw new Error(`网站读取失败（${response.status}）。`);
    return response.json() as Promise<unknown>;
  }
  async channel(): Promise<Channel> {
    return channelSchema.parse(await this.get('channel')).channel;
  }
  async production(id: string): Promise<Production> {
    return productionSchema.parse(await this.get(`productions/${encodeURIComponent(id)}`)).production;
  }
  async productions() {
    return this.get('productions');
  }
}
