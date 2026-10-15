import { promptSetSchema } from '@his-fm/contracts';
import { z } from 'zod';
import type { Config } from './config.ts';

const channelSchema = z.object({
  channel: z.object({ version: z.number().int().positive(), content: z.string(), prompts: promptSetSchema }),
});
const productionSchema = z.object({
  categoryProfile: z.object({
    id: z.string(),
    name: z.string(),
    version: z.number().int().positive(),
    prompt: z.string(),
  }),
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
export type Production = z.infer<typeof productionSchema>['production'] &
  Pick<z.infer<typeof productionSchema>, 'categoryProfile'>;

export class WebsiteClient {
  readonly site: Config['websites']['local'];
  private readonly request: typeof fetch;
  constructor(site: Config['websites']['local'], request: typeof fetch = fetch) {
    this.site = site;
    this.request = request;
  }
  private async get(path: string, commandId: string) {
    if (!commandId?.trim()) throw new Error('网站读取缺少原始指令。');
    let response: Response;
    try {
      response = await this.request(new URL(`/api/agent/${path}`, this.site.baseUrl), {
        headers: {
          Authorization: `Bearer ${this.site.token}`,
          'X-Hisfm-Station': this.site.stationId,
          'X-Hisfm-Command': commandId,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error('网站读取失败，请稍后重试。');
    }
    if (!response.ok) throw new Error(`网站读取失败（${response.status}）。`);
    return response.json() as Promise<unknown>;
  }
  async channel(commandId: string): Promise<Channel> {
    return channelSchema.parse(await this.get('channel', commandId)).channel;
  }
  async production(id: string, commandId: string): Promise<Production> {
    const result = productionSchema.parse(await this.get(`productions/${encodeURIComponent(id)}`, commandId));
    return { ...result.production, categoryProfile: result.categoryProfile };
  }
  async productions(commandId: string) {
    return this.get('productions', commandId);
  }
  async speech(id: string, commandId: string, generation: string, method = 'GET', body?: Uint8Array) {
    let response: Response;
    try {
      response = await this.request(
        new URL(`/api/agent/runtime/speech/${encodeURIComponent(id)}`, this.site.baseUrl),
        {
          method,
          headers: {
            Authorization: `Bearer ${this.site.token}`,
            'X-Hisfm-Station': this.site.stationId,
            'X-Hisfm-Generation': generation,
            'X-Hisfm-Command': commandId,
            'Content-Type': 'audio/wav',
            ...(body ? { 'Content-Length': String(body.byteLength) } : {}),
          },
          ...(body ? { body: Buffer.from(body) } : {}),
          redirect: 'error',
          signal: AbortSignal.timeout(180000),
        },
      );
    } catch {
      throw new Error('语音任务传输失败，请重试同一任务。');
    }
    if (!response.ok) throw new Error(`语音任务被拒绝（${response.status}）。`);
    return response.json() as Promise<{ complete?: boolean; input?: unknown; result?: unknown }>;
  }
}
