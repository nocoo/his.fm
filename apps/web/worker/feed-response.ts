import { createHash } from 'node:crypto';
import { getCategory } from './categories';
import { buildCategoryRssFeed, buildRssFeed } from './feed';
import { HttpError } from './http';

export const feedRoute = /^\/(?:feed|feeds\/[a-z0-9-]+)\.xml$/;

export async function feedResponse(request: Request, env: Env): Promise<Response> {
  if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, '不支持这个请求方式');
  const url = new URL(request.url);
  const mediaBase = env.MEDIA_BASE_URL ?? 'https://f.no.mt';
  const categoryId = /^\/feeds\/([a-z0-9-]+)\.xml$/.exec(url.pathname)?.[1];
  const category = categoryId ? await getCategory(env.DB, categoryId) : null;
  const body = category
    ? await buildCategoryRssFeed(env.DB, url.origin, mediaBase, category.id, category.name, env.MEDIA)
    : await buildRssFeed(env.DB, url.origin, mediaBase, env.MEDIA);
  const etag = `"${createHash('sha256').update(body).digest('hex')}"`;
  return conditionalFeedResponse(
    request,
    new Response(body, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        ETag: etag,
      },
    }),
  );
}

export function conditionalFeedResponse(request: Request, response: Response): Response {
  const etag = response.headers.get('ETag');
  const matches = request.headers
    .get('If-None-Match')
    ?.split(',')
    .some((tag) => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === etag);
  if (response.status === 200 && etag && matches) {
    void response.body?.cancel();
    const headers = new Headers(response.headers);
    headers.delete('Content-Length');
    return new Response(null, { status: 304, headers });
  }
  if (request.method === 'HEAD') {
    void response.body?.cancel();
    return new Response(null, response);
  }
  return response;
}
