import { themeCoverFrameSrc, themes } from '../src/brand/themes';
import { categoryIdSchema } from '../src/shared/category';
import type { PublicEpisode } from '../src/shared/episode';
import { formatEpisodeLabel } from '../src/shared/episode-display';
import { episodeThumbnailKey, episodeThumbnailWidths } from '../src/shared/episode-thumbnail';
import { episodeCanonicalUrl } from '../src/shared/episode-url';
import { getAppearance } from './appearance';
import { getCategory } from './categories';
import { findPublishedEpisodeByCategorySlug, resolveCategoryAlias } from './episode-public';
import { getEpisode } from './episodes';
import { absoluteMedia, enclosureForEpisode } from './feed';
import { HttpError } from './http';

const cardCacheControl = 'public, max-age=300, stale-while-revalidate=3600';
const cardNotFoundCacheControl = 'public, max-age=60';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  Allow: 'GET, HEAD, OPTIONS',
};

function squareCoverDimensions(coverUrl: string, origin: string, mediaBase: string) {
  if (episodeThumbnailKey(coverUrl, origin, mediaBase)) return { width: 1400, height: 1400 };
  try {
    const path = new URL(coverUrl, origin).pathname;
    if (/^\/images\/episode-\d+\.webp$/i.test(path)) return { width: 1400, height: 1400 };
  } catch {
    return null;
  }
  return null;
}

function thumbnailSizes(
  episode: Pick<PublicEpisode, 'id' | 'version' | 'coverUrl'>,
  theme: string,
  origin: string,
) {
  if (
    !episodeThumbnailKey(episode.coverUrl, origin) ||
    /^https:\/\/f\.no\.mt\/images\/episode-0[1-3]\.webp$/.test(episode.coverUrl)
  ) {
    return undefined;
  }
  const path = `/media/episode-thumbnails/${encodeURIComponent(episode.id)}/${episode.version}/${theme}`;
  return episodeThumbnailWidths.map((width) => ({
    url: new URL(`${path}/${width}.webp`, origin).href,
    width,
  }));
}

export function parseEpisodePageUrl(raw: string | null, origin: string) {
  if (!raw?.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.origin !== new URL(origin).origin) return null;
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  const match = /^\/episodes\/([^/]+)\/([^/]+)$/i.exec(pathname);
  if (!match) return null;
  const category = decodeURIComponent(match[1]);
  const slug = decodeURIComponent(match[2]);
  if (!categoryIdSchema.safeParse(category).success) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return null;
  return { category, slug };
}

function cardResponse(body: unknown, status: number, request: Request, cacheControl: string) {
  const headers = new Headers({
    ...corsHeaders,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  });
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers });
}

export async function buildEpisodeCard(
  env: Env,
  origin: string,
  category: string,
  slug: string,
): Promise<Record<string, unknown> | null> {
  const mediaBase = env.MEDIA_BASE_URL ?? 'https://f.no.mt';
  const resolvedCategory = await resolveCategoryAlias(env.DB, category);
  if (!(await findPublishedEpisodeByCategorySlug(env.DB, category, slug))) return null;
  let episode: PublicEpisode;
  try {
    episode = (await getEpisode(env.DB, slug, true, undefined, {
      category: resolvedCategory,
      origin,
    })) as PublicEpisode;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
  const [{ theme }, categoryRecord] = await Promise.all([
    getAppearance(env.DB),
    getCategory(env.DB, resolvedCategory),
  ]);
  const palette = themes[theme].palette;
  const coverUrl = absoluteMedia(origin, mediaBase, episode.coverUrl);
  const dimensions = squareCoverDimensions(episode.coverUrl, origin, mediaBase);
  const sizes = thumbnailSizes(episode, theme, origin);
  const cache = new Map<string, Promise<R2Object | null>>();
  const enclosure = await enclosureForEpisode(env.MEDIA, origin, mediaBase, episode, cache);
  const durationSeconds = Math.round(episode.durationSeconds);
  const card: Record<string, unknown> = {
    v: 1,
    status: 'published',
    page_url: episodeCanonicalUrl(origin, episode),
    title: episode.title,
    description: episode.summary,
    show: 'his.fm',
    column: categoryRecord.name,
    episode_label: formatEpisodeLabel(categoryRecord.name, episode.episodeNumber),
    published_at: episode.publishedAt,
    cover: {
      url: coverUrl,
      ...(dimensions ?? {}),
      ...(sizes ? { sizes } : {}),
      frame_svg: new URL(themeCoverFrameSrc(theme), origin).href,
    },
    theme: {
      name: themes[theme].name,
      accent: palette[2],
      ink: palette[1],
      paper: palette[0],
    },
  };
  if (Number.isSafeInteger(durationSeconds) && durationSeconds > 0) {
    card.duration = durationSeconds;
  }
  if (enclosure) {
    card.audio = {
      url: enclosure.url,
      mime: enclosure.type,
      bytes: enclosure.length,
    };
  }
  return card;
}

export async function routeEpisodeCard(request: Request, env: Env): Promise<Response> {
  const origin = new URL(request.url).origin;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: new Headers(corsHeaders) });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    throw new HttpError(405, '不支持这个请求方式');
  }
  const lookup = parseEpisodePageUrl(new URL(request.url).searchParams.get('url'), origin);
  if (!lookup) {
    return cardResponse({ error: '节目页面链接无效' }, 400, request, 'no-store');
  }
  const card = await buildEpisodeCard(env, origin, lookup.category, lookup.slug);
  if (!card) {
    return cardResponse({ v: 1, status: 'not_found' }, 404, request, cardNotFoundCacheControl);
  }
  return cardResponse(card, 200, request, cardCacheControl);
}
