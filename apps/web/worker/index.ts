import { version } from '../../../package.json';
import { discoveryLinks, routeAgent, routeDiscovery } from './agent-api';
import { getAppearance } from './appearance';
import { accessLogin, authenticate, isLocal, localLogin, logout } from './auth';
import { getCategory, listCategories } from './categories';
import { episodeArtRoute, routeEpisodeArt } from './episode-art';
import { routeEpisodeThumbnail } from './episode-thumbnails';
import { getEpisode, listEpisodes } from './episodes';
import { buildCategoryRssFeed, buildRssFeed } from './feed';
import { HttpError, json, requireSameOrigin } from './http';
import { buildLlmsFull } from './llms-full';
import { routeManagement } from './management';
import { streamMedia } from './media';
import {
  cacheablePublicRequest,
  freshPublicHtml,
  invalidatesPublicContent,
  thumbnailRoute,
} from './public-cache';
import { maybeServePublicHtml } from './public-html';
import { buildRobotsTxt } from './robots';
import { getSiteSeo } from './seo-store';
import { enrichSession } from './session';
import { buildSitemap } from './sitemap';

async function media(request: Request, env: Env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, '不支持这个请求方式');
  const key = new URL(request.url).pathname.slice('/media/'.length);
  if (!key || key.includes('..') || !/^[a-zA-Z0-9/_.-]+$/.test(key)) throw new HttpError(404, '媒体不存在');
  const object = await env.MEDIA.head(key);
  if (!object) throw new HttpError(404, '媒体不存在');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set(
    'Cache-Control',
    /^images\/(?:hero-retina-20260926-|identity\/.*-[a-f0-9]{16}\.webp$)/.test(key)
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=3600',
  );
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  return streamMedia(request, env.MEDIA, object, headers);
}

function xmlResponse(body: string, request: Request) {
  const response = new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=600',
    },
  });
  return request.method === 'HEAD' ? new Response(null, response) : response;
}

async function route(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const origin = url.origin;
  const mediaBase = env.MEDIA_BASE_URL ?? 'https://f.no.mt';
  if (env.ENVIRONMENT === 'local' && /^\/(?:@|src\/|node_modules\/)/.test(path))
    return env.ASSETS.fetch(request);
  if (url.hostname === 'www.his.fm' || (url.hostname === 'his.fm' && url.protocol === 'http:')) {
    url.protocol = 'https:';
    url.hostname = 'his.fm';
    return Response.redirect(url.href, 308);
  }
  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    /^\/(?:about|login|episodes(?:\/[^/]+){0,2})\/+$/i.test(path)
  ) {
    url.pathname = path.replace(/\/+$/, '');
    return Response.redirect(url.href, 308);
  }
  const episodeArt = episodeArtRoute.exec(path);
  if (episodeArt) return routeEpisodeArt(request, env, episodeArt[1], episodeArt[2] as 'art' | 'share');
  if (ctx && env.ENVIRONMENT !== 'local' && cacheablePublicRequest(request)) {
    const cached = await ctx.exports.PublicContent.fetch(new Request(url, { method: 'GET' }));
    const response = new Response(request.method === 'HEAD' ? null : cached.body, cached);
    response.headers.set('X-Public-Cache', cached.headers.get('CF-Cache-Status') ?? 'UNKNOWN');
    return response;
  }
  const shell = () => env.ASSETS.fetch(new Request(new URL('/', request.url), request));
  const discovery = routeDiscovery(request);
  if (discovery) return discovery;
  if (path.startsWith('/api/agent/')) return routeAgent(request, env);
  if (path === '/api/live') {
    if (request.method !== 'GET') throw new HttpError(405, '不支持这个请求方式');
    await env.DB.prepare('SELECT 1').first();
    return json({ status: 'ok', service: 'his.fm', version, revision: __BUILD_REVISION__ });
  }
  if (path === '/robots.txt') {
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, '不支持这个请求方式');
    const response = new Response(buildRobotsTxt(origin), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    });
    return request.method === 'HEAD' ? new Response(null, response) : response;
  }
  if (path === '/sitemap.xml') {
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, '不支持这个请求方式');
    return xmlResponse(await buildSitemap(env.DB, origin), request);
  }
  if (path === '/llms-full.txt') {
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, '不支持这个请求方式');
    const response = new Response(await buildLlmsFull(env.DB, origin), {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=600' },
    });
    return request.method === 'HEAD' ? new Response(null, response) : response;
  }
  if (path === '/feed.xml') {
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, '不支持这个请求方式');
    const body = await buildRssFeed(env.DB, origin, mediaBase, env.MEDIA);
    const response = new Response(body, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=600',
      },
    });
    return request.method === 'HEAD' ? new Response(null, response) : response;
  }
  const categoryFeed = /^\/feeds\/([a-z0-9-]+)\.xml$/.exec(path);
  if (categoryFeed) {
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, '不支持这个请求方式');
    const category = await getCategory(env.DB, categoryFeed[1]);
    const body = await buildCategoryRssFeed(env.DB, origin, mediaBase, category.id, category.name, env.MEDIA);
    const response = new Response(body, {
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=600',
      },
    });
    return request.method === 'HEAD' ? new Response(null, response) : response;
  }
  if (path === '/api/episodes') {
    if (request.method !== 'GET') throw new HttpError(405, '不支持这个请求方式');
    return json({ episodes: await listEpisodes(env.DB, true, undefined, origin) });
  }
  if (path === '/api/categories') {
    if (request.method !== 'GET') throw new HttpError(405, '不支持这个请求方式');
    return json({ categories: await listCategories(env.DB) });
  }
  if (path === '/api/appearance') {
    if (request.method !== 'GET') throw new HttpError(405, '不支持这个请求方式');
    const { theme } = await getAppearance(env.DB);
    return json({ appearance: { theme } });
  }
  if (path === '/api/site-seo') {
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, '不支持这个请求方式');
    const {
      version: _version,
      updatedAt: _updatedAt,
      updatedBy: _updatedBy,
      ...seo
    } = await getSiteSeo(env.DB);
    const response = json({ seo });
    return request.method === 'HEAD' ? new Response(null, response) : response;
  }
  const nestedEpisode = /^\/api\/episodes\/([^/]+)\/([^/]+)$/.exec(path);
  if (nestedEpisode) {
    if (request.method !== 'GET') throw new HttpError(405, '不支持这个请求方式');
    return json({
      episode: await getEpisode(env.DB, nestedEpisode[2], true, undefined, {
        category: nestedEpisode[1],
        origin,
      }),
    });
  }
  if (/^\/api\/episodes\/[^/]+$/.test(path)) {
    if (request.method !== 'GET') throw new HttpError(405, '不支持这个请求方式');
    return json({
      episode: await getEpisode(env.DB, path.slice('/api/episodes/'.length), true, undefined, { origin }),
    });
  }
  const thumbnail = thumbnailRoute.exec(path);
  if (thumbnail)
    return routeEpisodeThumbnail(request, env, thumbnail[1], thumbnail[2], thumbnail[3], thumbnail[4]);
  if (path.startsWith('/media/')) return media(request, env);
  if (path === '/admin' || path.startsWith('/admin/')) {
    if (path === '/admin/api/dev-login' && request.method === 'POST') return localLogin(request, env);
    const session = await authenticate(request, env);
    const api = path === '/admin/api' || path.startsWith('/admin/api/');
    if (!session) {
      if (api) throw new HttpError(401, '请先登录管理后台');
      if (!isLocal(request, env)) return accessLogin();
      return shell();
    }
    if (api && path.startsWith('/admin/api/')) {
      if (!['GET', 'HEAD'].includes(request.method)) requireSameOrigin(request);
      const response = await routeManagement(request, env, path.slice('/admin/api'.length), {
        kind: 'human',
        name: session.user.email,
      });
      if (response) return response;
    }
    if (path === '/admin/api/session' && request.method === 'GET') return json(await enrichSession(session));
    if (path === '/admin/api/logout' && request.method === 'POST') return logout(request, env);
    if (api) throw new HttpError(404, '接口不存在');
    const asset = await (path.includes('.') ? env.ASSETS.fetch(request) : shell());
    const response = new Response(asset.body, asset);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  if (path === '/api' || path.startsWith('/api/'))
    return json(
      {
        error: '接口不存在，请读取服务发现',
        code: 'not_found',
        documentation: `${url.origin}/api/agent/instructions`,
      },
      404,
      { Link: discoveryLinks(url.origin) },
    );
  if (path === '/login') return shell();
  const html = await maybeServePublicHtml(request, env);
  if (html) return html;
  return env.ASSETS.fetch(request);
}

async function respond(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
  try {
    return await route(request, env, ctx);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error(
      JSON.stringify({
        event: 'request_failed',
        path: new URL(request.url).pathname,
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
    return json(
      {
        error: '暂时无法完成操作，请稍后重试',
        ...(new URL(request.url).pathname.startsWith('/api/agent/')
          ? {
              code: 'internal_error',
              documentation: `${new URL(request.url).origin}/api/agent/instructions`,
            }
          : {}),
      },
      500,
      { Link: discoveryLinks(new URL(request.url).origin) },
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    let response = await respond(request, env, ctx);
    if (ctx && env.ENVIRONMENT !== 'local' && invalidatesPublicContent(request, response)) {
      try {
        await ctx.exports.PublicContent.invalidate();
      } catch (error) {
        console.error(JSON.stringify({ event: 'public_cache_purge_failed', message: String(error) }));
        response = new Response(response.body, response);
        response.headers.set('X-Public-Cache', 'invalidation-failed');
      }
    }
    const html = response.headers.get('Content-Type')?.startsWith('text/html');
    if (html && env.ENVIRONMENT !== 'local') response = await freshPublicHtml(response);
    const headers = new Headers(response.headers);
    if (html) headers.set('Cache-Control', 'no-store');
    if (new URL(request.url).protocol === 'https:')
      headers.set('Strict-Transport-Security', 'max-age=31536000');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!headers.has('Content-Security-Policy'))
      headers.set('Content-Security-Policy', "base-uri 'self'; object-src 'none'; frame-ancestors 'none'");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
} satisfies ExportedHandler<Env>;
