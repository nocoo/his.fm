import { describe, expect, it } from 'vitest';
import {
  agentFrameSchema,
  browserFrameSchema,
  commandSchema,
  fieldRefSchema,
  maxFrameBytes,
  operationSchema,
  pageContextSchema,
  protocolVersion,
  serverFrameSchema,
} from './index';

const context = {
  tabId: 'tab',
  pageEpoch: 1,
  seq: 1,
  route: '/admin',
  productionId: null,
  step: null,
  sourceId: null,
  version: null,
  field: null,
  draft: null,
  selection: null,
  activity: 'viewing',
};
describe('native agent protocol', () => {
  it('validates bounded page context without collecting arbitrary UI data', () => {
    expect(protocolVersion).toBe(1);
    expect(maxFrameBytes).toBe(262144);
    expect(pageContextSchema.parse(context)).toEqual(context);
    expect(pageContextSchema.safeParse({ ...context, screenshot: 'data:image/png' }).success).toBe(false);
    expect(fieldRefSchema.safeParse({ productionId: 'p', field: 'token' }).success).toBe(false);
    expect(
      browserFrameSchema.safeParse({
        type: 'context',
        context: { ...context, draft: { revision: 1, value: 'a'.repeat(80001), baseValue: '' } },
      }).success,
    ).toBe(false);
  });
  it('separates browser authority, agent effects and acknowledgements', () => {
    expect(browserFrameSchema.parse({ type: 'command', id: 'c', text: '写稿', context })).toMatchObject({
      id: 'c',
    });
    expect(commandSchema.parse({ id: 'c', text: '写稿', context, createdAt: 'now' }).context).toEqual(
      context,
    );
    expect(
      operationSchema.safeParse({
        id: 'o',
        commandId: 'c',
        kind: 'production.action',
        productionId: 'p',
        version: 1,
        action: 'approve_script',
      }).success,
    ).toBe(false);
    expect(agentFrameSchema.safeParse({ type: 'context', context }).success).toBe(false);
    expect(serverFrameSchema.parse({ type: 'event.ack', id: 'event' })).toEqual({
      type: 'event.ack',
      id: 'event',
    });
    expect(
      serverFrameSchema.parse({
        type: 'snapshot',
        messages: [],
        conversations: [],
        commands: [],
        proposals: [],
        online: false,
      }).type,
    ).toBe('snapshot');
  });
});
