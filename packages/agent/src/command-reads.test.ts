import assert from 'node:assert/strict';
import { join } from 'node:path';
import { assistantMessage, testHost } from '@frogie/core/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { openRuntime } from './runtime.ts';
import { fixture, testCommand, testContext } from './testing/fixtures.ts';

const { summaries } = vi.hoisted(() => ({ summaries: [] as (() => Promise<string>)[] }));
vi.mock('@frogie/core/host', async (original) => {
  const actual = await original<typeof import('@frogie/core/host')>();
  return {
    ...actual,
    openAgentHost: (options: Parameters<typeof actual.openAgentHost>[0]) => {
      if (options.summaryPrompt) summaries.push(options.summaryPrompt);
      return actual.openAgentHost(options);
    },
  };
});
afterEach(() => vi.restoreAllMocks());

const commandHeaders = (test: Awaited<ReturnType<typeof fixture>>) =>
  test.request.mock.calls.map(([, init]) => new Headers(init?.headers).get('X-Hisfm-Command'));

it.each(['missing', 'restricted', 'anonymous-agent'] as const)(
  'rejects a wire command with %s origin authority before reading shared history or the website',
  async (authority) => {
    const test = await fixture([assistantMessage('Must not execute')]);
    try {
      await testHost(test.runtime.host).appendHistory(test.runtime.rootId, [
        { role: 'user', content: 'Private owner material', timestamp: 1 },
      ]);
      const command = testCommand('untrusted');
      if (authority === 'missing') delete command.principal;
      else
        command.principal = {
          kind: 'agent',
          name: 'limited',
          ...(authority === 'restricted' ? { tokenId: 'limited-token' } : {}),
          scopes: authority === 'restricted' ? ['tasks:submit', 'prompts:read'] : ['tasks:manage'],
        };
      test.start();
      test.send(command);
      await expect.poll(() => test.store.command(command.id)?.status).toBe('failed');
      expect(test.fake.state.callCount).toBe(0);
      expect(test.request).not.toHaveBeenCalled();
      expect(test.logs.join()).not.toContain('Private owner material');
    } finally {
      await test.close();
    }
  },
);

it('accepts an agent explicitly authorized for shared task history while retaining command attenuation', async () => {
  const test = await fixture([assistantMessage('Accepted trusted task')]);
  try {
    const command = testCommand('trusted-agent');
    command.principal = {
      kind: 'agent',
      name: 'trusted',
      tokenId: 'trusted-token',
      scopes: ['tasks:submit', 'tasks:manage', 'prompts:read'],
    };
    test.start();
    test.send(command);
    await expect.poll(() => test.store.command(command.id)?.status).toBe('complete');
    expect(commandHeaders(test)).toEqual(['trusted-agent']);
    expect(test.fake.state.callCount).toBe(1);
  } finally {
    await test.close();
  }
});

it('binds preparation, tool reads, write checks and delegate snapshots to their originating command', async () => {
  let release = () => {};
  const blocked = new Promise<ReturnType<typeof assistantMessage>>((resolve) => {
    release = () => resolve(assistantMessage('Waiting'));
  });
  const test = await fixture([() => blocked]);
  try {
    test.start();
    test.send(testCommand('origin', 'Read current work', testContext));
    await expect.poll(() => test.fake.state.callCount).toBe(1);
    const tool = (name: string, args: unknown, taskId: number) =>
      testHost(test.runtime.host).tool(name, args, { taskId, conversationId: test.runtime.rootId });
    await tool('read_latest', { productionId: 'p' }, 9101);
    await tool('list_productions', {}, 9102);
    await expect(
      tool('patch_production', { productionId: 'p', version: 99, profileVersion: 1, changes: '{}' }, 9103),
    ).rejects.toThrow('节目版本');
    test.fake.setResponses([() => blocked]);
    await tool('delegate', { role: 'writer', instructions: 'Inspect work', revision: 1 }, 9104);
    await expect.poll(() => test.fake.state.callCount).toBe(2);
    expect(test.request.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(
      expect.arrayContaining(['/api/agent/channel', '/api/agent/productions/p', '/api/agent/productions']),
    );
    expect(commandHeaders(test).length).toBeGreaterThanOrEqual(10);
    expect(new Set(commandHeaders(test))).toEqual(new Set(['origin']));
  } finally {
    release();
    await test.close();
  }
});

it('authorizes every concurrent command before sharing a compaction prompt and fails closed on denial or version races', async () => {
  let releaseRoot = () => {};
  let releaseWorker = () => {};
  const rootBlock = new Promise<ReturnType<typeof assistantMessage>>((resolve) => {
    releaseRoot = () => resolve(assistantMessage('Waiting for work'));
  });
  const workerBlock = new Promise<ReturnType<typeof assistantMessage>>((resolve) => {
    releaseWorker = () => resolve(assistantMessage('Worker stopped'));
  });
  const test = await fixture([() => rootBlock]);
  const summarize = summaries.at(-1);
  assert(summarize);
  try {
    await expect(summarize()).rejects.toThrow('原始指令');
    expect(test.request).not.toHaveBeenCalled();
    test.start();
    test.send(testCommand('first'));
    await expect.poll(() => test.fake.state.callCount).toBe(1);
    test.fake.setResponses([() => workerBlock]);
    await testHost(test.runtime.host).tool(
      'delegate',
      { role: 'writer', instructions: 'Inspect work', revision: 1 },
      { taskId: 9201, conversationId: test.runtime.rootId },
    );
    await expect.poll(() => test.fake.state.callCount).toBe(2);
    releaseRoot();
    await expect.poll(() => test.store.command('first')?.status).toBe('waiting');
    test.fake.setResponses([() => workerBlock]);
    test.send(testCommand('second'));
    await expect.poll(() => test.fake.state.callCount).toBe(3);
    test.request.mockClear();
    await expect(summarize()).resolves.toBe(test.channel.prompts.compaction);
    expect(new Set(commandHeaders(test))).toEqual(new Set(['first', 'second']));
    expect(test.request).toHaveBeenCalledTimes(2);
    const authorized = test.request.getMockImplementation();
    assert(authorized);
    test.request.mockImplementation(async (input, init) =>
      new Headers(init?.headers).get('X-Hisfm-Command') === 'first'
        ? new Response(null, { status: 403 })
        : authorized(input, init),
    );
    test.request.mockClear();
    await expect(summarize()).rejects.toThrow('403');
    expect(new Set(commandHeaders(test))).toEqual(new Set(['first', 'second']));
    expect(test.request).toHaveBeenCalledTimes(2);
    test.request.mockImplementation(async (_input, init) =>
      Response.json({
        channel: {
          ...test.channel,
          version: new Headers(init?.headers).get('X-Hisfm-Command') === 'first' ? 1 : 2,
        },
      }),
    );
    await expect(summarize()).rejects.toThrow('版本');
  } finally {
    releaseRoot();
    releaseWorker();
    await test.close();
  }
});

it('revalidates cached preparation and restored submissions without falling back to the runtime token', async () => {
  let release = () => {};
  const blocked = new Promise<ReturnType<typeof assistantMessage>>((resolve) => {
    release = () => resolve(assistantMessage('Interrupted'));
  });
  const test = await fixture([() => blocked], { persistent: true });
  let runtime = test.runtime;
  try {
    test.start();
    test.send(testCommand('restored', 'Inspect current work', testContext));
    await expect.poll(() => test.fake.state.callCount).toBe(1);
    const closing = runtime.close();
    release();
    await closing;
    expect(test.store.get('prepared:command:restored')).toBeDefined();
    runtime = await openRuntime({
      databasePath: join(test.directory, 'frogie.sqlite'),
      models: test.models,
      config: test.config,
      store: test.store,
      transport: test.transport,
      client: test.client,
      decide: test.decide,
      log: (message) => test.logs.push(message),
    });
    const summarize = summaries.at(-1);
    assert(summarize);
    test.request.mockClear();
    test.request.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(summarize()).rejects.toThrow('403');
    expect(commandHeaders(test)).toEqual(['restored']);
    await runtime.pump();
    expect(test.store.command('restored')?.status).toBe('failed');
    expect(test.fake.state.callCount).toBe(1);
    expect(commandHeaders(test).every((id) => id === 'restored')).toBe(true);
  } finally {
    release();
    await runtime.close();
    await test.close();
  }
});

it.each(['missing', 'restricted'] as const)(
  'stops restored root and resident work with %s origin authority',
  async (authority) => {
    let releaseRoot = () => {};
    let releaseWorker = () => {};
    const rootBlock = new Promise<ReturnType<typeof assistantMessage>>((resolve) => {
      releaseRoot = () => resolve(assistantMessage('Interrupted root'));
    });
    const workerBlock = new Promise<ReturnType<typeof assistantMessage>>((resolve) => {
      releaseWorker = () => resolve(assistantMessage('Interrupted worker'));
    });
    const test = await fixture([() => rootBlock], { persistent: true });
    let runtime = test.runtime;
    try {
      test.start();
      test.send(testCommand('old-agent'));
      await expect.poll(() => test.fake.state.callCount).toBe(1);
      test.fake.setResponses([() => workerBlock]);
      test.decide.mockResolvedValue({ reuse: false, lifetime: 'resident', thinkingLevel: 'high' });
      await testHost(runtime.host).tool(
        'delegate',
        { role: 'reviewer', instructions: 'Review facts', revision: 1 },
        { taskId: 9301, conversationId: runtime.rootId },
      );
      await expect.poll(() => test.fake.state.callCount).toBe(2);
      const closing = runtime.close();
      releaseRoot();
      releaseWorker();
      await closing;
      const command = testCommand('old-agent');
      if (authority === 'missing') delete command.principal;
      else
        command.principal = {
          kind: 'agent',
          name: 'limited',
          tokenId: 'limited-token',
          scopes: ['tasks:submit'],
        };
      test.store.database
        .prepare('UPDATE commands SET payload=? WHERE id=?')
        .run(JSON.stringify(command), command.id);
      test.request.mockClear();
      runtime = await openRuntime({
        databasePath: join(test.directory, 'frogie.sqlite'),
        models: test.models,
        config: test.config,
        store: test.store,
        transport: test.transport,
        client: test.client,
        decide: test.decide,
        log: (message) => test.logs.push(message),
      });
      await runtime.pump();
      expect(
        Object.values((await runtime.work()).assignments).every(
          (assignment) => assignment.status === 'failed',
        ),
      ).toBe(true);
      expect(test.store.command(command.id)?.status).toBe('failed');
      expect(test.fake.state.callCount).toBe(2);
      expect(test.request).not.toHaveBeenCalled();
    } finally {
      releaseRoot();
      releaseWorker();
      await runtime.close();
      await test.close();
    }
  },
);
