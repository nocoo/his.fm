import { agentFrameSchema, browserFrameSchema, serverFrameSchema } from '@his-fm/contracts';
import { z } from 'zod';
import { version } from '../../../package.json';
import { categorySchema, publicCategorySchema } from '../src/shared/category';
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
  z.literal(editorialPriority[3]),
]);
export const serviceManifestSchema = z.object({
  name: z.literal('his.fm'),
  version: z.string(),
  protocol: z.literal('REST'),
  api: z.string(),
  authentication: z.object({
    type: z.literal('http'),
    scheme: z.literal('bearer'),
    configurationFile: z.literal('~/.config/his.fm/config.json'),
    tokenPath: z.literal('websites.<environment>.token'),
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
    execution: z.literal('native'),
    providers: z.array(z.enum(['gemini', 'elevenlabs'])),
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
function operation(operationId: string, summary: string, schema: object) {
  return {
    operationId,
    summary,
    responses: {
      ...errors,
      '200': { description: 'Success', content: content(schema) },
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
export function agentOpenApi(origin: string) {
  const schema = (value: z.ZodType, io: 'input' | 'output' = 'output') => z.toJSONSchema(value, { io });
  return {
    openapi: '3.1.0',
    info: {
      title: 'his.fm Agent Production API',
      version,
      description:
        'Authenticated read-only REST plus enrolled coordinator WebSockets. Legacy REST production mutations return 409 runtime_required. All machine mutations use typed operation frames, stable operation IDs and exact optimistic versions; human approvals are never available. Before every task read GET /channel: global prompt, then episode intent, then sources. Editorial priority never changes facts or grants permission. The owner must explicitly bind the token and station in the authenticated admin API before connecting.',
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
      },
      '/productions/{id}': {
        parameters: [idParameter],
        get: operation('getProduction', 'Read latest fields, version, feedback and audio status', {
          ...wrappedProduction,
          required: ['production', 'categoryProfile'],
          properties: { ...wrappedProduction.properties, categoryProfile: schema(categorySchema) },
        }),
      },
      '/categories': {
        get: operation('listCategories', 'Read selectable editorial categories without prompt bodies', {
          type: 'object',
          required: ['categories'],
          properties: { categories: { type: 'array', items: schema(publicCategorySchema) } },
        }),
      },
      '/categories/{id}': {
        parameters: [
          { ...idParameter, description: 'Stable category identifier selected on the production' },
        ],
        get: operation(
          'readCategory',
          'Read the private category prompt after the global channel prompt; owner-only writes',
          { type: 'object', required: ['category'], properties: { category: schema(categorySchema) } },
        ),
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
      '/runtime/connect': {
        get: {
          operationId: 'connectCoordinator',
          summary:
            'Upgrade the explicitly enrolled coordinator; 10s ping, 35s idle timeout, at most 15 minute authorization lease',
          parameters: [
            { name: 'X-Hisfm-Station', in: 'header', required: true, schema: { type: 'string' } },
            { name: 'protocol', in: 'query', schema: { const: '1' } },
          ],
          responses: {
            ...errors,
            '101': {
              description:
                'Typed AgentFrame/ServerFrame WebSocket. Never put tokens in the URL. Existing healthy station connections cannot be replaced.',
            },
          },
        },
      },
      '/runtime/receipts/{id}': {
        get: {
          ...operation(
            'readOperationReceipt',
            'Read an exact durable operation receipt; 202 means still unknown, not success',
            { type: 'object' },
          ),
          parameters: [
            { ...idParameter, description: 'Stable operation ID' },
            { name: 'X-Hisfm-Station', in: 'header', required: true, schema: { type: 'string' } },
          ],
        },
      },
      '/runtime/speech/{id}': {
        parameters: [
          { ...idParameter, description: 'Immutable website speech job ID, not a production ID' },
          ...['X-Hisfm-Station', 'X-Hisfm-Generation', 'X-Hisfm-Command'].map((name) => ({
            name,
            in: 'header',
            required: true,
            schema: { type: 'string' },
          })),
        ],
        get: operation('readNativeSpeechJob', 'Read the exact authorized speech job or completed receipt', {
          type: 'object',
        }),
        post: operation(
          'startNativeSpeechJob',
          'Mark local speech execution under the active enrolled lease',
          { type: 'object' },
        ),
        put: {
          ...operation(
            'completeNativeSpeechJob',
            'Upload mono 24 kHz PCM16 WAV and atomically attach a still-approved job',
            { type: 'object' },
          ),
          requestBody: {
            required: true,
            content: { 'audio/wav': { schema: { type: 'string', format: 'binary' } } },
          },
        },
        delete: operation(
          'failNativeSpeechJob',
          'Record a failed native attempt without deleting completed audio',
          { type: 'object' },
        ),
      },
    },
    components: {
      securitySchemes: {
        AgentBearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'hisfm_<64 hex characters>',
          description:
            'Store the studio-created token in the selected website entry of ~/.config/his.fm/config.json. Never send it to other origins. This is not a Cloudflare Access token or OAuth flow.',
        },
      },
      schemas: {
        AgentFrame: schema(agentFrameSchema, 'input'),
        BrowserFrame: schema(browserFrameSchema, 'input'),
        ServerFrame: schema(serverFrameSchema),
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
