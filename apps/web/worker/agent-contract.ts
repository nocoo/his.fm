import { grantsSchema, principalSchema, type Scope } from '@his-fm/contracts';
import { z } from 'zod';
import { version } from '../../../package.json';
import { appearanceSchema, appearanceUpdateSchema } from '../src/shared/appearance';
import { categoryInputSchema, categorySchema, categoryUpdateSchema } from '../src/shared/category';
import { channelProfileSchema, channelUpdateSchema, editorialPriority } from '../src/shared/channel';
import { episodeDisplaySchema, episodeInputSchema, episodeUpdateSchema } from '../src/shared/episode';
import {
  actionNames,
  agentActionSchema,
  agentActions,
  briefSchema,
  type Production,
  productionActionSchema,
  productionPatchSchema,
  productionStages,
  publicationSchema,
} from '../src/shared/production';
import { storageCleanupSchema, storageKinds } from '../src/shared/storage';
import { tokenSchema } from './agent-tokens';
import { bumperInputSchema, bumperUpdateSchema } from './bumpers';

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
  approvalScopes: z.tuple([z.literal('productions:approve'), z.literal('publications:write')]),
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
    source: z.literal('upload').optional(),
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
  publications: z.array(
    z.object({
      platform: z.enum(['wechat', 'xiaoyuzhou', 'site']),
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
      actor: principalSchema.extend({ scopes: z.array(z.string()).optional() }),
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
  availableActions: z.array(z.enum(actionNames)),
  blockedActions: z.record(z.string(), z.string()),
  canDelete: z.boolean(),
  canUploadCover: z.boolean(),
  canUploadAudio: z.boolean(),
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
  scopes: grantsSchema,
  limits: z.object({ jsonBytes: z.number(), coverBytes: z.number(), auditEvents: z.number() }),
  audio: z.object({
    execution: z.literal('external'),
    uploadMimeTypes: z.array(z.literal('audio/wav')),
    maximumSeconds: z.number(),
    maximumBytes: z.number(),
  }),
});
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const content = <T extends object>(schema: T) => ({ 'application/json': { schema } });
const fullProduction = {
  type: 'object',
  required: ['production'],
  properties: { production: ref('Production') },
};
const wrappedProduction = {
  description:
    'Without productions:read returns only production.id and production.version. With read access, publication fields and events still require publications:read.',
  anyOf: [
    fullProduction,
    {
      type: 'object',
      required: ['production'],
      properties: {
        production: {
          type: 'object',
          required: ['id', 'version'],
          properties: { id: { type: 'string' }, version: { type: 'integer' } },
          additionalProperties: false,
        },
      },
    },
  ],
};
const errors = Object.fromEntries(
  [400, 401, 403, 404, 405, 409, 413, 415, 500, 502, 503].map((status) => [
    String(status),
    {
      description: `HTTP ${status}; read error and documentation. Never blindly retry writes.`,
      content: content(ref('Error')),
    },
  ]),
);
function operation(
  operationId: string,
  summary: string,
  schema: object,
  requiredScopes: Scope[] = [],
  status = 200,
) {
  return {
    operationId,
    summary,
    'x-required-scopes': requiredScopes,
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
  description: 'Stable resource ID returned by create/list; never a display name or list position.',
};
export function agentOpenApi(origin: string) {
  const schema = (value: z.ZodType, io: 'input' | 'output' = 'output') => z.toJSONSchema(value, { io });
  const body = (value: z.ZodType) => ({ required: true, content: content(schema(value, 'input')) });
  const versionQuery = {
    name: 'version',
    in: 'query',
    required: true,
    schema: { type: 'integer', minimum: 1 },
    description: 'Expected resource version from the latest read.',
  };
  const categoryProjection = categorySchema.partial({ prompt: true });
  const tokenRecord = tokenSchema.omit({ expiresInDays: true }).extend({
    scopes: grantsSchema,
    invalidScopes: z.array(z.string()).optional(),
    id: z.string(),
    prefix: z.string(),
    createdAt: stamp,
    expiresAt: stamp,
    lastUsedAt: stamp.nullable(),
    revokedAt: stamp.nullable(),
  });
  const tokenInput = schema(tokenSchema, 'input');
  tokenInput.properties = {
    ...tokenInput.properties,
    scopes: { ...schema(tokenSchema.shape.scopes, 'input'), minItems: 1, uniqueItems: true },
  };
  const episode = episodeInputSchema.safeExtend({
    publishedAt: episodeInputSchema.shape.publishedAt.unwrap().in.nullable(),
    id: z.string(),
    version: z.number().int().positive(),
    sourceProductionId: z.string().nullable().optional(),
    createdAt: stamp,
    updatedAt: stamp,
  });
  const episodeMutation = schema(
    z.union([
      z.object({ episode }),
      z.object({ episode: z.strictObject({ id: episode.shape.id, version: episode.shape.version }) }),
    ]),
  );
  const storageObject = z.object({
    key: z.string(),
    version: z.string(),
    size: z.number(),
    uploaded: stamp,
    contentType: z.string(),
    kind: z.enum(storageKinds),
    state: z.enum(['referenced', 'protected', 'recent', 'unused']),
    reasons: z.array(z.string()),
  });
  const cleanupResult = z.object({
    results: z.array(
      z.object({
        key: z.string(),
        status: z.enum(['deleted', 'skipped', 'failed']),
        reason: z.string(),
        bytes: z.number(),
      }),
    ),
  });
  const bumper = z.object({
    id: z.string(),
    name: z.string(),
    position: z.enum(['intro', 'outro']),
    version: z.number().int().positive(),
    key: z.string(),
    url: z.string(),
    durationSeconds: z.number(),
    size: z.number(),
  });
  const bumperMutation = schema(
    z.union([
      z.object({ bumper }),
      z.object({ bumper: z.strictObject({ id: bumper.shape.id, version: bumper.shape.version }) }),
    ]),
  );
  const binaryBody = (types: string[]) => ({
    required: true,
    content: Object.fromEntries(
      types.map((type) => [type, { schema: { type: 'string', format: 'binary' } }]),
    ),
  });
  return {
    openapi: '3.1.0',
    info: {
      title: 'his.fm Scoped Site API',
      version,
      description:
        'Scoped external REST content management. Content creation and audio generation happen outside this service. Each operation declares x-required-scopes; all listed grants are required, with conditional grants documented separately. Write does not imply read, review or publication. Existing-record mutations require optimistic versions and retain the actual authenticated audit actor. Editorial priority is global prompt, category prompt, intent, sources; it never changes facts or grants permission. This service does not accept provider credentials or operate a task runtime. No infrastructure operations or external-platform publishing.',
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
        get: operation(
          'checkAgentToken',
          'Verify authenticated agent identity, token ID, grants and expiry in Unix milliseconds',
          schema(
            z.object({
              actor: principalSchema.extend({
                kind: z.literal('agent'),
                tokenId: z.string(),
                scopes: grantsSchema,
                expiresAt: z.number().positive(),
              }),
            }),
          ),
        ),
      },
      '/capabilities': {
        get: operation(
          'getServiceCapabilities',
          'Read limits, permissions and external audio upload requirements',
          ref('ServiceCapabilities'),
        ),
      },
      '/channel': {
        get: operation(
          'getChannelPositioning',
          'Read the private global editorial prompt and workflow/stage bundle before every creative task. Keep internal principles out of public content.',
          {
            type: 'object',
            required: ['channel', 'priority'],
            properties: { channel: ref('ChannelProfile'), priority: schema(prioritySchema) },
          },
          ['prompts:read'],
        ),
        put: {
          ...operation(
            'updateChannelPrompts',
            'Update saved prompts with an optimistic version; does not rewrite productions or invalidate approvals. Without prompts:read returns only the new version.',
            schema(
              z.union([
                z.object({ channel: channelProfileSchema, priority: prioritySchema }),
                z.object({ version: z.number().int().positive() }),
              ]),
            ),
            ['prompts:write'],
          ),
          requestBody: body(channelUpdateSchema),
        },
      },
      '/productions': {
        get: operation(
          'listProductions',
          'List productions; publication details/events projected by publications:read; no pagination',
          {
            type: 'object',
            required: ['productions'],
            properties: { productions: { type: 'array', items: ref('Production') } },
          },
          ['productions:read'],
        ),
        post: {
          ...operation(
            'createProduction',
            'Create a brief with server-owned identity, stage and audit history',
            wrappedProduction,
            ['productions:write'],
            201,
          ),
          requestBody: body(briefSchema),
        },
      },
      '/productions/{id}': {
        parameters: [idParameter],
        get: operation(
          'getProduction',
          'Read latest fields, version, feedback and audio status',
          {
            ...fullProduction,
            required: ['production', 'categoryProfile'],
            properties: { ...fullProduction.properties, categoryProfile: schema(categoryProjection) },
            description:
              'categoryProfile includes metadata; its private prompt is omitted without prompts:read. Publication details and publication events depend on publications:read. The same projection applies to mutation responses.',
          },
          ['productions:read'],
        ),
        put: {
          ...operation(
            'updateProduction',
            'Edit stage-allowed business fields with an expected version; no raw approval, asset, receipt or publication writes',
            wrappedProduction,
            ['productions:write'],
          ),
          requestBody: body(productionPatchSchema),
        },
        delete: {
          ...operation(
            'deleteProduction',
            'Delete an unpublished production only; publication references block deletion',
            {},
            ['productions:delete'],
            204,
          ),
          parameters: [versionQuery],
        },
      },
      '/categories': {
        get: operation(
          'listCategories',
          'Read category metadata; prompt is omitted without prompts:read',
          {
            type: 'object',
            required: ['categories'],
            properties: { categories: { type: 'array', items: schema(categoryProjection) } },
          },
          ['categories:read'],
        ),
        post: {
          ...operation(
            'createCategory',
            'Create a stable-ID category; setting a nonempty prompt additionally requires prompts:write; returned prompt needs prompts:read',
            schema(z.object({ category: categoryProjection })),
            ['categories:write'],
            201,
          ),
          requestBody: body(categoryInputSchema.partial({ prompt: true })),
        },
      },
      '/categories/{id}': {
        parameters: [
          { ...idParameter, description: 'Stable category identifier selected on the production' },
        ],
        get: operation(
          'readCategory',
          'Read category metadata; private prompt is omitted without prompts:read',
          { type: 'object', required: ['category'], properties: { category: schema(categoryProjection) } },
          ['categories:read'],
        ),
        put: {
          ...operation(
            'updateCategory',
            'Update category metadata by version; changing its prompt additionally requires prompts:write; returned prompt needs prompts:read',
            schema(z.object({ category: categoryProjection })),
            ['categories:write'],
          ),
          requestBody: body(
            categoryUpdateSchema.partial({ name: true, icon: true, color: true, prompt: true }),
          ),
        },
        delete: {
          ...operation(
            'deleteCategory',
            'Delete an unreferenced category by version; existing production/episode references block deletion',
            {},
            ['categories:delete'],
            204,
          ),
          parameters: [versionQuery],
        },
      },
      '/productions/{id}/capabilities': {
        parameters: [idParameter],
        get: operation(
          'getProductionCapabilities',
          'Discover currently valid actions and blocking reasons; read-only',
          ref('ProductionCapabilities'),
          ['productions:read'],
        ),
      },
      '/productions/{id}/prompts': {
        parameters: [idParameter],
        get: operation(
          'getProductionPrompts',
          'Read external research, script, cover and description instructions',
          ref('Prompts'),
          ['productions:read', 'prompts:read'],
        ),
      },
      '/productions/{id}/actions': {
        parameters: [idParameter],
        post: {
          ...operation(
            'performProductionAction',
            'Submit requires productions:submit; approve requires productions:approve; revise/reopen requires productions:reopen. Inline changes additionally require productions:write. Valid stage, feedback and assets remain mandatory; audit actor remains agent.',
            wrappedProduction,
          ),
          'x-required-scopes-by-action': {
            submit_brief: ['productions:submit'],
            submit_script: ['productions:submit'],
            submit_final: ['productions:submit'],
            approve_brief: ['productions:approve'],
            approve_script: ['productions:approve'],
            approve_final: ['productions:approve'],
            revise_brief: ['productions:reopen'],
            revise_script: ['productions:reopen'],
            revise_assets: ['productions:reopen'],
            reopen_brief: ['productions:reopen'],
            reopen_script: ['productions:reopen'],
            reopen_assets: ['productions:reopen'],
          },
          requestBody: body(productionActionSchema),
        },
      },
      '/productions/{id}/assets/cover': {
        parameters: [idParameter, versionQuery],
        put: {
          ...operation(
            'uploadProductionCover',
            'Upload a clean unframed raster original, at most 8 MiB; immutable key and approved-script asset rules apply',
            wrappedProduction,
            ['productions:write', 'storage:write'],
          ),
          requestBody: binaryBody(['image/png', 'image/jpeg', 'image/webp']),
        },
        delete: operation(
          'detachProductionCover',
          'Detach the current cover by expected version; does not delete referenced media or rewrite publication snapshots',
          wrappedProduction,
          ['productions:write', 'storage:write'],
        ),
      },
      '/productions/{id}/assets/audio': {
        parameters: [idParameter, versionQuery],
        put: {
          ...operation(
            'uploadProductionAudio',
            'Attach complete mono 24 kHz PCM16 WAV after script approval, at most 1800 seconds and 86465536 bytes. Content-Length is required; duration is derived from validated bytes. Final-approved assets require productions:reopen.',
            wrappedProduction,
            ['productions:write', 'storage:write'],
          ),
          requestBody: binaryBody(['audio/wav']),
        },
        delete: operation(
          'detachProductionAudio',
          'Detach current audio by expected version, preserving immutable media and published snapshots. Final-approved assets require productions:reopen.',
          wrappedProduction,
          ['productions:write', 'storage:write'],
        ),
      },
      '/productions/{id}/publications': {
        parameters: [idParameter],
        get: operation(
          'listPublicationRecords',
          'Read recorded publication facts, not remote platform status',
          {
            type: 'object',
            required: ['publications'],
            properties: { publications: { type: 'array', items: ref('Publication') } },
          },
          ['publications:read'],
        ),
        post: {
          ...operation(
            'recordPublication',
            'Record an actual completed platform publication and atomically update the public snapshot; ready/current final approval/assets required. This never calls an external publishing API.',
            wrappedProduction,
            ['publications:write'],
          ),
          requestBody: body(publicationSchema),
        },
      },
      '/productions/{id}/publications/{platform}': {
        parameters: [
          idParameter,
          {
            name: 'platform',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['wechat', 'xiaoyuzhou'] },
          },
        ],
        patch: {
          ...operation(
            'correctPublication',
            'Correct an existing publication record and snapshot atomically, preserving the previous audit value',
            wrappedProduction,
            ['publications:write'],
          ),
          requestBody: body(publicationSchema),
        },
        delete: {
          ...operation(
            'withdrawPublication',
            'Withdraw an existing record by version; withdrawing the last record unpublishes the site snapshot, not the remote post',
            wrappedProduction,
            ['publications:delete'],
          ),
          parameters: [versionQuery],
        },
      },
      '/episodes': {
        get: operation(
          'listEpisodes',
          'Read the private episode catalogue including draft snapshots',
          schema(z.object({ episodes: z.array(episode) })),
          ['episodes:read'],
        ),
        post: {
          ...operation(
            'createEpisode',
            'Create a manual catalogue episode; publishing additionally requires episodes:publish. Without episodes:read returns only id/version.',
            episodeMutation,
            ['episodes:write'],
            201,
          ),
          requestBody: body(episodeInputSchema),
        },
      },
      '/episodes/{id}': {
        parameters: [idParameter],
        get: operation(
          'getEpisode',
          'Read an exact catalogue episode and version',
          schema(z.object({ episode })),
          ['episodes:read'],
        ),
        put: {
          ...operation(
            'updateEpisode',
            'Update a manual episode by version; visibility/publication changes additionally require episodes:publish. Production snapshots cannot be rewritten here. Without episodes:read returns only id/version.',
            episodeMutation,
            ['episodes:write'],
          ),
          requestBody: body(episodeUpdateSchema),
        },
        patch: {
          ...operation(
            'updateEpisodeDisplay',
            'Change only the featured flag by version, including on a production snapshot. Without episodes:read returns only id/version.',
            episodeMutation,
            ['episodes:write'],
          ),
          requestBody: body(episodeDisplaySchema),
        },
        delete: {
          ...operation(
            'deleteEpisode',
            'Delete an unowned manual episode by version; production snapshots use publication withdrawal',
            {},
            ['episodes:delete'],
            204,
          ),
          parameters: [versionQuery],
        },
      },
      '/appearance': {
        get: operation(
          'getAppearance',
          'Read saved public appearance selection and optimistic version',
          schema(z.object({ appearance: appearanceSchema })),
          ['appearance:read'],
        ),
        put: {
          ...operation(
            'updateAppearance',
            'Update the saved public theme by version',
            schema(z.object({ appearance: appearanceSchema })),
            ['appearance:write'],
          ),
          requestBody: body(appearanceUpdateSchema),
        },
      },
      '/bumpers': {
        get: operation(
          'listBumpers',
          'List saved immutable bumper audio and metadata',
          schema(z.object({ bumpers: z.array(bumper) })),
          ['bumpers:read'],
        ),
        post: {
          ...operation(
            'uploadBumper',
            'Upload complete mono 24 kHz PCM16 WAV, at most 3 MiB and 30 seconds; metadata is required in query parameters. Without bumpers:read returns only bumper.id/version; otherwise full metadata.',
            bumperMutation,
            ['bumpers:write'],
            201,
          ),
          parameters: Object.entries(schema(bumperInputSchema, 'input').properties ?? {}).map(
            ([name, value]) => ({ name, in: 'query', required: true, schema: value }),
          ),
          requestBody: binaryBody(['audio/wav']),
        },
      },
      '/bumpers/{id}': {
        parameters: [idParameter],
        get: operation(
          'getBumper',
          'Read a saved bumper and optimistic version',
          schema(z.object({ bumper })),
          ['bumpers:read'],
        ),
        put: {
          ...operation(
            'updateBumper',
            'Rename or reposition a bumper by version; immutable media bytes are unchanged. Without bumpers:read returns only bumper.id/version; otherwise full metadata.',
            bumperMutation,
            ['bumpers:write'],
          ),
          requestBody: body(bumperUpdateSchema),
        },
        delete: {
          ...operation(
            'deleteBumper',
            'Delete unreferenced bumper metadata by version; productions and historical media provenance block deletion; immutable media is retained',
            {},
            ['bumpers:delete'],
            204,
          ),
          parameters: [versionQuery],
        },
      },
      '/agent-tokens': {
        get: operation(
          'listAgentTokens',
          'Read token metadata and grants, never existing secrets. Invalid stored grants project scopes:[] plus invalidScopes; authentication remains disabled until the owner revokes the token.',
          schema(z.object({ tokens: z.array(tokenRecord) })),
          ['tokens:read'],
        ),
        post: {
          ...operation(
            'issueAgentToken',
            'Issue a one-time secret. Grants must be nonempty, unique and known; agent delegation must be a subset of issuer grants and cannot outlive issuer expiry. Reject excess rather than clamp.',
            schema(z.object({ token: z.string(), record: tokenRecord })),
            ['tokens:issue'],
            201,
          ),
          requestBody: { required: true, content: content(tokenInput) },
        },
      },
      '/agent-tokens/{id}': {
        parameters: [idParameter],
        delete: operation(
          'deleteAgentToken',
          'Remove an already revoked token from management lists. Active or merely expired tokens return 409. Agent target grants must be a subset of caller grants. Revoked tombstones and delegation remain for security and audit. Repeated deletion returns 204.',
          {},
          ['tokens:delete'],
          204,
        ),
      },
      '/agent-tokens/{id}/revoke': {
        parameters: [idParameter],
        post: operation(
          'revokeAgentToken',
          'Revoke the target and descendants; agent target grants must be a subset of revoker grants',
          {},
          ['tokens:revoke'],
          204,
        ),
      },
      '/storage': {
        get: {
          ...operation(
            'scanStorage',
            'Scan all cursor pages before cleanup; current references, protected prefixes and 24-hour retention are reported',
            schema(z.object({ objects: z.array(storageObject), cursor: z.string().nullable() })),
            ['storage:read'],
          ),
          parameters: [{ name: 'cursor', in: 'query', schema: { type: 'string', maxLength: 4096 } }],
        },
        post: {
          ...operation(
            'uploadStorageObject',
            'Upload validated raster or mono 24 kHz PCM16 WAV, at most 25 MiB. Server generates a new immutable key; caller paths/query parameters are rejected.',
            schema(z.object({ object: storageObject, url: z.string() })),
            ['storage:write'],
            201,
          ),
          requestBody: binaryBody(['image/png', 'image/jpeg', 'image/webp', 'audio/wav']),
        },
      },
      '/storage/object': {
        parameters: [
          {
            name: 'key',
            in: 'query',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 1024 },
          },
        ],
        get: {
          operationId: 'downloadStorageObject',
          summary:
            'Download an exact private object with safe media type, range support and no-store headers',
          'x-required-scopes': ['storage:read'],
          parameters: [
            { name: 'Range', in: 'header', schema: { type: 'string' } },
            { name: 'If-Range', in: 'header', schema: { type: 'string' } },
          ],
          responses: {
            ...errors,
            '200': {
              description: 'Object bytes',
              content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
            },
            '206': { description: 'Requested byte range' },
            '416': { description: 'Invalid byte range' },
          },
        },
        head: {
          operationId: 'inspectStorageObject',
          summary: 'Read exact object headers without bytes',
          'x-required-scopes': ['storage:read'],
          responses: { ...errors, '200': { description: 'Object headers' } },
        },
        delete: {
          ...operation(
            'deleteStorageObject',
            'Delete only an unused, unprotected object older than 24 hours, revalidating references and exact object version; inspect per-item result',
            schema(cleanupResult),
            ['storage:delete'],
          ),
          parameters: [
            {
              name: 'version',
              in: 'query',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 256 },
            },
          ],
        },
      },
      '/storage/cleanup': {
        post: {
          ...operation(
            'cleanupStorage',
            'Revalidate and clean up at most 50 scanned items. Protected/referenced/recent/stale objects are skipped; partial success is reported per item. Never use a partial scan as cleanup authority.',
            schema(cleanupResult),
            ['storage:delete'],
          ),
          requestBody: body(storageCleanupSchema),
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
            'Store the studio-created token securely in your external client. Never send it to other origins. This is not a Cloudflare Access token or OAuth flow.',
        },
      },
      schemas: {
        ChannelProfile: {
          ...schema(channelProfileSchema),
          description:
            'Private Markdown global prompt and named workflow/stage prompts, versioned together independently of productions. Re-read at each task; pause and reassess if version changes. Internal editorial requirements do not grant API permissions.',
        },
        ServiceManifest: schema(serviceManifestSchema),
        CreateProduction: schema(briefSchema, 'input'),
        UpdateProduction: schema(productionPatchSchema, 'input'),
        AgentAction: schema(agentActionSchema, 'input'),
        ProductionAction: schema(productionActionSchema, 'input'),
        Production: schema(productionResponseSchema),
        Publication: schema(productionResponseSchema.shape.publications.element),
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
