import assert from 'node:assert/strict';
import { join } from 'node:path';
import { assistantMessage, toolCall } from '@frogie/core/testing';
import { expect, it } from 'vitest';
import { openRuntime } from './runtime.ts';
import { fixture } from './testing/fixtures.ts';

it('cancels a persisted root request before replay even though cancelled input is excluded from the next queue', async () => {
  let release = () => {};
  const blocked = new Promise<ReturnType<typeof assistantMessage>>((resolve) => {
    release = () => resolve(assistantMessage('Interrupted'));
  });
  const test = await fixture([() => blocked], { persistent: true });
  let runtime = test.runtime;
  try {
    test.start();
    test.send();
    await expect.poll(() => test.fake.state.callCount).toBe(1);
    const closing = runtime.close();
    release();
    await closing;
    test.store.set('cancelled:command-1', true);
    expect(test.store.next()).toBeNull();
    test.fake.setResponses([assistantMessage('Must not replay')]);
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
    await runtime.pump();
    expect(test.store.command('command-1')?.status).toBe('cancelled');
    expect(test.fake.state.callCount).toBe(1);
    expect(test.logs).not.toContain('Must not replay');
    expect(test.store.effects('command-1')).toEqual([]);
  } finally {
    release();
    await runtime.close();
    await test.close();
  }
});

it('halts an expired persisted assignment before restoring its executor model', async () => {
  let release = () => {};
  const blocked = new Promise<ReturnType<typeof assistantMessage>>((resolve) => {
    release = () => resolve(assistantMessage('Interrupted executor'));
  });
  let executorCalls = 0;
  const respond = (_context: unknown, _options: unknown, _state: unknown, model: { id: string }) => {
    if (model.id === 'gpt-6.1-sol') {
      executorCalls++;
      return blocked;
    }
    return assistantMessage('Waiting');
  };
  const test = await fixture(
    [
      assistantMessage([toolCall('delegate', { role: 'writer', instructions: 'Write', revision: 1 })], {
        stopReason: 'toolUse',
      }),
      respond,
      respond,
    ],
    { persistent: true },
  );
  let runtime = test.runtime;
  try {
    test.start();
    test.send();
    await expect.poll(() => executorCalls).toBe(1);
    const assignment = Object.values((await runtime.work()).assignments)[0];
    assert(assignment);
    const closing = runtime.close();
    release();
    await closing;
    test.config.runtime.maxTaskMinutes = 0.000001;
    test.fake.setResponses(
      Array.from({ length: 6 }, () => (_context, _options, _state, model) => {
        if (model.id === 'gpt-6.1-sol') executorCalls++;
        return assistantMessage('Expired work must remain failed');
      }),
    );
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
    expect((await runtime.work()).assignments[assignment.id]?.status).toBe('failed');
    await runtime.pump();
    expect(executorCalls).toBe(1);
    expect((await runtime.work()).assignments[assignment.id]?.result).toBeNull();
    expect(test.decide).toHaveBeenCalledOnce();
    expect(test.store.effects('command-1')).toEqual([]);
  } finally {
    release();
    await runtime.close();
    await test.close();
  }
});
