import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import type { ToolExecutionApi } from '@earendil-works/pi-durable';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { expect, it, vi } from 'vitest';
import { fixture, testCommand, testContext } from './testing/fixtures.ts';
import { acceptWork, successfulResult } from './testing/outcomes.ts';

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

it('accepts inspected criteria and fixed counts, and requires the independent review requested by the owner', async () => {
  const test = await activeFixture();
  const finish = {
    markdown: '验收完成',
    outcome: 'done',
    acceptedAssignmentIds: ['assignment:8001'],
    checks: [] as { assignmentId: string; criterion: string; evidence: string[] }[],
  };
  try {
    test.store.database
      .prepare('UPDATE commands SET payload=? WHERE id=?')
      .run(JSON.stringify(testCommand('command-1', '读取21页并独立审校')), 'command-1');
    test.fake.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall('submit_result', {
            ...successfulResult('21页摘要'),
            criteria: { required: 21, met: 21 },
          }),
        ],
        { stopReason: 'toolUse' },
      ),
    ]);
    await invoke(
      test,
      'delegate',
      {
        role: 'writer',
        instructions: 'Retrieve pages',
        requiredCriteria: ['21 pages'],
        requiredCount: 21,
        revision: 1,
      },
      8001,
    );
    await expect
      .poll(async () => (await test.runtime.work()).assignments['assignment:8001']?.status)
      .toBe('complete');
    await expect(invoke(test, 'finish_command', finish)).rejects.toThrow('inspect_work');
    await invoke(test, 'inspect_work', { id: 'assignment:8001' });
    await expect(invoke(test, 'finish_command', finish)).rejects.toThrow('验收标准');
    finish.checks = [
      { assignmentId: 'assignment:8001', criterion: '21 pages', evidence: ['Invented evidence'] },
    ];
    await expect(invoke(test, 'finish_command', finish)).rejects.toThrow('验收标准');
    finish.checks = [
      { assignmentId: 'assignment:8001', criterion: '21 pages', evidence: ['Verified test deliverable'] },
    ];
    await expect(invoke(test, 'finish_command', finish)).rejects.toThrow('独立审校');
    test.fake.setResponses([
      fauxAssistantMessage([fauxToolCall('submit_result', successfulResult('独立复核通过'))], {
        stopReason: 'toolUse',
      }),
    ]);
    await invoke(test, 'delegate', { role: 'reviewer', instructions: 'Review all facts', revision: 1 }, 8002);
    await expect
      .poll(async () => (await test.runtime.work()).assignments['assignment:8002']?.status)
      .toBe('complete');
    await invoke(test, 'inspect_work', { id: 'assignment:8002' });
    finish.acceptedAssignmentIds.push('assignment:8002');
    finish.checks.push({
      assignmentId: 'assignment:8002',
      criterion: 'Review all facts',
      evidence: ['Verified test deliverable'],
    });
    expect(plain(await invoke(test, 'finish_command', finish))).toContain('done');
    const assignments = Object.values((await test.runtime.work()).assignments);
    expect(assignments[0]?.conversationId).not.toBe(assignments[1]?.conversationId);
  } finally {
    await test.close();
  }
});

it('rejects unproven counts, altered outcomes and acceptance while work is still running', async () => {
  const test = await activeFixture();
  let release = () => {};
  const blocked = new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => {
    release = () => resolve(fauxAssistantMessage('paused'));
  });
  try {
    test.fake.setResponses([() => blocked]);
    await invoke(
      test,
      'delegate',
      { role: 'writer', instructions: 'Retrieve 21 pages', requiredCount: 21, revision: 1 },
      8101,
    );
    await expect.poll(() => test.fake.state.callCount).toBe(2);
    const assignment = (await test.runtime.work()).assignments['assignment:8101'];
    assert(assignment);
    const submit = (args: unknown) => invoke(test, 'submit_result', args, 8102, assignment.conversationId);
    await expect(
      invoke(test, 'finish_command', {
        markdown: 'done',
        outcome: 'done',
        acceptedAssignmentIds: [],
        checks: [],
      }),
    ).rejects.toThrow('仍在运行');
    await expect(submit({ ...successfulResult('report'), evidence: [] })).rejects.toThrow('证据');
    await expect(
      submit({ ...successfulResult('report'), criteria: { required: 21, met: 0 } }),
    ).rejects.toThrow('验收数量');
    await expect(submit(successfulResult('report'))).rejects.toThrow('固定');
    await expect(
      submit({ ...successfulResult('report'), criteria: { required: 1, met: 21 } }),
    ).rejects.toThrow('固定');
    const result = {
      markdown: 'fake-site-key blocked',
      outcome: 'blocked',
      evidence: ['fake-model-key'],
      criteria: { required: 21, met: 0 },
    };
    await submit(result);
    await submit(result);
    await expect(submit({ ...result, outcome: 'needs_input' })).rejects.toThrow('固定');
    expect((await test.runtime.work()).assignments['assignment:8101']).toMatchObject({
      result: '[已隐藏] blocked',
      outcome: { status: 'blocked', evidence: ['[已隐藏]'] },
    });
  } finally {
    release();
    await test.close();
  }
});

it('checks every durable website receipt and distinguishes unfinished outcomes from success', async () => {
  const test = await activeFixture();
  const finish = { markdown: '完成', outcome: 'done', acceptedAssignmentIds: [], checks: [] };
  try {
    await expect(
      invoke(test, 'finish_command', { ...finish, acceptedAssignmentIds: ['foreign'] }),
    ).rejects.toThrow('当前指令');
    await invoke(test, 'propose_draft', { markdown: 'changed', summary: 'edit' }, 8201);
    await expect(invoke(test, 'finish_command', finish)).rejects.toThrow('等待回执');
    test.store.receipt({ type: 'proposal.ack', id: 'proposal:8201', status: 'stale' });
    await expect(invoke(test, 'finish_command', finish)).rejects.toThrow('未确认');
    test.store.database.prepare('DELETE FROM receipts WHERE id=?').run('proposal:8201');
    test.store.receipt({ type: 'proposal.ack', id: 'proposal:8201', status: 'applied' });
    test.store.enqueue({
      type: 'operation',
      operation: {
        id: 'operation:8202',
        commandId: 'command-1',
        kind: 'production.patch',
        productionId: 'p',
        version: 1,
        changes: {},
      },
    });
    test.store.receipt({
      type: 'operation.result',
      id: 'operation:8202',
      ok: false,
      status: 409,
      result: { error: 'conflict' },
    });
    await expect(invoke(test, 'finish_command', finish)).rejects.toThrow('未确认');
    expect(plain(await invoke(test, 'finish_command', { ...finish, outcome: 'blocked' }))).toContain(
      'blocked',
    );
  } finally {
    await test.close();
  }
});

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
    await expect(invoke(test, 'submit_result', successfulResult('unassigned'))).rejects.toThrow('活动');
  } finally {
    await test.close();
  }
});

it('freezes assignment plans, reuses only idle compatible residents and retires them without root tools', async () => {
  const test = await activeFixture();
  try {
    test.fake.setResponses([
      fauxAssistantMessage([fauxToolCall('submit_result', successfulResult('# 审校结果'))], {
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
      fauxAssistantMessage([fauxToolCall('submit_result', successfulResult('# 复审结果'))], {
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
    await invoke(test, 'submit_result', successfulResult('first'), 203, assignment.conversationId);
    await expect(
      invoke(test, 'submit_result', successfulResult('second'), 204, assignment.conversationId),
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

it('reuses idle task writers within one command and keeps production-scoped writers available after completion', async () => {
  const test = await activeFixture();
  const response = () =>
    fauxAssistantMessage([fauxToolCall('submit_result', successfulResult('# 当前稿件'))], {
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
    test.fake.setResponses(acceptWork(test));
    test.release();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    expect(
      Object.values((await test.runtime.work()).conversations).every((conversation) => !conversation.retired),
    ).toBe(true);
  } finally {
    await test.close();
  }
});

it('keeps draft proposals waiting until website receipt and does not expose unrelated assignment results', async () => {
  const test = await activeFixture();
  try {
    test.fake.setResponses(acceptWork(test, '草稿已应用。'));
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
    test.fake.setResponses(acceptWork(test, '音频任务已提交。'));
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
      fauxAssistantMessage([fauxToolCall('submit_result', successfulResult('# native-cli-ok'))], {
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

it('creates an unscoped production draft and reuses stored receipts and pending operations before any effects', async () => {
  const test = await activeFixture();
  const args = {
    profileVersion: 1,
    brief: JSON.stringify({
      title: '新一期',
      slug: 'new-episode',
      episodeNumber: 7,
      sources: [{ id: 'source-7', type: 'text', title: '素材', content: '事实' }],
    }),
  };
  try {
    await expect(invoke(test, 'create_production', args, 1101)).rejects.toThrow('已有节目目标');
    test.store.database
      .prepare('UPDATE commands SET payload=? WHERE id=?')
      .run(JSON.stringify(testCommand()), 'command-1');
    test.transport.ready = false;
    await expect(invoke(test, 'create_production', args, 1101)).rejects.toThrow('未执行');
    test.transport.ready = true;
    await expect(invoke(test, 'create_production', { ...args, profileVersion: 2 }, 1101)).rejects.toThrow(
      '提示词',
    );
    await expect(invoke(test, 'create_production', { ...args, brief: 'null' }, 1101)).rejects.toThrow();
    const operation = vi.spyOn(test.transport, 'operation').mockImplementation(async (frame) => {
      const result = {
        type: 'operation.result' as const,
        id: frame.operation.id,
        ok: true,
        status: 201,
        result: { production: { id: 'new-production' } },
      };
      test.store.receipt(result);
      return result;
    });
    expect(plain(await invoke(test, 'create_production', args, 1101))).toContain('new-production');
    expect(operation.mock.calls[0]?.[0]).toMatchObject({
      type: 'operation',
      operation: { kind: 'production.create', commandId: 'command-1', brief: JSON.parse(args.brief) },
    });
    test.channel.version = 3;
    await invoke(test, 'create_production', args, 1101);
    expect(operation).toHaveBeenCalledOnce();
    test.store.enqueue({
      type: 'operation',
      operation: {
        id: 'operation:1102',
        commandId: 'command-1',
        kind: 'production.create',
        brief: JSON.parse(args.brief),
      },
    });
    await invoke(test, 'create_production', args, 1102);
    expect(operation).toHaveBeenCalledTimes(2);
  } finally {
    await test.close();
  }
});

it('allows only three human-review submission actions with strict target, version and policy guards', async () => {
  const test = await activeFixture();
  const args = { productionId: 'p', version: 1, profileVersion: 1, action: 'submit_brief' };
  try {
    await expect(invoke(test, 'submit_for_review', args, 1201)).rejects.toThrow('未保存');
    test.store.database
      .prepare('UPDATE commands SET payload=? WHERE id=?')
      .run(
        JSON.stringify(testCommand('command-1', '提交审阅', { ...testContext, draft: null })),
        'command-1',
      );
    await expect(invoke(test, 'submit_for_review', { ...args, productionId: 'other' }, 1201)).rejects.toThrow(
      '不一致',
    );
    await expect(invoke(test, 'submit_for_review', { ...args, version: 2 }, 1201)).rejects.toThrow(
      '节目版本',
    );
    await expect(invoke(test, 'submit_for_review', { ...args, profileVersion: 2 }, 1201)).rejects.toThrow(
      '提示词',
    );
    await expect(
      invoke(test, 'submit_for_review', { ...args, action: 'approve_brief' }, 1201),
    ).rejects.toThrow();
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
    for (const [index, action] of ['submit_brief', 'submit_script', 'submit_final'].entries())
      await invoke(test, 'submit_for_review', { ...args, action }, 1201 + index);
    expect(
      operation.mock.calls.map(
        ([frame]) => frame.operation.kind === 'production.action' && frame.operation.action,
      ),
    ).toEqual(['submit_brief', 'submit_script', 'submit_final']);
    await invoke(test, 'submit_for_review', { ...args, version: 99 }, 1201);
    expect(operation).toHaveBeenCalledTimes(3);
    test.store.enqueue({
      type: 'operation',
      operation: {
        id: 'operation:1204',
        commandId: 'command-1',
        kind: 'production.action',
        productionId: 'p',
        version: 1,
        action: 'submit_brief',
      },
    });
    await invoke(test, 'submit_for_review', { ...args, version: 99 }, 1204);
    expect(operation).toHaveBeenCalledTimes(4);
    test.store.database
      .prepare('UPDATE commands SET payload=? WHERE id=?')
      .run(JSON.stringify(testCommand()), 'command-1');
    await expect(invoke(test, 'submit_for_review', args, 1205)).rejects.toThrow('目标节目');
    test.store.enqueue({
      type: 'operation',
      operation: {
        id: 'created',
        commandId: 'command-1',
        kind: 'production.create',
        brief: { title: 'new' },
      },
    });
    test.store.receipt({
      type: 'operation.result',
      id: 'created',
      ok: true,
      status: 201,
      result: { production: { id: 'p' } },
    });
    await invoke(test, 'submit_for_review', args, 1205);
    expect(operation).toHaveBeenCalledTimes(5);
    await expect(
      invoke(test, 'submit_for_review', { ...args, productionId: 'not-created' }, 1206),
    ).rejects.toThrow('目标节目');
  } finally {
    await test.close();
  }
});

it('blocks only overlapping dirty fields and keeps unrelated source additions available', async () => {
  const test = await activeFixture();
  const args = { productionId: 'p', version: 1, profileVersion: 1 };
  let sequence = 1300;
  const patch = (changes: unknown) =>
    invoke(test, 'patch_production', { ...args, changes: JSON.stringify(changes) }, sequence++);
  const page = (context: typeof testContext) =>
    test.store.database
      .prepare('UPDATE commands SET payload=? WHERE id=?')
      .run(JSON.stringify(testCommand('command-1', '修改字段', context)), 'command-1');
  try {
    const operation = vi
      .spyOn(test.transport, 'operation')
      .mockResolvedValue({ pending: true, id: 'pending' });
    page({ ...testContext, field: { productionId: 'p', field: 'intent' } });
    await patch({ sources: [{ id: 'new', title: 'source' }] });
    await patch({ intent: 'old' });
    await expect(patch({ intent: 'new' })).rejects.toThrow('未保存');
    page({ ...testContext, field: null });
    await patch({ transcript: 'new' });
    page({ ...testContext, draft: { revision: 1, value: 'old', baseValue: 'old' } });
    await patch({ transcript: 'new' });
    page({
      ...testContext,
      sourceId: 's',
      field: { productionId: 'p', field: 'source.content', sourceId: 's' },
    });
    await patch({ intent: 'other' });
    await patch({ sources: [null, 'bad', {}, { id: 'other', content: 'new' }, { id: 's', content: 'old' }] });
    await expect(patch({ sources: [{ id: 's', content: 'changed' }] })).rejects.toThrow('未保存');
    await expect(patch({ sources: [] })).rejects.toThrow('未保存');
    await expect(patch({ sources: 'invalid' })).rejects.toThrow('未保存');
    expect(operation).toHaveBeenCalledTimes(6);
  } finally {
    await test.close();
  }
});

it('does not acknowledge cancellation until root and child abort plus execution environment cleanup finish', async () => {
  const test = await activeFixture();
  let releaseWorker = () => {};
  const worker = new Promise<ReturnType<typeof fauxAssistantMessage>>((resolve) => {
    releaseWorker = () => resolve(fauxAssistantMessage('late worker'));
  });
  let releaseCleanup = () => {};
  const cleanupGate = new Promise<void>((resolve) => {
    releaseCleanup = resolve;
  });
  const cleanup = vi
    .spyOn(NodeExecutionEnv.prototype, 'cleanup')
    .mockImplementationOnce(async () => cleanupGate);
  try {
    test.fake.setResponses([() => worker]);
    await invoke(test, 'delegate', { role: 'writer', instructions: 'Write', revision: 1 }, 1401);
    await expect.poll(() => test.fake.state.callCount).toBe(2);
    const cancel = test.runtime.cancel('command-1');
    expect(test.runtime.cancel('command-1')).toBe(cancel);
    expect(test.store.command('command-1')?.status).toBe('waiting');
    expect(test.store.event('cancelling:command-1')).toMatchObject({
      status: 'waiting',
      detail: expect.stringContaining('正在停止'),
    });
    expect(test.store.event('cancelled:command-1')).toBeNull();
    expect(test.store.next()).toBeNull();
    await expect(invoke(test, 'reply', { markdown: 'late' })).rejects.toThrow('取消');
    test.release();
    releaseWorker();
    await expect.poll(() => cleanup.mock.calls.length).toBe(1);
    expect(test.store.event('cancelled:command-1')).toBeNull();
    releaseCleanup();
    await cancel;
    expect(test.store.event('cancelled:command-1')).toMatchObject({ status: 'cancelled' });
    await test.runtime.cancel('command-1');
    expect(test.store.command('command-1')?.status).toBe('cancelled');
  } finally {
    releaseCleanup();
    releaseWorker();
    cleanup.mockRestore();
    await test.close();
  }
});

it('retains pending cancellation on abort failure and recovers it without resubmitting the model', async () => {
  const test = await activeFixture();
  try {
    const abort = vi
      .spyOn(test.runtime.root, 'abort')
      .mockRejectedValueOnce(new Error('private abort error'));
    await expect(test.runtime.cancel('command-1')).rejects.toThrow('private abort error');
    expect(test.store.command('command-1')?.status).toBe('waiting');
    expect(test.store.pendingCancellations()).toEqual(['command-1']);
    expect(test.store.event('cancelled:command-1')).toBeNull();
    abort.mockRestore();
    test.release();
    await test.runtime.pump();
    await test.runtime.pump();
    await expect.poll(() => test.store.command('command-1')?.status).toBe('cancelled');
    expect(test.fake.state.callCount).toBe(1);
  } finally {
    await test.close();
  }
});

it('waits for an in-flight allocation before confirming stop and never dispatches its cancelled assignment', async () => {
  const test = await activeFixture();
  let releaseDecision = () => {};
  const decision = new Promise<{ reuse: false; lifetime: 'task'; thinkingLevel: 'high' }>((resolve) => {
    releaseDecision = () => resolve({ reuse: false, lifetime: 'task', thinkingLevel: 'high' });
  });
  try {
    test.decide.mockImplementationOnce(() => decision);
    const dispatch = invoke(test, 'delegate', { role: 'writer', instructions: 'Write', revision: 1 }, 1501);
    const rejected = expect(dispatch).rejects.toThrow('取消');
    await expect.poll(() => test.decide.mock.calls.length).toBe(1);
    const cancel = test.runtime.cancel('command-1');
    test.release();
    expect(test.store.event('cancelled:command-1')).toBeNull();
    releaseDecision();
    await rejected;
    await cancel;
    expect(test.store.command('command-1')?.status).toBe('cancelled');
    expect(Object.keys((await test.runtime.work()).assignments)).toHaveLength(0);
    expect(test.fake.state.callCount).toBe(1);
  } finally {
    releaseDecision();
    await test.close();
  }
});

it('matches server textual audio authorization and rejects negation, preview and unsupported shortcuts', async () => {
  const test = await activeFixture();
  const operation = vi.spyOn(test.transport, 'operation').mockResolvedValue({ pending: true, id: 'audio' });
  let id = 1600;
  const audio = (text: string) => {
    test.store.database
      .prepare('UPDATE commands SET payload=? WHERE id=?')
      .run(JSON.stringify(testCommand('command-1', text, { ...testContext, draft: null })), 'command-1');
    return invoke(test, 'request_audio', { productionId: 'p', version: 1, profileVersion: 1 }, id++);
  };
  try {
    for (const text of [
      '请为本期生成音频',
      '制作配音',
      '重录这期录音',
      'Generate the narration',
      'create voiceover',
      'synthesize audio',
    ])
      await audio(text);
    for (const text of [
      '不要生成音频',
      '请生成音频预览',
      '只试听音频',
      '先不生成音频',
      'do not generate audio',
      "don't create voiceover",
      'never record audio',
      'preview narration',
      '/audio',
      '继续',
    ])
      await expect(audio(text)).rejects.toThrow('明确');
    expect(operation).toHaveBeenCalledTimes(6);
  } finally {
    operation.mockRestore();
    await test.close();
  }
});
