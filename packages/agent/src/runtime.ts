import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { executorTools, loadHisfmDefinition, workPolicy } from '@frogie/core/hisfm';
import { CONTEXT_BLOCKED, defineHostTool, type HostModels, openAgentHost } from '@frogie/core/host';
import {
  type AgentCommand,
  type ConversationStatus,
  operationSchema,
  type PageContext,
  proposalSchema,
  type ServerFrame,
} from '@his-fm/contracts';
import { Type } from 'typebox';
import type { Channel, WebsiteClient } from './client.ts';
import type { Config } from './config.ts';

const CONTEXT_FAILURE =
  '上下文压缩未完成，已暂停本次任务并保留完整历史；未继续请求模型，请修复压缩后再重试。';

import { type AssignmentPlan, type DecisionInput, decisions } from './decision.ts';
import { executionEnvironment, networkContext } from './network.ts';
import { runSpeechJob } from './speech-job.ts';
import type { InputRecord, RuntimeStore } from './store.ts';
import type { RuntimeTransport } from './transport.ts';

type ConversationId = number;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalidAssignmentMessage =
  '旧任务缺少当前指令、执行能力或提示词快照，已停止恢复。请基于当前需求重新派发；已有成果仍保留。';
type Assignment = {
  id: string;
  commandId: string;
  conversationId: ConversationId;
  role: 'writer' | 'reviewer' | 'speech';
  profileVersion: number;
  revision: number;
  input: string;
  fingerprint: string;
  plan: AssignmentPlan;
  createdAt: number;
  status: 'working' | 'complete' | 'failed' | 'cancelled';
  result: string | null;
  outcome: WorkOutcome | null;
  requiredCriteria: string[];
  requiredCount?: number;
};
type WorkOutcome = {
  status: 'done' | 'blocked' | 'needs_input';
  evidence: string[];
  criteria?: { required: number; met: number };
};
type CommandFinish = {
  outcome: WorkOutcome['status'];
  markdown: string;
  acceptedAssignmentIds: string[];
  checks: { assignmentId: string; criterion: string; evidence: string[] }[];
};
type Resident = {
  id: ConversationId;
  role: 'writer' | 'reviewer' | 'speech';
  profileVersion: number;
  categoryProfile: string;
  lifetime: 'resident' | 'task';
  retired: boolean;
  thinkingLevel: AssignmentPlan['thinkingLevel'];
  commandId: string;
  productionId: string | null;
};
type WorkState = { assignments: Record<string, Assignment>; conversations: Record<string, Resident> };
const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
});
const markdown = Type.String({ minLength: 1, maxLength: 70000 });
const outcome = Type.Union([Type.Literal('done'), Type.Literal('blocked'), Type.Literal('needs_input')]);
function overlapsDraft(page: PageContext | null, changes: Record<string, unknown>) {
  if (!page?.field || !page.draft || page.draft.value === page.draft.baseValue) return false;
  const field = page.field.field;
  if (!field.startsWith('source.'))
    return Object.hasOwn(changes, field) && changes[field] !== page.draft.baseValue;
  if (!Object.hasOwn(changes, 'sources')) return false;
  const source = Array.isArray(changes.sources)
    ? (changes.sources.find(
        (value: unknown) =>
          value !== null && typeof value === 'object' && 'id' in value && value.id === page.field?.sourceId,
      ) as Record<string, unknown> | undefined)
    : undefined;
  return source?.[field.slice('source.'.length)] !== page.draft.baseValue;
}

export type RuntimeOptions = {
  databasePath?: string;
  models: HostModels;
  config: Config;
  store: RuntimeStore;
  transport: RuntimeTransport;
  client: WebsiteClient;
  decide?: (input: DecisionInput) => Promise<AssignmentPlan>;
  log?: (message: string) => void;
};

export async function openRuntime(options: RuntimeOptions) {
  const { config, store, transport, client } = options;
  const runtimeId =
    store.get<string>('frogieRuntimeId') ?? digest(store.get<string>('identity') ?? randomUUID());
  store.set('frogieRuntimeId', runtimeId);
  const taskId = (prefix: string, id: number) => `${prefix}:${runtimeId}:${id}`;
  const workspaceRoot = join(config.runtime.workspaceRoot, 'frogie', runtimeId);
  const log = options.log ?? console.log;
  const background = (task: Promise<unknown>) => {
    void task.catch(() => log('后台任务出现错误，持久现场已保留。'));
  };
  const decide = options.decide ?? decisions(config);

  const running = new Map<string, Promise<void>>();
  const cancelling = new Map<string, Promise<void>>();
  let current: InputRecord | null = null;
  let restoringInput: InputRecord | null = null;
  let pumping = false;
  let pumpPromise: Promise<void> | undefined;
  let stopped = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let allocation = Promise.resolve();
  let host: Awaited<ReturnType<typeof openAgentHost<WorkState>>>;
  let rootId: number;
  const work = async () => host.snapshot();
  const secrets = [
    config.providers.raven.apiKey,
    config.decision.apiKey,
    ...Object.values(config.speechKeys),
    ...Object.values(config.websites).map((site) => site.token),
  ].filter(Boolean);
  const safeText = (text: string) =>
    secrets.reduce((value, secret) => value.replaceAll(secret, '[已隐藏]'), text);
  const commandStopped = (id: string) =>
    store.get<boolean>(`cancelled:${id}`) ||
    ['cancelled', 'failed', 'complete'].includes(store.command(id)?.status ?? '');
  function command(): AgentCommand {
    if (!current) throw new Error('没有活动指令。');
    const record = store.command(current.commandId);
    if (!record || commandStopped(current.commandId)) throw new Error('指令已取消或结束。');
    return record.command;
  }
  function visible(id: string, commandId: string, text: string) {
    const safe = safeText(text).slice(0, 70000);
    const existing = store.get<{ text: string; createdAt: string }>(`message:${id}`);
    const saved = existing ?? { text: safe, createdAt: new Date().toISOString() };
    if (existing && existing.text !== safe) throw new Error('回复 ID 的内容发生变化。');
    store.set(`message:${id}`, saved);
    transport.send({ type: 'message', message: { id, role: 'assistant', commandId, ...saved } });
    if (!existing) log(safe);
  }
  async function statuses() {
    const state = await work();
    const conversations: ConversationStatus[] = [
      {
        id: String(rootId),
        role: '主控',
        lifetime: 'coordinator',
        status: current ? 'working' : 'idle',
        task: current ? '处理用户指令' : '等待指令',
        model: config.coordinator.model,
        thinkingLevel: 'high',
      },
    ];
    for (const resident of Object.values(state.conversations)
      .filter((item) => !item.retired)
      .slice(-23)) {
      const assignment = Object.values(state.assignments).find(
        (item) => item.conversationId === resident.id && item.status === 'working',
      );
      conversations.push({
        id: String(resident.id),
        role: resident.role === 'reviewer' ? '审校' : resident.role === 'speech' ? '语音' : '写作',
        lifetime: resident.lifetime,
        status: assignment ? 'working' : 'idle',
        task: assignment ? '执行已分配任务' : '等待任务',
        model: config.executor.model,
        thinkingLevel: resident.thinkingLevel,
      });
    }
    const fingerprint = digest(conversations);
    if (store.get('statusFingerprint') === fingerprint) return;
    const sequence = (store.get<number>('statusSequence') ?? 0) + 1;
    store.set('statusSequence', sequence);
    store.set('statusFingerprint', fingerprint);
    transport.send({ type: 'status', id: `status:${sequence}`, conversations });
  }
  async function finishAssignment(id: string, status: Assignment['status']) {
    await host.transact(async (transaction) => {
      const state = await transaction.state();
      const assignment = state.assignments[id];
      if (assignment?.status !== 'working') return;
      assignment.status = commandStopped(assignment.commandId) ? 'cancelled' : status;
    });
    const assignment = (await work()).assignments[id];
    if (!assignment || commandStopped(assignment.commandId)) return;
    store.input(
      `result:${id}`,
      assignment.commandId,
      JSON.stringify({
        actor: 'host',
        type: 'assignment_result',
        assignmentId: id,
        status: assignment.status,
        result: assignment.result,
        outcome: assignment.outcome,
        requiredCriteria: assignment.requiredCriteria,
      }),
    );
    await statuses();
    background(pump());
  }
  async function retireTasks(commandId: string, cancelled = false) {
    await host.transact(async (transaction) => {
      const state = await transaction.state();
      for (const conversation of Object.values(state.conversations))
        if (
          conversation.lifetime === 'task' &&
          conversation.commandId === commandId &&
          (cancelled || conversation.productionId === null)
        )
          conversation.retired = true;
    });
  }
  function launch(assignment: Assignment) {
    if (running.has(assignment.id) || stopped || commandStopped(assignment.commandId)) return;
    const execution = (async () => {
      const envelope = JSON.parse(assignment.input);
      if (
        !envelope.ownerCommand ||
        !envelope.capabilities ||
        !envelope.channel?.prompts ||
        !assignment.requiredCriteria
      ) {
        await host.abort(assignment.conversationId);
        visible(`attention:${assignment.id}`, assignment.commandId, invalidAssignmentMessage);
        await finishAssignment(assignment.id, 'failed');
        return;
      }
      const remaining = assignment.createdAt + config.runtime.maxTaskMinutes * 60000 - Date.now();
      if (remaining <= 0) {
        await host.abort(assignment.conversationId);
        await finishAssignment(assignment.id, 'failed');
        return;
      }
      const settled = await host.run(assignment.conversationId, {
        requestId: assignment.id,
        content: assignment.input,
        instructions: `${workPolicy(envelope.channel.prompts, assignment.role)}\n当前所有者指令：${JSON.stringify(envelope.ownerCommand)}`,
        timeoutMs: remaining,
      });
      const saved = (await work()).assignments[assignment.id];
      if (!stopped)
        await finishAssignment(
          assignment.id,
          settled.status === 'done' && saved?.result ? 'complete' : 'failed',
        );
    })()
      .catch(async () => {
        if (!stopped) await finishAssignment(assignment.id, 'failed');
      })
      .finally(() => {
        running.delete(assignment.id);
      });
    running.set(assignment.id, execution);
    background(execution);
  }
  const submitResult = defineHostTool({
    name: 'submit_result',
    description: '保存不可变的 Markdown 交付物、执行结果与证据。',
    replay: 'safe',
    parameters: Type.Object({
      markdown,
      outcome,
      evidence: Type.Array(Type.String({ minLength: 1, maxLength: 4000 }), { maxItems: 100 }),
      criteria: Type.Optional(
        Type.Object({ required: Type.Integer({ minimum: 1 }), met: Type.Integer({ minimum: 0 }) }),
      ),
    }),
    execute: async (args, api) => {
      const result = safeText(args.markdown);
      const outcome: WorkOutcome = {
        status: args.outcome,
        evidence: args.evidence.map(safeText),
        ...(args.criteria ? { criteria: args.criteria } : {}),
      };
      if (
        args.outcome === 'done' &&
        (!args.evidence.length || (args.criteria && args.criteria.met < args.criteria.required))
      )
        throw new Error('完成成果需要证据且满足全部验收数量。');
      await host.transact(async (transaction) => {
        const state = await transaction.state();
        const assignment = Object.values(state.assignments).find(
          (item) => item.conversationId === api.conversationId && item.status === 'working',
        );
        if (!assignment || commandStopped(assignment.commandId)) throw new Error('没有活动任务。');
        if (
          args.outcome === 'done' &&
          assignment.requiredCount &&
          (!args.criteria ||
            args.criteria.required !== assignment.requiredCount ||
            args.criteria.met < assignment.requiredCount)
        )
          throw new Error('成果数量必须满足派发时固定的验收数量。');
        if (
          assignment.result !== null &&
          (assignment.result !== result || digest(assignment.outcome) !== digest(outcome))
        )
          throw new Error('结果已固定。');
        assignment.result = result;
        assignment.outcome = outcome;
      });
      return { ...textResult({ saved: true, outcome: args.outcome }), control: { terminate: true } };
    },
  });
  const generate = defineHostTool({
    name: 'generate_speech',
    description:
      '通过本机脚本执行当前已授权语音任务；不返回密钥或配置路径。返回成功回执作为证据，不伪造音频。',
    replay: 'safe',
    parameters: Type.Object({ jobId: Type.String({ pattern: '^[a-zA-Z0-9-]+$' }) }),
    execute: async (args, api) => {
      const assignment = Object.values((await work()).assignments).find(
        (item) => item.conversationId === api.conversationId && item.status === 'working',
      );
      if (
        assignment?.role !== 'speech' ||
        !assignment.commandId.startsWith(`speech:${args.jobId}:`) ||
        commandStopped(assignment.commandId)
      )
        throw new Error('当前会话未获授权执行这个语音任务。');
      const result = await runSpeechJob(
        client,
        () => transport.generation,
        args.jobId,
        assignment.commandId,
        join(workspaceRoot, digest(api.conversationId)),
        api.signal,
      );
      store.set(`speech-receipt:${assignment.commandId}`, result);
      return textResult(result);
    },
  });
  const read = defineHostTool({
    name: 'read_latest',
    description: '读取最新私有提示词，可同时读取节目；不返回凭证。',
    replay: 'safe',
    parameters: Type.Object({ productionId: Type.Optional(Type.String({ maxLength: 160 })) }),
    execute: async (args) => {
      command();
      const channel = await client.channel();
      store.set(`profile:${current?.id}`, channel.version);
      const production = args.productionId ? await client.production(args.productionId) : null;
      if (production) store.set(`category:${command().id}:${production.id}`, production.categoryProfile);
      return textResult({
        channel,
        category: production?.categoryProfile ?? null,
        production,
        context: store.get<PageContext>('latestContext'),
        contextLive: transport.ready,
        commandContext: command().context,
      });
    },
  });
  const list = defineHostTool({
    name: 'list_productions',
    description: '列出当前节目制作任务。',
    replay: 'safe',
    parameters: Type.Object({}),
    execute: async () => {
      command();
      return textResult(await client.productions());
    },
  });
  const reply = defineHostTool({
    name: 'reply',
    description: '向所有者发送简洁的中文 Markdown，不包含内部推理或决策细节。',
    replay: 'safe',
    parameters: Type.Object({ markdown }),
    execute: async (args, api) => {
      const active = command();
      visible(taskId('reply', api.taskId), active.id, args.markdown);
      store.set(`replied:${current?.id}`, true);
      return textResult('回复已发送。');
    },
  });
  const delegate = defineHostTool({
    name: 'delegate',
    description: '委派带上下文与验收标准的成果；执行者在当前授权范围和本机能力内自行选择方法，结果异步送达。',
    replay: 'safe',
    parameters: Type.Object({
      role: Type.Union([Type.Literal('writer'), Type.Literal('reviewer'), Type.Literal('speech')]),
      instructions: markdown,
      requiredCriteria: Type.Optional(
        Type.Array(Type.String({ minLength: 1, maxLength: 4000 }), { minItems: 1, maxItems: 50 }),
      ),
      requiredCount: Type.Optional(Type.Integer({ minimum: 1 })),
      revision: Type.Integer({ minimum: 1 }),
      productionId: Type.Optional(Type.String({ maxLength: 160 })),
      taskType: Type.Optional(
        Type.Union(
          ['research', 'translation', 'outline', 'draft', 'revision', 'review'].map((value) =>
            Type.Literal(value),
          ),
        ),
      ),
      complexity: Type.Optional(
        Type.Union(['simple', 'moderate', 'complex'].map((value) => Type.Literal(value))),
      ),
    }),
    execute: async (args, api) => {
      const active = command();
      const id = taskId('assignment', api.taskId);
      let release = () => {};
      const previous = allocation;
      allocation = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        const state = await work();
        const prior = state.assignments[id];
        if (prior) {
          if (prior.status === 'working') launch(prior);
          return textResult({ assignmentId: id, status: prior.status });
        }
        if (args.revision > config.runtime.maxRevisionRounds) throw new Error('已达到修改轮数上限。');
        if (
          Object.values(state.assignments).filter(
            (item) => item.commandId === active.id && item.role === args.role,
          ).length >= config.runtime.maxRevisionRounds
        )
          throw new Error('已达到修改轮数上限。');
        if (
          Object.values(state.assignments).filter((item) => item.status === 'working').length >=
          config.runtime.maxConcurrentAssignments
        )
          throw new Error('并发任务已满，请等待已派发任务。');
        const channel = await client.channel();
        const productionId = args.productionId ?? active.context?.productionId ?? null;
        const production = productionId ? await client.production(productionId) : null;
        const categoryProfile = digest(production?.categoryProfile ?? null);
        if (production) store.set(`category:${active.id}:${production.id}`, production.categoryProfile);
        const compatible = Object.values(state.conversations).filter(
          (item) =>
            !item.retired &&
            !cancelling.has(item.commandId) &&
            item.role === args.role &&
            item.profileVersion === channel.version &&
            item.categoryProfile === categoryProfile &&
            !Object.values(state.assignments).some(
              (assignment) => assignment.conversationId === item.id && assignment.status === 'working',
            ),
        );
        const resident = compatible.find((item) => item.lifetime === 'resident');
        const task = compatible.find(
          (item) =>
            item.lifetime === 'task' &&
            item.productionId === productionId &&
            (productionId !== null || item.commandId === active.id),
        );
        const plan = await decide({
          prompts: channel.prompts,
          role: args.role === 'speech' ? 'writer' : args.role,
          revision: args.revision,
          inputBytes: Buffer.byteLength(args.instructions),
          availableResident: !!resident,
          availableTask: !!task,
          taskType: (args.taskType ??
            (args.role === 'reviewer' ? 'review' : args.revision > 1 ? 'revision' : 'draft')) as NonNullable<
            DecisionInput['taskType']
          >,
          complexity: (args.complexity ??
            (args.instructions.length > 4000
              ? 'complex'
              : args.instructions.length < 400
                ? 'simple'
                : 'moderate')) as NonNullable<DecisionInput['complexity']>,
          scope: productionId ? 'production' : 'general',
        });
        const available = plan.lifetime === 'resident' ? resident : task;
        command();
        if (
          !config.executor.thinkingLevels.includes(plan.thinkingLevel) ||
          (plan.reuse && !available) ||
          (args.role !== 'reviewer' && plan.lifetime !== 'task')
        )
          throw new Error('任务分配不满足会话约束。');
        const input = JSON.stringify({
          assignmentId: id,
          ownerCommand: active,
          network: networkContext(channel.prompts.network),
          capabilities: {
            tools: args.role === 'speech' ? ['generate_speech', 'submit_result'] : executorTools,
            guidance: channel.prompts.capabilities,
          },
          role: args.role,
          instructions: args.instructions,
          requiredCriteria: args.requiredCriteria ?? [args.instructions],
          requiredCount: args.requiredCount,
          revision: args.revision,
          channel,
          category: production?.categoryProfile ?? null,
          production,
          context: active.context,
        });
        const assignment = await host.transact(async (transaction) => {
          const saved = await transaction.state();
          const conversationId =
            plan.reuse && available
              ? available.id
              : await transaction.create({
                  roleId: args.role,
                  model: { provider: config.executor.provider, modelId: config.executor.model },
                  thinkingLevel: plan.thinkingLevel,
                  instructions: `${workPolicy(channel.prompts, args.role)}\n当前所有者指令：${JSON.stringify(active)}`,
                });
          const assignment: Assignment = {
            id,
            commandId: active.id,
            conversationId,
            role: args.role,
            profileVersion: channel.version,
            revision: args.revision,
            input,
            fingerprint: digest(input),
            plan,
            createdAt: Date.now(),
            status: 'working',
            result: null,
            outcome: null,
            requiredCriteria: args.requiredCriteria ?? [args.instructions],
            ...(args.requiredCount ? { requiredCount: args.requiredCount } : {}),
          };
          await transaction.configure(conversationId, {
            roleId: args.role,
            model: { provider: config.executor.provider, modelId: config.executor.model },
            thinkingLevel: plan.thinkingLevel,
            instructions: `${workPolicy(channel.prompts, args.role)}\n当前所有者指令：${JSON.stringify(active)}`,
          });
          saved.conversations[conversationId] = {
            categoryProfile,
            commandId: active.id,
            productionId,
            id: conversationId,
            role: args.role,
            profileVersion: channel.version,
            lifetime: plan.lifetime,
            retired: false,
            thinkingLevel: plan.thinkingLevel,
          };
          saved.assignments[id] = assignment;
          return structuredClone(assignment);
        });
        visible(
          `dispatch:${id}`,
          active.id,
          args.role === 'reviewer'
            ? '已安排审校，完成后我会核对结果。'
            : args.role === 'speech'
              ? '已安排专职语音会话，完成后我会核对结果。'
              : '已安排写作，完成后我会核对结果。',
        );
        launch(assignment);
        await statuses();
        return textResult({ assignmentId: id, status: 'working' });
      } finally {
        release();
      }
    },
  });
  const inspect = defineHostTool({
    name: 'inspect_work',
    description: '读取不可变的任务结果或已保存的操作回执。',
    replay: 'safe',
    parameters: Type.Object({ id: Type.String() }),
    execute: async (args) => {
      const active = command();
      const assignment = (await work()).assignments[args.id];
      if (assignment && assignment.commandId !== active.id) throw new Error('成果不属于当前指令。');
      if (assignment) store.set(`inspected:${active.id}:${assignment.id}`, digest(assignment));
      return textResult(
        assignment
          ? {
              id: assignment.id,
              status: assignment.status,
              result: assignment.result,
              outcome: assignment.outcome,
              requiredCriteria: assignment.requiredCriteria,
              requiredCount: assignment.requiredCount,
              profileVersion: assignment.profileVersion,
            }
          : store.result(args.id),
      );
    },
  });
  const retire = defineHostTool({
    name: 'retire_conversation',
    description: '退役空闲执行会话，保留其历史。',
    replay: 'safe',
    parameters: Type.Object({ id: Type.String() }),
    execute: async (args) => {
      command();
      await host.transact(async (transaction) => {
        const state = await transaction.state();
        const conversation = state.conversations[args.id];
        if (
          !conversation ||
          Object.values(state.assignments).some(
            (item) => String(item.conversationId) === args.id && item.status === 'working',
          )
        )
          throw new Error('只能退休空闲执行会话。');
        conversation.retired = true;
      });
      await statuses();
      return textResult('会话已退休，历史保留。');
    },
  });
  const proposal = defineHostTool({
    name: 'propose_draft',
    description: '向所有者指令冻结的字段与草稿快照提出 Markdown 修改，不保存网站正式数据。',
    replay: 'safe',
    parameters: Type.Object({ markdown, summary: Type.String({ maxLength: 1000 }) }),
    execute: async (args, api) => {
      const active = command();
      if (!active.context?.field || !active.context.draft)
        throw new Error('指令没有固定的编辑字段，请从目标字段重新发起。');
      const proposal = proposalSchema.parse({
        id: taskId('proposal', api.taskId),
        commandId: active.id,
        context: active.context,
        target: active.context.field,
        value: args.markdown,
        summary: args.summary,
      });
      transport.send({ type: 'proposal', proposal });
      return textResult({ proposalId: proposal.id, status: 'awaiting_browser' });
    },
  });
  async function checkWrite(productionId: string, version: number, profileVersion: number) {
    const active = command();
    if (!transport.ready) throw new Error('连接尚未恢复，未执行网站写入。');
    if (active.context?.productionId && active.context.productionId !== productionId)
      throw new Error('目标节目与指令不一致。');
    const [channel, production] = await Promise.all([client.channel(), client.production(productionId)]);
    command();
    if (channel.version !== profileVersion) throw new Error('全局提示词已变化，请重新审阅。');
    const previousCategory = store.get(`category:${active.id}:${productionId}`);
    if (previousCategory && digest(previousCategory) !== digest(production.categoryProfile))
      throw new Error('栏目或栏目提示词已变化，请重新读取并审阅。');
    if (production.version !== version) throw new Error('节目版本已变化，请重新读取。');
    return production;
  }
  const create = defineHostTool({
    name: 'create_production',
    description:
      '仅为未指定现有节目的指令创建草稿，先读取最新提示词。brief JSON 必须包含 title、slug、episodeNumber，可包含 category、tags、targetDurationSeconds、sources、intent；每项素材必须有唯一稳定 id。不审批或发布。',
    replay: 'safe',
    parameters: Type.Object({
      profileVersion: Type.Integer({ minimum: 1 }),
      brief: Type.String({ minLength: 2, maxLength: 180000 }),
    }),
    execute: async (args, api) => {
      const active = command();
      const id = taskId('operation', api.taskId);
      const receipt = store.result(id);
      if (receipt) return textResult(receipt);
      const existing = store.event(id);
      if (existing?.type === 'operation') return textResult(await transport.operation(existing));
      if (active.context?.productionId) throw new Error('当前指令已有节目目标，不能创建其他节目。');
      if (!transport.ready) throw new Error('连接尚未恢复，未执行网站写入。');
      const channel = await client.channel();
      command();
      if (channel.version !== args.profileVersion) throw new Error('全局提示词已变化，请重新审阅。');
      const operation = operationSchema.parse({
        id,
        commandId: active.id,
        kind: 'production.create',
        brief: JSON.parse(args.brief),
      });
      return textResult(await transport.operation({ type: 'operation', operation }));
    },
  });
  const submit = defineHostTool({
    name: 'submit_for_review',
    description:
      '提交已保存内容供人工审核。允许 submit_brief、submit_script、submit_final；不审批、重开或发布。先读取最新节目和提示词，不能提交未保存草稿。',
    replay: 'safe',
    parameters: Type.Object({
      productionId: Type.String({ minLength: 1, maxLength: 160 }),
      version: Type.Integer({ minimum: 1 }),
      profileVersion: Type.Integer({ minimum: 1 }),
      action: Type.Union([
        Type.Literal('submit_brief'),
        Type.Literal('submit_script'),
        Type.Literal('submit_final'),
      ]),
    }),
    execute: async (args, api) => {
      const active = command();
      const id = taskId('operation', api.taskId);
      const receipt = store.result(id);
      if (receipt) return textResult(receipt);
      const existing = store.event(id);
      if (existing?.type === 'operation') return textResult(await transport.operation(existing));
      if (!active.context?.productionId && !store.createdProduction(active.id, args.productionId))
        throw new Error('请从目标节目发起提交审阅，或先在当前指令创建该节目。');
      if (active.context?.draft && active.context.draft.value !== active.context.draft.baseValue)
        throw new Error('请先保存未保存草稿，再提交审阅。');
      await checkWrite(args.productionId, args.version, args.profileVersion);
      const operation = operationSchema.parse({
        id,
        commandId: active.id,
        kind: 'production.action',
        productionId: args.productionId,
        version: args.version,
        action: args.action,
      });
      return textResult(await transport.operation({ type: 'operation', operation }));
    },
  });
  const patch = defineHostTool({
    name: 'patch_production',
    description:
      '按版本更新网站节目，不覆盖指令中的未保存草稿；草稿修改用 propose_draft。保留既有素材 id，新素材分配唯一稳定的非空 id。',
    replay: 'safe',
    parameters: Type.Object({
      productionId: Type.String(),
      version: Type.Integer({ minimum: 1 }),
      profileVersion: Type.Integer({ minimum: 1 }),
      changes: Type.String({ maxLength: 180000 }),
    }),
    execute: async (args, api) => {
      const active = command();
      const id = taskId('operation', api.taskId);
      const receipt = store.result(id);
      if (receipt) return textResult(receipt);
      const existing = store.event(id);
      if (existing?.type === 'operation') return textResult(await transport.operation(existing));
      const operation = operationSchema.parse({
        id,
        commandId: active.id,
        kind: 'production.patch',
        productionId: args.productionId,
        version: args.version,
        changes: JSON.parse(args.changes),
      });
      if (operation.kind !== 'production.patch') throw new Error('操作类型无效。');
      if (overlapsDraft(active.context, operation.changes))
        throw new Error('当前修改涉及未保存草稿，请使用草稿提案。');
      await checkWrite(args.productionId, args.version, args.profileVersion);
      return textResult(await transport.operation({ type: 'operation', operation }));
    },
  });
  const audio = defineHostTool({
    name: 'request_audio',
    description:
      '仅在逐字稿已确认且所有者文字明确要求生成音频时请求付费生成。否定、预览或试听指令不允许完整生成，不推定同意。',
    replay: 'safe',
    parameters: Type.Object({
      productionId: Type.String(),
      version: Type.Integer({ minimum: 1 }),
      profileVersion: Type.Integer({ minimum: 1 }),
    }),
    execute: async (args, api) => {
      const active = command();
      const id = taskId('operation', api.taskId);
      const receipt = store.result(id);
      if (receipt) return textResult(receipt);
      const existing = store.event(id);
      if (existing?.type === 'operation') return textResult(await transport.operation(existing));
      if (
        !/(?:生成|制作|合成|重录|录制|重生成).{0,16}(?:音频|配音|朗读|录音)|(?:generate|create|synthesize|regenerate|record).{0,24}(?:audio|narration|voiceover)/iu.test(
          active.text,
        ) ||
        /(?:不要|禁止|别|不需要|不必|暂不|先不|仅试听|只试听|试听|预览)|\b(?:not|don't|never|preview)\b/iu.test(
          active.text,
        )
      )
        throw new Error('请明确发送“生成音频”指令；本次没有启动付费任务。');
      const production = await checkWrite(args.productionId, args.version, args.profileVersion);
      if (!production.approvals.script || !production.approvals.brief || production.stage !== 'production')
        throw new Error('逐字稿尚未获得有效人工批准。');
      return textResult(
        await transport.operation({
          type: 'operation',
          operation: {
            id,
            commandId: active.id,
            kind: 'audio.request',
            productionId: args.productionId,
            version: args.version,
            options: {},
          },
        }),
      );
    },
  });
  async function validateFinish(active: AgentCommand, finish: CommandFinish) {
    if (
      active.id.startsWith('speech:') &&
      finish.outcome === 'done' &&
      !store.get<{ complete?: boolean }>(`speech-receipt:${active.id}`)?.complete
    )
      throw new Error('语音任务缺少成功的网站回执。');
    const assignments = Object.values((await work()).assignments).filter(
      (assignment) => assignment.commandId === active.id,
    );
    if (assignments.some((assignment) => assignment.status === 'working'))
      throw new Error('执行任务仍在运行，请等待结果或取消任务。');
    for (const id of finish.acceptedAssignmentIds) {
      const assignment = assignments.find((assignment) => assignment.id === id);
      if (
        assignment?.status !== 'complete' ||
        assignment.outcome?.status !== 'done' ||
        !assignment.outcome.evidence.length ||
        (assignment.outcome.criteria &&
          assignment.outcome.criteria.met < assignment.outcome.criteria.required) ||
        (assignment.requiredCount &&
          (!assignment.outcome.criteria ||
            assignment.outcome.criteria.required !== assignment.requiredCount ||
            assignment.outcome.criteria.met < assignment.requiredCount))
      )
        throw new Error('只能验收当前指令中有证据且达标的完成成果。');
      if (store.get(`inspected:${active.id}:${id}`) !== digest(assignment))
        throw new Error('请先用 inspect_work 核对当前不可变成果。');
      if (
        !assignment.requiredCriteria?.length ||
        assignment.requiredCriteria.some(
          (criterion) =>
            !finish.checks.some(
              (check) =>
                check.assignmentId === id &&
                check.criterion === criterion &&
                check.evidence.length > 0 &&
                check.evidence.every((evidence) => assignment.outcome?.evidence.includes(evidence)),
            ),
        )
      )
        throw new Error('每项验收标准都需要引用成果中的实际证据。');
    }
    if (finish.outcome !== 'done') return;
    const latest = assignments.filter(
      (assignment) =>
        !assignments.some((other) => other.role === assignment.role && other.revision > assignment.revision),
    );
    if (latest.some((assignment) => !finish.acceptedAssignmentIds.includes(assignment.id)))
      throw new Error('请验收当前指令各项任务的最新成果；受阻报告不是完成成果。');
    if (
      /独立.{0,6}(?:审校|复核|审核|审查)|independent.{0,20}review/iu.test(active.text) &&
      !assignments.some(
        (assignment) =>
          assignment.role === 'reviewer' && finish.acceptedAssignmentIds.includes(assignment.id),
      )
    )
      throw new Error('当前指令要求独立审校，请先验收审校成果。');
    for (const effect of store.effects(active.id)) {
      if (!effect.receipt) throw new Error('网站操作仍在等待回执。');
      if (
        effect.receipt.type === 'operation.result' ? !effect.receipt.ok : effect.receipt.status !== 'applied'
      )
        throw new Error('网站回执未确认操作成功，请处理失败或报告受阻。');
    }
  }
  const finish = defineHostTool({
    name: 'finish_command',
    description:
      '接受当前指令结果并交付最终答复。done 要求成功任务证据和网站回执；blocked、needs_input 表示目标尚未完成。',
    replay: 'safe',
    parameters: Type.Object({
      markdown,
      outcome,
      acceptedAssignmentIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 100 }),
      checks: Type.Array(
        Type.Object({
          assignmentId: Type.String({ minLength: 1 }),
          criterion: Type.String({ minLength: 1 }),
          evidence: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 100 }),
        }),
        { maxItems: 100 },
      ),
    }),
    execute: async (args, api) => {
      const active = command();
      await validateFinish(active, args);
      command();
      const finish = { ...args, markdown: safeText(args.markdown) };
      store.set(`finish:${active.id}`, finish);
      visible(taskId('finish', api.taskId), active.id, finish.markdown);
      store.set(`replied:${current?.id}`, true);
      return { ...textResult({ outcome: args.outcome }), control: { terminate: true } };
    },
  });
  const definition = loadHisfmDefinition();
  host = await openAgentHost<WorkState>({
    ...(options.databasePath ? { databasePath: options.databasePath } : {}),
    definition,
    runtimeId,
    scope: { environmentId: 'native', squadId: definition.squadId, harnessId: runtimeId },
    models: options.models,
    roles: {
      coordinator: {
        provider: config.coordinator.provider,
        modelId: config.coordinator.model,
        thinkingLevel: 'high',
      },
      ...Object.fromEntries(
        ['writer', 'reviewer', 'speech'].map((role) => [
          role,
          {
            provider: config.executor.provider,
            modelId: config.executor.model,
            thinkingLevel: 'high' as const,
          },
        ]),
      ),
    },
    tools: [
      submitResult,
      generate,
      read,
      list,
      reply,
      delegate,
      inspect,
      retire,
      proposal,
      create,
      submit,
      patch,
      audio,
      finish,
    ],
    state: { kind: 'hisfm.work', initial: () => ({ assignments: {}, conversations: {} }) },
    execution: { directory: workspaceRoot, shellEnv: executionEnvironment() },
    summaryPrompt: async () => (await client.channel()).prompts.compaction,
    onReport: () => log('会话出现内部错误，持久任务已保留。'),
  });
  rootId = host.rootId;
  try {
    const state = await work();
    const halted = new Set<number>();
    for (const assignment of Object.values(state.assignments)) {
      if (assignment.status !== 'working') continue;
      const envelope = JSON.parse(assignment.input);
      const invalid =
        !envelope.ownerCommand ||
        !envelope.capabilities ||
        !envelope.channel?.prompts ||
        !assignment.requiredCriteria;
      if (invalid && !commandStopped(assignment.commandId))
        visible(`attention:${assignment.id}`, assignment.commandId, invalidAssignmentMessage);
      if (
        commandStopped(assignment.commandId) ||
        assignment.createdAt + config.runtime.maxTaskMinutes * 60000 <= Date.now() ||
        invalid
      )
        halted.add(assignment.conversationId);
    }
    for (const pending of await host.pendingSubmissions()) {
      if (pending.conversationId !== rootId) continue;
      const input = store.database
        .prepare('SELECT * FROM inputs WHERE id = ?')
        .get(pending.requestId ?? '') as InputRecord | undefined;
      if (!input || commandStopped(input.commandId)) halted.add(rootId);
      else restoringInput = input;
    }
    await host.stageAbort([...halted]);
    await host.transact(async (transaction) => {
      const currentState = await transaction.state();
      for (const assignment of Object.values(currentState.assignments))
        if (assignment.status === 'working' && halted.has(assignment.conversationId))
          assignment.status = commandStopped(assignment.commandId) ? 'cancelled' : 'failed';
    });
  } catch (error) {
    await host.close();
    throw error;
  }

  function pump(): Promise<void> {
    if (pumping) return pumpPromise ?? Promise.resolve();
    pumpPromise = runPump();
    return pumpPromise;
  }
  async function runPump() {
    if (pumping || stopped || !transport.ready) return;
    pumping = true;
    try {
      current = restoringInput ?? store.next();
      restoringInput = null;
      await host.resume();
      for (const id of store.pendingCancellations()) await cancel(id);
      if (!current || commandStopped(current.commandId)) current = store.next();
      const state = await work();
      for (const assignment of Object.values(state.assignments)) {
        if (assignment.status === 'working' && !commandStopped(assignment.commandId)) launch(assignment);
        else if (assignment.status !== 'working' && !store.get(`notified:${assignment.id}`)) {
          await finishAssignment(assignment.id, assignment.status);
          store.set(`notified:${assignment.id}`, true);
        }
      }
      if (!current || commandStopped(current.commandId)) current = store.next();
      if (!current) return;
      const input = current;
      let content = store.get<string>(`prepared:${input.id}`);
      if (!content) {
        const channel: Channel = await client.channel();
        const active = store.command(input.commandId)?.command;
        const production = active?.context?.productionId
          ? await client.production(active.context.productionId)
          : null;
        content = JSON.stringify({
          ownerCommand: store.command(input.commandId)?.command,
          executorCapabilities: { tools: executorTools, guidance: channel.prompts.capabilities },
          network: networkContext(channel.prompts.network),
          input: JSON.parse(input.content),
          latestChannel: channel,
          latestCategory: production?.categoryProfile ?? null,
        });
        store.set(`prepared:${input.id}`, content);
      }
      if (commandStopped(input.commandId)) return;
      store.state(input.commandId, 'working', '正在处理', `working:${input.id}`);
      await statuses();
      const settled = await host.run(rootId, {
        content,
        requestId: input.id,
        instructions: `${JSON.parse(content).latestChannel.prompts.coordinator}\n当前所有者指令：${JSON.stringify(command())}`,
        timeoutMs: config.runtime.maxTaskMinutes * 60000,
      });
      if (stopped || commandStopped(input.commandId)) return;
      if (settled.status !== 'done')
        throw new Error(settled.detail === CONTEXT_BLOCKED ? CONTEXT_BLOCKED : '主控任务未完成。');
      if (settled.text && !store.get(`replied:${input.id}`))
        visible(`answer:${input.id}`, input.commandId, settled.text);
      const assignments = Object.values((await work()).assignments).filter(
        (assignment) => assignment.commandId === input.commandId,
      );
      const pending = assignments.some((assignment) => assignment.status === 'working');
      const finish = store.get<CommandFinish>(`finish:${input.commandId}`);
      if (finish) await validateFinish(command(), finish);
      store.finishInput(input.id);
      const waiting =
        pending || (!finish && store.hasInput(input.commandId)) || store.hasPendingEffect(input.commandId);
      const requiresAcceptance =
        input.commandId.startsWith('speech:') ||
        assignments.length > 0 ||
        store.effects(input.commandId).length > 0;
      const status =
        finish?.outcome === 'blocked'
          ? 'failed'
          : waiting || finish?.outcome === 'needs_input' || (requiresAcceptance && !finish)
            ? 'waiting'
            : 'complete';
      store.state(
        input.commandId,
        status,
        finish?.markdown.slice(0, 1000) ?? (status === 'waiting' ? '等待执行结果或主控验收' : '已完成'),
        `settled:${input.id}`,
      );
      if (status === 'complete' || status === 'failed') await retireTasks(input.commandId);
    } catch (error) {
      if (current && !stopped && !commandStopped(current.commandId)) {
        const contextBlocked = error instanceof Error && error.message === CONTEXT_BLOCKED;
        store.state(
          current.commandId,
          'failed',
          contextBlocked ? CONTEXT_FAILURE : '任务未完成，已保留现场；请检查配置或重新发出指令。',
          `failed:${current.id}`,
        );
        visible(
          `error:${current.id}`,
          current.commandId,
          contextBlocked ? CONTEXT_FAILURE : '这次任务未完成，现场已保留。请检查连接或重新发出指令。',
        );
        await retireTasks(current.commandId);
      }
    } finally {
      current = null;
      pumping = false;
      if (!stopped) {
        try {
          await statuses();
          transport.flush();
        } catch {
          log('状态同步暂时失败，持久现场已保留。');
        }
      }
    }
  }
  function cancel(commandId: string): Promise<void> {
    const existing = cancelling.get(commandId);
    if (existing) return existing;
    const task = stopCommand(commandId).finally(() => {
      cancelling.delete(commandId);
    });
    cancelling.set(commandId, task);
    return task;
  }
  async function stopCommand(commandId: string) {
    store.set(`cancelled:${commandId}`, true);
    const record = store.command(commandId);
    if (record && ['cancelled', 'failed', 'complete'].includes(record.status)) return;
    if (record)
      store.state(
        commandId,
        'waiting',
        '正在停止任务，等待执行会话和本机进程退出。',
        `cancelling:${commandId}`,
      );
    transport.flush();
    await Promise.all([
      ...(current?.commandId === commandId ? [host.abort(rootId)] : []),
      (async () => {
        await allocation;
        const state = await work();
        const assignments = Object.values(state.assignments).filter(
          (item) => item.commandId === commandId && (item.status === 'working' || running.has(item.id)),
        );
        await Promise.all(
          assignments.map(async (assignment) => {
            await host.abort(assignment.conversationId);
            await running.get(assignment.id);
            await host.cleanup(assignment.conversationId);
            await finishAssignment(assignment.id, 'cancelled');
          }),
        );
      })(),
    ]);
    await retireTasks(commandId, true);
    if (store.command(commandId))
      store.state(commandId, 'cancelled', '已取消任务，执行会话与本机进程已停止。', `cancelled:${commandId}`);
    await statuses();
    transport.flush();
  }
  const onCommand = (command: AgentCommand) => {
    if (store.get(`cancelled:${command.id}`)) background(cancel(command.id));
    else background(pump());
  };
  const onCancel = (id: string) => {
    void cancel(id).catch(() => log('取消处理中，现场已保留。'));
  };
  const onReady = () => {
    background(pump());
  };
  const onReceipt = (receipt: Extract<ServerFrame, { type: 'operation.result' | 'proposal.ack' }>) => {
    const event = store.event(receipt.id);
    const commandId =
      event?.type === 'operation'
        ? event.operation.commandId
        : event?.type === 'proposal'
          ? event.proposal.commandId
          : null;
    if (!commandId || commandStopped(commandId)) return;
    store.input(
      `receipt:${receipt.id}`,
      commandId,
      JSON.stringify({ actor: 'host', type: 'website_receipt', receipt }),
    );
    background(pump());
  };
  const onTerminal = (id: string) => {
    void (async () => {
      if (current?.commandId === id) await host.abort(rootId);
      for (const assignment of Object.values((await work()).assignments))
        if (assignment.commandId === id && assignment.status === 'working') {
          await host.abort(assignment.conversationId);
          await finishAssignment(assignment.id, 'cancelled');
        }
      await retireTasks(id, true);
    })().catch(() => log('恢复终态任务时发生错误，现场已保留。'));
  };
  transport.on('command', onCommand);
  transport.on('cancel', onCancel);
  transport.on('ready', onReady);
  transport.on('terminal', onTerminal);
  transport.on('receipt', onReceipt);
  interval = setInterval(() => {
    background(pump());
  }, 250);
  return {
    host,
    rootId,
    work,
    pump,
    cancel,
    async close() {
      stopped = true;
      clearInterval(interval);
      transport.off('command', onCommand);
      transport.off('cancel', onCancel);
      transport.off('ready', onReady);
      transport.off('terminal', onTerminal);
      transport.off('receipt', onReceipt);
      await host.close();
      await pumpPromise;
      await Promise.all(running.values());
      await Promise.allSettled(cancelling.values());
    },
  };
}
