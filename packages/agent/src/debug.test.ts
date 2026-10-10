import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { debugArguments, debugMain, readRuntimeDebug, runDebug, runtimeDirectory } from './debug.ts';
import { RuntimeStore } from './store.ts';
import { testCommand, testConfig } from './testing/fixtures.ts';

it('accepts a bounded environment/command selection and isolates runtime identities', () => {
  expect(debugArguments([])).toEqual({ environment: 'local', commandId: undefined });
  expect(debugArguments(['--environment', 'production', '--command', 'c'])).toEqual({
    environment: 'production',
    commandId: 'c',
  });
  for (const args of [
    ['--bad', 'x'],
    ['--environment', 'stage'],
    ['--command'],
    ['--command', 'a'.repeat(161)],
  ])
    expect(() => debugArguments(args)).toThrow();
  expect(runtimeDirectory('https://his.fm', 'a')).not.toBe(runtimeDirectory('https://his.fm', 'b'));
  expect(runtimeDirectory('https://his.fm', 'a')).not.toBe(runtimeDirectory('http://localhost:7056', 'a'));
});
it('reads bounded operational summaries without opening a harness or exposing tool content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hisfm-debug-'));
  try {
    expect(readRuntimeDebug(directory).state).toBe('not_started');
    const store = new RuntimeStore(join(directory, 'transport.sqlite'), 'test');
    store.receive(testCommand('c', 'private user request'));
    store.enqueue({
      type: 'message',
      message: { id: 'reply', role: 'assistant', text: 'private response', createdAt: 'now', commandId: 'c' },
    });
    const before = store.database.prepare('SELECT count(*) AS count FROM outbox').get();
    expect(readRuntimeDebug(directory, 'c').commands).toEqual([{ id: 'c', status: 'queued' }]);
    expect(() => readRuntimeDebug(directory, 'unknown')).toThrow('没有找到');
    const pi = new DatabaseSync(join(directory, 'frogie.sqlite'));
    pi.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY, conversation_id INTEGER, record TEXT)');
    const insert = pi.prepare('INSERT INTO entries VALUES (?,?,?)');
    insert.run(
      1,
      21,
      JSON.stringify({
        kind: 'pi.tool-result',
        model: [{ toolName: 'bash', content: 'private output' }, { toolName: 'bash', isError: true }, {}],
      }),
    );
    insert.run(2, 21, JSON.stringify({ kind: 'pi.tool-result' }));
    const summary = readRuntimeDebug(directory);
    expect(summary.tools).toEqual([{ conversationId: 21, name: 'bash', count: 2, failures: 1 }]);
    expect(JSON.stringify(summary)).not.toContain('private');
    expect(store.database.prepare('SELECT count(*) AS count FROM outbox').get()).toEqual(before);
    pi.close();
    store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('prints only the selected operational report and sanitizes command failures', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const read = vi.fn(() => ({
    state: 'not_started',
    commands: [],
    pendingEvents: 0,
    pendingEffects: 0,
    inputs: [],
    tools: [],
  }));
  try {
    await debugMain(['--environment', 'local'], {
      loadConfig: async () => testConfig(),
      readRuntimeDebug: read,
      runtimeDirectory: () => '/tmp/debug',
    });
    expect(read).toHaveBeenCalledWith('/tmp/debug', undefined);
    expect(String(log.mock.calls[0]?.[0])).not.toContain('fake-model-key');
    const inspect = vi.fn(async () => {});
    const host = { exitCode: 0 } as typeof process;
    await runDebug([], inspect, host);
    expect(inspect).toHaveBeenCalled();
    inspect.mockRejectedValueOnce(new Error('private-secret'));
    await runDebug([], inspect, host);
    expect(host.exitCode).toBe(1);
    expect(error).not.toHaveBeenCalledWith('private-secret');
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
});
