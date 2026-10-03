import { EventEmitter } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), readFile: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));

import { devServices } from './dev.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('uses the actual local process adapter paths without spawning or reading real credentials', async () => {
  mocks.spawn.mockReturnValue(new EventEmitter());
  devServices.spawn(['scripts/dev.mjs']);
  expect(mocks.spawn).toHaveBeenLastCalledWith(
    process.execPath,
    ['scripts/dev.mjs'],
    expect.objectContaining({ cwd: expect.stringContaining('/apps/web'), detached: true }),
  );
  devServices.spawn(['packages/agent/src/cli.ts']);
  expect(mocks.spawn.mock.calls[1]?.[2].cwd).not.toContain('/apps/web');
  mocks.readFile.mockResolvedValue('{"version":"2.1.0"}');
  expect(await devServices.version()).toBe('2.1.0');
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  devServices.kill(123);
  expect(kill).toHaveBeenCalledWith(-123, 'SIGTERM');
  kill.mockImplementationOnce(() => {
    throw Object.assign(new Error('gone'), { code: 'ESRCH' });
  });
  devServices.kill(123);
  kill.mockImplementationOnce(() => {
    throw Object.assign(new Error('denied'), { code: 'EPERM' });
  });
  expect(() => devServices.kill(123)).toThrow('denied');
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  devServices.log('ready');
  expect(log).toHaveBeenCalledWith('ready');
  await devServices.delay(1);
});
