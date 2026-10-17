import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { themeCoverFrameSrc } from '../src/brand/themes';
import { themeIdSchema } from '../src/shared/appearance';
import { composeCoverSvg, coverText } from '../src/shared/cover-composition';
import type { Actor } from '../src/shared/production';
import { requireScope } from './authorization';
import { getCategory } from './categories';
import { loadCoverFonts } from './cover-fonts';
import { getEpisode } from './episodes';
import { HttpError, json } from './http';
import { coverDimensions, rasterType } from './media-validation';
import { readBytes } from './production-body';
import { getProduction } from './production-store';

const coverQuery = z.strictObject({
  theme: themeIdSchema,
  version: z.coerce.number().int().positive().optional(),
});
const maxCoverBytes = 4 * 1024 * 1024;
// ponytail: one render per isolate bounds WASM memory; use a queue if contention grows.
let composing = false;

export function coverSource(origin: string, mediaBase: string, value: string, local = false) {
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    throw new HttpError(400, '封面地址无效');
  }
  const base = new URL(`${mediaBase.replace(/\/$/, '')}/`, origin);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== 'https:' && url.origin !== origin)
  ) {
    throw new HttpError(400, '封面地址不能包含凭据、查询参数或片段');
  }
  const localSeedImage =
    local && url.origin === 'https://f.no.mt' && /^\/images\/episode-0[1-3]\.webp$/.test(url.pathname);
  if (localSeedImage || (url.origin === origin && /^\/images\/[a-zA-Z0-9/_.-]+$/.test(url.pathname))) {
    return { assetPath: url.pathname, key: null };
  }
  const path =
    url.origin === origin && url.pathname.startsWith('/media/')
      ? url.pathname.slice('/media/'.length)
      : url.origin === base.origin && url.pathname.startsWith(base.pathname)
        ? url.pathname.slice(base.pathname.length)
        : '';
  let key: string;
  try {
    key = decodeURIComponent(path);
  } catch {
    throw new HttpError(400, '封面存储路径无效');
  }
  if (!key || /[\\\p{Cc}]/u.test(key) || key.split('/').some((part) => part === '..' || part === '.')) {
    throw new HttpError(400, '只能导出本站 images、media 或已配置 CDN 上的封面，请先上传干净原图');
  }
  return { assetPath: null, key };
}

async function sourceBytes(env: Env, origin: string, source: string) {
  const { assetPath, key } = coverSource(origin, env.MEDIA_BASE_URL, source, env.ENVIRONMENT === 'local');
  if (assetPath !== null) {
    const response = await env.ASSETS.fetch(new Request(new URL(assetPath, origin)));
    if (!response.ok) throw new HttpError(404, '封面原图不存在');
    return readBytes(response, maxCoverBytes);
  }
  const object = await env.MEDIA.get(key);
  if (!object) throw new HttpError(404, '封面原图不存在');
  if (object.size > maxCoverBytes) {
    await object.body.cancel();
    throw new HttpError(413, '合成封面的原图不能超过 4 MiB，请先缩小干净原图');
  }
  return readBytes(new Response(object.body), maxCoverBytes);
}

export async function routeCover(
  request: Request,
  env: Env,
  actor: Actor,
  resource: 'productions' | 'episodes',
  id: string,
): Promise<Response> {
  requireScope(actor, resource === 'productions' ? 'productions:read' : 'episodes:read');
  if (request.method !== 'GET') throw new HttpError(405, '封面导出只支持 GET');
  const url = new URL(request.url);
  const query = coverQuery.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success || [...url.searchParams.keys()].length !== new Set(url.searchParams.keys()).size) {
    throw new HttpError(400, '请选择有效的 theme；可选 version 必须为已保存的版本号');
  }
  const record =
    resource === 'productions' ? await getProduction(env.DB, id) : await getEpisode(env.DB, id, false, actor);
  if (query.data.version !== undefined && query.data.version !== record.version) {
    throw new HttpError(409, '节目已更新，请刷新后下载封面');
  }
  const source = 'assets' in record ? record.assets.cover?.url : record.coverUrl;
  if (!source) throw new HttpError(409, '请先上传并保存干净封面原图');
  const category = await getCategory(env.DB, record.category);
  const copy = { title: record.title, episodeNumber: record.episodeNumber, categoryName: category.name };
  if (composing)
    return json(
      {
        error: '封面正在生成，请稍后重试',
        code: 'unavailable',
        documentation: `${url.origin}/api/agent/instructions`,
      },
      503,
      { 'Retry-After': '1' },
    );
  composing = true;
  try {
    const bytes = await sourceBytes(env, url.origin, source);
    coverDimensions(bytes);
    const { mime } = rasterType(bytes);
    const frameResponse = await env.ASSETS.fetch(
      new Request(new URL(themeCoverFrameSrc(query.data.theme), url.origin)),
    );
    if (!frameResponse.ok) throw new HttpError(503, '品牌框架暂时不可用，请稍后重试');
    const frame = new TextDecoder().decode(await readBytes(frameResponse, 256 * 1024));
    if (!frame.startsWith('<svg ')) throw new HttpError(503, '品牌框架格式无效');
    const { fonts, families } = await loadCoverFonts(env, url.origin, coverText(query.data.theme, copy));
    const svg = composeCoverSvg(
      query.data.theme,
      copy,
      `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
      frame,
      families,
    );
    let png: Uint8Array;
    try {
      const { renderCoverPng } = await import('./cover-raster');
      png = await renderCoverPng(svg, fonts);
    } catch (error) {
      if (error instanceof HttpError) {
        if (error.status === 503) return json({ error: error.message }, 503, { 'Retry-After': '1' });
        throw error;
      }
      throw new HttpError(422, '封面图片无法解码或排版，请检查原图后重试');
    }
    return new Response(new Uint8Array(png), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(png.byteLength),
        'Content-Disposition': `attachment; filename="his-fm-ep-${String(record.episodeNumber).padStart(3, '0')}-${query.data.theme}.png"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Cover-Theme': query.data.theme,
        'X-Resource-Version': String(record.version),
      },
    });
  } finally {
    composing = false;
  }
}
