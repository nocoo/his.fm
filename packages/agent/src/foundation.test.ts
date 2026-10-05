import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { WebsiteClient } from './client.ts';
import { configSchema, configuredModels, loadConfig, website } from './config.ts';
import { assertDecisionBudget, type DecisionRequest, decisions, requestBytes } from './decision.ts';
import { acquireInstance, frameId, RuntimeStore } from './store.ts';
import { testCommand, testConfig, testContext } from './testing/fixtures.ts';

afterEach(() => vi.unstubAllGlobals());
const answer = (choice: string, keys: string[]) => ({
  type: 'choice',
  choice,
  confidence: 1,
  probabilities: Object.fromEntries(keys.map((key) => [key, key === choice ? 1 : 0])),
});

it('validates private configuration, exact models, supported high executor thinking and isolated sites', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hisfm-config-'));
  try {
    const path = join(directory, 'config.json');
    const config = testConfig(directory);
    await writeFile(path, JSON.stringify(config));
    expect(await loadConfig(path)).toEqual(config);
    await writeFile(path, '{"apiKey":"DO_NOT_LEAK"}');
    await expect(loadConfig(path)).rejects.toThrow('密钥未输出');
    await expect(loadConfig(join(directory, 'missing'))).rejects.not.toThrow('DO_NOT_LEAK');
    expect(website(config, 'local')).toEqual(config.websites.local);
    expect(() => website(config, 'production')).toThrow('令牌');
    config.websites.production.token = 'synthetic';
    expect(website(config, 'production').baseUrl).toBe('https://his.fm');
    config.websites.local.baseUrl = 'https://his.fm';
    expect(() => website(config, 'local')).toThrow('不匹配');
    config.websites.production.baseUrl = 'http://127.0.0.1';
    expect(() => website(config, 'production')).toThrow('不匹配');
    config.websites.production.baseUrl = 'http://example.test';
    expect(() => website(config, 'production')).toThrow('不匹配');
    for (const baseUrl of [
      'http://example.test',
      'https://user:pass@example.test',
      'https://example.test/?secret=yes',
      'https://example.test/#secret',
    ])
      expect(
        configSchema.safeParse({
          ...testConfig(),
          providers: { raven: { ...testConfig().providers.raven, baseUrl } },
        }).success,
      ).toBe(false);
    const models = configuredModels(testConfig());
    expect(models.getModels().map((model) => model.id)).toEqual(['gpt-6-astra', 'gpt-6.1-sol']);
    expect(await models.getAuth('raven')).toBeDefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('sends multiple bounded decision questions without raw transcripts or credentials', async () => {
  const config = testConfig();
  const request = vi.fn<DecisionRequest>(async () => ({
    answers: {
      plan: answer('reuse_resident', ['create_resident', 'create_task', 'reuse_resident']),
      thinking: answer('high', ['low', 'medium', 'high']),
    },
  }));
  expect(
    await decisions(
      config,
      request,
    )({ role: 'reviewer', revision: 2, inputBytes: 90000, availableResident: true }),
  ).toEqual({ reuse: true, lifetime: 'resident', thinkingLevel: 'high' });
  const payload = request.mock.calls[0]?.[0];
  expect(requestBytes(payload)).toBeLessThan(16384);
  expect(JSON.stringify(payload)).not.toContain('fake-');
  request.mockResolvedValue({
    answers: {
      plan: answer('create_task', ['create_task']),
      thinking: answer('low', ['low', 'medium', 'high']),
    },
  });
  expect(
    (
      await decisions(
        config,
        request,
      )({ role: 'writer', revision: 1, inputBytes: 10, availableResident: false })
    ).thinkingLevel,
  ).toBe('low');
  request.mockResolvedValue({
    answers: {
      plan: answer('create_resident', ['create_resident', 'create_task']),
      thinking: answer('medium', ['low', 'medium', 'high']),
    },
  });
  expect(
    (
      await decisions(
        config,
        request,
      )({ role: 'reviewer', revision: 1, inputBytes: 10, availableResident: false })
    ).lifetime,
  ).toBe('resident');
});

it('rejects malformed distributions and enforces entire encoded request and question ceilings', async () => {
  const config = testConfig();
  const input = { role: 'writer' as const, revision: 1, inputBytes: 10, availableResident: false };
  for (const malformed of [
    null,
    answer('invalid', ['create_task']),
    answer('create_task', ['extra']),
    { ...answer('create_task', ['create_task']), probabilities: { create_task: 0.2 } },
    { ...answer('create_task', ['create_task']), probabilities: { create_task: 1, extra: 0 } },
  ]) {
    await expect(decisions(config, async () => ({ answers: { plan: malformed } }))(input)).rejects.toThrow();
  }
  const questions = { first: { type: 'noul' as const }, second: { type: 'noul' as const } };
  assertDecisionBudget({ questions, state: 'x' }, config.decision);
  expect(() => assertDecisionBudget({ questions: {}, state: null }, config.decision)).toThrow('预算');
  expect(() =>
    assertDecisionBudget(
      {
        state: null,
        questions: Object.fromEntries(
          Array.from({ length: 13 }, (_, index) => [`q${index}`, { type: 'noul' as const }]),
        ),
      },
      config.decision,
    ),
  ).toThrow('预算');
  expect(() => assertDecisionBudget({ questions, state: '中'.repeat(6000) }, config.decision)).toThrow(
    '预算',
  );
  config.decision.maxInputBytes = 10;
  await expect(decisions(config, vi.fn())(input)).rejects.toThrow('预算');
});

it('uses the installed decision SDK and enforces the actual encoded HTTP body budget', async () => {
  const config = testConfig();
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      answers: {
        plan: answer('create_task', ['create_task']),
        thinking: answer('high', ['low', 'medium', 'high']),
      },
      model: 'jev-1.13.0',
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const choose = decisions(config);
  await choose({ role: 'writer', revision: 1, inputBytes: 10, availableResident: false });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(String(fetcher.mock.calls[0]?.[0])).toContain('/v1/systemone');
});

it('offers task reuse and sends bounded task type and complexity instead of raw task text', async () => {
  const request = vi.fn<DecisionRequest>(async () => ({
    answers: {
      plan: answer('reuse_task', ['create_task', 'reuse_task']),
      thinking: answer('medium', ['low', 'medium', 'high']),
    },
  }));
  expect(
    await decisions(
      testConfig(),
      request,
    )({
      role: 'writer',
      revision: 2,
      inputBytes: 40000,
      availableResident: false,
      availableTask: true,
      taskType: 'revision',
      complexity: 'complex',
      scope: 'production',
    }),
  ).toEqual({ reuse: true, lifetime: 'task', thinkingLevel: 'medium' });
  expect(request.mock.calls[0]?.[0].state).toMatchObject({
    taskType: 'revision',
    complexity: 'complex',
    scope: 'production',
  });
});

it('authenticates read-only website requests, blocks redirects and hides upstream failures', async () => {
  const site = testConfig().websites.local;
  const fetcher = vi.fn<typeof fetch>();
  const client = new WebsiteClient(site, fetcher);
  fetcher.mockResolvedValueOnce(Response.json({ channel: { version: 1, content: 'Private' } }));
  expect((await client.channel()).content).toBe('Private');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    redirect: 'error',
    headers: { Authorization: 'Bearer fake-site-key' },
  });
  fetcher.mockResolvedValueOnce(
    Response.json({
      categoryProfile: { id: 'work', name: 'Work', version: 1, prompt: 'Style' },
      production: {
        id: 'id/a',
        version: 2,
        scriptVersion: 1,
        stage: 'scripting',
        approvals: { script: null, brief: null },
        transcript: 'Markdown',
      },
    }),
  );
  expect((await client.production('id/a')).transcript).toBe('Markdown');
  expect(String(fetcher.mock.calls[1]?.[0])).toContain('id%2Fa');
  fetcher.mockResolvedValueOnce(Response.json({ productions: [] }));
  expect(await client.productions()).toEqual({ productions: [] });
  fetcher.mockResolvedValueOnce(new Response('private upstream text', { status: 401 }));
  await expect(client.channel()).rejects.toThrow('401');
  fetcher.mockRejectedValueOnce(new Error('secret key'));
  await expect(client.channel()).rejects.not.toThrow('secret key');
  fetcher.mockResolvedValueOnce(Response.json({ channel: null }));
  await expect(client.channel()).rejects.toThrow();
});

it('locks one instance, persists inbox/outbox/receipts and refuses identity or ID mutation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hisfm-store-'));
  const unlock = acquireInstance(directory);
  expect(() => acquireInstance(directory)).toThrow('已在运行');
  unlock();
  acquireInstance(directory)();
  const path = join(directory, 'store.sqlite');
  let store = new RuntimeStore(path, 'local');
  try {
    expect(store.command('none')).toBeNull();
    expect(store.result('none')).toBeNull();
    expect(store.next()).toBeNull();
    store.receive(testCommand());
    store.receive(testCommand());
    expect(store.next()?.id).toBe('command:command-1');
    expect(() => store.receive(testCommand('command-1', 'different'))).toThrow('内容');
    expect(store.command('command-1')?.command.text).toBe('请帮我写稿');
    expect(() => store.input('command:command-1', 'command-1', 'different')).toThrow('内容');
    expect(() =>
      store.atomic(() => {
        store.set('rolledback', true);
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(store.get('rolledback')).toBeNull();
    store.context(testContext);
    store.context({ ...testContext, seq: 0 });
    store.context({ ...testContext, pageEpoch: 0, seq: 20 });
    expect(store.get('latestContext')).toEqual(testContext);
    store.context({ ...testContext, pageEpoch: 2, seq: 0 });
    expect(store.get('latestContext')).toMatchObject({ pageEpoch: 2 });
    const message = {
      type: 'message' as const,
      message: {
        id: 'm',
        commandId: 'command-1',
        role: 'assistant' as const,
        text: 'hello',
        createdAt: 'now',
      },
    };
    store.enqueue(message);
    store.enqueue(message);
    expect(() =>
      store.enqueue({
        ...message,
        message: { ...message.message, id: 'too-big', text: '\u0000'.repeat(70000) },
      }),
    ).toThrow('帧预算');
    expect(() => store.enqueue({ ...message, message: { ...message.message, text: 'changed' } })).toThrow(
      '不得复用',
    );
    expect(frameId(message)).toBe('m');
    expect(
      frameId({
        type: 'operation',
        operation: { id: 'operation', commandId: 'command-1', kind: 'production.create', brief: {} },
      }),
    ).toBe('operation');
    expect(
      frameId({
        type: 'proposal',
        proposal: {
          id: 'proposal',
          commandId: 'command-1',
          context: testContext,
          target: { productionId: 'p', field: 'transcript' },
          value: 'text',
          summary: 'summary',
        },
      }),
    ).toBe('proposal');
    store.state('command-1', 'complete', 'done', 'event');
    expect(store.next()).toBeNull();
    store.finishInput('command:command-1');
    store.receipt({ type: 'operation.result', id: 'operation', ok: true, status: 200, result: {} });
    store.acknowledge('m');
    store.close();
    store = new RuntimeStore(path, 'local');
    expect(store.result('operation')).toMatchObject({ ok: true });
    expect(store.pending().map(frameId)).not.toContain('m');
    expect(store.command('command-1')?.status).toBe('complete');
    expect(() => new RuntimeStore(path, 'production')).toThrow('另一个网站');
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
