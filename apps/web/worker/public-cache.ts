import { themeIdSchema } from '../src/shared/appearance';
import { episodeArtRoute } from './episode-art';
import { routeEpisodeThumbnail } from './episode-thumbnails';
import { HttpError, json } from './http';
import { maybeServePublicHtml } from './public-html';

export const thumbnailRoute = /^\/media\/episode-thumbnails\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\.webp$/;
const publicPage = /^\/(?:about|episodes(?:\/[^/]+){0,2})?$/;

export function cacheablePublicRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (!['GET', 'HEAD'].includes(request.method) || url.origin !== 'https://his.fm') return false;
  if (episodeArtRoute.test(url.pathname)) return false;
  if (thumbnailRoute.test(url.pathname)) return !url.search;
  if (!publicPage.test(url.pathname)) return false;
  const seen = new Set<string>();
  for (const [key, value] of url.searchParams) {
    if (seen.has(key)) return false;
    seen.add(key);
    if (key === 'theme' && themeIdSchema.safeParse(value).success) continue;
    if (key === 'category' && url.pathname === '/episodes' && /^[a-z0-9-]{1,120}$/.test(value)) continue;
    return false;
  }
  return true;
}

export function invalidatesPublicContent(request: Request, response: Response): boolean {
  return (
    response.ok &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
    /^\/(?:admin\/api|api\/agent)\/(?:episodes|productions|categories|seo|appearance)(?:\/|$)/.test(
      new URL(request.url).pathname,
    )
  );
}

export async function publicContentResponse(request: Request, env: Env): Promise<Response> {
  if (!cacheablePublicRequest(request)) return json({ error: '页面不存在' }, 404);
  try {
    const thumbnail = thumbnailRoute.exec(new URL(request.url).pathname);
    const response = thumbnail
      ? await routeEpisodeThumbnail(request, env, thumbnail[1], thumbnail[2], thumbnail[3], thumbnail[4])
      : await maybeServePublicHtml(request, env);
    if (!response) return json({ error: '页面不存在' }, 404);
    if (response.status !== 200) response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    throw error;
  }
}

export async function freshPublicHtml(response: Response): Promise<Response> {
  const nonce = crypto.randomUUID();
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.delete('Content-Length');
  headers.delete('Content-Encoding');
  headers.delete('ETag');
  headers.delete('Age');
  headers.set(
    'Content-Security-Policy',
    `base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'nonce-${nonce}'`,
  );
  const html = (await response.text()).replace(/<script\b/g, `<script nonce="${nonce}"`);
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
