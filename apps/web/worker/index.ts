import { version } from '../../../package.json';
import { discoveryLinks, routeAgent, routeDiscovery } from './agent-api';
import { getAppearance } from './appearance';
import { accessLogin, authenticate, isLocal, localLogin, logout } from './auth';
import { getCategory, listCategories } from './categories';
import { redirect, resolveCategoryAlias } from './episode-public';
import { getEpisode, listEpisodes } from './episodes';
import { buildCategoryRssFeed, buildRssFeed } from './feed';
import { HttpError, json, requireSameOrigin } from './http';
import { buildLlmsFull } from './llms-full';
import { routeManagement } from './management';
import { streamMedia } from './media';
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
  headers.set('Cache-Control', 'public, max-age=3600');
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

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const origin = url.origin;
  const mediaBase = env.MEDIA_BASE_URL ?? 'https://f.no.mt';
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
    const requestedId = categoryFeed[1];
    const resolvedId = await resolveCategoryAlias(env.DB, requestedId);
    if (resolvedId !== requestedId) {
      return redirect(`${origin}/feeds/${resolvedId}.xml`);
    }
    const category = await getCategory(env.DB, resolvedId);
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
  if (path.startsWith('/media/')) return media(request, env);
  if (path === '/admin' || path.startsWith('/admin/')) {
    if (path === '/admin/api/dev-login' && request.method === 'POST') return localLogin(request, env);
    const session = await authenticate(request, env);
    const api = path === '/admin/api' || path.startsWith('/admin/api/');
    if (!session) {
      if (api) throw new HttpError(401, '请先登录管理后台');
      if (!isLocal(request, env)) return accessLogin();
      return env.ASSETS.fetch(request);
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
    const asset = await env.ASSETS.fetch(request);
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
  const html = await maybeServePublicHtml(request, env);
  if (html) return html;
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
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
  },
} satisfies ExportedHandler<Env>;
