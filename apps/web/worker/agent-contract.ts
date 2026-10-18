import {
  grantsSchema,
  principalSchema,
  promptSlotApplySchema,
  promptSlotCreateSchema,
  promptSlotPatchSchema,
  promptSlotProjectionSchema,
  promptSlotReplaceSchema,
  promptSlotTableSchema,
  type Scope,
} from '@his-fm/contracts';
import { z } from 'zod';
import { version } from '../../../package.json';
import { appearanceSchema, appearanceUpdateSchema, themeIdSchema } from '../src/shared/appearance';
import { categoryInputSchema, categoryMutationSchema, categorySchema } from '../src/shared/category';
import { channelProfileSchema, editorialPriority } from '../src/shared/channel';
import {
  episodeCreateSchema,
  episodeDisplaySchema,
  episodeInputSchema,
  episodeUpdateSchema,
} from '../src/shared/episode';
import {
  actionNames,
  agentActionSchema,
  agentActions,
  briefCreateSchema,
  briefSchema,
  type Production,
  productionActionSchema,
  productionAudioBindSchema,
  productionPatchSchema,
  productionStages,
  publicationPlatforms,
  publicationSchema,
} from '../src/shared/production';
import { seoOverrideSchema, siteSeoSchema, siteSeoUpdateSchema } from '../src/shared/seo';
import { storageCleanupSchema, storageKinds } from '../src/shared/storage';
import { tokenSchema } from './agent-tokens';
import { bumperInputSchema, bumperUpdateSchema } from './bumpers';

const stamp = z.string();
export const promptSlotContractSummary =
  'Prompt slots use GET/PUT/POST /channel/prompt-slots and /categories/{id}/prompt-slots, plus PATCH/DELETE /{slotId}. Reads require prompts:read; all writes require prompts:write, independently of category metadata grants. Mutations use the collection version; write-only responses contain only version. Category append adds after the same channel ID; override replaces it. Disabled category slots do not mask channel. Enabled results sort by order then ID. GET /migration/dry-run below either table is read-only; POST /migration/apply with version and legacyVersion explicitly initializes slots with an atomic original-value backup. Nothing auto-applies on deploy; reapply is a no-op. Old channel.content, channel.prompts.* and category.prompt are read-only: stored values until apply, then enabled local slots concatenated as Markdown. New clients must use slots; compatibility removal requires a separately announced, verified consumer cutover.';
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
      platform: z.enum(publicationPlatforms),
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
    uploadAudio: z.string(),
    bindAudio: z.string(),
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
    uploadMimeTypes: z.array(z.enum(['audio/wav', 'audio/mpeg'])),
    maximumSeconds: z.number(),
    maximumBytes: z.number(),
    maximumMp3Bytes: z.number(),
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
  [400, 401, 403, 404, 405, 409, 413, 415, 422, 500, 502, 503].map((status) => [
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
  const finishedCover = (resource: 'productions' | 'episodes') => ({
    parameters: [idParameter],
    get: {
      ...operation(
        resource === 'productions' ? 'downloadProductionCover' : 'downloadEpisodeCover',
        'Download a 1600x1600 PNG with the selected theme, saved title, category and episode number. Reads trusted local/CDN originals only; no upload, publication or source mutation. Source limit: 4 MiB and 4,000,000 pixels. Concurrent composition in the same isolate returns 503 with Retry-After: 1.',
        {},
        [resource === 'productions' ? 'productions:read' : 'episodes:read'],
      ),
      parameters: [
        { name: 'theme', in: 'query', required: true, schema: schema(themeIdSchema) },
        { ...versionQuery, required: false },
      ],
      responses: {
        ...errors,
        503: {
          ...errors['503'],
          headers: {
            'Retry-After': {
              description: 'Seconds before retrying when this isolate is already composing a cover.',
              schema: { type: 'integer', minimum: 1 },
            },
          },
        },
        200: {
          description:
            'Composited PNG attachment. Private, no-store; never upload this derivative as source artwork.',
          headers: {
            'X-Cover-Theme': { schema: schema(themeIdSchema) },
            'X-Resource-Version': { schema: { type: 'integer' } },
          },
          content: { 'image/png': { schema: { type: 'string', format: 'binary' } } },
        },
      },
    },
  });
  const categoryProjection = categorySchema.extend({ prompt: z.string() }).partial({ prompt: true });
  const { prompt: _legacyPrompt, ...categoryMetadataFields } = categoryMutationSchema.shape;
  const categoryMetadataMutation = z
    .strictObject(categoryMetadataFields)
    .refine((value) => Object.keys(value).length > 1);
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
  const slotMutation = schema(
    z.union([promptSlotTableSchema, z.strictObject({ version: z.number().int().positive() })]),
  );
  const slotCollection = (level: string) => ({
    get: {
      description: promptSlotContractSummary,
      ...operation(
        `read${level}PromptSlots`,
        'Read the private local slot table. Optional slot=editor,collector returns enabled merged slots plus Markdown body and channel/category versions; both levels must be initialized. Category enabled append adds after channel; override replaces the same ID. Disabled category slots do not mask channel. Order is ascending order then ID. Priority remains channel, category, intent, sources.',
        schema(
          z.union([
            promptSlotTableSchema,
            promptSlotTableSchema.extend({
              slots: z.array(promptSlotProjectionSchema),
              body: z.string(),
              versions: z.object({ channel: z.number(), category: z.number().optional() }),
            }),
          ]),
        ),
        ['prompts:read'],
      ),
      parameters: [
        {
          name: 'slot',
          in: 'query',
          schema: { type: 'string' },
          description:
            'Comma-separated stable IDs; unknown IDs are omitted. Channel route reads channel only; category route merges channel and selected category.',
        },
      ],
    },
    put: {
      ...operation(
        `replace${level}PromptSlots`,
        'Atomically replace/reorder the entire table using its collection version. Apply migration explicitly first. Slot versions/audit fields are server-owned. Without prompts:read returns only version.',
        slotMutation,
        ['prompts:write'],
      ),
      requestBody: body(promptSlotReplaceSchema),
    },
    post: {
      ...operation(
        `add${level}PromptSlot`,
        'Add a unique stable slot ID using collection version. skills body accepts one skill name per line, not instructions. Initial IDs are freely removable and new IDs are allowed.',
        slotMutation,
        ['prompts:write'],
        201,
      ),
      requestBody: body(promptSlotCreateSchema),
    },
  });
  const slotItem = (level: string) => ({
    parameters: [{ name: 'slotId', in: 'path', required: true, schema: { type: 'string' } }],
    patch: {
      ...operation(
        `edit${level}PromptSlot`,
        'Edit body/title/order/enabled/mode with collection version, never the individual slot version.',
        slotMutation,
        ['prompts:write'],
      ),
      requestBody: body(promptSlotPatchSchema),
    },
    delete: {
      ...operation(
        `delete${level}PromptSlot`,
        'Remove a slot using the collection version; channel/category scopes remain independent of metadata permissions.',
        slotMutation,
        ['prompts:write'],
      ),
      parameters: [versionQuery],
    },
  });
  const slotDryRun = (level: string) => ({
    get: operation(
      `preview${level}PromptSlotMigration`,
      'Read-only DRY-RUN from live stored Markdown: proposed per-level slots, unmapped headings, current collection and legacy versions. Does not write, initialize or back up data. Unknown sections remain in positioning. Review before separate explicit apply.',
      schema(
        z.object({
          version: z.number().int().min(0),
          legacyVersion: z.number().int().min(0),
          initialized: z.boolean(),
          slots: z.array(promptSlotProjectionSchema),
          unmappedHeadings: z.array(z.string()),
        }),
      ),
      ['prompts:read'],
    ),
  });
  const slotApply = (level: string) => ({
    post: {
      ...operation(
        `apply${level}PromptSlotMigration`,
        'Explicitly apply after reviewing dry-run; requires collection version and legacyVersion. Atomically backs up original text/versions/audit and initializes slots. Nothing auto-applies on deploy. Reapply to initialized level is a no-op, returning current state even after later edits. Write-only receives version only.',
        slotMutation,
        ['prompts:write'],
      ),
      requestBody: body(promptSlotApplySchema),
    },
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
          'Deprecated read-only whole prompts. Until explicit slot migration applies, returns stored legacy content and prompts.*. Afterwards content and every old prompts.* field synthesize enabled channel slots in order as Markdown. Use /channel/prompt-slots for all writes and new clients; removal requires a separately announced consumer cutover. Keep internal principles out of public content.',
          {
            type: 'object',
            required: ['channel', 'priority'],
            properties: { channel: ref('ChannelProfile'), priority: schema(prioritySchema) },
          },
          ['prompts:read'],
        ),
      },
      '/channel/prompt-slots': slotCollection('Channel'),
      '/channel/prompt-slots/{slotId}': slotItem('Channel'),
      '/channel/prompt-slots/migration/dry-run': slotDryRun('Channel'),
      '/channel/prompt-slots/migration/apply': slotApply('Channel'),
      '/categories/{id}/prompt-slots': { parameters: [idParameter], ...slotCollection('Category') },
      '/categories/{id}/prompt-slots/{slotId}': {
        ...slotItem('Category'),
        parameters: [idParameter, ...slotItem('Category').parameters],
      },
      '/categories/{id}/prompt-slots/migration/dry-run': {
        parameters: [idParameter],
        ...slotDryRun('Category'),
      },
      '/categories/{id}/prompt-slots/migration/apply': {
        parameters: [idParameter],
        ...slotApply('Category'),
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
          requestBody: body(briefCreateSchema),
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
            'Create category metadata; legacy prompt input is rejected. Manage guidance separately via prompt-slots with prompts:write; returned deprecated whole prompt needs prompts:read.',
            schema(z.object({ category: categoryProjection })),
            ['categories:write'],
            201,
          ),
          requestBody: body(categoryInputSchema.omit({ prompt: true })),
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
            'Update category metadata by version; optional nextId renames the ID and preserves slots while updating episode/production references atomically. Legacy prompt input is rejected; returned prompt needs prompts:read and synthesizes enabled local slots after explicit migration.',
            schema(z.object({ category: categoryProjection })),
            ['categories:write'],
          ),
          requestBody: body(categoryMetadataMutation),
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
            'Upload a clean unframed raster original, at most 8 MiB; immutable key and approved-script asset rules apply. Use 1400x1400 square originals (smaller accepted), without text, logos, borders or overlays. Keep the share subject near x=50%, y=40%; on square originals the crop spans y=13.75-66.25%. Upload pregenerates square podcast art and landscape share images as immutable generated R2 objects before publication, just like studio uploads; publication and republication warm linked episode artwork keys. Public published-only /episodes/{id}/art.jpg and /episodes/{id}/share.jpg resolve to art.jpg?v=<hash> (optionally with &size=N) and share.jpg?v=<hash>. Square art follows the website theme, defaults to 1400 square and accepts size=1400-3000; 1200x630 sharing is theme-independent. Cache generated outputs, never replace originals; storage cleanup protects current generated versions. Successful versioned artwork responses and 304s include x-hisfm-art: edge-hit | r2-hit | rendered. After successful cover upload/publication warming, the first default 1400-square art or share GET should report r2-hit (pregenerated), not rendered (lazy fallback); an already warm edge may report edge-hit. Repeat GETs to the same full versioned URL at the same edge should become edge-hit after asynchronous cache fill, not globally guaranteed. Other sizes may render. HEAD reads cached GET metadata without a body and cannot warm the edge; cold HEAD/304 may use only R2 metadata without populating it. Conditional 304s honor the same ETag and Last-Modified validators.',
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
            'Attach mono 24 kHz PCM16 WAV or MP3 (audio/mpeg) after script approval, at most 3600 seconds. WAV up to 172865536 bytes; MP3 up to 144065536 bytes (320 kbps cap). Content-Length is required; duration is derived from validated bytes. Final-approved assets require productions:reopen.',
            wrappedProduction,
            ['productions:write', 'storage:write'],
          ),
          requestBody: binaryBody(['audio/wav', 'audio/mpeg']),
        },
        delete: operation(
          'detachProductionAudio',
          'Detach current audio by expected version, preserving immutable media and published snapshots. Final-approved assets require productions:reopen.',
          wrappedProduction,
          ['productions:write', 'storage:write'],
        ),
      },
      '/productions/{id}/assets/audio/bind': {
        parameters: [idParameter],
        post: {
          ...operation(
            'bindProductionAudio',
            'Attach a validated WAV or MP3 already stored in the his-fm R2 bucket. Requires current script approval, at most 3600 seconds with the same byte caps as PUT; reviewed assets require productions:reopen. Upload out-of-band only with separate infrastructure authorization, then bind by key. Staging sources are retained. Keys must be uploads/<uuid>.{wav|mp3} or productions/{id}/audio-<scriptVersion>-<uuid>.{wav|mp3} for this production.',
            wrappedProduction,
            ['productions:write', 'storage:write'],
          ),
          requestBody: body(productionAudioBindSchema),
        },
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
            schema: { type: 'string', enum: publicationPlatforms },
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
          requestBody: body(episodeCreateSchema),
        },
      },
      '/productions/{id}/cover.png': finishedCover('productions'),
      '/episodes/{id}/cover.png': finishedCover('episodes'),
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
      '/seo': {
        get: operation(
          'getSiteSeo',
          'Read site-wide SEO defaults, podcast feed metadata and optimistic version',
          schema(
            z.object({
              seo: siteSeoSchema.extend({
                version: z.number().int().positive(),
                updatedAt: stamp,
                updatedBy: z.string(),
              }),
            }),
          ),
          ['prompts:read'],
        ),
        put: {
          ...operation(
            'updateSiteSeo',
            'Update site-wide SEO and RSS defaults by version',
            schema(
              z.object({
                seo: siteSeoSchema.extend({
                  version: z.number().int().positive(),
                  updatedAt: stamp,
                  updatedBy: z.string(),
                }),
              }),
            ),
            ['prompts:write'],
          ),
          requestBody: body(siteSeoUpdateSchema),
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
            'Upload validated raster, mono 24 kHz PCM16 WAV or MP3, at most 25 MiB. By default the server generates a new immutable uploads/<uuid> key. Optional query key=reference/voices/<name>.mp3 writes or replaces a voice-preview reference MP3 (audio/mpeg only); no traversal, no other query parameters with key.',
            schema(z.object({ object: storageObject, url: z.string() })),
            ['storage:write'],
            201,
          ),
          parameters: [
            {
              name: 'key',
              in: 'query',
              required: false,
              schema: {
                type: 'string',
                minLength: 24,
                maxLength: 1024,
                pattern: '^reference/voices/[A-Za-z0-9][A-Za-z0-9._-]*\\.mp3$',
              },
            },
          ],
          requestBody: binaryBody(['image/png', 'image/jpeg', 'image/webp', 'audio/wav', 'audio/mpeg']),
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
            'Deprecated read-only projection. Legacy stored fields until explicit migration; then each whole-prompt field concatenates enabled channel slots in order. New reads/writes use prompt-slots. No fixed removal date: separately announce verified consumer cutover. Prompt edits do not grant permissions or rewrite productions.',
        },
        ServiceManifest: schema(serviceManifestSchema),
        CreateProduction: schema(briefCreateSchema, 'input'),
        UpdateProduction: schema(productionPatchSchema, 'input'),
        AgentAction: schema(agentActionSchema, 'input'),
        ProductionAction: schema(productionActionSchema, 'input'),
        BindProductionAudio: schema(productionAudioBindSchema, 'input'),
        Production: schema(productionResponseSchema),
        Publication: schema(productionResponseSchema.shape.publications.element),
        ProductionCapabilities: schema(productionCapabilitiesSchema),
        ServiceCapabilities: schema(serviceCapabilitiesSchema),
        Prompts: schema(
          z.object({ brief: z.string(), script: z.string(), cover: z.string(), description: z.string() }),
        ),
        Error: schema(z.object({ error: z.string(), code: z.string(), documentation: z.string() })),
        SeoOverride: schema(seoOverrideSchema),
        SiteSeo: schema(siteSeoSchema),
      },
    },
  };
}
