import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { afterEach, expect, it, vi } from 'vitest';
import { openRuntime } from './runtime.ts';
import { fixture, snapshot, testCommand, testContext } from './testing/fixtures.ts';

afterEach(() => vi.restoreAllMocks());

it('reuses production writers across commands but isolates other productions and retired identities', async () => {
  const tool = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
    fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' });
  const dispatch = () =>
    tool('delegate', { role: 'writer', instructions: 'Revise this script', revision: 1 });
  const result = (_context: unknown, _options: unknown, _state: unknown, model: { id: string }) =>
    model.id === 'gpt-6.1-sol'
      ? tool('submit_result', { markdown: '# 稿件' })
      : fauxAssistantMessage('等待写作');
  const responses = () => [dispatch(), result, result, fauxAssistantMessage('已完成写作')];
  const test = await fixture(responses());
  const page = (productionId: string) => ({ ...testContext, productionId, field: null, draft: null });
  try {
    test.start();
    test.send(testCommand('first', '写稿', page('p')));
    await expect.poll(() => test.store.command('first')?.status).toBe('complete');
    const first = Object.values((await test.runtime.work()).conversations)[0];
    expect(first?.retired).toBe(false);
    test.fake.setResponses(responses());
    test.decide.mockResolvedValueOnce({ reuse: true, lifetime: 'task', thinkingLevel: 'medium' });
    test.send(testCommand('revision', '改这稿', page('p')));
    await expect.poll(() => test.store.command('revision')?.status).toBe('complete');
    expect(Object.keys((await test.runtime.work()).conversations)).toHaveLength(1);
    expect(test.decide.mock.calls[1]?.[0].availableTask).toBe(true);
    test.fake.setResponses(responses());
    test.send(testCommand('other-production', '写另一期', page('other')));
    await expect.poll(() => test.store.command('other-production')?.status).toBe('complete');
    expect(test.decide.mock.calls[2]?.[0].availableTask).toBe(false);
    expect(Object.keys((await test.runtime.work()).conversations)).toHaveLength(2);
    test.fake.setResponses([
      tool('retire_conversation', { id: String(first?.id) }),
      fauxAssistantMessage('已结束这期写作'),
    ]);
    test.send(testCommand('retire', '结束这期写作', page('p')));
    await expect.poll(() => test.store.command('retire')?.status).toBe('complete');
    expect(
      Object.values((await test.runtime.work()).conversations).find(
        (conversation) => conversation.id === first?.id,
      )?.retired,
    ).toBe(true);
    test.fake.setResponses(responses());
    test.send(testCommand('new-writer', '重写', page('p')));
    await expect.poll(() => test.store.command('new-writer')?.status).toBe('complete');
    expect(test.decide.mock.calls[3]?.[0].availableTask).toBe(false);
    test.channel.version = 2;
    test.fake.setResponses(responses());
    test.send(testCommand('new-policy', '按新要求重写', page('p')));
    await expect.poll(() => test.store.command('new-policy')?.status).toBe('complete');
    expect(test.decide.mock.calls[4]?.[0].availableTask).toBe(false);
  } finally {
    await test.close();
  }
});

it('retires unscoped task writers at command completion instead of reusing unrelated general work', async () => {
  const dispatch = () =>
    fauxAssistantMessage([fauxToolCall('delegate', { role: 'writer', instructions: 'Write', revision: 1 })], {
      stopReason: 'toolUse',
    });
  const result = (_context: unknown, _options: unknown, _state: unknown, model: { id: string }) =>
    model.id === 'gpt-6.1-sol'
      ? fauxAssistantMessage([fauxToolCall('submit_result', { markdown: '# 稿件' })], {
          stopReason: 'toolUse',
        })
      : fauxAssistantMessage('等待');
  const responses = () => [dispatch(), result, result, fauxAssistantMessage('完成')];
  const test = await fixture(responses());
  try {
    test.start();
    test.send();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    expect(Object.values((await test.runtime.work()).conversations)[0]?.retired).toBe(true);
    test.fake.setResponses(responses());
    test.send(testCommand('other-general'));
    await expect.poll(() => test.store.command('other-general')?.status).toBe('complete');
    expect(test.decide.mock.calls[1]?.[0].availableTask).toBe(false);
    expect(Object.keys((await test.runtime.work()).conversations)).toHaveLength(2);
  } finally {
    await test.close();
  }
});

it('persists snapshot cancellation before the command body and eventually confirms without a model call', async () => {
  const test = await fixture();
  try {
    test.start();
    test.socket.receive({
      ...snapshot,
      commands: [{ id: 'late-command', status: 'cancelling', detail: 'stopping' }],
    });
    await delay(20);
    expect(test.store.get('cancelled:late-command')).toBe(true);
    expect(test.store.event('cancelled:late-command')).toBeNull();
    test.send(testCommand('late-command'));
    await expect.poll(() => test.store.command('late-command')?.status).toBe('cancelled');
    expect(test.store.event('cancelled:late-command')).toMatchObject({ status: 'cancelled' });
    expect(test.fake.state.callCount).toBe(0);
  } finally {
    await test.close();
  }
});

it('reopens real Pi SQLite and replays the same root request without another model turn', async () => {
  const test = await fixture([fauxAssistantMessage('持久回复')], { persistent: true });
  let runtime = test.runtime;
  try {
    test.start();
    test.send();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    await runtime.close();
    test.store.database.prepare("UPDATE commands SET status='working' WHERE id='command-1'").run();
    test.store.database.prepare('UPDATE inputs SET done=0').run();
    runtime = await openRuntime({
      config: test.config,
      models: test.models,
      storage: await openNodeSqliteStorage(join(test.directory, 'pi.sqlite')),
      store: test.store,
      transport: test.transport,
      client: test.client,
      decide: test.decide,
    });
    await runtime.pump();
    expect(test.store.command('command-1')?.status).toBe('complete');
    expect(test.fake.state.callCount).toBe(1);
    expect(test.logs.filter((line) => line === '持久回复')).toHaveLength(1);
  } finally {
    await runtime.close();
    await test.close();
  }
});

it('recovers queued commands without starting models offline, and redacts model or HTTP failures', async () => {
  const test = await fixture([
    fauxAssistantMessage('unavailable', { stopReason: 'error', errorMessage: 'fake-model-key private' }),
  ]);
  try {
    test.store.receive(testCommand());
    await test.runtime.pump();
    expect(test.fake.state.callCount).toBe(0);
    test.start();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('failed');
    expect(test.logs.join()).not.toContain('fake-model-key');
    vi.spyOn(test.client, 'channel').mockRejectedValueOnce(new Error('fake-site-key'));
    test.send(testCommand('second'));
    await expect.poll(() => test.store.command('second')?.status).toBe('failed');
    expect(test.logs.join()).not.toContain('fake-site-key');
  } finally {
    await test.close();
  }
});

it('honors cancellation before command replay, live cancellation and safe cancel failures', async () => {
  const test = await fixture([fauxAssistantMessage('unused')]);
  try {
    test.start();
    test.socket.receive({ type: 'cancel', commandId: 'command-1' });
    test.send();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('cancelled');
    expect(test.fake.state.callCount).toBe(0);
    const snapshot = vi.spyOn(test.runtime.harness, 'snapshot').mockRejectedValueOnce(new Error('private'));
    test.socket.receive({ type: 'cancel', commandId: 'missing' });
    await expect.poll(() => test.logs.join()).toContain('取消处理中');
    snapshot.mockRestore();
    test.transport.emit('terminal', 'missing');
    await delay(10);
  } finally {
    await test.close();
  }
});

it('bounds root execution time and never marks an aborted run successful', async () => {
  const test = await fixture([
    async () => {
      await delay(50);
      return fauxAssistantMessage('late');
    },
  ]);
  try {
    test.config.runtime.maxTaskMinutes = 0.0001;
    test.start();
    test.send();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('failed');
    expect(test.logs).not.toContain('late');
  } finally {
    await test.close();
  }
});

it('times out child execution and reports missing result rather than fabricating Markdown', async () => {
  const test = await fixture([
    fauxAssistantMessage([fauxToolCall('delegate', { role: 'writer', instructions: 'Write', revision: 1 })], {
      stopReason: 'toolUse',
    }),
    async (_context, _options, _state, model) => {
      if (model.id === 'gpt-6.1-sol') await delay(50);
      return fauxAssistantMessage('No result submitted');
    },
    async (_context, _options, _state, model) => {
      if (model.id === 'gpt-6.1-sol') await delay(50);
      return fauxAssistantMessage('No result submitted');
    },
    fauxAssistantMessage('执行没有返回有效成果。'),
  ]);
  try {
    test.config.runtime.maxTaskMinutes = 0.0006;
    test.start();
    test.send();
    await expect
      .poll(async () => Object.values((await test.runtime.work()).assignments)[0]?.status)
      .toBe('failed');
    const assignment = Object.values((await test.runtime.work()).assignments)[0];
    expect(assignment?.result).toBeNull();
  } finally {
    await test.close();
  }
});

it('does not publish empty final text and catches status synchronization failures', async () => {
  const test = await fixture([fauxAssistantMessage('')]);
  try {
    test.start();
    test.send();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    expect(test.logs).not.toContain('');
    vi.spyOn(test.runtime.harness, 'snapshot').mockRejectedValueOnce(new Error('private storage'));
    await test.runtime.pump();
    expect(test.logs.join()).not.toContain('private storage');
    test.transport.emit('terminal', 'unknown');
    await delay(10);
  } finally {
    await test.close();
  }
});

it('reports terminal cleanup and status persistence failures without raw exception output', async () => {
  const test = await fixture();
  try {
    test.start();
    await test.runtime.pump();
    const snapshot = vi
      .spyOn(test.runtime.harness, 'snapshot')
      .mockRejectedValueOnce(new Error('secret exception'));
    test.transport.emit('terminal', 'unknown');
    await expect.poll(() => test.logs.join()).toContain('恢复终态任务');
    snapshot
      .mockRejectedValueOnce(new Error('secret exception'))
      .mockRejectedValueOnce(new Error('secret exception'));
    await test.runtime.pump();
    expect(test.logs.join()).toContain('状态同步暂时失败');
    expect(test.logs.join()).not.toContain('secret exception');
  } finally {
    await test.close();
  }
});

it('leaves interrupted durable work recoverable on close without changing it to failed', async () => {
  let release = () => {};
  const block = new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => {
    release = () => resolve(fauxAssistantMessage('after close'));
  });
  const test = await fixture([() => block], { persistent: true });
  try {
    test.start();
    test.send();
    await expect.poll(() => test.fake.state.callCount).toBe(1);
    const close = test.runtime.close();
    release();
    await close;
    expect(test.store.command('command-1')?.status).toBe('working');
  } finally {
    release();
    await test.close();
  }
});

it('resumes an existing nonterminal assignment after reopening without recreating conversation or input', async () => {
  let release = () => {};
  const block = new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => {
    release = () => resolve(fauxAssistantMessage('interrupted'));
  });
  const response = (_context: unknown, _options: unknown, _state: unknown, model: { id: string }) =>
    model.id === 'gpt-6.1-sol' ? block : fauxAssistantMessage('等待成果');
  const test = await fixture(
    [
      fauxAssistantMessage(
        [fauxToolCall('delegate', { role: 'writer', instructions: 'Write', revision: 1 })],
        { stopReason: 'toolUse' },
      ),
      response,
      response,
    ],
    { persistent: true },
  );
  let runtime = test.runtime;
  try {
    test.start();
    test.send();
    await expect.poll(async () => Object.values((await runtime.work()).assignments).length).toBe(1);
    const first = Object.values((await runtime.work()).assignments)[0];
    const close = runtime.close();
    release();
    await close;
    test.fake.setResponses([
      fauxAssistantMessage([fauxToolCall('submit_result', { markdown: '# 恢复稿件' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage('恢复完成'),
    ]);
    runtime = await openRuntime({
      config: test.config,
      models: test.models,
      storage: await openNodeSqliteStorage(join(test.directory, 'pi.sqlite')),
      store: test.store,
      transport: test.transport,
      client: test.client,
      decide: test.decide,
      log: (message) => test.logs.push(message),
    });
    await runtime.pump();
    await expect
      .poll(async () => Object.values((await runtime.work()).assignments)[0]?.status)
      .not.toBe('working');
    expect(Object.values((await runtime.work()).assignments)[0]?.conversationId).toBe(first?.conversationId);
    expect(test.decide).toHaveBeenCalledOnce();
    expect(await runtime.root.agent(BACKGROUND_CONTEXT)).toMatchObject({ thinkingLevel: 'high' });
  } finally {
    release();
    await runtime.close();
    await test.close();
  }
});

it('keeps a resident reviewer reusable across logical owner commands while task writers retire', async () => {
  const dispatch = () =>
    fauxAssistantMessage(
      [fauxToolCall('delegate', { role: 'reviewer', instructions: 'Review facts', revision: 1 })],
      { stopReason: 'toolUse' },
    );
  const result = (_context: unknown, _options: unknown, _state: unknown, model: { id: string }) =>
    model.id === 'gpt-6.1-sol'
      ? fauxAssistantMessage([fauxToolCall('submit_result', { markdown: '# 审校通过' })], {
          stopReason: 'toolUse',
        })
      : fauxAssistantMessage('正在审校。');
  const responses = () => [dispatch(), result, result, fauxAssistantMessage('已完成审校。')];
  const test = await fixture(responses());
  test.decide.mockResolvedValueOnce({ reuse: false, lifetime: 'resident', thinkingLevel: 'high' });
  try {
    test.start();
    test.send();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    const first = Object.values((await test.runtime.work()).conversations)[0];
    expect(first?.retired).toBe(false);
    test.fake.setResponses(responses());
    test.decide.mockResolvedValueOnce({ reuse: true, lifetime: 'resident', thinkingLevel: 'low' });
    test.send(testCommand('another-command'));
    await expect.poll(() => test.store.command('another-command')?.status).toBe('complete');
    const state = await test.runtime.work();
    expect(Object.keys(state.conversations)).toHaveLength(1);
    expect(Object.values(state.assignments)).toHaveLength(2);
    expect(Object.values(state.conversations)[0]).toMatchObject({
      id: first?.id,
      thinkingLevel: 'low',
      retired: false,
    });
    expect(test.decide.mock.calls[1]?.[0].availableResident).toBe(true);
  } finally {
    await test.close();
  }
});
