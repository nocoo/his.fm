import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { devServices, runDevelopment, startDevelopment } from './dev.ts';
import { testConfig } from './testing/fixtures.ts';

function fixture() {
  const config = testConfig();
  config.websites.local.baseUrl = 'http://127.0.0.1:7056';
  const children: ChildProcess[] = [];
  const services = {
    ...devServices,
    loadConfig: vi.fn(async () => config),
    version: vi.fn(async () => '2.1.0'),
    log: vi.fn(),
    fetch: vi.fn<typeof fetch>(),
    spawn: vi.fn(() => {
      const child = Object.assign(new EventEmitter(), {
        pid: 100 + children.length,
        exitCode: null,
      }) as ChildProcess;
      children.push(child);
      return child;
    }),
    kill: vi.fn(),
    delay: vi.fn(async () => {}),
  };
  return { services, config, children };
}
const healthy = () => Response.json({ service: 'his.fm', version: '2.1.0', status: 'ok' });
const login = () => new Response(null, { headers: { 'set-cookie': 'session=fake; HttpOnly' } });
it('reuses local website and agent without stopping processes it does not own', async () => {
  const { services } = fixture();
  services.fetch
    .mockResolvedValueOnce(healthy())
    .mockResolvedValueOnce(login())
    .mockResolvedValueOnce(Response.json({ online: true }));
  const handle = await startDevelopment(services);
  handle.close();
  handle.close();
  expect(services.spawn).not.toHaveBeenCalled();
  expect(services.kill).not.toHaveBeenCalled();
  expect(services.log).toHaveBeenCalledWith(expect.stringContaining('复用当前 Local'));
});
it('starts a local website and coordinator after readiness, then terminates only child groups', async () => {
  const { services, children } = fixture();
  services.fetch
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('starting'))
    .mockResolvedValueOnce(healthy())
    .mockResolvedValueOnce(login())
    .mockResolvedValueOnce(Response.json({ online: false }))
    .mockResolvedValueOnce(Response.json({ online: true }));
  const handle = await startDevelopment(services);
  expect(services.spawn.mock.calls).toHaveLength(2);
  expect(services.spawn).toHaveBeenNthCalledWith(1, ['scripts/dev.mjs']);
  expect(services.spawn).toHaveBeenNthCalledWith(2, [
    '--experimental-strip-types',
    'packages/agent/src/cli.ts',
    'start',
    '--environment',
    'local',
  ]);
  children[1]?.emit('exit', 1);
  handle.close();
  expect(services.kill.mock.calls).toEqual([[100], [101]]);
});
it('rejects production endpoints, occupied services, invalid login and missing runtime API', async () => {
  const test = fixture();
  test.config.websites.local.baseUrl = 'http://127.0.0.1:9999';
  await expect(startDevelopment(test.services)).rejects.toThrow('7056');
  const occupied = fixture();
  occupied.services.fetch.mockResolvedValueOnce(Response.json({ service: 'another' }));
  await expect(startDevelopment(occupied.services)).rejects.toThrow('占用');
  const unavailable = fixture();
  unavailable.services.fetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(startDevelopment(unavailable.services)).rejects.toThrow('未就绪');
  const invalid = fixture();
  invalid.services.fetch
    .mockResolvedValueOnce(healthy())
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(startDevelopment(invalid.services)).rejects.toThrow('登录失败');
  const noCookie = fixture();
  noCookie.services.fetch.mockResolvedValueOnce(healthy()).mockResolvedValueOnce(new Response(null));
  await expect(startDevelopment(noCookie.services)).rejects.toThrow('缺少会话');
  const noHub = fixture();
  noHub.services.fetch
    .mockResolvedValueOnce(healthy())
    .mockResolvedValueOnce(login())
    .mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(startDevelopment(noHub.services)).rejects.toThrow('未就绪');
});
it('bounds startup waiting and cleans failed child startup', async () => {
  const { services } = fixture();
  services.fetch.mockRejectedValue(new Error('offline'));
  await expect(startDevelopment(services)).rejects.toThrow('期限');
  expect(services.delay).toHaveBeenCalledTimes(60);
  expect(services.kill).toHaveBeenCalledWith(100);
  const broken = fixture();
  broken.services.fetch.mockRejectedValue(new Error('offline'));
  broken.services.delay.mockImplementation(async () => {
    broken.children[0]?.emit('error', new Error('child failed'));
  });
  await expect(startDevelopment(broken.services)).rejects.toThrow('期限');
  expect(broken.services.delay).toHaveBeenCalledOnce();
});

it('waits for a real agent connection and fails a timed-out binding instead of claiming ready', async () => {
  const { services } = fixture();
  services.fetch
    .mockResolvedValueOnce(healthy())
    .mockResolvedValueOnce(login())
    .mockImplementation(async () => Response.json({ online: false }));
  await expect(startDevelopment(services)).rejects.toThrow('主控未能连接');
  expect(services.delay).toHaveBeenCalledTimes(40);
  expect(services.kill).toHaveBeenCalledWith(100);
});

it('wires and reports development startup without exposing runtime secrets', async () => {
  const host = new EventEmitter() as typeof process;
  const close = vi.fn();
  const start = vi.fn(async () => ({ close, children: [] }));
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await runDevelopment(start, host);
    host.emit('SIGINT');
    host.emit('SIGTERM');
    expect(close).toHaveBeenCalledTimes(2);
    start.mockRejectedValueOnce(new Error('private'));
    await runDevelopment(start, host);
    expect(host.exitCode).toBe(1);
    expect(error).not.toHaveBeenCalledWith('private');
  } finally {
    error.mockRestore();
  }
});
