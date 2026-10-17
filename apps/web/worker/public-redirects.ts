import { episodePublicPath, isReservedEpisodeSegment } from '../src/shared/episode-url';
import { findPublishedEpisodeBySlug, redirect, resolveCategoryAlias } from './episode-public';

export async function maybeServePublicRedirects(request: Request, env: Env): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const path = url.pathname;
  const origin = url.origin;

  const legacyEpisode = /^\/episodes\/([^/]+)$/.exec(path);
  if (legacyEpisode && !isReservedEpisodeSegment(legacyEpisode[1])) {
    const hit = await findPublishedEpisodeBySlug(env.DB, legacyEpisode[1]);
    if (hit) return redirect(`${origin}${episodePublicPath(hit.category, hit.slug)}`);
  }

  const categoryEpisode = /^\/episodes\/([^/]+)\/([^/]+)$/.exec(path);
  if (categoryEpisode) {
    const [, categoryId, slug] = categoryEpisode;
    const resolvedCategory = await resolveCategoryAlias(env.DB, categoryId);
    if (resolvedCategory !== categoryId) {
      return redirect(`${origin}${episodePublicPath(resolvedCategory, slug)}`);
    }
  }

  return null;
}
