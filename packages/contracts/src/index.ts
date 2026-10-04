import { z } from 'zod';
import { runtimeRequestSchema } from './speech.ts';

export * from './speech.ts';

export const protocolVersion = 1;
export const maxFrameBytes = 256 * 1024;
const id = z.string().min(1).max(160);
const text = z.string().max(80000);
export const fieldRefSchema = z.strictObject({
  productionId: id,
  field: z.enum([
    'title',
    'intent',
    'transcript',
    'summary',
    'description',
    'source.title',
    'source.content',
  ]),
  sourceId: id.optional(),
});
export type FieldRef = z.infer<typeof fieldRefSchema>;
export const pageContextSchema = z.strictObject({
  tabId: id,
  pageEpoch: z.number().int().nonnegative(),
  seq: z.number().int().nonnegative(),
  route: z.string().max(500),
  productionId: id.nullable(),
  step: z.enum(['brief', 'script', 'assets', 'review', 'publish']).nullable(),
  sourceId: id.nullable(),
  version: z.number().int().positive().nullable(),
  field: fieldRefSchema.nullable(),
  draft: z
    .strictObject({ revision: z.number().int().nonnegative(), value: text, baseValue: text })
    .nullable(),
  selection: z
    .strictObject({ from: z.number().int().nonnegative(), to: z.number().int().nonnegative(), text })
    .nullable(),
  activity: z.enum(['viewing', 'editing', 'saving', 'conflict']),
});
export type PageContext = z.infer<typeof pageContextSchema>;
export const commandSchema = z.strictObject({
  id,
  text: z.string().trim().min(1).max(12000),
  context: pageContextSchema.nullable(),
  createdAt: z.string(),
});
export type AgentCommand = z.infer<typeof commandSchema>;
export const agentMessageSchema = z.strictObject({
  id,
  role: z.enum(['user', 'assistant']),
  text: z.string().max(80000),
  commandId: id.nullable(),
  createdAt: z.string(),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;
export const conversationSchema = z.strictObject({
  id,
  role: z.string().max(100),
  lifetime: z.enum(['coordinator', 'resident', 'task']),
  status: z.enum(['idle', 'working', 'waiting', 'failed', 'retired']),
  task: z.string().max(300),
  model: z.string().max(120),
  thinkingLevel: z.string().max(20),
});
export type ConversationStatus = z.infer<typeof conversationSchema>;
export const proposalSchema = z.strictObject({
  id,
  commandId: id,
  context: pageContextSchema,
  target: fieldRefSchema,
  value: text,
  summary: z.string().max(1000),
});
export type DraftProposal = z.infer<typeof proposalSchema>;
export const operationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id,
    commandId: id,
    kind: z.literal('production.patch'),
    productionId: id,
    version: z.number().int().positive(),
    changes: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    id,
    commandId: id,
    kind: z.literal('production.create'),
    brief: z.record(z.string(), z.unknown()),
  }),
  z.strictObject({
    id,
    commandId: id,
    kind: z.literal('production.action'),
    productionId: id,
    version: z.number().int().positive(),
    action: z.enum(['submit_brief', 'submit_script', 'submit_final']),
  }),
  z.strictObject({
    id,
    commandId: id,
    kind: z.literal('audio.request'),
    productionId: id,
    version: z.number().int().positive(),
    options: z.record(z.string(), z.unknown()),
  }),
]);
export type AgentOperation = z.infer<typeof operationSchema>;
export const browserFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('delivery.ack'), deliveryId: z.number().int().positive() }),
  z.strictObject({ type: z.literal('ping') }),
  z.strictObject({ type: z.literal('context'), context: pageContextSchema }),
  z.strictObject({
    type: z.literal('command'),
    id,
    text: z.string().trim().min(1).max(12000),
    context: pageContextSchema.nullable(),
  }),
  z.strictObject({ type: z.literal('cancel'), commandId: id }),
  z.strictObject({ type: z.literal('proposal.ack'), id, status: z.enum(['applied', 'stale', 'rejected']) }),
]);
export const agentFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('runtime.response'), id, ok: z.boolean(), result: z.unknown() }),
  z.strictObject({ type: z.literal('ping') }),
  z.strictObject({ type: z.literal('accepted'), commandId: id }),
  z.strictObject({ type: z.literal('message'), message: agentMessageSchema }),
  z.strictObject({ type: z.literal('status'), id, conversations: z.array(conversationSchema).max(24) }),
  z.strictObject({
    type: z.literal('command.state'),
    id,
    commandId: id,
    status: z.enum(['working', 'complete', 'failed', 'cancelled', 'waiting']),
    detail: z.string().max(1000),
  }),
  z.strictObject({ type: z.literal('proposal'), proposal: proposalSchema }),
  z.strictObject({ type: z.literal('operation'), operation: operationSchema }),
]);
export const commandStateSchema = z.strictObject({
  id,
  status: z.string().max(30),
  detail: z.string().max(1000),
});
export const serverFrameSchema = z.discriminatedUnion('type', [
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('runtime.request'),
    id,
    request: runtimeRequestSchema,
  }),
  z.strictObject({ deliveryId: z.number().int().positive().optional(), type: z.literal('pong') }),
  z.strictObject({ deliveryId: z.number().int().positive().optional(), type: z.literal('event.ack'), id }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('welcome'),
    protocolVersion: z.literal(1),
    connectionId: id,
  }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('snapshot'),
    messages: z.array(agentMessageSchema).max(200),
    conversations: z.array(conversationSchema).max(24),
    commands: z.array(commandStateSchema).max(100),
    proposals: z.array(proposalSchema).max(50),
    online: z.boolean(),
  }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('presence'),
    online: z.boolean(),
  }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('context'),
    context: pageContextSchema,
  }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('context.ack'),
    seq: z.number().int().nonnegative(),
    tabId: id,
  }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('command'),
    command: commandSchema,
  }),
  z.strictObject({ deliveryId: z.number().int().positive().optional(), type: z.literal('command.ack'), id }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('cancel'),
    commandId: id,
  }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('message'),
    message: agentMessageSchema,
  }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('status'),
    id,
    conversations: z.array(conversationSchema).max(24),
  }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('command.state'),
    id,
    commandId: id,
    status: z.string().max(30),
    detail: z.string().max(1000),
  }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('proposal'),
    proposal: proposalSchema,
  }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('proposal.ack'),
    id,
    status: z.enum(['applied', 'stale', 'rejected']),
  }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('operation.result'),
    id,
    ok: z.boolean(),
    status: z.number().int(),
    result: z.unknown(),
  }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('production.changed'),
    productionId: id,
    version: z.number().int().positive(),
  }),
  z.strictObject({
    deliveryId: z.number().int().positive().optional(),
    type: z.literal('error'),
    code: z.string().max(80),
    message: z.string().max(500),
  }),
]);
export type BrowserFrame = z.infer<typeof browserFrameSchema>;
export type AgentFrame = z.infer<typeof agentFrameSchema>;
export type ServerFrame = z.infer<typeof serverFrameSchema>;

export * from './wav.ts';
