import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assistantMessage, testHost, toolCall } from '@frogie/core/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { openRuntime } from './runtime.ts';
import { fixture, snapshot, testCommand, testContext } from './testing/fixtures.ts';
import { acceptWork, successfulResult } from './testing/outcomes.ts';

afterEach(() => vi.restoreAllMocks());

it('preserves completed legacy history and stops unfinished assignments missing the current command envelope', async () => {
  let release = () => {};
  const block = new Promise<ReturnType<typeof assistantMessage>>((resolve) => {
    release = () => resolve(assistantMessage('interrupted'));
  });
  const response = (_context: unknown, _options: unknown, _state: unknown, model: { id: string }) =>
    model.id === 'gpt-6.1-sol' ? block : assistantMessage('等待任务');
  const test = await fixture(
    [
      assistantMessage([toolCall('delegate', { role: 'writer', instructions: 'Research', revision: 1 })], {
        stopReason: 'toolUse',
      }),
      response,
      response,
    ],
    { persistent: true },
  );
  let runtime = test.runtime;
  try {
    test.start();
    test.send();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('waiting');
    const assignment = Object.values((await runtime.work()).assignments)[0];
    assert(assignment);
    test.store.receive(testCommand('old-complete'));
    test.store.state('old-complete', 'complete', 'Historical completion', 'old-state');
    const historical = {
      ...assignment,
      id: 'historical',
      commandId: 'old-complete',
      status: 'complete' as const,
      input: '{"instructions":"Legacy task"}',
      result: '# Legacy artifact',
    };
    Reflect.deleteProperty(historical, 'outcome');
    Reflect.deleteProperty(historical, 'requiredCriteria');
    await runtime.host.transact(async (transaction) => {
      const state = await transaction.state();
      state.assignments.historical = historical;
      const pending = state.assignments[assignment.id];
      assert(pending);
      pending.input = '{"instructions":"Old restricted task"}';
      Reflect.deleteProperty(pending, 'outcome');
      Reflect.deleteProperty(pending, 'requiredCriteria');
    });
    const closing = runtime.close();
    release();
    await closing;
    const calls = test.fake.state.callCount;
    test.fake.setResponses([
      assistantMessage(
        [
          toolCall('finish_command', {
            markdown: '旧任务需要按当前指令重新派发。',
            outcome: 'blocked',
            acceptedAssignmentIds: [],
            checks: [],
          }),
        ],
        { stopReason: 'toolUse' },
      ),
    ]);
    runtime = await openRuntime({
      config: test.config,
      models: test.models,
      databasePath: join(test.directory, 'frogie.sqlite'),
      store: test.store,
      transport: test.transport,
      client: test.client,
      decide: test.decide,
      log: (message) => test.logs.push(message),
    });
    await runtime.pump();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('failed');
    const saved = await runtime.work();
    expect(saved.assignments.historical).toEqual(historical);
    expect(saved.assignments[assignment.id]?.status).toBe('failed');
    expect(saved.assignments[assignment.id]?.outcome).toBeUndefined();
    expect(test.fake.state.callCount).toBe(calls + 1);
    expect(test.logs.join()).toContain('旧任务缺少当前指令');
  } finally {
    release();
    await runtime.close();
    await test.close();
  }
});

it('replays a durable finish and its outbox after reopening without another model call', async () => {
  const test = await fixture(
    [
      assistantMessage(
        [
          toolCall('finish_command', {
            markdown: '结果已确认',
            outcome: 'done',
            acceptedAssignmentIds: [],
            checks: [],
          }),
        ],
        { stopReason: 'toolUse' },
      ),
    ],
    { persistent: true },
  );
  let runtime = test.runtime;
  try {
    test.start();
    test.send();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    const pending = test.store.pending();
    const calls = test.fake.state.callCount;
    await runtime.close();
    test.store.database.prepare("UPDATE commands SET status='queued'").run();
    test.store.database.prepare('UPDATE inputs SET done=0').run();
    runtime = await openRuntime({
      config: test.config,
      models: test.models,
      databasePath: join(test.directory, 'frogie.sqlite'),
      store: test.store,
      transport: test.transport,
      client: test.client,
      decide: test.decide,
    });
    await runtime.pump();
    expect(test.store.command('command-1')?.status).toBe('complete');
    expect(test.store.get('finish:command-1')).toMatchObject({ outcome: 'done' });
    expect(test.fake.state.callCount).toBe(calls);
    expect(test.store.pending().filter((frame) => frame.type !== 'status')).toEqual(
      pending.filter((frame) => frame.type !== 'status'),
    );
  } finally {
    await runtime.close();
    await test.close();
  }
});

it('reuses production writers across commands but isolates other productions and retired identities', async () => {
  const tool = (name: string, args: Parameters<typeof toolCall>[1]) =>
    assistantMessage([toolCall(name, args)], { stopReason: 'toolUse' });
  const dispatch = () =>
    tool('delegate', { role: 'writer', instructions: 'Revise this script', revision: 1 });
  const result = (_context: unknown, _options: unknown, _state: unknown, model: { id: string }) =>
    model.id === 'gpt-6.1-sol'
      ? tool('submit_result', successfulResult('# 稿件'))
      : assistantMessage('等待写作');
  const responses = () => [dispatch(), result, result];
  const test = await fixture(responses());
  test.fake.appendResponses(acceptWork(test));
  const page = (productionId: string) => ({ ...testContext, productionId, field: null, draft: null });
  try {
    test.start();
    test.send(testCommand('first', '写稿', page('p')));
    await expect.poll(() => test.store.command('first')?.status).toBe('complete');
    const first = Object.values((await test.runtime.work()).conversations)[0];
    expect(first?.retired).toBe(false);
    test.fake.setResponses([...responses(), ...acceptWork(test)]);
    test.decide.mockResolvedValueOnce({ reuse: true, lifetime: 'task', thinkingLevel: 'medium' });
    test.send(testCommand('revision', '改这稿', page('p')));
    await expect.poll(() => test.store.command('revision')?.status).toBe('complete');
    expect(Object.keys((await test.runtime.work()).conversations)).toHaveLength(1);
    expect(test.decide.mock.calls[1]?.[0].availableTask).toBe(true);
    test.fake.setResponses([...responses(), ...acceptWork(test)]);
    test.send(testCommand('other-production', '写另一期', page('other')));
    await expect.poll(() => test.store.command('other-production')?.status).toBe('complete');
    expect(test.decide.mock.calls[2]?.[0].availableTask).toBe(false);
    expect(Object.keys((await test.runtime.work()).conversations)).toHaveLength(2);
    test.fake.setResponses([
      tool('retire_conversation', { id: String(first?.id) }),
      assistantMessage('已结束这期写作'),
    ]);
    test.send(testCommand('retire', '结束这期写作', page('p')));
    await expect.poll(() => test.store.command('retire')?.status).toBe('complete');
    expect(
      Object.values((await test.runtime.work()).conversations).find(
        (conversation) => conversation.id === first?.id,
      )?.retired,
    ).toBe(true);
    test.fake.setResponses([...responses(), ...acceptWork(test)]);
    test.send(testCommand('new-writer', '重写', page('p')));
    await expect.poll(() => test.store.command('new-writer')?.status).toBe('complete');
    expect(test.decide.mock.calls[3]?.[0].availableTask).toBe(false);
    test.channel.version = 2;
    test.fake.setResponses([...responses(), ...acceptWork(test)]);
    test.send(testCommand('new-policy', '按新要求重写', page('p')));
    await expect.poll(() => test.store.command('new-policy')?.status).toBe('complete');
    expect(test.decide.mock.calls[4]?.[0].availableTask).toBe(false);
  } finally {
    await test.close();
  }
});

it('retires unscoped task writers at command completion instead of reusing unrelated general work', async () => {
  const dispatch = () =>
    assistantMessage([toolCall('delegate', { role: 'writer', instructions: 'Write', revision: 1 })], {
      stopReason: 'toolUse',
    });
  const result = (_context: unknown, _options: unknown, _state: unknown, model: { id: string }) =>
    model.id === 'gpt-6.1-sol'
      ? assistantMessage([toolCall('submit_result', successfulResult('# 稿件'))], {
          stopReason: 'toolUse',
        })
      : assistantMessage('等待');
  const responses = () => [dispatch(), result, result];
  const test = await fixture(responses());
  test.fake.appendResponses(acceptWork(test));
  try {
    test.start();
    test.send();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    expect(Object.values((await test.runtime.work()).conversations)[0]?.retired).toBe(true);
    test.fake.setResponses([...responses(), ...acceptWork(test)]);
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
  const test = await fixture([assistantMessage('持久回复')], { persistent: true });
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
      databasePath: join(test.directory, 'frogie.sqlite'),
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
    assistantMessage('unavailable', { stopReason: 'error', errorMessage: 'fake-model-key private' }),
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
  const test = await fixture([assistantMessage('unused')]);
  try {
    test.start();
    test.socket.receive({ type: 'cancel', commandId: 'command-1' });
    test.send();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('cancelled');
    expect(test.fake.state.callCount).toBe(0);
    const snapshot = vi.spyOn(test.runtime.host, 'snapshot').mockRejectedValueOnce(new Error('private'));
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
      return assistantMessage('late');
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
    assistantMessage([toolCall('delegate', { role: 'writer', instructions: 'Write', revision: 1 })], {
      stopReason: 'toolUse',
    }),
    async (_context, _options, _state, model) => {
      if (model.id === 'gpt-6.1-sol') await delay(50);
      return assistantMessage('No result submitted');
    },
    async (_context, _options, _state, model) => {
      if (model.id === 'gpt-6.1-sol') await delay(50);
      return assistantMessage('No result submitted');
    },
    assistantMessage('执行没有返回有效成果。'),
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
  const test = await fixture([assistantMessage('')]);
  try {
    test.start();
    test.send();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    expect(test.logs).not.toContain('');
    vi.spyOn(test.runtime.host, 'snapshot').mockRejectedValueOnce(new Error('private storage'));
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
      .spyOn(test.runtime.host, 'snapshot')
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
  const block = new Promise<ReturnType<typeof assistantMessage>>((resolve) => {
    release = () => resolve(assistantMessage('after close'));
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
  const block = new Promise<ReturnType<typeof assistantMessage>>((resolve) => {
    release = () => resolve(assistantMessage('interrupted'));
  });
  const response = (_context: unknown, _options: unknown, _state: unknown, model: { id: string }) =>
    model.id === 'gpt-6.1-sol' ? block : assistantMessage('等待成果');
  const test = await fixture(
    [
      assistantMessage([toolCall('delegate', { role: 'writer', instructions: 'Write', revision: 1 })], {
        stopReason: 'toolUse',
      }),
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
      assistantMessage([toolCall('submit_result', successfulResult('# 恢复稿件'))], {
        stopReason: 'toolUse',
      }),
      assistantMessage('恢复完成'),
    ]);
    runtime = await openRuntime({
      config: test.config,
      models: test.models,
      databasePath: join(test.directory, 'frogie.sqlite'),
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
    expect(await testHost(runtime.host).agent(runtime.rootId)).toMatchObject({ thinkingLevel: 'high' });
  } finally {
    release();
    await runtime.close();
    await test.close();
  }
});

it('keeps a resident reviewer reusable across logical owner commands while task writers retire', async () => {
  const dispatch = () =>
    assistantMessage(
      [toolCall('delegate', { role: 'reviewer', instructions: 'Review facts', revision: 1 })],
      { stopReason: 'toolUse' },
    );
  const result = (_context: unknown, _options: unknown, _state: unknown, model: { id: string }) =>
    model.id === 'gpt-6.1-sol'
      ? assistantMessage([toolCall('submit_result', successfulResult('# 审校通过'))], {
          stopReason: 'toolUse',
        })
      : assistantMessage('正在审校。');
  const responses = () => [dispatch(), result, result];
  const test = await fixture(responses());
  test.fake.appendResponses(acceptWork(test));
  test.decide.mockResolvedValueOnce({ reuse: false, lifetime: 'resident', thinkingLevel: 'high' });
  try {
    test.start();
    test.send();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    const first = Object.values((await test.runtime.work()).conversations)[0];
    expect(first?.retired).toBe(false);
    test.fake.setResponses([...responses(), ...acceptWork(test)]);
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
