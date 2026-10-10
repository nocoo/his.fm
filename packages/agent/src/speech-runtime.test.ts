import { assistantMessage, testHost, toolCall } from '@frogie/core/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { fixture, testCommand } from './testing/fixtures.ts';
import { acceptWork, successfulResult } from './testing/outcomes.ts';

const execute = vi.hoisted(() => vi.fn());
vi.mock('./speech-job.ts', () => ({ runSpeechJob: execute }));
const call = (name: string, args: Parameters<typeof toolCall>[1]) =>
  assistantMessage([toolCall(name, args)], { stopReason: 'toolUse' });
afterEach(() => {
  execute.mockReset();
  vi.unstubAllEnvs();
});
it('delegates speech to a restricted conversation and requires a successful website receipt', async () => {
  vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7890');
  vi.stubEnv('https_proxy', '');
  vi.stubEnv('NODE_USE_ENV_PROXY', '1');
  const test = await fixture([]);
  const command = testCommand('speech:job:attempt', 'Execute speechJobId=job');
  command.context = null;
  execute.mockResolvedValue({ complete: true, result: { url: '/media/test.wav' } });
  let root = 0;
  let child = 0;
  const acceptance = acceptWork(test);
  test.fake.setResponses(
    Array.from({ length: 16 }, () => async (_transcript, _options, _state, model) => {
      if (model.id === 'gpt-6.1-sol') {
        child++;
        if (child === 1) return call('generate_speech', { jobId: 'wrong' });
        if (child === 2) return call('generate_speech', { jobId: 'job' });
        return call('submit_result', successfulResult('Generated audio; successful website receipt.'));
      }
      root++;
      if (root === 1)
        return call('delegate', {
          role: 'speech',
          instructions: 'Execute speechJobId=job using generate_speech and report the website receipt.',
          revision: 1,
        });
      const assignment = Object.values((await test.runtime.work()).assignments)[0];
      if (assignment?.status !== 'complete') return assistantMessage('正在生成。');
      const response = acceptance.shift();
      return response ? response() : assistantMessage('已完成');
    }),
  );
  try {
    test.start();
    test.send(command);
    await expect.poll(() => test.store.command(command.id)?.status).toBe('complete');
    expect(execute).toHaveBeenCalledTimes(1);
    const assignment = Object.values((await test.runtime.work()).assignments)[0];
    assert(assignment);
    expect(JSON.parse(assignment.input).network).toMatchObject({
      httpsProxy: 'http://127.0.0.1:7890',
      nodeEnvProxyEnabled: true,
    });
    expect(JSON.parse(assignment.input).network.guidance).toContain('回环');
    const agent = await testHost(test.runtime.host).agent(assignment.conversationId);
    expect(agent.tools.map((tool) => tool.name)).toEqual(['generate_speech', 'submit_result']);
    expect(test.store.get(`speech-receipt:${command.id}`)).toMatchObject({ complete: true });
    expect(JSON.stringify(test.socket.frames)).not.toContain('speechKeys');
  } finally {
    await test.close();
  }
});
it('does not accept speech completion without a receipt', async () => {
  const test = await fixture([
    call('finish_command', { outcome: 'done', markdown: 'Done', acceptedAssignmentIds: [], checks: [] }),
    assistantMessage('无法确认完成。'),
  ]);
  const command = testCommand('speech:missing:attempt', 'Execute speechJobId=missing');
  command.context = null;
  try {
    test.start();
    test.send(command);
    await expect.poll(() => test.store.command(command.id)?.status).toBe('waiting');
    expect(test.store.get(`finish:${command.id}`)).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await test.close();
  }
});

import assert from 'node:assert/strict';
