import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runCli } from './cli.ts';
import { runtimeDirectory } from './debug.ts';
import { dependencies, main, parseArguments } from './main.ts';
import { RuntimeStore } from './store.ts';
import { testCommand, testConfig } from './testing/fixtures.ts';

afterEach(() => vi.restoreAllMocks());

it('parses only supported startup commands and defaults to local', () => {
  expect(parseArguments(['start'])).toBe('local');
  expect(parseArguments(['start', '--environment', 'local'])).toBe('local');
  expect(parseArguments(['start', '--environment', 'production'])).toBe('production');
  for (const args of [
    [],
    ['stop'],
    ['start', 'extra'],
    ['start', '--config', 'x'],
    ['start', '--environment', 'staging'],
    ['start', '--environment', 'local', 'extra'],
  ])
    expect(() => parseArguments(args)).toThrow();
});

it('starts private per-site SQLite paths, closes once and cleans up failed startup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hisfm-main-'));
  const config = testConfig(directory);
  const stop = vi.fn();
  const start = vi.fn();
  const runtimeClose = vi.fn(async () => {});
  const unlock = vi.fn();
  const services = {
    ...dependencies,
    loadConfig: vi.fn(async () => config),
    acquireInstance: vi.fn(() => unlock),
    RuntimeTransport: class {
      start = start;
      stop = stop;
    } as unknown as typeof dependencies.RuntimeTransport,
    openRuntime: vi.fn(async () => ({ close: runtimeClose })) as unknown as typeof dependencies.openRuntime,
  };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const handle = await main(['start'], services, directory);
    expect(start).toHaveBeenCalledOnce();
    expect(services.openRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ config, databasePath: expect.stringMatching(/frogie\.sqlite$/) }),
    );
    await handle.close();
    await handle.close();
    expect(runtimeClose).toHaveBeenCalledOnce();
    expect(unlock).toHaveBeenCalledOnce();
    config.websites.production.token = 'fake';
    const production = await main(['start', '--environment', 'production'], services, directory);
    await production.close();
    expect(services.acquireInstance.mock.calls[0]).not.toEqual(services.acquireInstance.mock.calls[1]);
    vi.mocked(services.openRuntime).mockRejectedValueOnce(new Error('private upstream details'));
    await expect(main(['start'], services, directory)).rejects.not.toThrow('private upstream details');
    expect(unlock).toHaveBeenCalledTimes(3);
    const failingStore = {
      ...services,
      RuntimeStore: class {
        constructor() {
          throw new Error('unavailable');
        }
      } as unknown as typeof dependencies.RuntimeStore,
    };
    await expect(main(['start'], failingStore, directory)).rejects.toThrow('启动失败');
    expect(unlock).toHaveBeenCalledTimes(4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('wires process signals without real process exit and reports startup/shutdown failures safely', async () => {
  const host = new EventEmitter() as typeof process;
  const close = vi.fn(async () => {});
  const start = vi.fn(async () => ({ close })) as unknown as typeof main;
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await runCli(['start'], start, host);
  host.emit('SIGINT');
  host.emit('SIGTERM');
  expect(close).toHaveBeenCalledTimes(2);
  close.mockRejectedValueOnce(new Error('private'));
  await runCli(['start'], start, host);
  host.emit('SIGTERM');
  await Promise.resolve();
  expect(host.exitCode).toBe(1);
  vi.mocked(start).mockRejectedValueOnce(new Error('private-token'));
  await runCli(['wrong'], start, host);
  expect(error).toHaveBeenCalledWith('主控未能启动，请检查命令、网站令牌与本机配置。');
});

it.each(['idle', 'command', 'event', 'existing-host'] as const)(
  'preserves legacy history and fences %s work before opening a new host',
  async (state) => {
    const directory = await mkdtemp(join(tmpdir(), 'hisfm-main-legacy-'));
    const config = testConfig(directory);
    const site = config.websites.local;
    const path = runtimeDirectory(site.baseUrl, site.stationId, directory);
    const identity = `${new URL(site.baseUrl).origin}|${site.stationId}`;
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'pi.sqlite'), 'legacy-history-untouched');
    if (state === 'existing-host') await writeFile(join(path, 'frogie.sqlite'), 'host-history-untouched');
    const store = new RuntimeStore(join(path, 'transport.sqlite'), identity);
    store.receive(testCommand('historical'));
    store.state('historical', 'complete', 'Retained result', 'completed:historical');
    store.acknowledge('accepted:historical');
    store.acknowledge('completed:historical');
    if (state === 'command' || state === 'existing-host') {
      store.receive(testCommand('unfinished'));
      store.acknowledge('accepted:unfinished');
    }
    if (state === 'event') store.enqueue({ type: 'accepted', commandId: 'historical' });
    if (state === 'event')
      store.database.prepare('UPDATE outbox SET acked=0 WHERE id=?').run('accepted:historical');
    store.close();
    const start = vi.fn();
    const close = vi.fn(async () => {});
    const unlock = vi.fn();
    const openRuntime = vi.fn(async () => ({ close })) as unknown as typeof dependencies.openRuntime;
    const services = {
      ...dependencies,
      loadConfig: async () => config,
      acquireInstance: () => unlock,
      RuntimeTransport: class {
        start = start;
        stop = vi.fn();
      } as unknown as typeof dependencies.RuntimeTransport,
      openRuntime,
    };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      if (state === 'command' || state === 'event') {
        await expect(main(['start'], services, directory)).rejects.toThrow('启动失败');
        expect(openRuntime).not.toHaveBeenCalled();
        expect(start).not.toHaveBeenCalled();
        expect(existsSync(join(path, 'frogie.sqlite'))).toBe(false);
      } else {
        const runtime = await main(['start'], services, directory);
        await runtime.close();
        expect(openRuntime).toHaveBeenCalledOnce();
      }
      expect(unlock).toHaveBeenCalledOnce();
      expect(await readFile(join(path, 'pi.sqlite'), 'utf8')).toBe('legacy-history-untouched');
      const retained = new RuntimeStore(join(path, 'transport.sqlite'), identity);
      try {
        expect(retained.command('historical')?.status).toBe('complete');
        if (state === 'command') expect(retained.command('unfinished')?.status).toBe('queued');
        if (state === 'event') expect(retained.pending()).toHaveLength(1);
      } finally {
        retained.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
