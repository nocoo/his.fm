import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultPrompts } from '@frogie/core/hisfm/prompts';
import { createModelFixture, type ModelResponse } from '@frogie/core/testing';
import { type AgentCommand, defaultSpeechSettings, type PageContext } from '@his-fm/contracts';
import { vi } from 'vitest';
import type WebSocket from 'ws';
import { WebsiteClient } from '../client.ts';
import { type Config, configSchema } from '../config.ts';
import type { AssignmentPlan, DecisionInput } from '../decision.ts';
import { openRuntime } from '../runtime.ts';
import { RuntimeStore } from '../store.ts';
import { RuntimeTransport } from '../transport.ts';

export function testConfig(directory = '/tmp/hisfm-test'): Config {
  return configSchema.parse({
    schemaVersion: 1,
    configRevision: '0'.repeat(64),
    speech: defaultSpeechSettings,
    speechKeys: { gemini: '', elevenlabs: '' },
    providers: {
      raven: { api: 'openai-completions', baseUrl: 'http://127.0.0.1:1', apiKey: 'fake-model-key' },
    },
    coordinator: {
      provider: 'raven',
      model: 'gpt-6-astra',
      thinkingLevel: 'high',
      contextWindow: 128000,
      maxTokens: 8192,
    },
    executor: {
      provider: 'raven',
      model: 'gpt-6.1-sol',
      thinkingLevels: ['low', 'medium', 'high'],
      contextWindow: 128000,
      maxTokens: 8192,
    },
    decision: {
      baseUrl: 'http://127.0.0.1:2',
      apiKey: 'fake-decision-key',
      model: 'jev-latest',
      maxInputBytes: 16384,
      maxBatchQuestions: 12,
      timeoutMs: 35000,
    },
    websites: {
      local: { baseUrl: 'http://127.0.0.1:3', token: 'fake-site-key', stationId: 'hisfm-test' },
      production: { baseUrl: 'https://his.fm', token: '', stationId: 'hisfm-production' },
    },
    runtime: {
      maxConcurrentAssignments: 3,
      maxRevisionRounds: 5,
      maxTaskMinutes: 30,
      workspaceRoot: directory,
    },
  });
}
export const testContext: PageContext = {
  tabId: 'tab',
  pageEpoch: 1,
  seq: 1,
  route: '/admin/productions/p',
  productionId: 'p',
  step: 'script',
  sourceId: null,
  version: 1,
  field: { productionId: 'p', field: 'transcript' },
  draft: { revision: 2, value: 'draft', baseValue: 'old' },
  selection: null,
  activity: 'editing',
};
export const testCommand = (
  id = 'command-1',
  text = '请帮我写稿',
  page: PageContext | null = null,
): AgentCommand => ({
  id,
  text,
  context: page,
  createdAt: '2026-10-03T00:00:00Z',
  principal: { kind: 'human', name: 'owner' },
});
export class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  frames: unknown[] = [];
  send(value: string) {
    this.frames.push(JSON.parse(value));
  }
  terminate() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', 1006);
  }
  close(code: number) {
    this.readyState = 3;
    this.emit('close', code);
  }
  receive(value: unknown, binary = false) {
    this.emit('message', Buffer.from(JSON.stringify(value)), binary);
  }
}
export const snapshot = {
  type: 'snapshot' as const,
  messages: [],
  commands: [],
  conversations: [],
  proposals: [],
  online: true,
};
export async function fixture(responses: ModelResponse[] = [], options: { persistent?: boolean } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'hisfm-runtime-'));
  const config = testConfig(directory);
  const { fake, models } = createModelFixture({
    provider: 'raven',
    models: [
      { id: 'gpt-6-astra', reasoning: true },
      { id: 'gpt-6.1-sol', reasoning: true },
    ],
    tokensPerSecond: 100000,
  });
  fake.setResponses(responses);
  const store = new RuntimeStore(join(directory, 'transport.sqlite'), 'test');
  const socket = new FakeSocket();
  const logs: string[] = [];
  const transport = new RuntimeTransport(
    store,
    config.websites.local,
    () => socket as unknown as WebSocket,
    (text) => logs.push(text),
  );
  const channel = { version: 1, content: 'Test editorial policy.', prompts: { ...defaultPrompts } };
  const production = {
    id: 'p',
    version: 1,
    stage: 'production',
    scriptVersion: 2,
    category: 'work',
    categoryProfile: { id: 'work', name: '工作之间', version: 1, prompt: 'Test category style.' },
    approvals: { script: { at: 'now', by: 'owner' }, brief: { at: 'now', by: 'owner' } },
  };
  const request = vi.fn<typeof fetch>(async (input, init) => {
    if (!new Headers(init?.headers).get('X-Hisfm-Command')) return new Response(null, { status: 403 });
    return Response.json(
      String(input).endsWith('/channel')
        ? { channel }
        : String(input).endsWith('/productions')
          ? { productions: [production] }
          : { production, categoryProfile: production.categoryProfile },
    );
  });
  const client = new WebsiteClient(config.websites.local, request);
  const decide = vi.fn<(input: DecisionInput) => Promise<AssignmentPlan>>(async () => ({
    reuse: false,
    lifetime: 'task',
    thinkingLevel: 'high',
  }));
  const runtime = await openRuntime({
    ...(options.persistent ? { databasePath: join(directory, 'frogie.sqlite') } : {}),
    models,
    config,
    store,
    transport,
    client,
    decide,
    log: (text) => logs.push(text),
  });
  const start = () => {
    transport.start();
    socket.emit('open');
    socket.receive({ type: 'welcome', protocolVersion: 1, connectionId: 'connection' });
    socket.receive(snapshot);
  };
  const send = (command = testCommand()) => socket.receive({ type: 'command', command });
  return {
    directory,
    config,
    fake,
    models,
    store,
    transport,
    socket,
    client,
    request,
    channel,
    production,
    decide,
    runtime,
    logs,
    start,
    send,
    close: async () => {
      transport.stop();
      await runtime.close();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
