import assert from 'node:assert/strict';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { estimateContextTokens } from '@earendil-works/pi-ai/utils/estimate';
import { AssistantEntry, UserEntry } from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import { expect, it, vi } from 'vitest';
import { CONTEXT_BLOCKED, CONTEXT_FAILURE, contextModels } from './context.ts';
import { openRuntime } from './runtime.ts';
import { fixture, testCommand, testContext } from './testing/fixtures.ts';

it('changes only summary reasoning and preserves model, budget, cancellation and provider binding', async () => {
  const fake = fauxProvider({ models: [{ id: 'coordinator' }] });
  const models = createModels();
  models.setProvider(fake.provider);
  const complete = vi.spyOn(models, 'completeSimple');
  const stream = vi.spyOn(models, 'streamSimple');
  const guarded = contextModels(models);
  const model = fake.getModel();
  const context = { messages: [] };
  const options = { reasoning: 'high' as const, maxTokens: 8192, signal: new AbortController().signal };
  fake.setResponses([fauxAssistantMessage('Summary'), fauxAssistantMessage('Answer')]);
  expect((await guarded.completeSimple(model, context, options)).stopReason).toBe('stop');
  expect(complete).toHaveBeenCalledWith(model, context, { ...options, reasoning: 'low' });
  expect((await guarded.streamSimple(model, context, options).result()).stopReason).toBe('stop');
  expect(stream).toHaveBeenLastCalledWith(model, context, options);
  expect(guarded.getModel(model.provider, model.id)).toEqual(model);
  expect(Reflect.get(guarded, 'missing')).toBeUndefined();
});

it('blocks the recorded 123908-token failure locally without a provider call', async () => {
  const fake = fauxProvider({ models: [{ id: 'coordinator', contextWindow: 128000, maxTokens: 8192 }] });
  const models = createModels();
  models.setProvider(fake.provider);
  const guarded = contextModels(models);
  const previous = fauxAssistantMessage('Read the production', { timestamp: 100 });
  previous.usage = { ...previous.usage, input: 122681, output: 42, totalTokens: 122723 };
  const context = {
    messages: [previous, { role: 'user' as const, content: 'x'.repeat(1185 * 4), timestamp: 101 }],
  };
  expect(estimateContextTokens(context.messages).tokens).toBe(123908);
  const events = guarded.streamSimple(fake.getModel(), context);
  const received = [];
  for await (const event of events) received.push(event);
  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({ type: 'error', reason: 'error' });
  expect(await events.result()).toMatchObject({
    stopReason: 'error',
    errorMessage: CONTEXT_BLOCKED,
    usage: { totalTokens: 0 },
  });
  expect(fake.state.callCount).toBe(0);
});

it.each([0, 128000])(
  'permits safe requests with a %i-token window and counts system context',
  async (window) => {
    const fake = fauxProvider({ models: [{ id: 'coordinator', contextWindow: window, maxTokens: 8192 }] });
    const models = createModels();
    models.setProvider(fake.provider);
    const guarded = contextModels(models);
    fake.setResponses([fauxAssistantMessage('Allowed')]);
    expect((await guarded.streamSimple(fake.getModel(), { messages: [] }).result()).stopReason).toBe('stop');
    const oversized = { messages: [], systemPrompt: 'x'.repeat(128000 * 4) };
    if (window) {
      expect((await guarded.streamSimple(fake.getModel(), oversized).result()).errorMessage).toBe(
        CONTEXT_BLOCKED,
      );
      expect(fake.state.callCount).toBe(1);
    }
  },
);

async function congest(test: Awaited<ReturnType<typeof fixture>>) {
  const model = test.fake.getModel('gpt-6-astra');
  assert(model);
  model.maxTokens = test.config.coordinator.maxTokens;
  const history = [];
  for (let index = 0; index < 18; index++) {
    const entry = await test.runtime.root.commit(
      (tx) =>
        tx.appendEntry(UserEntry, test.runtime.root.id, {
          model: [{ role: 'user', content: `History ${index}: ${'x'.repeat(8000)}`, timestamp: index + 1 }],
        }),
      BACKGROUND_CONTEXT,
    );
    history.push(entry.id);
  }
  const previous = fauxAssistantMessage('Previous command completed', { timestamp: Date.now() - 1 });
  previous.usage = { ...previous.usage, input: 122681, output: 42, totalTokens: 122723 };
  await test.runtime.root.commit(
    (tx) => tx.appendEntry(AssistantEntry, test.runtime.root.id, { model: [previous] }),
    BACKGROUND_CONTEXT,
  );
  return history;
}

it('compacts and reopens a congested coordinator without deleting history or repeating summarization', async () => {
  const test = await fixture(
    [
      (_context, options, _state, model) => {
        expect(options?.reasoning).toBe('low');
        expect(options?.maxTokens).toBe(8192);
        expect(model.id).toBe('gpt-6-astra');
        return fauxAssistantMessage('Verified context checkpoint; approvals remain owner-only.');
      },
      (context, options) => {
        expect(options?.reasoning).toBe('high');
        expect(JSON.stringify(context)).toContain('Verified context checkpoint');
        expect(JSON.stringify(context)).toContain('new owner command');
        expect(estimateContextTokens(context).tokens).toBeLessThan(30000);
        return fauxAssistantMessage('Context recovered.');
      },
    ],
    { persistent: true },
  );
  let runtime = test.runtime;
  try {
    const history = await congest(test);
    test.start();
    test.send(testCommand('recovered', 'new owner command', testContext));
    await expect.poll(() => test.store.command('recovered')?.status).toBe('complete');
    expect(test.fake.state.callCount).toBe(2);
    const context = await test.runtime.root.context(BACKGROUND_CONTEXT);
    expect(context.head?.kind).toBe('pi.compaction');
    const entries = await test.runtime.root.entries({}, 100, undefined, BACKGROUND_CONTEXT);
    expect(entries.items.map((entry) => entry.id)).toEqual(expect.arrayContaining(history));
    expect(test.store.command('recovered')?.command.context).toEqual(testContext);
    expect(test.store.effects('recovered')).toEqual([]);
    await runtime.close();
    runtime = await openRuntime({
      storage: await openNodeSqliteStorage(join(test.directory, 'pi.sqlite')),
      models: test.models,
      config: test.config,
      store: test.store,
      transport: test.transport,
      client: test.client,
      decide: test.decide,
      log: (text) => test.logs.push(text),
    });
    expect((await runtime.root.context(BACKGROUND_CONTEXT)).head?.id).toBe(context.head?.id);
    test.fake.appendResponses([fauxAssistantMessage('Next command completed.')]);
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
      fauxAssistantMessage('', { stopReason, errorMessage: 'Invalid request: fake-model-key' }),
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
      expect((await test.runtime.root.context(BACKGROUND_CONTEXT)).head).toBeUndefined();
      expect(
        (await test.runtime.root.entries({}, 100, undefined, BACKGROUND_CONTEXT)).items.map(
          (entry) => entry.id,
        ),
      ).toEqual(expect.arrayContaining(history));
      expect(test.store.effects('command-1')).toEqual([]);
    } finally {
      await test.close();
    }
  },
);
