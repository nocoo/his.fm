'use strict';

const $ = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const nodes = {
  controller: {
    title: '主控 + 确定性 Host',
    status: '拟新增 / 唯一产品连接',
    description: '一个长期 root conversation，搭配不依赖模型判断的收件箱、租约和写回程序。用户只和它沟通。',
    does: [
      '读取最新频道策略与节目版本，规划并派发持久 assignment。',
      '验收具体 Markdown hash，独占网站 API adapter 和主控对话。',
      '派发立即返回 taskId，不阻塞等待长任务；完成通知再唤醒主控。',
    ],
    not: [
      '主控不能替人类批准逐字稿或发布。',
      'API Token 在 host client，不在模型 prompt；这仍不是 OS 隔离。',
    ],
    source: 'packages/agent/src/coordinator.ts（拟新增）',
  },
  web: {
    title: 'Web 工作室',
    status: '已有界面 / 深度集成',
    description: '不是再挂一个外部聊天机器人，而是每期节目都有任务、成果、等待项和唯一主控对话。',
    does: [
      '右侧主控常驻现有工作室；左侧保留手工编辑、素材详情、五阶段与 Save。',
      '主控已保存内容实时更新左侧；dirty 同字段显示冲突，未保存稿保留。',
      '持续报告当前页面、素材、编辑字段、选区、草稿 revision 和 Save／冲突状态；命令固定发送时的快照。',
      '角色状态在折叠运行概览；Jev 调度过程不在用户界面播报。',
    ],
    not: [
      '浏览器关闭不会停止本机任务。',
      '协作开启可理解未保存创作稿，但不会自动 Save；秘密字段和未发送聊天输入不采集。',
    ],
    source: 'apps/web/src/admin/production/ + admin/agent/（拟新增）',
  },
  api: {
    title: '生产 API / D1',
    status: '已有规则 / 新增运行协议',
    description: '网站仍是节目、作品版本与人类批准的权威。主控的内部验收不能覆盖这些规则。',
    does: [
      '复用版本 CAS、capabilities、阶段可写字段和人类身份。',
      '新增页面 context/session/content 读取、命令快照固定与 draft proposal ACK；浏览器自述不是服务端权限。',
      '新增 durable commands、tasks、events、lease 与 operation receipts；私有稿件放独立无 CDN 的 R2 bucket。',
      '每次机器写回同时核对 operationId、leaseEpoch 和 productionVersion。',
    ],
    not: [
      '现有 Token 没有细粒度 scope，不假装已经有。',
      '心跳／token 流不占用 production 的 200 条业务历史。',
    ],
    source: 'apps/web/worker/production-model.ts · production-store.ts · agent-api.ts',
  },
  hub: {
    title: 'AgentHub / Durable Object',
    status: '拟新增 / 只做连接协调',
    description: '本机主动连出；浏览器和主控都连云端枢纽。D1 保存真相，DO 负责有界实时扇出。',
    does: [
      '使用 WebSocket hibernation，attachment 只放安全身份和 epoch。',
      '用户 HTTP 指令先持久化，再通知在线主控。',
      '断线后按 cursor 补读；落后过多则重新取 snapshot。',
    ],
    not: ['不是模型执行器，不运行 Pi Harness。', '不是另一套数据库；通知丢失不能导致任务丢失。'],
    source: 'apps/web/worker/agent-hub.ts（拟新增）',
  },
  audio: {
    title: 'AudioWorkflow / R2',
    status: '现有能力 / 增加幂等关联',
    description: '保留云端音频流水线。本机主控只发起和跟踪，不拿 Gemini 密钥，不另造一个 TTS 引擎。',
    does: [
      '批准 Markdown → 确定性播读文本 → 不可变音频快照。',
      '保存 scriptVersion、spokenTextHash、rendererVersion 与 jobId。',
      '超时先查任务回执；R2 保存真实完成音频。',
    ],
    not: [
      '主控取消本机任务不等于取消已运行的云端音频。',
      '不承诺上游计费 exactly-once；不默认加入片头片尾。',
    ],
    source: 'apps/web/worker/audio-routes.ts · audio-workflow.ts',
  },
  jev: {
    title: 'Jev / 本机 Falcon',
    status: '拟新增接入 / 复用现有网关',
    description: '根据当前工作的复杂度、上下文和候选会话状态，从合法调度方案中选一个。',
    does: [
      '选复用／新建／退休，以及 model + thinking + lifetime 的完整组合。',
      '输入有限、脱敏；校验选项与概率，保存完整决策快照。',
      '恢复相同 assignment 使用原决策，不重问。',
    ],
    not: ['不能授予网站权限，不能批准内容，也不接收用户直聊。', '网关失效时停止新派发，不能静默选默认模型。'],
    source: 'packages/agent/src/decision.ts；参考 giraffe work-priority.ts',
  },
  resident: {
    title: '长期审校 conversation',
    status: '拟新增 / 持久角色身份',
    description: '跨节目保留方法、术语和审校经验。长期意味着可以接续，不意味着一直在调用模型。',
    does: [
      '一个角色一次接一个 assignment；新任务都重新带入证据包。',
      '独立审阅 writer 的具体成果 hash，发现问题交主控返工。',
      '身份跨重启保持；空闲时不产生模型请求。',
    ],
    not: ['历史意见不自动成为新一期的事实来源。', '没有网站 API tool；不能代替主控写回、代替用户批准。'],
    source: 'packages/agent/src/conversations.ts（拟新增）',
  },
  episode: {
    title: '短期研究 / 写作 conversation',
    status: '拟新增 / 工作范围固定',
    description: '围绕某一期某次具体工作持久存在，可以多轮改稿、跨进程重启。交付后退休，不无限积累活跃角色。',
    does: [
      '完成研究、翻译、提纲、初稿或修改，返回 Markdown 信封。',
      'Jev 决定 model 和档位，host 固定 task/production/input hash。',
      '使用本机 CLI，必要时生成媒体候选，交主控验收。',
    ],
    not: [
      '不 fork 主控上下文，防止继承网站工具和私密历史。',
      '退休不是物理删除；reset 和 compaction 都保留历史。',
    ],
    source: 'Pi createConversation/configure + app Assignment/Result docs',
  },
  storage: {
    title: 'Pi Durable / 本地 SQLite',
    status: '框架已有 / 应用状态待建',
    description:
      'conversation、task、doc 同一原子提交，是恢复的基础。应用仍需管理 host assignment、输入版本和外部副作用。',
    does: [
      '单实例锁后打开 Harness，先重建 registry/assignment 再 resume。',
      '持久化决策、输入指纹、回执和 outbox。',
      '使用稳定 requestId 去重提交；断线后补传，不重做已确认工作。',
    ],
    not: [
      'SQLite 默认 NORMAL 不保证断电时最后写入绝不丢。',
      'Pi submission 去重不是 HTTP、shell 或计费的 exactly-once。',
    ],
    source: '@earendil-works/pi-durable 1.0.0；openNodeSqliteStorage',
  },
  cli: {
    title: 'NodeExecutionEnv / 本机 CLI',
    status: '按需求 / 无沙箱运行',
    description: '使用本机原有工具与文件系统，没有容器和路径 jail。任意 CLI 不是自动安全、也不是可随意重放。',
    does: [
      '允许研究、文件、转换等本机任务；活动与结果留证据。',
      '中断的外部副作用先对账，未知结果进入人工关注。',
      '默认不向 child env 注入网站 Token，日志只上传安全摘要。',
    ],
    not: [
      '同用户可读 config.json，主控独占 API 是逻辑职责而非强隔离。',
      '绝不能把任意 bash 标为 replay-safe；cwd 不是安全边界。',
    ],
    source: '@earendil-works/pi-durable/env/node · CodingTools',
  },
};

function inspect(id) {
  const node = nodes[id];
  $('#node-title').textContent = node.title;
  $('#node-status').textContent = node.status;
  $('#node-description').textContent = node.description;
  $('#node-source').textContent = node.source;
  for (const [selector, values] of [
    ['#node-does', node.does],
    ['#node-not', node.not],
  ]) {
    $(selector).replaceChildren(
      ...values.map((text) => {
        const li = document.createElement('li');
        li.textContent = text;
        return li;
      }),
    );
  }
  all('[data-node]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.node === id);
    button.setAttribute('aria-pressed', String(button.dataset.node === id));
  });
}
all('[data-node]').forEach((button) => button.addEventListener('click', () => inspect(button.dataset.node)));
inspect('controller');

const tabs = all('[data-tab]');
function switchTab(id, focus = false) {
  if (!tabs.some((tab) => tab.dataset.tab === id)) id = 'journey';
  tabs.forEach((tab) => {
    const selected = tab.dataset.tab === id;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $(`#panel-${tab.dataset.tab}`).hidden = !selected;
    if (selected && focus) tab.focus();
  });
  if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  tab.addEventListener('keydown', (event) => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      switchTab(tabs[next].dataset.tab, true);
    }
  });
});
window.addEventListener('hashchange', () => switchTab(location.hash.slice(1)));
switchTab(location.hash.slice(1));

const stageNames = ['选题', '逐字稿', '成品制作', '最终检查', '发布'];
const initial = {
  title: '下班以后，还要追多少个 AI？',
  intent: '从下班后仍在追赶新工具的夜晚切入，聊聊怎样给具体生活留一点空间。',
  transcript:
    '# 逐字稿草稿\n\n十一点半，工作群里又出现一段新工具演示。你想着只看十分钟，页面却越开越多。\n\n今晚，可以先问一个小问题：下周哪项工作真的需要它？',
  summary: '从一个深夜还在收藏教程的场景出发，聊工作与生活之间的边界。',
  description: '# 本期听点\n\n- 哪项工作真的需要这个新工具？\n- 怎么给下班后的自己留一点空间？',
  'source:s1:title': '最初的选题笔记',
  'source:s1:content':
    '# 原始素材\n\n观察：下班以后，新的学习任务仍然占据晚饭和休息。\n\n待核实：具体研究的样本、时间和适用范围。不要把个人感受当成研究结论。',
};
let canonical = { ...initial };
let version = 1;
let sourceIds = ['s1'];
let nextSource = 2;
let drafts = new Map();
let conflicts = new Set();
let stage = 0;
let selectedSource = null;
let approval = { brief: false, script: false, final: false };
let audioReady = false;
let coverReady = false;
let online = true;
let raceNextSave = false;
let pendingMessage = null;
let recentField = 'intent';
let lastChange = '所有内容已保存 · 演示版本';
let notice = '左侧可以直接编辑。右侧发一句话，主控的修改会回到同一份内容。';
let messages = [];
let queuedMessages = [];
let pageEpoch = 0;
let contextSeq = 0;
let sharing = true;
let shareEpoch = 1;
let contextStale = false;
let composing = false;
let selection = null;
let lastActivity = '正在查看选题';
let acknowledgedContext = null;
let draftRevisions = new Map();
let delayNextReply = false;
let delayedReply = null;
const fieldName = (key) => {
  if (key.startsWith('source:')) return key.endsWith(':title') ? '素材标题' : '原始素材正文';
  return (
    {
      title: '节目标题',
      intent: '创作意图',
      transcript: '完整逐字稿',
      summary: '节目摘要',
      description: '平台简介',
    }[key] ?? key
  );
};
const valueOf = (key) => drafts.get(key)?.value ?? canonical[key] ?? '';
const sourceKey = (id, part) => `source:${id}:${part}`;
function currentTarget() {
  if (all('[data-field]').some((input) => input.dataset.field === recentField)) return recentField;
  if (stage === 0 && selectedSource) return sourceKey(selectedSource, 'content');
  return ['intent', 'transcript', 'description', 'transcript', 'description'][stage];
}
function pageContext() {
  const target = currentTarget();
  return {
    contextId: `demo-context-${contextSeq}`,
    pageEpoch,
    shareEpoch,
    seq: contextSeq,
    target,
    location: `第 001 期 · ${stageNames[stage]}${selectedSource ? ` · 素材 ${selectedSource}` : ''}`,
    viewedVersion: version,
    savedValue: canonical[target] ?? '',
    value: valueOf(target),
    dirty: drafts.has(target),
    draftRevision: draftRevisions.get(target) ?? 0,
    dirtyFields: [...drafts.keys()],
    selection: selection?.target === target && selection.value === valueOf(target) ? { ...selection } : null,
    activity: lastActivity,
  };
}
function publishContext() {
  if (sharing && !contextStale && !composing) {
    contextSeq++;
    acknowledgedContext = pageContext();
  }
  const context = acknowledgedContext;
  $('#chat-context').textContent = !sharing
    ? '页面共享已暂停，不再读取当前页面'
    : context
      ? `${context.location} · ${fieldName(context.target)}`
      : '尚无已同步页面';
  $('#context-version').textContent = !sharing
    ? '仅保留已经明确发送的任务；不采集新草稿'
    : contextStale || composing
      ? `等待页面同步${composing ? ' · 中文输入尚未完成' : ''}，不会用旧页面猜测“这里”`
      : `页面已同步 · seq ${context.seq} · 网站 v${context.viewedVersion}${context.dirty ? ` · 未保存草稿 r${context.draftRevision}` : ' · 当前字段已保存'}`;
  $('#context-activity').textContent = sharing && context ? `最近操作：${context.activity}` : '';
  $('#context-selection').textContent =
    sharing && context?.selection
      ? `已选中 ${context.selection.end - context.selection.start} 个 UTF-16 单位：${context.selection.text.slice(0, 42)}`
      : sharing && context
        ? `范围：当前字段${context.dirtyFields.length ? ` · 共 ${context.dirtyFields.length} 处未保存` : ''}`
        : '';
  $('#toggle-context').textContent = sharing ? '暂停页面共享' : '恢复页面共享';
  $('#simulate-context-stale').textContent = contextStale ? '模拟上下文同步完成' : '模拟上下文未同步';
}
function addMessage(kind, text, target) {
  messages.push({ kind, text, target });
  renderChat();
}
function locate(key) {
  if (key.startsWith('source:')) {
    stage = 0;
    selectedSource = key.split(':')[1];
  } else {
    stage = key === 'transcript' ? 1 : ['summary', 'description'].includes(key) ? 2 : 0;
    selectedSource = null;
  }
  renderEditor();
  const input = all('[data-field]').find((field) => field.dataset.field === key);
  input?.focus({ preventScroll: true });
}
function renderChat() {
  $('#chat').replaceChildren(
    ...messages.map(({ kind, text, target }) => {
      const div = document.createElement('div');
      div.className = `chat-bubble ${kind}`;
      const name = document.createElement('strong');
      name.textContent = kind === 'owner' ? '你' : '主控';
      const content = document.createElement('p');
      content.textContent = text;
      div.append(name, content);
      if (target) {
        const button = document.createElement('button');
        button.className = 'result-link';
        button.textContent = `定位到${fieldName(target)} ↗`;
        button.addEventListener('click', () => locate(target));
        div.append(button);
      }
      return div;
    }),
  );
  $('#chat').scrollTop = $('#chat').scrollHeight;
}
function invalidate(keys) {
  if (keys.some((key) => ['title', 'intent'].includes(key) || key.startsWith('source:'))) {
    approval = { brief: false, script: false, final: false };
    audioReady = false;
  } else if (keys.includes('transcript')) {
    approval.script = false;
    approval.final = false;
    audioReady = false;
  } else if (keys.length) approval.final = false;
}
function syncRemote(patch, actor = '主控') {
  const changed = Object.keys(patch).filter((key) => canonical[key] !== patch[key]);
  if (!changed.length) return;
  Object.assign(canonical, patch);
  version++;
  invalidate(changed);
  for (const [key, draft] of drafts) {
    if (draft.value === canonical[key]) {
      drafts.delete(key);
      conflicts.delete(key);
    } else if (draft.base !== canonical[key]) conflicts.add(key);
  }
  lastChange = `${actor}已保存 · v${version}`;
  lastActivity = `收到${actor}的已保存更新${conflicts.size ? ' · 正在处理重叠冲突' : ''}`;
  notice = conflicts.size
    ? `${actor}已保存新内容；${conflicts.size} 处与你的未保存稿重叠。左侧输入保持不变，请先选版。`
    : `${actor}修改已保存，左侧已同步；你的其它草稿保持不变。`;
  all('[data-field]').forEach((input) => {
    if (!drafts.has(input.dataset.field)) input.value = canonical[input.dataset.field] ?? '';
  });
  renderSourceList();
  updateStatus();
  renderConflicts();
}
function updateStatus() {
  $('#canonical-version').textContent = `v${version}`;
  $('#save-state').textContent = drafts.size
    ? `${drafts.size} 处未保存${conflicts.size ? ` · ${conflicts.size} 处待选版` : ''}`
    : lastChange;
  $('#save-edits').disabled = !drafts.size || conflicts.size > 0;
  $('#update-notice').textContent = notice;
  $('#update-notice').classList.toggle('has-conflict', conflicts.size > 0);
  $('#connection-status').textContent = online ? '已连接 · 演示' : '主控离线 · 你仍可编辑 Save';
  $('#toggle-connection').textContent = online ? '模拟主控断线' : '模拟主控重连';
  $('#simulate-update').disabled = !online;
  $('#approval-status').textContent =
    `选题 ${approval.brief ? '已确认' : '未确认'} / 逐字稿 ${approval.script ? '已确认' : '未确认'} / 成品 ${approval.final ? '已确认' : '未确认'}`;
  $('#approve-stage').textContent =
    stage === 0
      ? approval.brief
        ? '重新打开选题'
        : '标记选题完成'
      : stage === 1
        ? approval.script
          ? '重新打开逐字稿'
          : '标记逐字稿完成'
        : stage === 3
          ? '批准最终成品'
          : stage === 2
            ? '转到最终检查'
            : '平台发布由你确认';
  $('#approve-stage').disabled = drafts.size > 0 || conflicts.size > 0 || stage === 4;
  all('[data-stage]').forEach((button) =>
    button.setAttribute('aria-current', Number(button.dataset.stage) === stage ? 'step' : 'false'),
  );
  publishContext();
}
function editField(key, value) {
  recentField = key;
  draftRevisions.set(key, (draftRevisions.get(key) ?? 0) + 1);
  selection = null;
  lastActivity = `正在编辑${fieldName(key)} · 未 Save`;
  if (value === canonical[key]) {
    drafts.delete(key);
    conflicts.delete(key);
  } else if (drafts.has(key)) drafts.get(key).value = value;
  else drafts.set(key, { value, base: canonical[key] ?? '' });
  updateStatus();
  const preview = document.getElementById(`local-${key}`);
  if (preview) preview.textContent = value;
  if (!conflicts.has(key)) renderConflicts();
}
function field(key, rows = 5) {
  const wrapper = document.createElement('div');
  wrapper.className = 'editable-field';
  const label = document.createElement('label');
  label.textContent = fieldName(key);
  label.htmlFor = `field-${key}`;
  const input = document.createElement(rows === 1 ? 'input' : 'textarea');
  input.id = `field-${key}`;
  input.dataset.field = key;
  input.value = valueOf(key);
  if (rows > 1) input.rows = rows;
  input.addEventListener('focus', () => {
    recentField = key;
    if (selection?.target !== key) selection = null;
    lastActivity = `正在查看${fieldName(key)}`;
    publishContext();
  });
  input.addEventListener('input', () => editField(key, input.value));
  input.addEventListener('select', () => {
    if (document.activeElement !== input) return;
    recentField = key;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? start;
    selection =
      start !== end
        ? { target: key, start, end, text: input.value.slice(start, end), value: input.value }
        : null;
    if (selection) lastActivity = `选中了${fieldName(key)}的一段内容`;
    publishContext();
  });
  input.addEventListener('compositionstart', () => {
    composing = true;
    publishContext();
  });
  input.addEventListener('compositionend', () => {
    composing = false;
    editField(key, input.value);
  });
  const note = document.createElement('small');
  note.textContent =
    rows === 1 ? '你可以直接修改，Save 后生效。' : 'Markdown · 可手工编辑；未保存稿不会被实时更新覆盖。';
  wrapper.append(label, input, note);
  return wrapper;
}
function renderSourceList() {
  const list = $('#source-list');
  if (!list) return;
  list.replaceChildren(
    ...sourceIds.map((id) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'source-list-button';
      const title = document.createElement('strong');
      title.textContent = valueOf(sourceKey(id, 'title')) || '未命名素材';
      const note = document.createElement('small');
      note.textContent = `${id} · ${canonical[sourceKey(id, 'content')].replace(/\n/g, ' ').slice(0, 58)}…`;
      const arrow = document.createElement('span');
      arrow.textContent = '↗';
      button.append(title, note, arrow);
      button.addEventListener('click', () => {
        selectedSource = id;
        renderEditor();
      });
      li.append(button);
      return li;
    }),
  );
}
function renderEditor() {
  pageEpoch++;
  selection = null;
  lastActivity = `打开${stageNames[stage]}${selectedSource ? ` · 素材 ${selectedSource}` : ''}`;
  $('#editor-stages').replaceChildren(
    ...stageNames.map((name, index) => {
      const button = document.createElement('button');
      button.dataset.stage = index;
      button.textContent = `${index + 1} ${name}`;
      button.addEventListener('click', () => {
        stage = index;
        selectedSource = null;
        renderEditor();
      });
      return button;
    }),
  );
  const region = $('#editor-fields');
  region.replaceChildren();
  if (stage === 0 && selectedSource) {
    const back = document.createElement('button');
    back.className = 'outline source-back';
    back.textContent = '← 返回选题与素材列表';
    back.addEventListener('click', () => {
      selectedSource = null;
      renderEditor();
    });
    region.append(
      back,
      field(sourceKey(selectedSource, 'title'), 1),
      field(sourceKey(selectedSource, 'content'), 10),
    );
  } else if (stage === 0) {
    region.append(field('title', 1), field('intent', 4));
    const heading = document.createElement('div');
    heading.className = 'source-list-heading';
    const title = document.createElement('h4');
    title.textContent = '原始素材';
    const add = document.createElement('button');
    add.className = 'outline';
    add.textContent = '添加素材';
    add.addEventListener('click', () => {
      const id = `s${nextSource++}`;
      sourceIds.push(id);
      canonical[sourceKey(id, 'title')] = '';
      canonical[sourceKey(id, 'content')] = '';
      editField(sourceKey(id, 'title'), '我的新素材');
      editField(sourceKey(id, 'content'), '# 原始素材\n\n在这里输入你的资料。');
      selectedSource = id;
      renderEditor();
    });
    heading.append(title, add);
    const list = document.createElement('ul');
    list.id = 'source-list';
    list.className = 'source-list';
    region.append(heading, list);
    renderSourceList();
  } else if (stage === 1) region.append(field('transcript', 13));
  else if (stage === 2) {
    region.append(field('summary', 3), field('description', 6));
    const bar = document.createElement('div');
    bar.className = 'media-demo';
    const audio = document.createElement('button');
    audio.className = 'outline';
    audio.textContent = audioReady ? '音频已完成（模拟）' : '制作音频（模拟）';
    audio.addEventListener('click', () => {
      if (!approval.script) notice = '请先在左侧批准逐字稿，再发起音频制作。';
      else {
        audioReady = true;
        notice = '已模拟云端音频完成；没有真实音频或计费请求。';
      }
      updateStatus();
    });
    const cover = document.createElement('button');
    cover.className = 'outline';
    cover.textContent = '确认已有封面（模拟）';
    cover.addEventListener('click', () => {
      coverReady = true;
      notice = '已记录示例封面，不上传任何文件。';
      updateStatus();
    });
    bar.append(audio, cover);
    region.append(bar);
  } else {
    const preview = document.createElement('pre');
    preview.className = 'markdown-paper';
    preview.textContent =
      stage === 3
        ? `${canonical.transcript}\n\n---\n音频：${audioReady ? '已完成（模拟）' : '待制作'}\n封面：${coverReady ? '已就绪（模拟）' : '待确认'}`
        : '# 发布材料\n\n继续沿用已有的微信 / 小宇宙发布流程。\n\n由你实际发布后记录平台 URL 与时间。主控只协助准备，不代替确认。';
    region.append(preview);
  }
  recentField =
    stage === 0 && selectedSource
      ? sourceKey(selectedSource, 'content')
      : ['intent', 'transcript', 'description', 'transcript', 'description'][stage];
  renderConflicts();
  updateStatus();
}
function renderConflicts() {
  const region = $('#conflict-region');
  region.hidden = conflicts.size === 0;
  region.replaceChildren(
    ...[...conflicts].map((key) => {
      const box = document.createElement('article');
      box.className = 'field-conflict';
      const title = document.createElement('strong');
      title.textContent = `${fieldName(key)}：你和主控修改了同一处`;
      const comparison = document.createElement('div');
      comparison.className = 'conflict-comparison';
      for (const [name, content, isLocal] of [
        ['你的未保存稿', valueOf(key), true],
        ['网站已保存版本', canonical[key], false],
      ]) {
        const item = document.createElement('div');
        const label = document.createElement('small');
        label.textContent = name;
        const pre = document.createElement('pre');
        pre.textContent = content;
        if (isLocal) pre.id = `local-${key}`;
        item.append(label, pre);
        comparison.append(item);
      }
      const local = document.createElement('button');
      local.className = 'outline';
      local.textContent = '保留我的草稿，随后 Save';
      local.addEventListener('click', () => {
        drafts.get(key).base = canonical[key];
        conflicts.delete(key);
        notice = '保留了你的选择，尚未保存。请点 Save 提交这一版。';
        renderConflicts();
        updateStatus();
      });
      const remote = document.createElement('button');
      remote.className = 'outline';
      remote.textContent = '采用主控已保存版本';
      remote.addEventListener('click', () => {
        drafts.delete(key);
        conflicts.delete(key);
        const input = all('[data-field]').find((item) => item.dataset.field === key);
        if (input) input.value = canonical[key];
        notice = '已采用网站保存的内容，其它字段草稿不变。';
        renderConflicts();
        updateStatus();
      });
      const buttons = document.createElement('div');
      buttons.className = 'conflict-buttons';
      buttons.append(local, remote);
      box.append(title, comparison, buttons);
      return box;
    }),
  );
}
function saveEdits() {
  if (!drafts.size || conflicts.size) return false;
  if (raceNextSave) {
    raceNextSave = false;
    const key = drafts.keys().next().value;
    syncRemote({ [key]: `${canonical[key]}\n\n主控在你点击 Save 的同时补充了一条说明。` });
    notice = '模拟 409：保存期间网站版本变了。你的输入完整保留，请比较后再保存。';
    lastActivity = 'Save 返回 409 · 本地稿保留，等待选版';
    updateStatus();
    return false;
  }
  const submitted = Object.fromEntries([...drafts].map(([key, value]) => [key, value.value]));
  Object.assign(canonical, submitted);
  version++;
  invalidate(Object.keys(submitted));
  drafts.clear();
  lastChange = `你已保存 · v${version}`;
  selection = null;
  lastActivity = `Save 成功 · 网站 v${version}`;
  notice = '保存成功。主控后续工作会读取你的新版本。';
  renderSourceList();
  updateStatus();
  addMessage(
    'controller',
    `已看到你保存的${Object.keys(submitted).map(fieldName).join('、')}。我会以这一版继续，保留你刚做的修改。`,
  );
  return true;
}
function refreshMessage(message, basis) {
  publishContext();
  const context = structuredClone(acknowledgedContext);
  return { ...message, target: context.target, context, basis };
}
function showPending(message) {
  pendingMessage = message;
  const warning = $('#draft-context-warning');
  warning.hidden = false;
  warning.replaceChildren();
  const text = document.createElement('p');
  text.textContent = '主控已理解你正在编辑未保存稿。选择修改草稿（不 Save），或明确只处理网站保存版。';
  const draft = document.createElement('button');
  draft.type = 'button';
  draft.className = 'outline';
  draft.textContent = '按当前草稿修改，不保存';
  draft.addEventListener('click', () => runMessage({ ...message, basis: 'draft' }));
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'outline';
  save.textContent = '先 Save 再发送';
  save.addEventListener('click', () => {
    if (message.context.pageEpoch !== pageEpoch || message.target !== currentTarget()) {
      staleReply(message, '待发送请求的原页面已经变化，请回到原对象或重新明确目标。');
      return;
    }
    if (saveEdits()) runMessage(refreshMessage(message, 'canonical'));
  });
  const saved = document.createElement('button');
  saved.type = 'button';
  saved.className = 'outline';
  saved.textContent = '仅基于已保存版本发送';
  saved.addEventListener('click', () => runMessage({ ...message, basis: 'canonical' }));
  warning.append(text, draft, save, saved);
}
function requestMessage(text, action = 'improve', fromComposer = false) {
  publishContext();
  if (!sharing || contextStale || composing || !acknowledgedContext) {
    notice = !sharing
      ? '页面共享已暂停，主控不会猜测“这里”。请恢复共享，或明确描述一个不依赖页面的任务。'
      : '当前页面尚未确认同步。先完成输入与同步，再发送“改这里”。';
    updateStatus();
    return;
  }
  const context = structuredClone(acknowledgedContext);
  const message = { text, action, fromComposer, target: context.target, context, basis: 'canonical' };
  if (context.dirty && action === 'improve') showPending(message);
  else runMessage(message);
}
function staleReply(message, reason) {
  notice = reason;
  updateStatus();
  addMessage(
    'controller',
    `${reason}这次工作仍绑定发送时的${fieldName(message.target)}，没有改到你后来打开的页面。`,
    message.target,
  );
}
function runMessage(message, queued = false) {
  if (!message) return;
  if (!queued) {
    pendingMessage = null;
    $('#draft-context-warning').hidden = true;
    addMessage('owner', message.text);
    if (message.fromComposer && $('#owner-message').value.trim() === message.text)
      $('#owner-message').value = '';
  }
  if (!online) {
    queuedMessages.push(message);
    addMessage(
      'controller',
      '消息和发送时的页面快照已在演示队列中等待。重连先核对原对象和版本，不会跟随新页面改错内容。',
    );
    return;
  }
  if (delayNextReply && !queued) {
    delayNextReply = false;
    delayedReply = structuredClone(message);
    $('#release-reply').hidden = false;
    addMessage('controller', '我正在处理你刚才指定的内容。你可以继续操作；这次修改的对象已固定。');
    return;
  }
  if (message.action === 'inspect') {
    const context = message.context;
    addMessage(
      'controller',
      `你发消息时在${context.location}，${context.activity}。当前对象是${fieldName(context.target)}，${context.dirty ? `你有未 Save 的草稿 r${context.draftRevision}` : `网站保存版 v${context.viewedVersion}`}。${context.selection ? `选中的是“${context.selection.text.slice(0, 70)}”。` : '没有选定局部段落。'}我会按这个对象理解“这里”，不会把未保存稿当已保存内容。`,
    );
    return;
  }
  if (message.action === 'source') {
    if (message.context.viewedVersion !== version) {
      staleReply(message, '发送后节目版本已变化，新增素材暂未写回，请重新核对。');
      return;
    }
    if (approval.brief) {
      addMessage('controller', '选题已经确认。请先在左侧重新打开选题阶段，我再补充素材。');
      return;
    }
    const id = `s${nextSource++}`;
    sourceIds.push(id);
    syncRemote({
      [sourceKey(id, 'title')]: '晚饭前的那一次关机 · 资料线索',
      [sourceKey(id, 'content')]:
        '# 新增原始素材（示例）\n\n场景线索：晚饭已经准备好，电脑还开着。\n\n## 可以追问\n- 下周哪一项工作真的需要新工具？\n- 哪段研究结论适用于这个问题？\n\n这是待核实的写作线索，不是真实研究证据。',
    });
    addMessage(
      'controller',
      '已补充一份原始素材，左侧列表已经更新。你可以点开继续修改，再 Save。',
      sourceKey(id, 'content'),
    );
    return;
  }
  const key = message.target;
  const context = message.context;
  if (message.basis === 'draft') {
    if (
      !sharing ||
      contextStale ||
      composing ||
      context.pageEpoch !== pageEpoch ||
      context.shareEpoch !== shareEpoch ||
      context.draftRevision !== (draftRevisions.get(key) ?? 0) ||
      context.value !== valueOf(key) ||
      context.viewedVersion !== version
    ) {
      staleReply(message, '你在发送之后换页、继续编辑或更新了版本；草稿建议暂未应用，原输入保留。');
      return;
    }
    const range = context.selection;
    const revised = range
      ? `${context.value.slice(0, range.start)}${range.text}（示例润色：表达更具体）${context.value.slice(range.end)}`
      : `${context.value}\n\n补充表达：先描述一个具体场景，再交代尚待核实的部分。`;
    editField(key, revised);
    const input = all('[data-field]').find((item) => item.dataset.field === key);
    if (input) input.value = revised;
    lastActivity = '主控建议已应用到浏览器草稿 · 尚未 Save';
    notice = '主控已修改左侧草稿，没有保存网站内容。你可以继续编辑，再 Save。';
    updateStatus();
    addMessage(
      'controller',
      range
        ? `我根据发送时选中的“${range.text.slice(0, 48)}”调整了这一段，其它段落保留。左侧仍是未保存稿。`
        : `已基于你的未保存内容调整${fieldName(key)}，没有替你 Save。`,
      key,
    );
    return;
  }
  if (context.viewedVersion !== version || context.savedValue !== canonical[key]) {
    staleReply(message, '网站内容已变化，未用旧页面快照覆盖新版本。');
    return;
  }
  if (
    ((key === 'intent' || key.startsWith('source:')) && approval.brief) ||
    (key === 'transcript' && (!approval.brief || approval.script))
  ) {
    addMessage('controller', '这个阶段需要你先在左侧完成前置确认，或重新打开当前阶段。我不会替你改变审批。');
    return;
  }
  const range = !context.dirty ? context.selection : null;
  const content = range
    ? `${context.savedValue.slice(0, range.start)}${range.text}（示例润色：表达更具体）${context.savedValue.slice(range.end)}`
    : key === 'intent'
      ? '从一个晚饭已凉、电脑仍亮着的夜晚切入。围绕下周真正要用的一个工具展开，把研究边界讲清楚，让听众为今晚留一点空间。'
      : `${context.savedValue}\n\n## 补充整理\n先写具体场景，再核对来源；没有证据的部分保留为问题，不做确定性断言。`;
  syncRemote({
    [key]:
      content === canonical[key] ? `${content}\n\n本轮补充：用具体场景连接听点，保留核实边界。` : content,
  });
  addMessage(
    'controller',
    conflicts.has(key)
      ? `我已整理并保存${fieldName(key)}。你也正在修改这一处，左侧保留了你的草稿并显示两版，请选择后再继续。`
      : `已整理并保存发送时指定的${fieldName(key)}，左侧已同步。`,
    key,
  );
}
$('#save-edits').addEventListener('click', saveEdits);
$('#chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('#owner-message').value.trim();
  if (text)
    requestMessage(text, /素材|资料/.test(text) && /补充|新增|添加/.test(text) ? 'source' : 'improve', true);
});
$('#ask-source').addEventListener('click', () => requestMessage('请帮我补充一份原始素材。', 'source'));
$('#ask-improve').addEventListener('click', () => requestMessage('帮我把当前内容整理得更具体一些。'));
$('#ask-context').addEventListener('click', () => requestMessage('你看到我在做什么？', 'inspect'));
$('#simulate-update').addEventListener('click', () => {
  if (!online) return;
  const key = all('[data-field]').some((item) => item.dataset.field === recentField)
    ? recentField
    : currentTarget();
  syncRemote({ [key]: `${canonical[key]}\n\n主控补充：把无法核实的结论单独列出，下一轮再核对。` });
  addMessage(
    'controller',
    `已更新${fieldName(key)}。${conflicts.has(key) ? '这处与你的草稿重叠，左侧保留输入等待你选版。' : '左侧已同步。'}`,
    key,
  );
});
$('#toggle-context').addEventListener('click', () => {
  sharing = !sharing;
  shareEpoch++;
  if (!sharing) {
    acknowledgedContext = null;
    pendingMessage = null;
    $('#draft-context-warning').hidden = true;
  } else contextStale = false;
  notice = sharing
    ? '页面共享已恢复。创作草稿可被理解，但未自动 Save。'
    : '已停止新的页面共享。此前明确发送的任务仍保留原来的快照。';
  updateStatus();
});
$('#simulate-context-stale').addEventListener('click', () => {
  contextStale = !contextStale;
  publishContext();
});
$('#simulate-delay').addEventListener('click', () => {
  delayNextReply = true;
  notice = '下次主控回复将延迟送达，你可以测试切页或继续编辑。';
  updateStatus();
});
$('#release-reply').addEventListener('click', () => {
  const message = delayedReply;
  delayedReply = null;
  $('#release-reply').hidden = true;
  runMessage(message, true);
});
$('#simulate-race').addEventListener('click', () => {
  raceNextSave = true;
  notice = '已安排演示：下次有改动点击 Save，将收到 409。';
  updateStatus();
});
$('#toggle-connection').addEventListener('click', () => {
  online = !online;
  notice = online
    ? '主控已重连，补读快照和排队指令，不覆盖本地草稿。'
    : '主控离线；网站表单仍可手动编辑、Save 和人工确认。';
  updateStatus();
  if (online) {
    const queue = queuedMessages;
    queuedMessages = [];
    queue.forEach((message) => runMessage(message, true));
  }
});
$('#approve-stage').addEventListener('click', () => {
  if (drafts.size || conflicts.size) return;
  if (stage === 0) {
    approval.brief = !approval.brief;
    if (!approval.brief) {
      approval.script = false;
      approval.final = false;
      audioReady = false;
    }
    notice = approval.brief ? '你已确认选题，可以继续写稿。' : '你已重新打开选题。';
  } else if (stage === 1) {
    if (!approval.brief) notice = '请先确认选题。';
    else {
      approval.script = !approval.script;
      approval.final = false;
      audioReady = false;
      notice = approval.script ? '你已批准这一版逐字稿，可以制作音频。' : '你已重新打开逐字稿。';
    }
  } else if (stage === 2) {
    stage = 3;
    renderEditor();
  } else if (stage === 3) {
    if (!approval.script || !audioReady || !coverReady)
      notice = '逐字稿、音频、封面尚未全部就绪，不能通过终审。';
    else {
      approval.final = true;
      notice = '你已批准示例成品；平台发布仍由你操作。';
    }
  }
  updateStatus();
});
$('#reset-studio').addEventListener('click', () => {
  canonical = { ...initial };
  version = 1;
  sourceIds = ['s1'];
  nextSource = 2;
  drafts = new Map();
  conflicts = new Set();
  stage = 0;
  selectedSource = null;
  approval = { brief: false, script: false, final: false };
  audioReady = false;
  coverReady = false;
  online = true;
  raceNextSave = false;
  pendingMessage = null;
  recentField = 'intent';
  notice = '演示已重置，可以从补素材开始。';
  lastChange = '所有内容已保存 · 演示版本';
  messages = [];
  queuedMessages = [];
  pageEpoch = 0;
  contextSeq = 0;
  sharing = true;
  shareEpoch = 1;
  contextStale = false;
  composing = false;
  selection = null;
  acknowledgedContext = null;
  draftRevisions = new Map();
  delayNextReply = false;
  delayedReply = null;
  $('#release-reply').hidden = true;
  $('#owner-message').value = '';
  $('#draft-context-warning').hidden = true;
  addMessage(
    'controller',
    '我在右边协助你。你可以直接编辑左侧并 Save，也可以告诉我需要修改什么；完成后内容会出现在左侧。',
  );
  renderEditor();
});
addMessage(
  'controller',
  '我在右边协助你。左侧的选题、原始素材、逐字稿和 Save 都照常使用。你希望我先补充素材，还是整理当前意图？',
);
renderEditor();

const failures = [
  {
    name: '网站断线',
    kicker: 'NETWORK / 通知不是唯一副本',
    title: '工作没有丢，实时状态可能过期。',
    description: '主控正在写稿，机器睡眠或者网络暂时断开。Web 不能继续显示“在线运行中”。',
    truth: '已确认的用户指令在 D1，本机已开始的 assignment 在 SQLite；尚未 ACK 的事件和结果在 outbox。',
    forbidden: '重新创建整期任务，或者租约过期后继续发起付费／外部写操作。',
    steps: [
      ['显示 stale / offline', '保留最后上报时间，区别于失败和已完成。'],
      ['重连并核对租约', '读取 command cursor、operation receipts；旧 epoch 不能写。'],
      ['先补回执，再补事件', '同 operationId 返回已有结果；重复 eventId 去重。'],
      ['恢复安全工作', '纯文本本地成果重新验收；预算、版本和审批仍需有效。'],
    ],
    result: '恢复的是同一个 assignment，不是新的一次生成。',
  },
  {
    name: '主控进程崩溃',
    kicker: 'CRASH / 框架之外也要持久',
    title: '先重建 Host，再恢复 Pi。',
    description: '会话历史还在，但仅存在于内存的工具 ticket、schema 和 action closure 已经消失。',
    truth: 'assignment 保存任务身份、输入 hash、profile、权限和 schema version；执行句柄可以从这些信息重建。',
    forbidden: '一打开 Harness 就 resume，或者重问 Jev 为同一任务换模型再跑。',
    steps: [
      ['获得实例锁，打开存储', '确认没有另一个进程持有该站点 storage。'],
      ['重建 registry 与 assignment', '恢复工具上下文、profile 快照、输入指纹和 outbox。'],
      ['对账中断副作用', 'API 查 receipt；shell 查文件／job，不知道就 needs_attention。'],
      ['最后 resume scheduler', '安全读取可继续；未知 CLI 不自动重放。'],
    ],
    result: 'Pi 的 durable transcript + 应用 durable assignment，二者缺一不可。',
  },
  {
    name: '写回遇到 409',
    kicker: 'CONFLICT / 人类编辑优先保留',
    title: '候选稿留下，不能覆盖你的新稿。',
    description: 'writer 用 production v5 写完，你已在 Web 修改为 v6。主控持有的是旧输入。',
    truth: '候选 Markdown、输入 v5 和审校 hash 均保留；canonical 当前是 v6。',
    forbidden: '只换一个最新 version 数字，原样重试旧全文。',
    steps: [
      ['停止旧 operation', '写入未成功，不生成假的 completed 回执。'],
      ['读取 v6 与 profile', '展示人类改动和候选稿差异，检查是否还适用。'],
      ['由主控决定重做范围', '新 assignment / requestId；必要时让 Jev 重新选复用方案。'],
      ['重新验收才提交', '审校绑定新稿 hash，CAS 成功才确认 canonical 写回。'],
    ],
    result: '冲突是新的业务事实，不是网络错误。',
  },
  {
    name: '音频响应丢失',
    kicker: 'PAID EFFECT / 先查已有任务',
    title: '可能已经开始，不要再付一次钱。',
    description: 'POST 音频返回超时，但 Cloudflare 可能已创建 job 并开始合成。',
    truth: '稳定 operationId 和服务端 receipt 可以定位原来的 audioJobId；job 快照绑定已批准 scriptVersion。',
    forbidden: '因为本机重启或超时就重新调用“生成音频”。',
    steps: [
      ['暂停重试生成', '保留 operationId，标记 outcome unknown。'],
      ['查询回执与 job', '找到 J1 正在运行或已经完成；没有回执则按协议对账。'],
      ['继续观察同一 job', '只认云端状态，不相信本机估算进度。'],
      ['匹配版本后收取资产', '旧 scriptVersion 的音频不能附到新稿。'],
    ],
    result: '去重网站音频请求；上游响应丢失仍不保证 exactly-once billing。',
  },
  {
    name: 'Jev 不可用',
    kicker: 'DECISION / 不静默 fallback',
    title: '暂停新派发，保留已冻结的决定。',
    description: 'Falcon 超时、结构化答案无效，或者没有合法 profile 可以执行新工作。',
    truth: '已经开始的 assignment 有冻结 decision；新工作还没有合法派发决定。',
    forbidden: '主控随意选一个默认模型／档位，假装是 Jev 的建议。',
    steps: [
      ['标记 waiting_decision', 'Web 显示具体原因，不暴露网关密钥。'],
      ['已有工作按原方案继续', '不为了显示活跃而重问模型。'],
      ['通过主控补充约束', '用户不直接和 Jev 对话，候选集合仍由 host 校验。'],
      ['网关恢复后再决策', '新 requestId 记录一次真实结果，验证候选与概率。'],
    ],
    result: '建议不可用不是授权扩大；排队也比隐形换模型诚实。',
  },
  {
    name: 'Token 撤销 / 接管',
    kicker: 'AUTHORITY / 旧机器不再写回',
    title: '有历史，不等于仍有权限。',
    description: '用户撤销 Token 或明确让另一台机器接管。旧主控可能还在本地运行。',
    truth: '云端 tokenId、station lease 和 epoch 是写回权限；本地历史只用于恢复，不授予网站权限。',
    forbidden: '用本机已有 Access／浏览器身份绕过撤销；旧 epoch 延迟写入。',
    steps: [
      ['机器进入 auth_required', '停止新派发与新外部副作用，断开旧 WSS。'],
      ['Worker 每次重新校验', '验证 Token 有效性、当前 station 与 leaseEpoch。'],
      ['保存本机候选结果', '不删历史、不自动伪造新的身份。'],
      ['用户显式恢复或接管', '新 epoch 排除旧机器；先对账再继续，首版不自动多机 failover。'],
    ],
    result: '全 CLI 下这仍是受信任进程的行为约束，不是防恶意代码的 OS 隔离。',
  },
];
let failureIndex = 0,
  recoveryCount = 0;
function renderRecovery() {
  const value = failures[failureIndex];
  $('#failure-picker').replaceChildren(
    ...failures.map((item, index) => {
      const button = document.createElement('button');
      button.textContent = item.name;
      button.setAttribute('aria-pressed', String(index === failureIndex));
      button.addEventListener('click', () => {
        failureIndex = index;
        recoveryCount = 0;
        renderRecovery();
      });
      return button;
    }),
  );
  $('#failure-kicker').textContent = value.kicker;
  $('#failure-title').textContent = value.title;
  $('#failure-description').textContent = value.description;
  $('#failure-truth').textContent = value.truth;
  $('#failure-forbidden').textContent = value.forbidden;
  $('#recovery-steps').replaceChildren(
    ...value.steps.map(([title, text], index) => {
      const li = document.createElement('li');
      li.classList.toggle('passed', index < recoveryCount);
      const n = document.createElement('b');
      n.textContent = index < recoveryCount ? '✓' : index + 1;
      const div = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = title;
      const p = document.createElement('p');
      p.textContent = text;
      div.append(strong, p);
      li.append(n, div);
      return li;
    }),
  );
  $('#recover').disabled = recoveryCount === value.steps.length;
  $('#recovery-result').textContent =
    recoveryCount === value.steps.length ? value.result : '点击演练恢复顺序。';
}
$('#recover').addEventListener('click', () => {
  recoveryCount = Math.min(recoveryCount + 1, failures[failureIndex].steps.length);
  renderRecovery();
});
renderRecovery();

const scenarios = {
  revise: {
    plans: [
      ['复用本期 writer / medium', '同 production、task scope 和兼容上下文', 0.78],
      ['新建短期 writer / medium', '可行，但丢失本轮编辑上下文', 0.15],
      ['等待主控澄清', '要求已经足够清楚', 0.07],
    ],
    choice: '复用本期 writer',
    explanation:
      '示例输出：profile writer；Jev 决策保存到新 revision 的 assignment。主控仍需验证会话空闲和输入版本。',
  },
  new: {
    plans: [
      ['新建短期研究 / medium', '新 production，不继承旧期事实', 0.86],
      ['等待资料补齐', '已具备初始来源', 0.14],
      ['复用已退休旧期 writer', '非法候选：不发送给 Jev', null],
    ],
    choice: '新建本期研究 conversation',
    explanation: '旧期 writer 不在合法候选中。Jev 无权通过一个高概率值复活已退休的会话。',
  },
  review: {
    plans: [
      ['创建短期独立审校 / low', '长期 reviewer 正忙，本期需继续推进', 0.66],
      ['排队复用长期 reviewer / low', '保留长期经验，但等待时间更长', 0.34],
      ['让作者自审并交付', '非法候选：缺少独立审校', null],
    ],
    choice: '新建短期 reviewer',
    explanation: '长期 reviewer 仍保留身份与当前 assignment。不会把两个节目同时塞进一个 busy conversation。',
  },
  offline: {
    plans: [
      ['新建 conversation', '没有有效 Jev 答案', null],
      ['静默使用默认模型', '禁止的 fallback', null],
      ['保留任务等待决策', '这是 host 状态，不是伪造 Jev 概率', null],
    ],
    choice: 'waiting_decision',
    explanation: '本次无任何概率结果。已有冻结 assignment 可继续；用户只能经主控补充约束或等待恢复。',
  },
};
function renderDecision() {
  const value = scenarios[$('#assignment-kind').value];
  $('#candidate-plans').replaceChildren(
    ...value.plans.map(([title, detail, probability]) => {
      const div = document.createElement('div');
      div.className = 'plan';
      const strong = document.createElement('strong');
      strong.textContent = title;
      const small = document.createElement('small');
      small.textContent = detail;
      const number = document.createElement('span');
      number.className = 'probability';
      number.textContent = probability === null ? '—' : `${Math.round(probability * 100)}%`;
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('i');
      fill.style.width = `${(probability ?? 0) * 100}%`;
      bar.append(fill);
      div.append(strong, number, small, bar);
      return div;
    }),
  );
  $('#decision-choice').textContent = value.choice;
  $('#decision-explanation').textContent = value.explanation;
}
$('#assignment-kind').addEventListener('change', renderDecision);
renderDecision();

const questions = [
  ['R1', '全 CLI 的信任边界', '接受无沙箱、同用户全权限；主控独占 API 是逻辑约束，不是不可绕过隔离。'],
  [
    'R2',
    '人工确认继续存在',
    'brief / script / final 由人类批准，平台实际发布仍由人类记录；主控只验收自己的交付。',
  ],
  ['R3', '模型和档位两者不同', '主控与执行 model、thinking 均不同；执行配置由 Jev 从有限合法 profile 选择。'],
  ['R4', '销毁先是逻辑退休', '停止任务、关闭订阅、禁止复用；保留作品与审计，不把 reset 当物理删除。'],
  [
    'R5',
    '左侧工作室 + 右侧主控',
    '现有阶段与 Save 保留；主控已保存修改实时显示，同字段草稿冲突明确选版；Jev 过程只在内部。',
  ],
  ['R6', '自动交付范围', '可编辑文本由主控验收后写回；付费音频须已有稿件批准和任务授权。'],
  ['R7', '故障不扩大权限', 'Jev 失效暂停新派发；一个活跃 station，首版不自动跨机器接管。'],
  ['R8', '实时传输', 'D1 持久指令与回执 + DO WebSocket 扇出；本机主动连接，无入站服务。'],
];
const reviewKey = 'hisfm-agent-architecture-review-v1';
let stored = {},
  storageAvailable = true;
try {
  stored = JSON.parse(localStorage.getItem(reviewKey) ?? '{}');
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};
} catch {
  storageAvailable = false;
}
const validChoices = ['pending', 'accept', 'change', 'discuss'];
$('#review-questions').replaceChildren(
  ...questions.map(([id, title, description]) => {
    const row = document.createElement('div');
    row.className = 'review-question';
    const n = document.createElement('b');
    n.textContent = id;
    const text = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = title;
    const p = document.createElement('p');
    p.textContent = description;
    text.append(strong, p);
    const label = document.createElement('label');
    label.setAttribute('aria-label', `${id} ${title}`);
    const select = document.createElement('select');
    select.id = `review-${id}`;
    select.setAttribute('aria-label', `${id} ${title}`);
    ['待评审', '接受推荐', '需要修改', '先讨论'].forEach((name, index) => {
      const option = document.createElement('option');
      option.value = validChoices[index];
      option.textContent = name;
      select.append(option);
    });
    select.value = validChoices.includes(stored[id]) ? stored[id] : 'pending';
    select.addEventListener('change', saveReview);
    label.append(select);
    row.append(n, text, label);
    return row;
  }),
);
$('#review-notes').value = typeof stored.notes === 'string' ? stored.notes.slice(0, 20000) : '';
function reviewValue() {
  return Object.fromEntries([
    ...questions.map(([id]) => [id, $(`#review-${id}`).value]),
    ['notes', $('#review-notes').value.slice(0, 20000)],
  ]);
}
function saveReview() {
  try {
    localStorage.setItem(reviewKey, JSON.stringify(reviewValue()));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
  }
  $('#review-save').textContent = storageAvailable
    ? '已保存在此浏览器；未发送到网站'
    : '浏览器存储不可用，请导出后保存';
}
$('#review-notes').addEventListener('input', saveReview);
if (Object.keys(stored).length) $('#review-save').textContent = '已恢复此浏览器的评审草稿';
if (!storageAvailable) $('#review-save').textContent = '浏览器存储不可用；仍可导出';
$('#clear-review').addEventListener('click', () => {
  if (!window.confirm('清空此浏览器保存的架构评审意见？')) return;
  questions.forEach(([id]) => {
    $(`#review-${id}`).value = 'pending';
  });
  $('#review-notes').value = '';
  saveReview();
});
$('#export-review').addEventListener('click', () => {
  const value = reviewValue();
  const labels = { pending: '待评审', accept: '接受推荐', change: '需要修改', discuss: '先讨论' };
  const text = [
    '# his.fm 核心 Agent 架构评审',
    '',
    `日期：${new Date().toISOString().slice(0, 10)}`,
    '',
    '状态：设计 Review，不自动授权实现或运行。',
    '',
    ...questions.flatMap(([id, title, description]) => [
      `## ${id} ${title}`,
      `立场：${labels[value[id]]}`,
      description,
      '',
    ]),
    '## 其他意见',
    value.notes || '暂无',
    '',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hisfm-agent-architecture-review.md';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('#review-save').textContent = '已导出 Markdown；未提交到网站';
});
