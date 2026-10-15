import { hasScope } from '@his-fm/contracts';
import instructions from '../../../docs/api-onboarding.md?raw';
import { version } from '../../../package.json';
import { editorialPriority } from '../src/shared/channel';
import {
  type Actor,
  actionNames,
  agentActions,
  agentEditableFields,
  type Production,
  productionPatchSchema,
} from '../src/shared/production';
import { agentOpenApi } from './agent-contract';
import { authenticateAgent } from './agent-tokens';
import { requireScope } from './authorization';
import { HttpError, json } from './http';
import { routeManagement } from './management';
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
      tokenManagement: `${origin}/admin/connections`,
      verification: `${base}/me`,
    },
    links: {
      catalog: `${origin}/.well-known/api-catalog`,
      openapi: `${base}/openapi.json`,
      instructions: `${base}/instructions`,
      capabilities: `${base}/capabilities`,
      productions: `${base}/productions`,
      channel: `${base}/channel`,
      health: `${origin}/api/live`,
    },
    workflow: 'draft -> brief_review -> scripting -> script_review -> production -> final_review -> ready',
    approvalScopes: ['productions:approve', 'publications:write'],
    editorialPriority,
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
        ? `# his.fm\n\n> Chinese solo podcast production studio.\n\n## Editorial priority\n\nGlobal prompt > selected category prompt > episode intent > source material. Authenticated agents must read ${origin}/api/agent/channel before every creative task. Read the selected category through the private production categoryProfile or /api/agent/categories/:id. Global, category and workflow/stage prompts are private. The channel response includes the editable prompts bundle.\n\n## Agent API\n\n- [Service discovery](${origin}/api/agent): Scoped external REST content management.\n- [OpenAPI 3.1](${origin}/api/agent/openapi.json): Complete machine-readable contract.\n- [API onboarding](${origin}/api/agent/instructions): Authentication, scopes, versioned content operations.\n\nDiscovery is public; all production data requires a studio-issued bearer token. This service does not expose MCP or A2A.\n`
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
  const canReopen = hasScope(actor, 'productions:reopen');
  const availableActions: (typeof actionNames)[number][] = [];
  const blockedActions: Record<string, string> = {};
  for (const action of actionNames) {
    try {
      applyAction(production, { action, version: production.version, feedback: 'Capability check' }, actor);
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
    editableFields: hasScope(actor, 'productions:write')
      ? canReopen
        ? Object.keys(productionPatchSchema.shape).filter((field) => field !== 'version')
        : agentEditableFields[production.stage].filter(
            (field) => field !== 'category' || !production.approvals.brief,
          )
      : [],
    availableActions,
    blockedActions,
    canDelete:
      hasScope(actor, 'productions:delete') &&
      !production.publications.length &&
      !production.events.some((event) => event.action.includes('publication:')),
    canUploadCover:
      hasScope(actor, 'productions:write') &&
      hasScope(actor, 'storage:write') &&
      (canReopen || production.stage === 'production'),
    canUploadAudio:
      hasScope(actor, 'productions:write') &&
      hasScope(actor, 'storage:write') &&
      (canReopen || production.stage === 'production') &&
      Boolean(production.approvals.brief && production.approvals.script && production.transcript.trim()),
    links: {
      self: `${base}/capabilities`,
      production: base,
      prompts: `${base}/prompts`,
      actions: `${base}/actions`,
      cover: `${base}/assets/cover?version=${production.version}`,
      audio: `${base}/assets/audio?version=${production.version}`,
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
      if (path !== '/capabilities') {
        requireScope(actor, 'productions:read');
        return json(
          productionCapabilities(await getProduction(env.DB, path.split('/')[2]), actor, url.origin),
          200,
          headers,
        );
      }
      return json(
        {
          authentication: 'Bearer',
          editorial: {
            priority: editorialPriority,
            channelUrl: `${url.origin}/api/agent/channel`,
            readBeforeEveryTask: true,
          },
          scopes: actor.scopes ?? [],
          editableFields: hasScope(actor, 'productions:write') ? agentEditableFields : {},
          agentActions: hasScope(actor, 'productions:submit') ? agentActions : [],
          limits: { jsonBytes: 750000, coverBytes: 8388608, auditEvents: 200 },
          audio: {
            execution: 'external',
            uploadMimeTypes: ['audio/wav'],
            maximumSeconds: 1800,
            maximumBytes: 86465536,
          },
        },
        200,
        headers,
      );
    }
    const response = await routeManagement(request, env, path, actor);
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
