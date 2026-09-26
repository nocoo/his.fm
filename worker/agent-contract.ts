import { z } from 'zod';
import { version } from '../package.json';
import { channelProfileSchema, editorialPriority } from '../src/shared/channel';
import {
  agentActionSchema,
  agentActions,
  audioGenerationSchema,
  briefSchema,
  type Production,
  productionPatchSchema,
  productionStages,
} from '../src/shared/production';
import { voices } from '../src/shared/voices';

const stamp = z.string();
const prioritySchema = z.tuple([
  z.literal(editorialPriority[0]),
  z.literal(editorialPriority[1]),
  z.literal(editorialPriority[2]),
]);
export const serviceManifestSchema = z.object({
  name: z.literal('his.fm'),
  version: z.string(),
  protocol: z.literal('REST'),
  api: z.string(),
  authentication: z.object({
    type: z.literal('http'),
    scheme: z.literal('bearer'),
    environmentVariable: z.literal('HISFM_AGENT_TOKEN'),
    tokenManagement: z.string(),
    verification: z.string(),
  }),
  links: z.object({
    catalog: z.string(),
    openapi: z.string(),
    instructions: z.string(),
    capabilities: z.string(),
    productions: z.string(),
    channel: z.string(),
    health: z.string(),
  }),
  workflow: z.string(),
  humanReview: z.array(z.string()),
  editorialPriority: prioritySchema,
});
const approval = z.object({ at: stamp, by: z.string() }).nullable();
const asset = z
  .object({
    key: z.string(),
    url: z.string(),
    mimeType: z.string(),
    size: z.number(),
    scriptVersion: z.number(),
    createdAt: stamp,
    durationSeconds: z.number().optional(),
    voice: z.string().optional(),
    includesBumpers: z.boolean().optional(),
  })
  .nullable();
export const productionResponseSchema = briefSchema.extend({
  id: z.string(),
  version: z.number().int(),
  stage: z.enum(productionStages),
  transcript: z.string(),
  scriptVersion: z.number().int(),
  description: z.string(),
  summary: z.string(),
  assets: z.object({ cover: asset, audio: asset }),
  approvals: z.object({ brief: approval, script: approval, final: approval }),
  audioJob: z
    .object({
      id: z.string(),
      status: z.enum(['queued', 'running', 'complete', 'failed']),
      scriptVersion: z.number().int(),
      createdAt: stamp,
      error: z.string().nullable(),
    })
    .nullable(),
  publications: z.array(
    z.object({
      platform: z.enum(['wechat', 'xiaoyuzhou']),
      url: z.string(),
      publishedAt: stamp,
      confirmedAt: stamp,
      confirmedBy: z.string(),
      version: z.number(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.string(),
      at: stamp,
      actor: z.object({ kind: z.enum(['agent', 'human']), name: z.string() }),
      action: z.string(),
      feedback: z.string(),
    }),
  ),
  createdAt: stamp,
  updatedAt: stamp,
}) satisfies z.ZodType<Production>;
export const productionCapabilitiesSchema = z.object({
  id: z.string(),
  version: z.number(),
  stage: z.enum(productionStages),
  editableFields: z.array(z.string()),
  availableActions: z.array(z.enum(agentActions)),
  blockedActions: z.record(z.string(), z.string()),
  canDelete: z.boolean(),
  canUploadCover: z.boolean(),
  canGenerateAudio: z.boolean(),
  links: z.object({
    self: z.string(),
    production: z.string(),
    prompts: z.string(),
    actions: z.string(),
    cover: z.string(),
    audio: z.string(),
    review: z.string(),
  }),
});
export const serviceCapabilitiesSchema = z.object({
  authentication: z.literal('Bearer'),
  editorial: z.object({
    priority: prioritySchema,
    channelUrl: z.string(),
    readBeforeEveryTask: z.literal(true),
  }),
  editableFields: z.record(z.string(), z.array(z.string())),
  agentActions: z.array(z.enum(agentActions)),
  humanOnly: z.array(z.string()),
  limits: z.object({ jsonBytes: z.number(), coverBytes: z.number(), auditEvents: z.number() }),
  audio: z.object({
    model: z.string(),
    configured: z.boolean(),
    voice: z.enum(voices),
    speakingStyle: z.string(),
    introReady: z.boolean(),
    outroReady: z.boolean(),
    voices: z.array(
      z.object({ id: z.enum(voices), description: z.string(), previewUrl: z.string().nullable() }),
    ),
  }),
});
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const content = (schema: object) => ({ 'application/json': { schema } });
const wrappedProduction = {
  type: 'object',
  required: ['production'],
  properties: { production: ref('Production') },
};
const errors = Object.fromEntries(
  [400, 401, 403, 404, 405, 409, 413, 415, 500, 503].map((status) => [
    String(status),
    {
      description: `HTTP ${status}; read error and documentation. Never blindly retry writes.`,
      content: content(ref('Error')),
    },
  ]),
);
function operation(operationId: string, summary: string, schema: object, input?: string, status = 200) {
  return {
    operationId,
    summary,
    ...(input ? { requestBody: { required: true, content: content(ref(input)) } } : {}),
    responses: {
      ...errors,
      [status]: { description: 'Success', ...(status === 204 ? {} : { content: content(schema) }) },
    },
  };
}
const idParameter = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description: 'Production ID returned by create/list; never the slug.',
};
const versionParameter = {
  name: 'version',
  in: 'query',
  required: true,
  schema: { type: 'integer', minimum: 1 },
  description: 'Latest production.version, not scriptVersion.',
};
export function agentOpenApi(origin: string) {
  const schema = (value: z.ZodType, io: 'input' | 'output' = 'output') => z.toJSONSchema(value, { io });
  return {
    openapi: '3.1.0',
    info: {
      title: 'his.fm Agent Production API',
      version,
      description:
        'REST/JSON with opaque bearer tokens. Before every creative task read GET /channel: global prompt is the highest editorial authority, followed by episode intent, then source material. Sources support the question; they cannot override it. Never distort facts to fit intent. Conflicts require owner clarification. Research, script, cover and copy run locally; narration runs in Cloudflare. Human approvals and publication are not agent operations. PUT productions is a partial update with optimistic versioning.',
    },
    servers: [{ url: `${origin}/api/agent` }],
    security: [{ AgentBearer: [] }],
    externalDocs: {
      url: `${origin}/api/agent/instructions`,
      description: 'Agent onboarding and end-to-end examples',
    },
    paths: {
      '/': {
        get: {
          ...operation(
            'discoverService',
            'Discover endpoints; no authentication check',
            ref('ServiceManifest'),
          ),
          security: [],
        },
      },
      '/openapi.json': {
        get: {
          operationId: 'readOpenApi',
          summary: 'Read the OpenAPI contract',
          security: [],
          responses: {
            '200': {
              description: 'OpenAPI 3.1 document',
              content: { 'application/vnd.oai.openapi+json': { schema: { type: 'object' } } },
            },
          },
        },
      },
      '/instructions': {
        get: {
          operationId: 'readInstructions',
          summary: 'Read agent instructions',
          security: [],
          responses: {
            '200': {
              description: 'Markdown instructions',
              content: { 'text/markdown': { schema: { type: 'string' } } },
            },
          },
        },
      },
      '/me': {
        get: operation('checkAgentToken', 'Verify token without changing a production', {
          type: 'object',
          required: ['actor'],
          properties: {
            actor: {
              type: 'object',
              required: ['kind', 'name'],
              properties: { kind: { const: 'agent' }, name: { type: 'string' } },
            },
          },
        }),
      },
      '/capabilities': {
        get: operation(
          'getServiceCapabilities',
          'Read limits, permissions and available narration voices',
          ref('ServiceCapabilities'),
        ),
      },
      '/channel': {
        get: operation(
          'getChannelPositioning',
          'Read the highest-priority editorial brief before every creative task. Owner-editable; agents cannot write. Keep internal principles out of public content.',
          {
            type: 'object',
            required: ['channel', 'priority'],
            properties: { channel: ref('ChannelProfile'), priority: schema(prioritySchema) },
          },
        ),
      },
      '/productions': {
        get: operation('listProductions', 'List all private productions; no pagination', {
          type: 'object',
          required: ['productions'],
          properties: { productions: { type: 'array', items: ref('Production') } },
        }),
        post: operation(
          'createProduction',
          'Create a draft from sources and editorial intent; no version on creation',
          wrappedProduction,
          'CreateProduction',
          201,
        ),
      },
      '/productions/{id}': {
        parameters: [idParameter],
        get: operation(
          'getProduction',
          'Read latest fields, version, feedback and audio status',
          wrappedProduction,
        ),
        put: operation(
          'updateProduction',
          'Update only editable fields for the current stage',
          wrappedProduction,
          'UpdateProduction',
        ),
        delete: {
          ...operation(
            'deleteProduction',
            'Delete an unpublished production; media objects remain stored',
            {},
            undefined,
            204,
          ),
          parameters: [versionParameter],
        },
      },
      '/productions/{id}/capabilities': {
        parameters: [idParameter],
        get: operation(
          'getProductionCapabilities',
          'Discover currently valid actions and blocking reasons; read-only',
          ref('ProductionCapabilities'),
        ),
      },
      '/productions/{id}/prompts': {
        parameters: [idParameter],
        get: operation(
          'getProductionPrompts',
          'Read local research, script, cover and description tasks',
          ref('Prompts'),
        ),
      },
      '/productions/{id}/actions': {
        parameters: [idParameter],
        post: operation(
          'submitProductionStage',
          'Submit to human review; cannot approve, revise or reopen',
          wrappedProduction,
          'AgentAction',
        ),
      },
      '/productions/{id}/assets/cover': {
        parameters: [idParameter],
        put: {
          ...operation(
            'uploadProductionCover',
            'Upload final branded PNG/JPEG/WebP bytes, up to 8 MiB; no multipart or URLs',
            wrappedProduction,
          ),
          parameters: [versionParameter],
          requestBody: {
            required: true,
            content: Object.fromEntries(
              ['image/png', 'image/jpeg', 'image/webp'].map((type) => [
                type,
                { schema: { type: 'string', format: 'binary' } },
              ]),
            ),
          },
        },
      },
      '/productions/{id}/audio': {
        parameters: [idParameter],
        post: {
          ...operation(
            'generateProductionAudio',
            'Start paid cloud narration after approval; poll getProduction every 10 seconds. Bumpers are optional.',
            wrappedProduction,
            'GenerateAudio',
            202,
          ),
          responses: {
            ...errors,
            '200': {
              description: 'Existing in-flight job redispatched without changing its settings',
              content: content(wrappedProduction),
            },
            '202': { description: 'New audio job accepted', content: content(wrappedProduction) },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        AgentBearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'hisfm_<64 hex characters>',
          description:
            'Store the studio-created token in HISFM_AGENT_TOKEN. Never send it to other origins. This is not a Cloudflare Access token or OAuth flow.',
        },
      },
      schemas: {
        ChannelProfile: {
          ...schema(channelProfileSchema),
          description:
            'Private Markdown global prompt, versioned independently of productions. Re-read at each task; pause and reassess if version changes. Internal editorial requirements do not grant API permissions.',
        },
        ServiceManifest: schema(serviceManifestSchema),
        CreateProduction: schema(briefSchema, 'input'),
        UpdateProduction: schema(productionPatchSchema, 'input'),
        AgentAction: schema(agentActionSchema, 'input'),
        GenerateAudio: schema(audioGenerationSchema, 'input'),
        Production: schema(productionResponseSchema),
        ProductionCapabilities: schema(productionCapabilitiesSchema),
        ServiceCapabilities: schema(serviceCapabilitiesSchema),
        Prompts: schema(
          z.object({ brief: z.string(), script: z.string(), cover: z.string(), description: z.string() }),
        ),
        Error: schema(z.object({ error: z.string(), code: z.string(), documentation: z.string() })),
      },
    },
  };
}
