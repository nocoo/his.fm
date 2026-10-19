import { Buffer } from 'node:buffer';
import { themeCoverFrameSrc } from '../src/brand/themes';
import type { ThemeId } from '../src/shared/appearance';
import { composeCoverSvg, coverArtwork, coverDesignSize, coverText } from '../src/shared/cover-composition';
import { type ArtRecord, artLocation } from '../src/shared/episode-art';
import { composeShareSvg } from '../src/shared/share-composition';
import { getAppearance } from './appearance';
import { coverSource } from './cover';
import { loadCoverFonts } from './cover-fonts';
import { HttpError, json } from './http';
import { coverDimensions } from './media-validation';
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
  ctx?: ExecutionContext,
): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, '节目图片只支持 GET 或 HEAD');
  const url = new URL(request.url);
  const parameters = [...url.searchParams];
  const sizeValue = url.searchParams.get('size') ?? '1400';
  const size = Number(sizeValue);
  const version = url.searchParams.get('v');
  if (
    (kind === 'share' && url.searchParams.has('size')) ||
    parameters.some(([key]) => key !== 'size' && key !== 'v') ||
    parameters.length !== new Set(parameters.map(([key]) => key)).size ||
    (version !== null && !/^[a-f0-9]{64}$/.test(version)) ||
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
    "SELECT e.id, e.title, e.episode_number AS episodeNumber, e.cover_url AS coverUrl, c.name AS categoryName FROM episodes e JOIN categories c ON c.id = e.category WHERE e.id = ? AND e.status = 'published' AND e.published_at <= ?",
  )
    .bind(id, new Date().toISOString())
    .first<Omit<ArtRecord, 'resource'>>();
  if (!episode) throw new HttpError(404, '这期节目不存在');
  const theme = kind === 'art' ? (await getAppearance(env.DB)).theme : null;
  const record: ArtRecord = { ...episode, resource: 'episodes' };
  const location = await artLocation(record, theme, size);
  if (version !== location.version)
    return new Response(null, {
      status: 302,
      headers: { Location: location.url, 'Cache-Control': 'no-store' },
    });
  try {
    const cache =
      env.ENVIRONMENT !== 'local' && typeof caches !== 'undefined'
        ? (caches as CacheStorage & { default: Cache }).default
        : undefined;
    const cacheKey = new Request(request.url);
    const cached = await cache?.match(cacheKey).catch((error: unknown) => {
      console.error(JSON.stringify({ event: 'episode_art_edge_read_failed', message: String(error) }));
    });
    let headers: Headers;
    if (cached) {
      headers = new Headers(cached.headers);
      const length = headers.get('X-Hisfm-Art-Length');
      if (length) headers.set('Content-Length', length);
      headers.delete('X-Hisfm-Art-Length');
      headers.set('X-Hisfm-Art', 'edge-hit');
    } else {
      const { object, source } = await ensureEpisodeArt(env, url.origin, record, theme, size);
      headers = new Headers({
        'Content-Type': 'image/jpeg',
        'Content-Length': String(object.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        ETag: object.httpEtag,
        'Last-Modified': object.uploaded.toUTCString(),
        'X-Hisfm-Art': source,
      });
    }
    const etags = request.headers.get('If-None-Match');
    const modifiedSince = request.headers.get('If-Modified-Since');
    if (
      etags
        ? etags
            .split(',')
            .some((tag) => tag.trim().replace(/^W\//, '') === headers.get('ETag') || tag.trim() === '*')
        : modifiedSince && Date.parse(modifiedSince) >= Date.parse(headers.get('Last-Modified') ?? '')
    ) {
      void cached?.body?.cancel().catch(() => undefined);
      headers.delete('Content-Length');
      return new Response(null, { status: 304, headers });
    }
    if (request.method === 'HEAD') {
      void cached?.body?.cancel().catch(() => undefined);
      return new Response(null, { headers });
    }
    if (cached) return new Response(cached.body, { headers });
    const object = await env.MEDIA.get(location.key);
    if (!object) throw new HttpError(503, '封面缓存暂时不可用，请稍后重试');
    const response = new Response(object.body, { headers });
    if (cache) {
      const entry = response.clone();
      entry.headers.set('X-Hisfm-Art-Length', String(object.size));
      const write = cache.put(cacheKey, entry).catch((error: unknown) => {
        console.error(JSON.stringify({ event: 'episode_art_edge_write_failed', message: String(error) }));
      });
      if (ctx) ctx.waitUntil(write);
      else await write;
    }
    return response;
  } catch (error) {
    if (error instanceof HttpError && error.status === 503)
      return json({ error: error.message }, 503, { 'Retry-After': '1' });
    throw error;
  }
}

export async function ensureEpisodeArt(
  env: Env,
  origin: string,
  episode: ArtRecord,
  theme: ThemeId | null,
  size = 1400,
): Promise<{ object: R2Object; source: 'r2-hit' | 'rendered' }> {
  const { key } = await artLocation(episode, theme, size);
  const cached = await env.MEDIA.head(key);
  if (cached) return { object: cached, source: 'r2-hit' };
  if (composing) throw new HttpError(503, '封面正在生成，请稍后重试');
  composing = true;
  try {
    const width = theme ? size : 1200;
    const height = theme ? size : 630;
    const renderWidth = Math.min(width, 1600);
    const renderHeight = Math.min(height, 1600);
    const frame = await readSvg(
      env,
      origin,
      theme ? themeCoverFrameSrc(theme) : '/brand/stillwood-wordmark.svg',
    );
    const { fonts, families } = theme
      ? await loadCoverFonts(env, origin, coverText(theme, episode))
      : { fonts: [], families: {} };
    const stream = await sourceStream(env, origin, episode.coverUrl);
    let jpeg: Uint8Array;
    try {
      const artwork = theme ? coverArtwork(theme) : null;
      const source = await env.IMAGES.input(stream)
        .transform({
          width: artwork ? Math.ceil((renderWidth * artwork.width) / coverDesignSize) : 1600,
          height: artwork ? Math.ceil((renderHeight * artwork.height) / coverDesignSize) : 1600,
          fit: artwork ? 'cover' : 'contain',
        })
        .output({ format: 'image/webp', quality: 95, anim: false });
      const bytes = await readBytes(source.response(), maxSourceBytes);
      const dataUrl = `data:image/webp;base64,${Buffer.from(bytes).toString('base64')}`;
      const svg = theme
        ? composeCoverSvg(theme, episode, dataUrl, frame, families)
        : composeShareSvg(frame, { dataUrl, ...coverDimensions(bytes) });
      const { renderCoverJpeg } = await import('./cover-raster');
      jpeg = await renderCoverJpeg(svg, fonts, renderWidth, renderHeight);
      if (width > renderWidth) {
        const output = await env.IMAGES.input(new Blob([new Uint8Array(jpeg)]).stream())
          .transform({ width, height, fit: 'squeeze' })
          .output({ format: 'image/jpeg', quality: 90, anim: false });
        jpeg = await readBytes(output.response(), maxSourceBytes);
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(422, '封面图片无法解码或排版，请检查原图后重试');
    }
    const stored = await env.MEDIA.put(key, jpeg, {
      httpMetadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' },
      onlyIf: { etagDoesNotMatch: '*' },
    });
    const object = stored ?? (await env.MEDIA.head(key));
    if (!object) throw new HttpError(503, '封面缓存暂时无法保存，请稍后重试');
    return { object, source: 'rendered' };
  } finally {
    composing = false;
  }
}
