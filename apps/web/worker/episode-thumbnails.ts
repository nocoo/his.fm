import { themeIdSchema } from '../src/shared/appearance';
import { coverArtwork } from '../src/shared/cover-composition';
import { episodeThumbnailKey, episodeThumbnailWidths } from '../src/shared/episode-thumbnail';
import { HttpError } from './http';

const maxThumbnailSourceBytes = 20_000_000;

export async function routeEpisodeThumbnail(
  request: Request,
  env: Env,
  episodeId: string,
  version: string,
  theme: string,
  width: string,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    throw new HttpError(405, '缩略图只支持 GET 或 HEAD');
  const parsedTheme = themeIdSchema.safeParse(theme);
  if (
    new URL(request.url).search ||
    !parsedTheme.success ||
    !/^[1-9]\d*$/.test(version) ||
    !Number.isSafeInteger(Number(version)) ||
    !episodeThumbnailWidths.some((candidate) => String(candidate) === width)
  ) {
    throw new HttpError(400, '缩略图尺寸或版本无效');
  }
  const artwork = coverArtwork(parsedTheme.data);
  const episode = await env.DB.prepare(
    "SELECT cover_url AS coverUrl FROM episodes WHERE id = ? AND version = ? AND status = 'published' AND published_at <= ?",
  )
    .bind(episodeId, Number(version), new Date().toISOString())
    .first<{ coverUrl: string }>();
  if (!episode) throw new HttpError(404, '这期节目不存在');
  const key = episodeThumbnailKey(episode.coverUrl, new URL(request.url).origin, env.MEDIA_BASE_URL);
  if (!key) throw new HttpError(404, '封面原图不在本站存储中');
  const object = await env.MEDIA.get(key);
  if (!object) throw new HttpError(404, '封面原图不存在');
  const original = () =>
    new Response(null, {
      status: 302,
      headers: {
        Location: new URL(episode.coverUrl, request.url).href,
        'Cache-Control': 'no-store',
        'X-Thumbnail-Status': 'original',
      },
    });
  if (object.size > maxThumbnailSourceBytes) {
    await object.body.cancel();
    return original();
  }
  const headers = {
    'Content-Type': 'image/webp',
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };
  if (request.method === 'HEAD') {
    await object.body.cancel();
    return new Response(null, { headers });
  }
  try {
    const response = (
      await env.IMAGES.input(object.body)
        .transform({
          width: Number(width),
          height: Math.round((Number(width) * artwork.height) / artwork.width),
          fit: 'cover',
        })
        .output({ format: 'image/webp', quality: 80, anim: false })
    ).response({ headers });
    if (response.status === 200 && response.headers.get('Content-Type') === 'image/webp') return response;
    await response.body?.cancel();
    throw new Error('Images returned an unexpected output format');
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'episode_thumbnail_failed',
        episodeId,
        version,
        width,
        message: String(error),
      }),
    );
    return original();
  }
}
