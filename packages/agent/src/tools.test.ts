import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import type { ToolExecutionApi } from '@earendil-works/pi-durable';
import { expect, it, vi } from 'vitest';
import { fixture, testCommand, testContext } from './testing/fixtures.ts';

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function activeFixture() {
  let release = (_message: ReturnType<typeof fauxAssistantMessage>) => {};
  const block = new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => {
    release = resolve;
  });
  const test = await fixture([() => block]);
  test.start();
  test.send(testCommand('command-1', '生成音频', testContext));
  await expect.poll(() => test.fake.state.callCount).toBe(1);
  return {
    ...test,
    release: () => release(fauxAssistantMessage('完成')),
    close: async () => {
      release(fauxAssistantMessage('完成'));
      await test.close();
    },
  };
}
function invoke(
  test: Fixture,
  name: string,
  args: unknown,
  id = 9001,
  conversationId = test.runtime.root.id,
) {
  const tool = test.runtime.registry
    .snapshot()
    .tools()
    .find((item) => item.tool.name === name)?.tool;
  assert(tool);
  return tool.execute(args as never, { taskId: id, conversationId } as ToolExecutionApi, BACKGROUND_CONTEXT);
}
const plain = (result: Awaited<ReturnType<typeof invoke>>) =>
  result.content?.map((item) => (item.type === 'text' ? item.text : '')).join('') ?? '';

it('reads current policies and productions, reports safe Markdown and proposes exact immutable draft context', async () => {
  const test = await activeFixture();
  try {
    const read = JSON.parse(plain(await invoke(test, 'read_latest', { productionId: 'p' })));
    expect(read.production.id).toBe('p');
    expect(read.channel.version).toBe(1);
    expect(read.commandContext).toEqual(testContext);
    expect(JSON.parse(plain(await invoke(test, 'read_latest', {}))).production).toBeNull();
    expect(JSON.parse(plain(await invoke(test, 'list_productions', {}))).productions).toHaveLength(1);
    await invoke(test, 'reply', { markdown: '# 回复\nfake-site-key' });
    await invoke(test, 'reply', { markdown: '# 回复\nfake-site-key' });
    expect(test.logs.join()).toContain('[已隐藏]');
    expect(test.logs.join()).not.toContain('fake-site-key');
    await expect(invoke(test, 'reply', { markdown: 'changed' })).rejects.toThrow('内容发生变化');
    test.store.context({ ...testContext, productionId: 'other', pageEpoch: 2 });
    const proposal = JSON.parse(
      plain(await invoke(test, 'propose_draft', { markdown: '# 新稿', summary: '替换正文' })),
    );
    const event = test.store.event(proposal.proposalId);
    expect(event).toMatchObject({ type: 'proposal', proposal: { context: testContext, value: '# 新稿' } });
    expect(plain(await invoke(test, 'inspect_work', { id: 'missing' }))).toBe('null');
    test.store.receipt({ type: 'proposal.ack', id: 'proposal', status: 'stale' });
    expect(plain(await invoke(test, 'inspect_work', { id: 'proposal' }))).toContain('stale');
    await expect(invoke(test, 'retire_conversation', { id: 'missing' })).rejects.toThrow('空闲');
  } finally {
    await test.close();
  }
});

it('rejects writes against dirty drafts, changed policy/version, wrong production and disconnected transport', async () => {
  const test = await activeFixture();
  const args = { productionId: 'p', version: 1, profileVersion: 1, changes: '{"transcript":"new"}' };
  try {
    await expect(invoke(test, 'patch_production', args)).rejects.toThrow('未保存草稿');
    test.store.database
      .prepare('UPDATE commands SET payload=? WHERE id=?')
      .run(
        JSON.stringify(testCommand('command-1', '生成音频', { ...testContext, draft: null })),
        'command-1',
      );
    await expect(invoke(test, 'patch_production', { ...args, productionId: 'other' })).rejects.toThrow(
      '不一致',
    );
    await expect(invoke(test, 'patch_production', { ...args, version: 2 })).rejects.toThrow('节目版本');
    await expect(invoke(test, 'patch_production', { ...args, profileVersion: 2 })).rejects.toThrow('提示词');
    test.transport.ready = false;
    await expect(invoke(test, 'patch_production', args)).rejects.toThrow('未执行');
    test.transport.ready = true;
    await expect(invoke(test, 'patch_production', { ...args, changes: 'invalid' })).rejects.toThrow();
    await expect(invoke(test, 'propose_draft', { markdown: 'text', summary: 'summary' })).rejects.toThrow(
      '固定',
    );
    test.store.database
      .prepare('UPDATE commands SET payload=? WHERE id=?')
      .run(JSON.stringify(testCommand()), 'command-1');
    await expect(invoke(test, 'propose_draft', { markdown: 'text', summary: 'summary' })).rejects.toThrow(
      '固定',
    );
    await expect(invoke(test, 'request_audio', args)).rejects.toThrow('明确');
  } finally {
    await test.close();
  }
});

it('sends canonical patches and approved explicit audio only through idempotent WS operation receipts', async () => {
  const test = await activeFixture();
  const args = { productionId: 'p', version: 1, profileVersion: 1, changes: '{"transcript":"new"}' };
  try {
    test.store.database
      .prepare('UPDATE commands SET payload=? WHERE id=?')
      .run(JSON.stringify(testCommand('command-1', '生成音频')), 'command-1');
    const operation = vi.spyOn(test.transport, 'operation').mockImplementation(async (frame) => {
      const result = {
        type: 'operation.result' as const,
        id: frame.operation.id,
        ok: true,
        status: 200,
        result: {},
      };
      test.store.receipt(result);
      return result;
    });
    expect(plain(await invoke(test, 'patch_production', args, 100))).toContain('200');
    expect(plain(await invoke(test, 'patch_production', args, 100))).toContain('200');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(plain(await invoke(test, 'request_audio', args, 200))).toContain('200');
    expect(plain(await invoke(test, 'request_audio', args, 200))).toContain('200');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(operation.mock.calls[1]?.[0]).toMatchObject({
      type: 'operation',
      operation: { kind: 'audio.request', options: {} },
    });
    const production = await test.client.production('p');
    for (const value of [
      { ...production, approvals: { ...production.approvals, script: null } },
      { ...production, approvals: { ...production.approvals, brief: null } },
      { ...production, stage: 'scripting' },
    ]) {
      vi.spyOn(test.client, 'production').mockResolvedValueOnce(value);
      await expect(invoke(test, 'request_audio', args, 201)).rejects.toThrow('批准');
    }
    test.store.enqueue({
      type: 'operation',
      operation: {
        id: 'operation:300',
        commandId: 'command-1',
        kind: 'production.patch',
        productionId: 'p',
        version: 1,
        changes: {},
      },
    });
    await invoke(test, 'patch_production', { ...args, version: 50 }, 300);
    test.store.enqueue({
      type: 'operation',
      operation: {
        id: 'operation:400',
        commandId: 'command-1',
        kind: 'audio.request',
        productionId: 'p',
        version: 1,
        options: {},
      },
    });
    await invoke(test, 'request_audio', { ...args, version: 50 }, 400);
    expect(operation).toHaveBeenCalledTimes(4);
  } finally {
    await test.close();
  }
});

it('rejects calls without an active command, cancelled commands and invalid delegation choices', async () => {
  const idle = await fixture();
  try {
    await expect(invoke(idle, 'reply', { markdown: 'no command' })).rejects.toThrow('活动');
  } finally {
    await idle.close();
  }
  const test = await activeFixture();
  try {
    await expect(
      invoke(test, 'delegate', { role: 'writer', instructions: 'write', revision: 6 }),
    ).rejects.toThrow('轮数');
    test.decide.mockResolvedValueOnce({ reuse: true, lifetime: 'task', thinkingLevel: 'high' });
    await expect(
      invoke(test, 'delegate', { role: 'writer', instructions: 'write', revision: 1 }),
    ).rejects.toThrow('约束');
    test.decide.mockResolvedValueOnce({ reuse: false, lifetime: 'resident', thinkingLevel: 'high' } as never);
    await expect(
      invoke(test, 'delegate', { role: 'writer', instructions: 'write', revision: 1 }),
    ).rejects.toThrow('约束');
    test.config.executor.thinkingLevels = ['low'];
    await expect(
      invoke(test, 'delegate', { role: 'reviewer', instructions: 'review', revision: 1 }),
    ).rejects.toThrow('约束');
    test.store.state('command-1', 'cancelled', 'cancelled', 'cancel');
    await expect(invoke(test, 'reply', { markdown: 'late' })).rejects.toThrow('取消');
    await expect(invoke(test, 'submit_result', { markdown: 'unassigned' })).rejects.toThrow('活动');
  } finally {
    await test.close();
  }
});

it('freezes assignment plans, reuses only idle compatible residents and retires them without root tools', async () => {
  const test = await activeFixture();
  try {
    test.fake.setResponses([
      fauxAssistantMessage([fauxToolCall('submit_result', { markdown: '# 审校结果' })], {
        stopReason: 'toolUse',
      }),
    ]);
    test.decide.mockResolvedValue({ reuse: false, lifetime: 'resident', thinkingLevel: 'high' } as never);
    const first = JSON.parse(
      plain(
        await invoke(
          test,
          'delegate',
          { role: 'reviewer', instructions: 'Review', revision: 1, productionId: 'p' },
          101,
        ),
      ),
    );
    await expect
      .poll(async () => (await test.runtime.work()).assignments[first.assignmentId]?.status)
      .toBe('complete');
    const work = await test.runtime.work();
    const assignment = work.assignments[first.assignmentId];
    assert(assignment);
    expect(assignment.plan).toEqual({ reuse: false, lifetime: 'resident', thinkingLevel: 'high' });
    expect(assignment.profileVersion).toBe(1);
    expect(JSON.parse(assignment.input).production.id).toBe('p');
    expect(plain(await invoke(test, 'inspect_work', { id: first.assignmentId }))).toContain('# 审校结果');
    expect(
      plain(await invoke(test, 'delegate', { role: 'reviewer', instructions: 'Review', revision: 1 }, 101)),
    ).toContain('complete');
    test.decide.mockResolvedValue({ reuse: true, lifetime: 'resident', thinkingLevel: 'high' } as never);
    test.fake.setResponses([
      fauxAssistantMessage([fauxToolCall('submit_result', { markdown: '# 复审结果' })], {
        stopReason: 'toolUse',
      }),
    ]);
    const second = JSON.parse(
      plain(
        await invoke(test, 'delegate', { role: 'reviewer', instructions: 'Review again', revision: 2 }, 102),
      ),
    );
    await expect
      .poll(async () => (await test.runtime.work()).assignments[second.assignmentId]?.status)
      .toBe('complete');
    expect((await test.runtime.work()).assignments[second.assignmentId]?.conversationId).toBe(
      assignment.conversationId,
    );
    expect(test.decide.mock.calls[1]?.[0].availableResident).toBe(true);
    await invoke(test, 'retire_conversation', { id: String(assignment.conversationId) });
    expect((await test.runtime.work()).conversations[assignment.conversationId]?.retired).toBe(true);
    test.config.runtime.maxRevisionRounds = 2;
    await expect(
      invoke(test, 'delegate', { role: 'reviewer', instructions: 'Again', revision: 1 }, 103),
    ).rejects.toThrow('轮数');
  } finally {
    await test.close();
  }
});

it('limits concurrent work, rejects busy retirement and cancels the execution scope without erasing resident history', async () => {
  const test = await activeFixture();
  let release = () => {};
  const wait = new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => {
    release = () => resolve(fauxAssistantMessage('late output'));
  });
  try {
    test.fake.setResponses([() => wait]);
    test.config.runtime.maxConcurrentAssignments = 1;
    test.decide.mockResolvedValue({ reuse: false, lifetime: 'resident', thinkingLevel: 'high' } as never);
    const args = { role: 'reviewer', instructions: 'Review', revision: 1 };
    const first = JSON.parse(plain(await invoke(test, 'delegate', args, 201)));
    await expect.poll(() => test.fake.state.callCount).toBe(2);
    expect(plain(await invoke(test, 'delegate', args, 201))).toContain('working');
    await expect(invoke(test, 'delegate', args, 202)).rejects.toThrow('并发');
    const assignment = (await test.runtime.work()).assignments[first.assignmentId];
    assert(assignment);
    await expect(
      invoke(test, 'retire_conversation', { id: String(assignment.conversationId) }),
    ).rejects.toThrow('空闲');
    await invoke(test, 'submit_result', { markdown: 'first' }, 203, assignment.conversationId);
    await expect(
      invoke(test, 'submit_result', { markdown: 'second' }, 204, assignment.conversationId),
    ).rejects.toThrow('固定');
    test.store.database.prepare('UPDATE commands SET id=? WHERE id=?').run('other', 'command-1');
    await expect(invoke(test, 'reply', { markdown: 'missing' })).rejects.toThrow('取消');
    test.store.database.prepare('UPDATE commands SET id=? WHERE id=?').run('command-1', 'other');
    const cancel = test.runtime.cancel('command-1');
    release();
    test.release();
    await cancel;
    expect(test.store.command('command-1')?.status).toBe('cancelled');
    expect((await test.runtime.work()).conversations[assignment.conversationId]?.retired).toBe(false);
  } finally {
    release();
    await test.close();
  }
});

it('reuses idle task writers within one command, creates alternatives and retires only at logical completion', async () => {
  const test = await activeFixture();
  const response = () =>
    fauxAssistantMessage([fauxToolCall('submit_result', { markdown: '# 当前稿件' })], {
      stopReason: 'toolUse',
    });
  try {
    test.fake.setResponses([response(), response(), response()]);
    const args = {
      role: 'writer',
      instructions: 'write',
      revision: 1,
      productionId: 'p',
      taskType: 'draft',
      complexity: 'simple',
    };
    await invoke(test, 'delegate', args, 501);
    await expect
      .poll(async () => (await test.runtime.work()).assignments['assignment:501']?.status)
      .toBe('complete');
    const first = (await test.runtime.work()).assignments['assignment:501'];
    assert(first);
    expect((await test.runtime.work()).conversations[first.conversationId]?.retired).toBe(false);
    test.decide.mockResolvedValueOnce({ reuse: true, lifetime: 'task', thinkingLevel: 'medium' });
    await invoke(test, 'delegate', { ...args, revision: 2, taskType: 'revision' }, 502);
    await expect
      .poll(async () => (await test.runtime.work()).assignments['assignment:502']?.status)
      .toBe('complete');
    expect((await test.runtime.work()).assignments['assignment:502']?.conversationId).toBe(
      first.conversationId,
    );
    expect(test.decide.mock.calls[1]?.[0]).toMatchObject({
      availableTask: true,
      taskType: 'revision',
      complexity: 'simple',
      scope: 'production',
    });
    await invoke(test, 'delegate', { ...args, revision: 3 }, 503);
    await expect
      .poll(async () => (await test.runtime.work()).assignments['assignment:503']?.status)
      .toBe('complete');
    expect((await test.runtime.work()).assignments['assignment:503']?.conversationId).not.toBe(
      first.conversationId,
    );
    test.fake.setResponses([
      fauxAssistantMessage('已验收初稿'),
      fauxAssistantMessage('已验收修订'),
      fauxAssistantMessage('全部完成'),
    ]);
    test.release();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    expect(
      Object.values((await test.runtime.work()).conversations).every((conversation) => conversation.retired),
    ).toBe(true);
  } finally {
    await test.close();
  }
});

it('keeps draft proposals waiting until website receipt and does not expose unrelated assignment results', async () => {
  const test = await activeFixture();
  try {
    test.fake.setResponses([fauxAssistantMessage('草稿已应用。')]);
    await invoke(test, 'propose_draft', { markdown: 'updated', summary: 'draft proposal' }, 602);
    test.release();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('waiting');
    test.socket.receive({ type: 'proposal.ack', id: 'proposal:602', status: 'applied' });
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    expect(test.logs).toContain('草稿已应用。');
    test.socket.receive({ type: 'proposal.ack', id: 'proposal:602', status: 'applied' });
    test.socket.receive({ type: 'operation.result', id: 'unknown', ok: true, status: 200, result: {} });
  } finally {
    await test.close();
  }
});

it('holds pending operations until a durable result and forwards an operation completion as host input', async () => {
  const test = await activeFixture();
  try {
    test.fake.setResponses([fauxAssistantMessage('音频任务已提交。')]);
    test.store.enqueue({
      type: 'operation',
      operation: {
        id: 'later',
        commandId: 'command-1',
        kind: 'audio.request',
        productionId: 'p',
        version: 1,
        options: {},
      },
    });
    test.release();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('waiting');
    test.socket.receive({ type: 'operation.result', id: 'later', ok: true, status: 200, result: {} });
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    expect(test.logs).toContain('音频任务已提交。');
  } finally {
    await test.close();
  }
});

it('uses actual native CLI tools in executor environments without website credentials', async () => {
  const test = await activeFixture();
  try {
    test.fake.setResponses([
      fauxAssistantMessage([fauxToolCall('bash', { command: 'printf "native-cli-ok"' })], {
        stopReason: 'toolUse',
      }),
      fauxAssistantMessage([fauxToolCall('submit_result', { markdown: '# native-cli-ok' })], {
        stopReason: 'toolUse',
      }),
    ]);
    await invoke(test, 'delegate', { role: 'writer', instructions: 'Run native CLI.', revision: 1 }, 701);
    await expect
      .poll(async () => (await test.runtime.work()).assignments['assignment:701']?.status)
      .toBe('complete');
    expect((await test.runtime.work()).assignments['assignment:701']?.result).toContain('native-cli-ok');
  } finally {
    await test.close();
  }
});

it('cancels all live work when a reconnect snapshot makes the command terminal', async () => {
  const test = await activeFixture();
  let release = () => {};
  const waiting = new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => {
    release = () => resolve(fauxAssistantMessage('late'));
  });
  try {
    test.fake.setResponses([() => waiting]);
    await invoke(test, 'delegate', { role: 'writer', instructions: 'Write', revision: 1 }, 801);
    await expect.poll(() => test.fake.state.callCount).toBe(2);
    test.store.database.prepare("UPDATE commands SET status='complete' WHERE id='command-1'").run();
    test.transport.emit('terminal', 'command-1');
    release();
    test.release();
    await expect
      .poll(async () => (await test.runtime.work()).assignments['assignment:801']?.status)
      .toBe('cancelled');
    expect(test.store.command('command-1')?.status).toBe('complete');
    test.transport.emit('terminal', 'unknown');
    await test.runtime.pump();
  } finally {
    release();
    await test.close();
  }
});

it('passes actual task complexity and revision intent, expires overdue dispatch and safely rejects foreign results', async () => {
  const test = await activeFixture();
  try {
    test.config.runtime.maxTaskMinutes = 0;
    await invoke(test, 'delegate', { role: 'writer', instructions: 'x'.repeat(5000), revision: 2 }, 901);
    await expect
      .poll(async () => (await test.runtime.work()).assignments['assignment:901']?.status)
      .toBe('failed');
    expect(test.decide.mock.calls[0]?.[0]).toMatchObject({ complexity: 'complex', taskType: 'revision' });
    await invoke(test, 'delegate', { role: 'writer', instructions: 'x'.repeat(800), revision: 3 }, 902);
    await expect
      .poll(async () => (await test.runtime.work()).assignments['assignment:902']?.status)
      .toBe('failed');
    expect(test.decide.mock.calls[1]?.[0]).toMatchObject({ complexity: 'moderate' });
    const family = test.runtime.registry.snapshot().extension('hisfm.coordinator');
    expect(family).toBeDefined();
  } finally {
    await test.close();
  }
});

it('reports absent execution handles as failed durable tasks rather than leaking exceptions', async () => {
  const test = await activeFixture();
  try {
    const original = test.runtime.harness.conversation.bind(test.runtime.harness);
    vi.spyOn(test.runtime.harness, 'conversation').mockImplementation(async (id, context) =>
      id === test.runtime.root.id ? original(id, context) : undefined,
    );
    await invoke(test, 'delegate', { role: 'writer', instructions: 'Write', revision: 1 }, 1001);
    await expect
      .poll(async () => (await test.runtime.work()).assignments['assignment:1001']?.status)
      .toBe('failed');
  } finally {
    await test.close();
  }
});

import assert from 'node:assert/strict';
