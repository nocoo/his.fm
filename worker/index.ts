import { accessLogin, authenticate, isLocal, localLogin, logout } from './auth';
import { getEpisode, listEpisodes, mutateEpisode } from './episodes';
import { HttpError, json } from './http';

async function media(request: Request, env: Env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, '不支持这个请求方式');
  const key = new URL(request.url).pathname.slice('/media/'.length);
  if (!key || key.includes('..') || !/^[a-zA-Z0-9/_.-]+$/.test(key)) throw new HttpError(404, '媒体不存在');
  const object = await env.MEDIA.get(key, { onlyIf: request.headers });
  if (!object) throw new HttpError(404, '媒体不存在');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=3600');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === '/api/live') {
    if (request.method !== 'GET') throw new HttpError(405, '不支持这个请求方式');
    await env.DB.prepare('SELECT 1').first();
    return json({ status: 'ok', service: 'his.fm' });
  }
  if (path === '/api/episodes') {
    if (request.method !== 'GET') throw new HttpError(405, '不支持这个请求方式');
    return json({ episodes: await listEpisodes(env.DB, true) });
  }
  if (/^\/api\/episodes\/[^/]+$/.test(path)) {
    if (request.method !== 'GET') throw new HttpError(405, '不支持这个请求方式');
    return json({ episode: await getEpisode(env.DB, path.slice('/api/episodes/'.length), true) });
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
    if (path === '/admin/api/session' && request.method === 'GET') return json(session);
    if (path === '/admin/api/logout' && request.method === 'POST') return logout(request, env);
    if (path === '/admin/api/episodes') {
      if (request.method === 'GET') return json({ episodes: await listEpisodes(env.DB, false) });
      if (request.method === 'POST') return mutateEpisode(request, env.DB);
      throw new HttpError(405, '不支持这个请求方式');
    }
    if (/^\/admin\/api\/episodes\/[^/]+$/.test(path)) {
      const id = path.slice('/admin/api/episodes/'.length);
      if (request.method === 'GET') return json({ episode: await getEpisode(env.DB, id, false) });
      if (request.method === 'PUT' || request.method === 'DELETE') return mutateEpisode(request, env.DB, id);
      throw new HttpError(405, '不支持这个请求方式');
    }
    if (api) throw new HttpError(404, '接口不存在');
    const asset = await env.ASSETS.fetch(request);
    const response = new Response(asset.body, asset);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  if (path === '/api' || path.startsWith('/api/')) throw new HttpError(404, '接口不存在');
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
      return json({ error: '暂时无法完成操作，请稍后重试' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
