import { createServer } from 'node:http';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxThinking, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { expect, it } from 'vitest';
import { EXECUTOR_CAPABILITIES, ROOT_POLICY, WORK_POLICY } from './prompts.ts';
import { fixture, testCommand } from './testing/fixtures.ts';
import { acceptWork, successfulResult } from './testing/outcomes.ts';

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
    call('delegate', {
      role: 'writer',
      instructions: 'Write a short script.',
      revision: 1,
      productionId: 'p',
    }),
    (_context, _options, _state, model) =>
      model.id === 'gpt-6.1-sol'
        ? call('submit_result', successfulResult('# 初稿\n测试逐字稿。'))
        : fauxAssistantMessage('已安排，稍后给你结果。'),
    (_context, _options, _state, model) =>
      model.id === 'gpt-6.1-sol'
        ? call('submit_result', successfulResult('# 初稿\n测试逐字稿。'))
        : fauxAssistantMessage('已安排，稍后给你结果。'),
  ]);
  test.fake.appendResponses(acceptWork(test, '稿件已完成并核对。'));
  try {
    test.start();
    test.send();
    await expect
      .poll(async () => Object.values((await test.runtime.work()).assignments)[0]?.status)
      .toBe('complete');
    await expect.poll(() => test.store.command('command-1')?.status).toBe('complete');
    const assignment = Object.values((await test.runtime.work()).assignments)[0];
    expect(assignment?.result).toContain('测试逐字稿');
    expect(JSON.parse(assignment?.input ?? '{}')).toMatchObject({
      channel: test.channel,
      category: test.production.categoryProfile,
    });
    expect((assignment?.input ?? '').indexOf('"channel":')).toBeLessThan(
      (assignment?.input ?? '').indexOf('"category":'),
    );
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

it('scopes a prior CLI prohibition to its smoke command and retrieves 21 sources using actual executor bash', async () => {
  const fetched: string[] = [];
  const server = createServer((request, response) => {
    fetched.push(request.url ?? '');
    response.end(`Source evidence ${request.url}\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const test = await fixture([fauxAssistantMessage('冒烟测试收到。')]);
  try {
    test.start();
    test.send(testCommand('smoke', '这次冒烟测试禁止本机命令和网络访问，只回复收到。'));
    await expect.poll(() => test.store.command('smoke')?.status).toBe('complete');
    const owner = testCommand('research', '读取21个页面，提供可核验摘要。');
    let rootTurns = 0;
    let workerTurns = 0;
    const acceptance = acceptWork(test);
    test.fake.setResponses(
      Array.from({ length: 10 }, () => async (transcript, _options, _state, model) => {
        if (model.id === 'gpt-6.1-sol') {
          workerTurns += 1;
          if (workerTurns === 1) {
            expect(JSON.stringify(transcript)).toContain('ownerCommand');
            expect(JSON.stringify(transcript)).not.toContain('禁止本机命令');
            return call('bash', {
              command: `command -v curl; for page in $(seq 1 21); do curl --fail --silent http://127.0.0.1:${address.port}/source-$page; done`,
            });
          }
          expect(JSON.stringify(transcript)).toContain('Source evidence /source-21');
          return call('submit_result', {
            ...successfulResult('# 来源摘要\n已读取21页并核对。'),
            criteria: { required: 21, met: 21 },
          });
        }
        rootTurns += 1;
        if (rootTurns === 1)
          return call('delegate', {
            role: 'writer',
            instructions: 'Retrieve pages and summarize their content.',
            requiredCriteria: ['Retrieve 21 pages and summarize'],
            requiredCount: 21,
            revision: 1,
            taskType: 'research',
          });
        const assignments = Object.values((await test.runtime.work()).assignments);
        if (assignments[0]?.status !== 'complete') return fauxAssistantMessage('正在读取来源。');
        const response = acceptance.shift();
        assert(response);
        return response();
      }),
    );
    test.send(owner);
    await expect.poll(() => test.store.command('research')?.status).toBe('complete');
    expect(fetched).toHaveLength(21);
    const assignment = Object.values((await test.runtime.work()).assignments)[0];
    assert(assignment);
    expect(JSON.parse(assignment.input)).toMatchObject({
      ownerCommand: owner,
      capabilities: { tools: ['read', 'write', 'edit', 'bash', 'submit_result'] },
      requiredCount: 21,
    });
    expect((await test.runtime.root.agent(BACKGROUND_CONTEXT)).instructions).not.toContain('禁止本机命令');
    expect(assignment.outcome).toMatchObject({ status: 'done', criteria: { required: 21, met: 21 } });
  } finally {
    await test.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it.each(['blocked', 'needs_input'] as const)(
  'keeps a %s Markdown report separate from successful work',
  async (outcome) => {
    const result = (_context: unknown, _options: unknown, _state: unknown, model: { id: string }) =>
      model.id === 'gpt-6.1-sol'
        ? call('submit_result', {
            markdown: '# 调研报告\n已读取0页，需要可访问的来源。',
            outcome,
            evidence: [],
            criteria: { required: 21, met: 0 },
          })
        : fauxAssistantMessage('等待调研结果。');
    const test = await fixture([
      call('delegate', { role: 'writer', instructions: 'Retrieve 21 pages', requiredCount: 21, revision: 1 }),
      result,
      result,
      call('finish_command', { outcome: 'done', markdown: '已完成', acceptedAssignmentIds: [], checks: [] }),
      call('finish_command', {
        outcome,
        markdown: '目标尚未完成，需要可访问来源。',
        acceptedAssignmentIds: [],
        checks: [],
      }),
    ]);
    try {
      test.start();
      test.send();
      await expect.poll(() => test.store.get('finish:command-1')).toMatchObject({ outcome });
      await expect
        .poll(() => test.store.command('command-1')?.status)
        .toBe(outcome === 'blocked' ? 'failed' : 'waiting');
      expect(Object.values((await test.runtime.work()).assignments)[0]).toMatchObject({
        status: 'complete',
        outcome: { status: outcome },
      });
      expect(test.socket.frames).not.toContainEqual(
        expect.objectContaining({ type: 'command.state', status: 'complete' }),
      );
    } finally {
      await test.close();
    }
  },
);

it.each(['writer', 'reviewer'] as const)(
  'gives a %s native file processing and verification tools for a non-research outcome',
  async (role) => {
    const test = await fixture();
    const owner = testCommand('process-data', '整理两条本地时长数据，生成汇总文件并核验总时长。');
    const script = `const fs = require('node:fs');
const rows = JSON.parse(fs.readFileSync('durations.json', 'utf8'));
const total = rows.reduce((sum, row) => sum + row.seconds, 0);
require('node:assert/strict').equal(total, 180);
fs.writeFileSync('summary.json', JSON.stringify({ count: rows.length, total }));
console.log('Verified 2 rows, total 180 seconds');`;
    const steps = [
      call('write', { path: 'durations.json', content: '[{"seconds":60},{"seconds":120}]' }),
      call('write', { path: 'summarize.cjs', content: script }),
      call('bash', { command: `${JSON.stringify(process.execPath)} summarize.cjs` }),
      call('read', { path: 'summary.json' }),
      call('submit_result', {
        markdown: '已生成 summary.json，两条数据共180秒，脚本断言通过。',
        outcome: 'done',
        evidence: ['summary.json: count=2, total=180; script assertion passed'],
        criteria: { required: 2, met: 2 },
      }),
    ];
    let dispatched = false;
    const acceptance = acceptWork(test);
    test.fake.setResponses(
      Array.from({ length: 12 }, () => async (transcript, _options, _state, model) => {
        if (model.id === 'gpt-6.1-sol') {
          if (steps.length === 1) {
            expect(JSON.stringify(transcript)).toContain('Verified 2 rows, total 180 seconds');
            expect(JSON.stringify(transcript)).toContain('summary.json');
          }
          const step = steps.shift();
          assert(step);
          return step;
        }
        if (!dispatched) {
          dispatched = true;
          return call('delegate', {
            role,
            instructions: 'Deliver a verified duration summary file. Choose suitable tools and methods.',
            requiredCriteria: ['Summarize both records and verify the total'],
            requiredCount: 2,
            revision: 1,
          });
        }
        if (Object.values((await test.runtime.work()).assignments)[0]?.status !== 'complete')
          return fauxAssistantMessage('正在整理和核验数据。');
        const response = acceptance.shift();
        assert(response);
        return response();
      }),
    );
    try {
      test.start();
      test.send(owner);
      await expect.poll(() => test.store.command(owner.id)?.status).toBe('complete');
      const assignment = Object.values((await test.runtime.work()).assignments)[0];
      assert(assignment);
      expect(JSON.parse(assignment.input)).toMatchObject({
        ownerCommand: owner,
        capabilities: EXECUTOR_CAPABILITIES,
      });
      expect(assignment.outcome).toMatchObject({ status: 'done', criteria: { required: 2, met: 2 } });
      const executor = await test.runtime.harness.conversation(assignment.conversationId, BACKGROUND_CONTEXT);
      assert(executor);
      const agent = await executor.agent(BACKGROUND_CONTEXT);
      expect(agent.instructions).toBe(`${WORK_POLICY}\nCurrent ownerCommand: ${JSON.stringify(owner)}`);
      expect(agent.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(EXECUTOR_CAPABILITIES.tools),
      );
      expect((await test.runtime.root.agent(BACKGROUND_CONTEXT)).instructions).toBe(
        `${ROOT_POLICY}\nCurrent ownerCommand: ${JSON.stringify(owner)}`,
      );
    } finally {
      await test.close();
    }
  },
);

import assert from 'node:assert/strict';
