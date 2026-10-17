import { Buffer } from 'node:buffer';
import { themeCoverFrameSrc } from '../src/brand/themes';
import { composeCoverSvg, coverArtwork, coverDesignSize, coverText } from '../src/shared/cover-composition';
import { composeShareSvg } from '../src/shared/share-composition';
import { getAppearance } from './appearance';
import { coverSource } from './cover';
import { loadCoverFonts } from './cover-fonts';
import { HttpError, json } from './http';
import { readBytes } from './production-body';

export const episodeArtRoute = /^\/episodes\/([^/]+)\/(art|share)\.jpg$/;
const maxSourceBytes = 20_000_000;
let composing = false;

async function readSvg(env: Env, origin: string, path: string) {
  const response = await env.ASSETS.fetch(new Request(new URL(path, origin)));
  if (!response.ok) throw new HttpError(503, '品牌框架暂时不可用，请稍后重试');
  const svg = new TextDecoder().decode(await readBytes(response, 256 * 1024));
  if (!svg.startsWith('<svg ')) throw new HttpError(503, '品牌框架格式无效');
  return svg;
}

async function sourceStream(env: Env, origin: string, source: string) {
  const { assetPath, key } = coverSource(origin, env.MEDIA_BASE_URL, source, env.ENVIRONMENT === 'local');
  if (assetPath !== null) {
    const response = await env.ASSETS.fetch(new Request(new URL(assetPath, origin)));
    if (!response.ok || !response.body) throw new HttpError(404, '封面原图不存在');
    if (Number(response.headers.get('Content-Length')) > maxSourceBytes) {
      await response.body.cancel();
      throw new HttpError(413, '封面原图不能超过 20 MB');
    }
    return response.body;
  }
  const object = await env.MEDIA.get(key);
  if (!object) throw new HttpError(404, '封面原图不存在');
  if (object.size > maxSourceBytes) {
    await object.body.cancel();
    throw new HttpError(413, '封面原图不能超过 20 MB');
  }
  return object.body;
}

export async function routeEpisodeArt(
  request: Request,
  env: Env,
  encodedId: string,
  kind: 'art' | 'share',
): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, '节目图片只支持 GET 或 HEAD');
  const url = new URL(request.url);
  const parameters = [...url.searchParams];
  const sizeValue = url.searchParams.get('size') ?? '1400';
  const size = Number(sizeValue);
  if (
    (kind === 'share' && parameters.length !== 0) ||
    parameters.some(([key]) => key !== 'size') ||
    parameters.length > 1 ||
    !/^\d{4}$/.test(sizeValue) ||
    size < 1400 ||
    size > 3000
  ) {
    throw new HttpError(400, '方形封面 size 必须为 1400–3000 的整数；分享图不接受参数');
  }
  let id: string;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    throw new HttpError(400, '节目编号无效');
  }
  const episode = await env.DB.prepare(
    "SELECT e.title, e.episode_number AS episodeNumber, e.cover_url AS coverUrl, c.name AS categoryName FROM episodes e JOIN categories c ON c.id = e.category WHERE e.id = ? AND e.status = 'published' AND e.published_at <= ?",
  )
    .bind(id, new Date().toISOString())
    .first<{ title: string; episodeNumber: number; coverUrl: string; categoryName: string }>();
  if (!episode) throw new HttpError(404, '这期节目不存在');
  if (composing) return json({ error: '封面正在生成，请稍后重试' }, 503, { 'Retry-After': '1' });
  composing = true;
  try {
    const theme = kind === 'art' ? (await getAppearance(env.DB)).theme : null;
    const width = kind === 'art' ? size : 1200;
    const height = kind === 'art' ? size : 630;
    const renderWidth = Math.min(width, 1600);
    const renderHeight = Math.min(height, 1600);
    const frame = await readSvg(
      env,
      url.origin,
      theme ? themeCoverFrameSrc(theme) : '/brand/stillwood-wordmark.svg',
    );
    const { fonts, families } = theme
      ? await loadCoverFonts(env, url.origin, coverText(theme, episode))
      : { fonts: [], families: {} };
    const stream = await sourceStream(env, url.origin, episode.coverUrl);
    let jpeg: Uint8Array;
    try {
      const artwork = theme ? coverArtwork(theme) : null;
      const source = await env.IMAGES.input(stream)
        .transform({
          width: artwork ? Math.ceil((renderWidth * artwork.width) / coverDesignSize) : renderWidth,
          height: artwork ? Math.ceil((renderHeight * artwork.height) / coverDesignSize) : renderHeight,
          fit: 'cover',
        })
        .output({ format: 'image/webp', quality: 95, anim: false });
      const bytes = await readBytes(source.response(), maxSourceBytes);
      const dataUrl = `data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`;
      const svg = theme
        ? composeCoverSvg(theme, episode, dataUrl, frame, families)
        : composeShareSvg(frame, dataUrl);
      const { renderCoverJpeg } = await import('./cover-raster');
      jpeg = await renderCoverJpeg(svg, fonts, renderWidth, renderHeight);
      if (width > renderWidth) {
        const output = await env.IMAGES.input(new Blob([new Uint8Array(jpeg)]).stream())
          .transform({ width, height, fit: 'squeeze' })
          .output({ format: 'image/jpeg', quality: 90, anim: false });
        jpeg = await readBytes(output.response(), maxSourceBytes);
      }
    } catch (error) {
      if (error instanceof HttpError && error.status === 503)
        return json({ error: error.message }, 503, { 'Retry-After': '1' });
      if (error instanceof HttpError) throw error;
      throw new HttpError(422, '封面图片无法解码或排版，请检查原图后重试');
    }
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(jpeg), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(jpeg.byteLength),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } finally {
    composing = false;
  }
}
