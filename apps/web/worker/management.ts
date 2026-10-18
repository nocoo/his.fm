import type { Actor } from '../src/shared/production';
import { routeAgentTokens } from './agent-tokens';
import { routeAppearance } from './appearance';
import { requireScope } from './authorization';
import { routeBumpers } from './bumpers';
import { routeCategories } from './categories';
import { routeChannel } from './channel';
import { routeCover } from './cover';
import { pregenerateEpisodeArt } from './episode-art-pregenerate';
import { getEpisode, listEpisodes, mutateEpisode } from './episodes';
import { HttpError, json } from './http';
import { routeProductions } from './production';
import { routePromptSlots } from './prompt-slots';
import { routeSiteSeo } from './seo-store';
import { routeStorage } from './storage';

export async function routeManagement(
  request: Request,
  env: Env,
  path: string,
  actor: Actor,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  let response: Response | null = null;
  const category = /^\/categories(?:\/([a-z0-9-]+))?$/.exec(path);
  const bumper = /^\/bumpers(?:\/([^/]+))?$/.exec(path);
  const episode = /^\/episodes(?:\/([^/]+))?$/.exec(path);
  const cover = /^\/(productions|episodes)\/([^/]+)\/cover\.png$/.exec(path);
  const promptSlots = /^\/(?:channel|categories\/([a-z0-9-]+))\/prompt-slots(\/.*)?$/.exec(path);
  if (promptSlots) response = await routePromptSlots(request, env, actor, promptSlots[1], promptSlots[2]);
  else if (cover)
    response = await routeCover(
      request,
      env,
      actor,
      cover[1] === 'productions' ? 'productions' : 'episodes',
      cover[2],
    );
  else if (category) response = await routeCategories(request, env, actor, category[1]);
  else if (path === '/channel') response = await routeChannel(request, env, actor);
  else if (path === '/seo') response = await routeSiteSeo(request, env, actor);
  else if (path === '/appearance') response = await routeAppearance(request, env, actor);
  else if (bumper) response = await routeBumpers(request, env, actor, bumper[1]);
  else if (path === '/storage' || path.startsWith('/storage/')) {
    const url = new URL(request.url);
    url.pathname = `/admin/api${path}`;
    response = await routeStorage(new Request(url, request), env, actor);
  } else if (path === '/agent-tokens' || path.startsWith('/agent-tokens/'))
    response = await routeAgentTokens(request, env, path, actor);
  else if (episode) {
    requireScope(
      actor,
      request.method === 'GET'
        ? 'episodes:read'
        : request.method === 'DELETE'
          ? 'episodes:delete'
          : 'episodes:write',
    );
    if (request.method === 'GET')
      response = episode[1]
        ? json({ episode: await getEpisode(env.DB, episode[1], false, actor) })
        : json({ episodes: await listEpisodes(env.DB, false, actor) });
    else if (
      (episode[1] && ['PUT', 'PATCH', 'DELETE'].includes(request.method)) ||
      (!episode[1] && request.method === 'POST')
    )
      response = await mutateEpisode(request, env.DB, actor, episode[1]);
    else throw new HttpError(405, 'Unsupported episode method');
  } else response = await routeProductions(request, env, path, actor);
  if (response?.ok && !['GET', 'HEAD', 'DELETE'].includes(request.method)) {
    const generationPath = category?.[1]
      ? `/categories/${((await response.clone().json()) as { category: { id: string } }).category.id}`
      : path;
    const generation = pregenerateEpisodeArt(env, new URL(request.url).origin, generationPath);
    if (ctx) ctx.waitUntil(generation);
    else await generation;
  }
  return response;
}
