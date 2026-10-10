import assert from 'node:assert/strict';
import { join } from 'node:path';
import { assistantMessage, contextTokens, testHost } from '@frogie/core/testing';
import { expect, it } from 'vitest';
import { openRuntime } from './runtime.ts';
import { fixture, testCommand, testContext } from './testing/fixtures.ts';

const CONTEXT_FAILURE =
  '上下文压缩未完成，已暂停本次任务并保留完整历史；未继续请求模型，请修复压缩后再重试。';

async function congest(test: Awaited<ReturnType<typeof fixture>>) {
  const model = test.fake.getModel('gpt-6-astra');
  assert(model);
  model.maxTokens = test.config.coordinator.maxTokens;
  const history = [];
  for (let index = 0; index < 18; index++) {
    const entries = await testHost(test.runtime.host).appendHistory(test.runtime.rootId, [
      { role: 'user', content: `History ${index}: ${'x'.repeat(8000)}`, timestamp: index + 1 },
    ]);
    history.push(...entries);
  }
  const previous = assistantMessage('Previous command completed', { timestamp: Date.now() - 1 });
  previous.usage = { ...previous.usage, input: 122681, output: 42, totalTokens: 122723 };
  await testHost(test.runtime.host).appendHistory(test.runtime.rootId, [previous]);
  return history;
}

it('compacts and reopens a congested coordinator without deleting history or repeating summarization', async () => {
  const test = await fixture(
    [
      (context, options, _state, model) => {
        expect(JSON.stringify(context)).toContain('自定义压缩要求：保留待验收项');
        expect(JSON.stringify(context)).not.toContain('Use this EXACT format');
        expect(options?.reasoning).toBe('low');
        expect(options?.maxTokens).toBe(8192);
        expect(model.id).toBe('gpt-6-astra');
        return assistantMessage('Verified context checkpoint; approvals remain owner-only.');
      },
      (context, options) => {
        expect(options?.reasoning).toBe('high');
        expect(JSON.stringify(context)).toContain('Verified context checkpoint');
        expect(JSON.stringify(context)).toContain('new owner command');
        expect(contextTokens(context)).toBeLessThan(30000);
        return assistantMessage('Context recovered.');
      },
    ],
    { persistent: true },
  );
  test.channel.prompts.compaction = '自定义压缩要求：保留待验收项';
  let runtime = test.runtime;
  try {
    const history = await congest(test);
    test.start();
    test.send(testCommand('recovered', 'new owner command', testContext));
    await expect.poll(() => test.store.command('recovered')?.status).toBe('complete');
    expect(test.fake.state.callCount).toBe(2);
    const context = await testHost(test.runtime.host).context(test.runtime.rootId);
    expect(context.head?.kind).toBe('pi.compaction');
    const entries = await testHost(test.runtime.host).entries(test.runtime.rootId);
    expect(entries.items.map((entry) => entry.id)).toEqual(expect.arrayContaining(history));
    expect(test.store.command('recovered')?.command.context).toEqual(testContext);
    expect(test.store.effects('recovered')).toEqual([]);
    await runtime.close();
    runtime = await openRuntime({
      databasePath: join(test.directory, 'frogie.sqlite'),
      models: test.models,
      config: test.config,
      store: test.store,
      transport: test.transport,
      client: test.client,
      decide: test.decide,
      log: (text) => test.logs.push(text),
    });
    expect((await testHost(runtime.host).context(runtime.rootId)).head?.id).toBe(context.head?.id);
    test.fake.appendResponses([assistantMessage('Next command completed.')]);
    test.send(testCommand('next', 'Confirm retained context'));
    await expect.poll(() => test.store.command('next')?.status).toBe('complete');
    expect(test.fake.state.callCount).toBe(3);
  } finally {
    await runtime.close();
    await test.close();
  }
});

it.each(['length', 'error', 'stop'] as const)(
  'stops after a %s/empty summary with a safe error and no doomed generation',
  async (stopReason) => {
    const test = await fixture([
      assistantMessage('', { stopReason, errorMessage: 'Invalid request: fake-model-key' }),
    ]);
    try {
      const history = await congest(test);
      test.start();
      test.send();
      await expect.poll(() => test.store.command('command-1')?.status).toBe('failed');
      expect(test.fake.state.callCount).toBe(1);
      expect(test.logs).toContain(CONTEXT_FAILURE);
      expect(test.logs.join()).not.toContain('检查连接');
      expect(test.logs.join()).not.toContain('fake-model-key');
      expect((await testHost(test.runtime.host).context(test.runtime.rootId)).head).toBeUndefined();
      expect(
        (await testHost(test.runtime.host).entries(test.runtime.rootId)).items.map((entry) => entry.id),
      ).toEqual(expect.arrayContaining(history));
      expect(test.store.effects('command-1')).toEqual([]);
    } finally {
      await test.close();
    }
  },
);
