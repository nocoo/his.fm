import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxThinking, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { expect, it } from 'vitest';
import { fixture, testCommand } from './testing/fixtures.ts';

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: 'toolUse' });

it('answers an owner command with durable request ID and excludes thinking from visible messages', async () => {
  const test = await fixture([
    fauxAssistantMessage([fauxThinking('private deliberation'), { type: 'text', text: '哥，收到。' }]),
  ]);
  try {
    test.start();
    test.send();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    expect(test.logs).toContain('哥，收到。');
    expect(JSON.stringify(test.socket.frames)).not.toContain('private deliberation');
    test.send();
    await test.runtime.pump();
    expect(test.fake.state.callCount).toBe(1);
    const agent = await test.runtime.root.agent(BACKGROUND_CONTEXT);
    expect(agent.tools.map((tool) => tool.name)).toContain('delegate');
    expect(agent.tools.map((tool) => tool.name)).not.toContain('bash');
  } finally {
    await test.close();
  }
});

it('dispatches a real Pi execution conversation and routes its immutable Markdown result back to root', async () => {
  const test = await fixture([
    call('delegate', { role: 'writer', instructions: 'Write a short script.', revision: 1 }),
    (_context, _options, _state, model) =>
      model.id === 'gpt-6.1-sol'
        ? call('submit_result', { markdown: '# 初稿\n测试逐字稿。' })
        : fauxAssistantMessage('已安排，稍后给你结果。'),
    (_context, _options, _state, model) =>
      model.id === 'gpt-6.1-sol'
        ? call('submit_result', { markdown: '# 初稿\n测试逐字稿。' })
        : fauxAssistantMessage('已安排，稍后给你结果。'),
    fauxAssistantMessage('稿件已完成并核对。'),
  ]);
  try {
    test.start();
    test.send();
    await expect
      .poll(async () => Object.values((await test.runtime.work()).assignments)[0]?.status)
      .toBe('complete');
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    const assignment = Object.values((await test.runtime.work()).assignments)[0];
    expect(assignment?.result).toContain('测试逐字稿');
    expect(test.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'writer',
        revision: 1,
        inputBytes: 21,
        availableResident: false,
      }),
    );
    assert(assignment);
    const conversation = await test.runtime.harness.conversation(
      assignment.conversationId,
      BACKGROUND_CONTEXT,
    );
    assert(conversation);
    expect((await conversation.agent(BACKGROUND_CONTEXT)).tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['bash', 'read', 'write', 'edit', 'submit_result']),
    );
    expect((await conversation.agent(BACKGROUND_CONTEXT)).tools.map((tool) => tool.name)).not.toContain(
      'patch_production',
    );
  } finally {
    await test.close();
  }
});

it('sends explicit reply tools once and serially handles queued owner commands', async () => {
  const test = await fixture([
    call('reply', { markdown: '第一条回复' }),
    fauxAssistantMessage('not duplicated'),
    fauxAssistantMessage('第二条回复'),
  ]);
  try {
    test.start();
    test.send();
    test.send(testCommand('second'));
    await expect.poll(() => test.store.command('second')?.status).toBe('complete');
    expect(test.logs).toEqual(expect.arrayContaining(['第一条回复', '第二条回复']));
    expect(test.logs).not.toContain('not duplicated');
  } finally {
    await test.close();
  }
});

import assert from 'node:assert/strict';
