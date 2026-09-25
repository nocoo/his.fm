import instructions from '../docs/hermes.md?raw';
import { version } from '../package.json';
import { type Actor, agentActions, agentEditableFields, type Production } from '../src/shared/production';
import { voiceSamples } from '../src/shared/voice-samples';
import { voiceCharacters, voices } from '../src/shared/voices';
import { agentOpenApi } from './agent-contract';
import { authenticateAgent } from './agent-tokens';
import { AUDIO_MODEL } from './audio';
import { routeAudio } from './audio-routes';
import { getSettings } from './audio-store';
import { HttpError, json } from './http';
import { routeProductions } from './production';
import { applyAction } from './production-model';
import { getProduction } from './production-store';

export function discoveryLinks(origin: string) {
  return `<${origin}/.well-known/api-catalog>; rel="api-catalog", <${origin}/api/agent/openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json", <${origin}/api/agent/instructions>; rel="service-doc"; type="text/markdown"`;
}

function manifest(origin: string) {
  const base = `${origin}/api/agent`;
  return {
    name: 'his.fm',
    version,
    protocol: 'REST',
    api: base,
    authentication: {
      type: 'http',
      scheme: 'bearer',
      environmentVariable: 'HISFM_AGENT_TOKEN',
      tokenManagement: `${origin}/admin/settings`,
      verification: `${base}/me`,
    },
    links: {
      catalog: `${origin}/.well-known/api-catalog`,
      openapi: `${base}/openapi.json`,
      instructions: `${base}/instructions`,
      capabilities: `${base}/capabilities`,
      productions: `${base}/productions`,
      health: `${origin}/api/live`,
    },
    workflow: 'draft -> brief_review -> scripting -> script_review -> production -> final_review -> ready',
    humanReview: ['brief', 'script', 'final', 'publication'],
  };
}

export function routeDiscovery(request: Request): Response | null {
  const { origin, pathname } = new URL(request.url);
  const path = pathname.replace(/\/$/, '');
  if (
    ![
      '/api/agent',
      '/api/agent/openapi.json',
      '/api/agent/instructions',
      '/.well-known/api-catalog',
      '/llms.txt',
    ].includes(path)
  )
    return null;
  const headers = { Link: discoveryLinks(origin), Allow: 'GET, HEAD, OPTIONS' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!['GET', 'HEAD'].includes(request.method))
    return json(
      {
        error: '此发现地址只支持读取',
        code: 'method_not_allowed',
        documentation: `${origin}/api/agent/instructions`,
      },
      405,
      headers,
    );
  let response: Response;
  if (path === '/api/agent') response = json(manifest(origin), 200, headers);
  else if (path === '/api/agent/openapi.json') {
    response = json(agentOpenApi(origin), 200, headers);
    response.headers.set('Content-Type', 'application/vnd.oai.openapi+json;version=3.1; charset=utf-8');
  } else if (path === '/.well-known/api-catalog') {
    response = json(
      {
        linkset: [
          {
            anchor: `${origin}/api/agent`,
            'service-desc': [
              {
                href: `${origin}/api/agent/openapi.json`,
                type: 'application/vnd.oai.openapi+json',
                title: 'his.fm Agent Production API',
              },
            ],
            'service-doc': [{ href: `${origin}/api/agent/instructions`, type: 'text/markdown' }],
            'service-meta': [{ href: `${origin}/api/agent`, type: 'application/json' }],
          },
        ],
      },
      200,
      headers,
    );
    response.headers.set('Content-Type', 'application/linkset+json');
  } else {
    const text =
      path === '/llms.txt'
        ? `# his.fm\n\n> Chinese solo podcast production studio.\n\n## Agent API\n\n- [Service discovery](${origin}/api/agent): REST API entrypoint.\n- [OpenAPI 3.1](${origin}/api/agent/openapi.json): Complete machine-readable contract.\n- [Hermes instructions](${origin}/api/agent/instructions): Authentication, stages, examples and review boundaries.\n\nDiscovery is public; all production data requires a studio-issued bearer token. This service does not expose MCP or A2A.\n`
        : instructions.replaceAll('https://his.fm', origin);
    response = new Response(text, {
      headers: {
        ...headers,
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }
  return request.method === 'HEAD' ? new Response(null, response) : response;
}

export function productionCapabilities(production: Production, actor: Actor, origin: string) {
  const availableActions: (typeof agentActions)[number][] = [];
  const blockedActions: Record<string, string> = {};
  for (const action of agentActions) {
    try {
      applyAction(production, { action, version: production.version }, actor);
      availableActions.push(action);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      blockedActions[action] = error.message;
    }
  }
  const base = `${origin}/api/agent/productions/${encodeURIComponent(production.id)}`;
  return {
    id: production.id,
    version: production.version,
    stage: production.stage,
    editableFields: agentEditableFields[production.stage],
    availableActions,
    blockedActions,
    canDelete: !production.publications.length,
    canUploadCover: production.stage === 'production',
    canGenerateAudio:
      production.stage === 'production' &&
      Boolean(production.approvals.brief && production.approvals.script) &&
      production.audioJob?.status !== 'running',
    links: {
      self: `${base}/capabilities`,
      production: base,
      prompts: `${base}/prompts`,
      actions: `${base}/actions`,
      cover: `${base}/assets/cover?version=${production.version}`,
      audio: `${base}/audio`,
      review: `${origin}/admin/productions/${encodeURIComponent(production.id)}`,
    },
  };
}

export async function routeAgent(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice('/api/agent'.length).replace(/\/$/, '');
  const headers: Record<string, string> = { Link: discoveryLinks(url.origin) };
  try {
    const actor = await authenticateAgent(request, env);
    if (path === '/me' || path === '/capabilities' || /^\/productions\/[^/]+\/capabilities$/.test(path)) {
      if (request.method !== 'GET') throw new HttpError(405, '此接口只支持 GET');
      if (path === '/me') return json({ actor }, 200, headers);
      if (path !== '/capabilities')
        return json(
          productionCapabilities(await getProduction(env.DB, path.split('/')[2]), actor, url.origin),
          200,
          headers,
        );
      const settings = await getSettings(env);
      return json(
        {
          authentication: 'Bearer',
          editableFields: agentEditableFields,
          agentActions,
          humanOnly: ['approval', 'revision', 'reopening', 'settings', 'tokens', 'publication'],
          limits: { jsonBytes: 750000, coverBytes: 8388608, auditEvents: 200 },
          audio: {
            model: AUDIO_MODEL,
            configured: settings.ttsConfigured,
            voice: settings.voice,
            speakingStyle: settings.speakingStyle,
            introReady: Boolean(settings.intro),
            outroReady: Boolean(settings.outro),
            voices: voices.map((id) => ({
              id,
              description: voiceCharacters[id],
              previewUrl: voiceSamples.find((sample) => sample.voice === id)?.url ?? null,
            })),
          },
        },
        200,
        headers,
      );
    }
    const response =
      (await routeAudio(request, env, path, actor)) ?? (await routeProductions(request, env, path, actor));
    if (!response) throw new HttpError(404, '接口不存在，请读取服务发现和 OpenAPI 中的实际路径');
    response.headers.set('Link', headers.Link);
    return response;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    if (error.status === 405) {
      const paths: Record<string, object> = agentOpenApi(url.origin).paths;
      const operations = paths[path.replace(/^\/productions\/[^/]+/, '/productions/{id}')];
      if (operations)
        headers.Allow = Object.keys(operations)
          .filter((key) => key !== 'parameters')
          .map((method) => method.toUpperCase())
          .join(', ');
    }
    const codes: Record<number, string> = {
      400: 'invalid_request',
      401: 'unauthorized',
      403: 'forbidden',
      404: 'not_found',
      405: 'method_not_allowed',
      409: 'conflict',
      413: 'payload_too_large',
      415: 'unsupported_media_type',
      503: 'unavailable',
    };
    return json(
      {
        error: error.message,
        code: codes[error.status] ?? 'request_failed',
        documentation: `${url.origin}/api/agent/instructions`,
      },
      error.status,
      { ...headers, ...(error.status === 401 ? { 'WWW-Authenticate': 'Bearer realm="his.fm"' } : {}) },
    );
  }
}
