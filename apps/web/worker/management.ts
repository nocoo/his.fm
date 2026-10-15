import type { Actor } from '../src/shared/production';
import { hub, notifyProductionChanged, routeRuntimeAdmin } from './agent-runtime';
import { routeAgentTokens } from './agent-tokens';
import { routeAiSettings } from './ai-settings';
import { routeAppearance } from './appearance';
import { routeAudio } from './audio-routes';
import { requireScope } from './authorization';
import { routeBumpers } from './bumpers';
import { routeCategories } from './categories';
import { routeChannel } from './channel';
import { getEpisode, listEpisodes, mutateEpisode } from './episodes';
import { HttpError, json } from './http';
import { routeProductions } from './production';
import { routeStorage } from './storage';
import { routeTasks } from './tasks';

export async function routeManagement(
  request: Request,
  env: Env,
  path: string,
  actor: Actor,
): Promise<Response | null> {
  let response: Response | null = null;
  const category = /^\/categories(?:\/([a-z0-9-]+))?$/.exec(path);
  const bumper = /^\/bumpers(?:\/([^/]+))?$/.exec(path);
  const episode = /^\/episodes(?:\/([^/]+))?$/.exec(path);
  if (category) response = await routeCategories(request, env, actor, category[1]);
  else if (path === '/channel') response = await routeChannel(request, env, actor);
  else if (path === '/appearance') response = await routeAppearance(request, env, actor);
  else if (path === '/ai-settings') response = await routeAiSettings(request, env, actor);
  else if (bumper) response = await routeBumpers(request, env, actor, bumper[1]);
  else if (path === '/storage' || path.startsWith('/storage/')) {
    const url = new URL(request.url);
    url.pathname = `/admin/api${path}`;
    response = await routeStorage(new Request(url, request), env, actor);
  } else if (path === '/agent-tokens' || path.startsWith('/agent-tokens/'))
    response = await routeAgentTokens(request, env, path, actor);
  else if (path.startsWith('/agent/')) {
    const url = new URL(request.url);
    url.pathname = `/admin/api${path}`;
    response = await routeRuntimeAdmin(new Request(url, request), env, actor);
  } else if (path === '/tasks' || path.startsWith('/tasks/'))
    response = await routeTasks(request, env, path, actor);
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
  } else
    response =
      (await routeAudio(request, env, path, actor)) ?? (await routeProductions(request, env, path, actor));
  if (response?.ok && !['GET', 'HEAD'].includes(request.method)) {
    if (response.status === 202 && env.AGENT_HUB) await hub(env).fetch('https://hub/speech-queued');
    if (request.method !== 'DELETE') await notifyProductionChanged(env, response);
  }
  return response;
}
