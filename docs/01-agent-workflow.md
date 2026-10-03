# 01 · his.fm 核心 Agent 工作流

状态：架构提案，等待用户 Review。2026-10-03。集成方式已按最新反馈修订：左侧现有制作流程、右侧持续主控聊天；内部 Jev 决策不向用户播报。**本文和交互演示不表示系统已实现，也不授权启动 agent。**

[打开交互架构图](01-agent-workflow/index.html) · [文档目录](README.md) · [02 · 页面上下文与 API 重构](02-page-context-api.md)

本机可直接用 Chrome 打开 `docs/01-agent-workflow/index.html`，不需要运行网站。页面的字体也来自仓库内素材，没有第三方网络请求。验证命令：`node docs/01-agent-workflow/verify.mjs`；截图写入被忽略的 `.local/agent-architecture/`。评审页为独立静态文档，不发布到生产，也不冒充已经集成的 Basalt 管理界面。

默认打开“工作室协同”原型：可添加／打开素材、手工编辑和 Save、从右侧请求修改，并演练同字段冲突、409、断线队列。内部架构、恢复协议和 Jev 仅作为技术评审附录。原型检验交互契约，不宣称已实现生产同步、真实模型、真实媒体或 CodeMirror 的完整 undo/IME 行为；这些仍属于实施验收。

## 1. 目标与明确不做的事

把本机 agent 作为播客制作的一等参与者：用户在 Web 给唯一主控下达工作；主控通过 Jev 决策调度长期／短期 conversation，验收后写回节目。研究、翻译、提纲、初稿、修改、正式逐字稿、节目介绍、审校报告均交付 Markdown；音频仍为 WAV 等二进制，附带 Markdown 制作报告，不能把“全部文字用 Markdown”误解为媒体也转成 Markdown。

本轮只增加设计文档与静态演示，不修改生产 API、数据、权限、模型配置或 `packages/agent`。不启动 agent，不生成音频，不调用业务模型，不部署。页面中的角色、概率、进度、稿件和故障均为确定性的模拟数据。

实施后仍是一个 npm monorepo、一个网站 Worker、一个本机 agent 进程。不要引入 Redis、消息中间件、通用多租户 agent 平台，或把多个 conversation 包装为多个 CLI agent 进程。一个 Pi Durable Harness 已能并行运行多个 conversation。

## 2. 调研基线：事实与提案分开

### 已有 his.fm 能力

基线提交 `09af3dbcb874025b7a912a32a9a81fc461f88bfa`，版本 `2.0.5`。

| 模块／文件 | 已实现 | 本次需要补齐 |
| --- | --- | --- |
| `apps/web/worker/agent-tokens.ts` | hash-only、到期／撤销的 Bearer Token；Access 管理入口 | 机器绑定、结构化 tokenId、运行租约／撤销传播；现有 Token **没有细粒度 scope** |
| `apps/web/worker/agent-api.ts`、`agent-contract.ts` | REST discovery、OpenAPI、capabilities、节目操作 | 原生 agent 任务／连接协议、运行态、幂等操作；替换 Hermes 文案和引导 |
| `apps/web/src/shared/production.ts`、`worker/production-model.ts` | 7 个后端制作状态、5 个前端步骤、乐观版本、agent 可写字段和人工审批 | 与任务／成果联动，不另造一套“agent 制作状态”取代它 |
| `apps/web/worker/production-store.ts` | D1 CAS、每节目最多 200 条业务历史 | agent 遥测独立保存，不能心跳一次就吃掉一个业务历史名额 |
| `apps/web/worker/audio-routes.ts`、`audio-workflow.ts` | 已批准逐字稿 → 云端音频任务 → R2；快照、重试和脚本版本检查 | 主控发起／跟踪、operationId 去重、Markdown 播读快照 |
| `apps/web/src/admin/production/*` | 手工编辑／确认、复制给外部 agent 的提示词、刷新取回 | 原生“交给主控”、任务卡、成果历史、主控对话和实时状态 |
| `apps/web/worker/channel.ts` | 私有全局提示词及 version，agent 只读 | 每个 assignment 固定 profileVersion，写回前检查是否变化 |
| `packages/agent/.gitkeep` | 空目录 | 待批准后成为本地运行时包 |

### Pi Durable 1.0：可复用与不能假定

参考 [Earendil 文章](https://earendil.com/posts/pi-durable/) 和 [Durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)，并读取 `../giraffe/packages/agent/node_modules/@earendil-works/pi-durable` 的 **1.0.0** README／类型。上游 main 可变化；实施前锁定具体版本并复核。

- `Harness.open`、SQLite、`root`、`createConversation`、`configure`、durable tasks/docs、`requestId`、`resume`、`watch` 已存在；不是自己实现一套 LLM turn loop。
- 角色／长期和短期语义／Jev 调度／网站同步是应用能力，不是框架内置“多 agent”。
- 一个 storage 只允许一个拥有进程；框架不提供跨进程锁。启动前另加本机实例锁。
- `requestId` 对 submission 去重，不等于 shell、HTTP、计费调用或整条业务链路 exactly-once。
- SQLite 默认 WAL、`synchronous=NORMAL`：可恢复进程崩溃，不保证突然断电时最后一次提交不丢。不能在文档中承诺零数据损失。
- `watch` 是当前快照与变更流，不是永久消息队列；慢消费者超过 100 帧会被最新快照替换。应用须自建有界事件游标和重连协议。
- `reset`／compaction 不删除历史。未找到可直接依赖的“物理删除一个 conversation”公共契约；销毁必须区分停止调度与物理清理。
- task-owned 子会话会继承 agent 配置，fork 也会继承历史。执行会话必须显式选择 tools/extensions，不 fork 含主控上下文的 root，避免误继承网站工具。

### Giraffe：参考，不复制业务框架

只读基线 `bfd595b63bc9dd8efed58334e8b81707d5d160b7`；该仓 agent 也进行了只读核对。

| 文件（相对 `../giraffe/packages/agent/src/`） | 借鉴 | his.fm 的差异 |
| --- | --- | --- |
| `config.ts`、`models.ts` | schema 验证、provider 注册、私有文件写入 | 用户要求一份 `~/.config/his.fm/config.json`；不照搬独立 credentials.json |
| `instance.ts` | SQLite `BEGIN IMMEDIATE` 单实例锁 | 锁作用域为目标网站／频道，不以进程 PID 猜测存活 |
| `work-priority.ts`、`decision.ts` | TypeSafe SDK、Falcon 标识头、有限选项和概率验证 | 新增 Jev 对复用／新建／退休及 model＋thinking 的联合选择 |
| `work-conversations.ts` | 稳定 business key、结果 schema、独立审校 conversation | `active Map` 的 closure 不是 durable；所有 assignment 数据先落盘，恢复前重建工具上下文 |
| `work-analysis.ts`、`work-daemon.ts` | 冻结输入、先持久化后上报、终态重传、不重做业务 | 事件驱动收件箱代替仓库 cron；不复制 GitHub repair/push 工作流 |
| `work-recovery.test.ts` | 真 SQLite reopen＋假外部副作用 | 追加稿件 CAS、失联、撤销、音频去重、断点重建测试 |

Giraffe 当前 Jev 从少数固定 profile 选 worker，并不负责会话复用／销毁；不要把这里的新设计描述成 Giraffe 已有能力。其受限 workspace tool 也不是本项目要求的完整本机 CLI。

## 3. 总体架构与权威数据归属

```text
用户（Cloudflare Access）
  └─ Web：只向主控发消息；其余角色只观察
       ├─ Worker /admin/api/agent/*：指令、确认、快照、作品
       └─ AgentHub Durable Object：WebSocket 通知／连接状态，不运行 LLM
                    ↑ 仅本机主动向外连接，无本机入站服务
本机 hisfm agent
  ├─ Host：单实例锁、租约、收件箱、发件箱、白名单 profile 验证、事件投影
  ├─ Pi Durable / SQLite
  │    ├─ coordinator：唯一网站 client，唯一用户对话入口
  │    ├─ resident conversations：长期审校／术语等角色
  │    └─ episode task conversations：本次节目／任务的写作与修改
  ├─ Jev → 本机 Falcon：选择合法调度方案，不执行工作、不获得审批权
  └─ NodeExecutionEnv / CodingTools：本机文件、bash、已有 CLI，无沙箱

现有 Worker → D1（节目／审批／任务） → AudioWorkflow → R2 音频
```

“主控”包含确定性的 host 编排层和 root conversation，不让 LLM 直接持有 Token 字符串。host 中唯一 product client 服务于主控工具、心跳和遥测；这不是另一个自治角色。其他 conversation 可以调用自己的模型／本机 CLI，但不注册网站 API tool，不持有独立网站连接。Jev 的 HTTP client 是本机决策连接，不是网站连接。

| 权威 | 内容 | 不负责 |
| --- | --- | --- |
| 本机 Pi SQLite | 原始 conversation、durable assignment、决策快照、工具断点、未确认发件箱 | 不取代网站审批、节目版本和用户任务队列 |
| 云端 D1 | 用户指令、任务状态、机器租约、网站可见事件、成果索引、操作回执、节目／审批 | 不存模型密钥和完整内部推理文本 |
| R2 | 独立私有 `AGENT_ARTIFACTS` bucket 保存 Markdown 成果／源快照；已有 `MEDIA` bucket 继续存公开音频／封面 | 未审核研究资料不走公开 CDN；本地临时文件不自动上传 |
| AgentHub DO | 在线 socket、唤醒、扇出通知、连接 attachment | 不当第二个任务数据库，不直接改节目，不保存另一份审批真相 |
| Web ViewModel | 由快照＋事件生成可见状态 | 不推断“有心跳＝工作成功”，不直接驱动子会话 |

采用 DO 是为单频道的连接协调和 WebSocket 扇出，不是将 Pi Durable 移到 Cloudflare。D1 持久化先成功，再发送 DO 通知；通知可能丢失，因此客户端用游标补读。避免 D1／DO 双写都声称自己是唯一真相。

**不能把私有成果仅换个前缀就写进现有 MEDIA bucket。** 当前 `f.no.mt` 是该 bucket 的公开 CDN，`worker/index.ts` 的 `/media/*` 也可按 key 读取。新增独立、无公开域名的 R2 binding，只有鉴权后的成果 controller 可读写；不提供公开 presigned URL，不让现有资源清理器误扫这个 bucket。已批准的公开内容仍通过现有 publication snapshot 显式发布。

## 4. 主控与 conversation 生命周期

### 唯一主控

每个网站／频道一个稳定 root conversation；同时只允许一个拥有租约的本机 daemon。空闲时阻塞等待，不轮询问模型“还有什么要做”。收到持久指令后才调用模型；主控规划／验收串行，执行 conversation 可以并行。

派发工具提交 durable assignment 后立即返回 taskId，不在 root 工具里阻塞等待长篇写稿或音频。子任务完成转成主控的系统通知；主控便能在工作进行中处理用户追加意见、暂停和取消。系统通知与人类消息有不同 actor，不伪装成人类。

主控工具建议：`read_context`、`decide_assignment`、`dispatch`、`inspect_work`、`accept_artifact`、`commit_production`、`request_audio`、`report_to_owner`、`retire_conversation`。它们是固定的 host extension，而非允许模型动态安装任意网站客户端。

### 长期 conversation

用途例：事实／引文审校、中文表达审校、稳定术语规范。长期指 **身份和有效历史跨重启保留**，不指持续生成、永不压缩或常驻一个模型请求。

复用条件：同频道、同职责、兼容的任务类型、有效策略版本、未退休、当前空闲。每次 assignment 都带新输入包，历史不是本期事实来源；跨期只保留可复用编辑规则及附来源的知识，不能把上期的人名、引文、数字当本期证据。一个长期审校会话一次只处理一个 assignment；忙时由 Jev 从“排队复用”或“另建短期审校”选，不向同一 conversation 并发灌稿。

长期经验的提升同样需要主控验收：审校者输出 `memory-proposal.md`，主控只收录去掉本期私有细节、带出处和适用边界的规则，并绑定 channel profileVersion。原始历史可以检索，但压缩摘要不是权威知识库，也不能覆盖当前全局提示词。

持久身份使用应用 registry，不与某一次 root turn 的 task 所有权绑定。取消某一期只取消对应 assignment，不抹除跨期角色。压缩后仍可检索历史，不能称为删除。

### 短期 conversation

稳定 key 为 `siteId + productionId + taskId + role + branch`；可跨多轮改稿和多个 daemon 启动，直到该工作交付／撤销。一次修改任务不等于一次 LLM turn。

新一集、新授权范围、不同基础稿件或不兼容角色不复用同一个短期 conversation。旧稿改写产生新的 assignment 和输入指纹，不复用同一 requestId 提交不同内容。允许同一期同时有翻译、写作、审校，但同一 canonical 字段只有一条待写回流水线。

### 创建、改配、销毁

`proposed → idle → busy → idle → retiring → archived`。Jev 推荐合法动作，主控 host 验证并执行。

- 新建必须由 durable transaction 保存 conversationId、assignment、decision 和 requestId，再提交模型输入。
- profile 调整仅在 assignment 边界；运行中的工具调用不热切换 cwd／工具集合。配置文件更改不悄悄修改在途任务。
- 停止／销毁先终止其活动任务、关闭订阅和 CLI 子进程，确认清理结果，再从活跃 registry 退休。审计、已交付 Markdown 与引用关系保留。
- 默认“销毁”是禁止复用的逻辑退休，不承诺物理擦除 SQLite 历史。物理清理需在停止 daemon、校验无活动任务／引用后做 session rotation＋备份保留策略；具体 retention 值待 Review，不能调用不存在的 `deleteConversation()`。

## 5. Jev 的决策契约

通过本机 Falcon（默认 `http://127.0.0.1:19823`）调用 TypeSafe `systemOne`，参考 Giraffe 使用的 `@typesafe-ai/sdk`，不把 Jev 当 OpenAI chat completion。实际 model、endpoint、source key 均来自 his.fm 自己的配置，不读取其它项目的私有配置。

host 先产生**有限合法候选**，每个 planId 绑定 `{action, conversationId?, lifetime, role, profileId}`；Jev 只在这些完整方案中选一个，避免分别选 model／thinking／reuse 后得到不兼容的组合。

输入仅含任务类型、目标、风险、待处理字数、需要的上下文、来源完整性、候选会话摘要／忙闲、profile 能力及预算。不给 Token、完整历史、原始私密材料或原始工具输出。设 24 KiB 决策输入上限，不能截断关键权限和版本字段；超限先生成可验证的摘要再决策。

输出校验：choice 必须来自候选，概率键完整且和约等于 1，数值有限且在范围内。记录 gateway requestId、模型实际返回名、输入 hash、候选、choice、confidence、probabilities、policy/config digest、时间与决策摘要。概率是相对偏好，不是成功率、事实可信度或授权。

**必须由 Jev 决定**执行 conversation 的 model＋thinking，以及复用还是创建。主控可拒绝违法／过期方案并缩小候选重新请求，不可静默换成自己的默认模型。网关不可用、输出无效或无足够区分度时进入 `waiting_decision`；暂停新派发，Web 只显示“工作暂时排队／需要补充信息”等可操作状态，内部决策故障码不进聊天；允许用户通过主控补充约束。已有冻结 assignment 可以继续；不重问 Jev 来“恢复”同一 assignment。

Jev 的请求、概率和决定只写本机内部审计；网站仅接收必要的任务进度与成果，不需要知道一次会话创建背后的决策过程。

空闲回收可批量问一次 Jev，不要每次 tool call 都问。主控模型由配置固定，Jev 不能把执行 profile 升格为主控或赋予新权限。独立审校有独立 conversationId，不能让作者自己担任唯一验收者。

## 6. 一份本机配置

文件：`~/.config/his.fm/config.json`；目录权限 0700、文件 0600、原子写入。只在明确安装／配置时设置这些权限，本次设计不操作用户配置。运行记录另存同目录 `state/<siteId>/`，不另造第二份配置／凭据来源。

示意配置（占位 ID 必须在实施时验证；不是可直接运行的生产配置）：

```json
{
  "schemaVersion": 1,
  "website": {
    "baseUrl": "https://his.fm",
    "stationId": "studio-mac",
    "token": "<his.fm-agent-token>"
  },
  "providers": {
    "primary": {
      "api": "openai-responses",
      "baseUrl": "<model-gateway-https-url>",
      "apiKey": "<model-gateway-key>"
    }
  },
  "coordinator": {
    "provider": "primary",
    "model": "<coordinator-model-id>",
    "thinkingLevel": "high"
  },
  "executionProfiles": {
    "writer": {
      "provider": "primary",
      "model": "<executor-model-id>",
      "thinkingLevel": "medium",
      "capabilities": ["research", "translate", "outline", "write", "revise"]
    },
    "reviewer": {
      "provider": "primary",
      "model": "<review-model-id>",
      "thinkingLevel": "low",
      "capabilities": ["review"]
    }
  },
  "decision": {
    "api": "typesafe-systemone",
    "baseUrl": "http://127.0.0.1:19823",
    "apiKey": "<his.fm-falcon-source-key>",
    "model": "jev-latest",
    "timeoutMs": 35000
  },
  "runtime": {
    "workspaceRoot": "~/.config/his.fm/work",
    "maxConcurrentAssignments": 3,
    "maxRevisionRounds": 5,
    "maxTaskMinutes": 60
  }
}
```

配置预检须拒绝：URL 凭据／query／fragment、不受支持的 provider API 或 thinking level、主控与执行使用相同 model 或相同 thinking level、未知 profile、空凭据、错误站点、目录不可写。这里按需求严格解释“不同的 model 和 think level”为两者均不同，作为 Review 决策项；若要允许同模型不同档，需显式修改此约束。

真实可用 thinking level 从 Pi／provider 能力取得，不能把 CLI 的 `max/xhigh` 字符串直接假定成 SDK 参数；不静默 clamp。不支持则启动失败并显示具体配置路径（不输出值）。Jev 无 LLM thinking 参数，不伪造一项。预算字段是运行控制，不自动扩展权限。旧配置 digest 的在途 assignment 必须可重建或安全暂停。

本次安装的 Pi AI 1.0 类型实际包含 `off/minimal/low/medium/high/xhigh/max`；类型能表达并不代表每个模型都支持。profile 还需填写／验证 contextWindow、maxTokens 等调用限制。端点和密钥留配置文件，durable task 只保存 profileId 与非秘密快照；密钥轮换不复制到历史 transcript。正常 `start` 前台常驻并处理 SIGINT/SIGTERM；是否安装 launchd 自动启动是后续明确操作，不在首次连接时悄悄安装系统服务。

## 7. 常驻连接、用户消息与实时观测

### 启动与在线定义

`validate config → acquire local lock → open storage → install registry → rebuild assignments/tools/outbox → authenticate /me + capabilities → acquire station lease → reconcile commands/effects → resume scheduler → connect live stream`。

不能在工具 ticket 重建前 `resume()`，否则恢复的工具读到空 Map。站点／频道变化使用新 storage namespace，拒绝跨环境继续旧任务。Token 到期／撤销后停止领取、新派发及写回；Web 显示 `auth_required`，不弹出无人值守浏览器登录。

本机主动建立 WSS，Web 浏览器单独连同一 AgentHub；不在用户机器开放端口，不要求公网回连。建议 heartbeat 15 秒、45 秒无有效心跳标为离线，站点写租约 60 秒；这些是待验证的产品目标，不是观测结果。休眠／网络断开与“任务失败”分开，显示最后上报时间和未确认结果数。

### durable 协议

HTTP 持久入口负责写，WSS 只负责通知／状态投影：

1. 用户向 Access 保护的 `/admin/api/agent/commands` 提交带 clientRequestId 的消息／任务，D1 持久化成功才显示“已收到”；机器离线时仍可排队。
2. Worker 尝试通知 DO，DO 唤醒机器；丢失通知不丢任务，机器启动／重连／心跳检查 command cursor。
3. 主控领取 command，保存本地 assignment 后 ACK；commandId 映射为 Pi requestId，重复投递不重复派发。
4. 运行事件先本地持久化，批量送 Worker；云端分配递增 cursor 并广播。浏览器以 snapshot＋cursor 补读，事件重复去重，缺口重取快照。
5. WSS 断开不从头生成；本机 outbox 在 ACK 前保留。恢复后先查 operation receipts，再重传未提交事件。

事件区分 `command_received / assignment_started / artifact_ready / review_failed / operation_committed / waiting_human / interrupted / completed`。关键审计事件持久；token 流和 tool 活跃指标可合并，建议每秒至多 5 帧、每批 64 KiB。满队列背压，禁止丢掉完成／撤销／版本冲突事件。浏览器落后于 retention 游标时必须显式 reset snapshot，不能把进度跳变伪装为连续。

建议首版容量：每 task 至多 100 个成果 revision、单 Markdown 成果 256 KiB、一次 source 快照 2 MiB、频道事件日志 30 天；关键 receipt 至少覆盖任务与重试保留期，不能早于最后可重放 assignment 被清理。本机磁盘达预算进入 needs_attention，不删除活动任务或未 ACK outbox。这些值列为实现前容量测试参数，不是现有能力；超过 30 天的 UI 从归档任务快照恢复，不要求无限重放事件流。

在线连接授权不是一次性永久通行证。浏览器 Access 会话／JWT 到期重连，Token 撤销时断开机器连接；每个持久操作重新查 token 与租约。WSS 不在 query string 携带长期 Token，机器用 Authorization header，浏览器用同源 Access cookie；握手校验 Origin。DO attachment 只存非秘密身份和 epoch。

### 单写者 fencing

D1 `agent_stations` 保存 active station、leaseEpoch、expiresAt，领取及续租用 CAS。所有 agent canonical 写回同时带 tokenId、stationId、leaseEpoch、taskId、operationId；Worker 在**同一数据库原子边界**验证租约和生产版本。不能先检查 lease、稍后无条件写入。

断网时可以完成本机已有的纯文本工作，但在拿不到新租约后不得启动付费／外部写副作用；恢复先对账。显式用户接管新机器才能增加 epoch；旧机器延迟消息拒绝。首版一个活跃机器，不设计自动跨机器 failover，因为本地 conversation storage 不在云端复制。

### Web 集成：现有编辑区在左，唯一主控在右（本轮修订）

**不另建一套以 agent 为中心的制作流程。** 现有工作室已经覆盖选题、素材、逐字稿、成品、终审和发布，继续作为用户的直接操作面。桌面结构为现有导航／面包屑下的双栏：左侧 65–75% 是现有页面，右侧约 340–420px 是主控聊天。聊天不是独立页面、不是切换出去的“agent 模式”，也不是只读 agent 日志。

- 左侧照常编辑原始素材、意图、逐字稿、简介，手工 Save；现有人工确认、重开、试听、上传和发布操作不变。即使 agent 离线，左侧仍可完整工作。
- 右侧是默认出现、持续挂载的主控聊天，无启用／暂停入口或页面感知提示区，输入框固定在底部，展示用户指令、自然语言答复和结果卡。切换制作阶段／素材详情不重置对话和输入；节目身份沿用现有页面标题／面包屑，不另加“主控正在理解的页面”区域，未发消息不能被静默发给另一节目。
- 主控不是模拟点击左侧 DOM：它通过已有业务 controller 保存，提交成功事件携带 productionId、version、actor、operationId、changedFields、sourceIds 和 artifactRefs；左侧读取同一 canonical 状态，实时投影这次变更。只有服务端保存成功后才说“已修改”，streaming 中间文稿不是已经保存的表单值。
- 主控补充的素材直接出现在左侧原始素材列表，用户可以打开、修改或删除后 Save。仍保持紧凑列表＋单份素材详情，不一次展开所有资料。资料更正保留来源 provenance 和内容 revision，不假装是未编辑的原始抓取。
- 聊天结果卡说明“修改了什么”，提供“定位到素材／字段”“查看差异”。定位是导航，不自动撤销人类确认。素材详情返回时仍保留未保存 brief 草稿。
- 角色连接与工作状态保留在右栏标题旁可展开的“运行概览”：只展示在线／忙闲、当前工作和异常；不是默认消息流中的角色矩阵。用户仍不能直聊执行会话。
- **Jev 不面向用户播报。** 选模、thinking 选择、概率、复用／新建／退休理由仅留本机内部审计，不进入普通聊天、结果卡、运行概览或常规 Web 事件 payload。用户只看到“正在整理资料”“已补充两份素材”“工作暂时排队”等结果与状态；网关故障不显示模型术语，详细故障码仅供本机诊断。架构技术附录仍可解释内部机制，不是产品 UI。
- 桌面明确采用两个用途清晰的滚动区域：左侧现有 `.admin-content-island`、右侧聊天记录；两者独立但不再嵌套滚动编辑卡。标题、阶段导航和聊天输入固定可见。此设计在批准后**显式替换**当前“全工作室只有一个主滚动区域”的规则，不能靠 `scrollIntoView` 滚动整个 shell。
- 窄屏不能硬挤左右两列：原有编辑主页面下默认呈现紧凑主控输入区，可展开为全屏 sheet；收起只是布局操作，不关闭主控或后台页面理解，不提供“启用”动作。收起后回到原字段、滚动位置与草稿，消息提示不挡住 Save。静态文档可上下展示以便对照，实施必须验证 sheet、键盘和焦点管理。
- UI 实施复用现有 Basalt shell／controls 与共享 MarkdownEditor，而非将本页原型的原生 textarea 搬进产品。其选区、输入法 composition、草稿 revision 通过只读 adapter 报告，不抓取整页 DOM。

### 同时编辑契约：实时更新，但绝不吞掉用户草稿

这里不做逐字符协同、CRDT 或全表单热替换。保留显式 Save，采用“canonical 快照＋逐字段本地 draft＋冲突队列”。每个草稿保存基准值、基准 version 和当前值；远端事件在 ViewModel 收敛，不用组件换 key 重挂载来刷新。

| 情况 | 左侧呈现 | 保存语义 |
| --- | --- | --- |
| 用户没有改该字段 | 主控已提交内容立即更新，短暂标出“主控已更新”；保留焦点／滚动 | 使用服务端返回的新 version；展示保存时间与作者 |
| 用户在改别的字段 | 主控更新无重叠字段，本地输入保留 | Save 只提交本地 dirty fields，基于最新 canonical version；未改字段绝不回传旧值 |
| 用户正在改同一字段 | 输入保持原样；旁边显示“主控已保存另一版，待处理”，可对照本地稿与已保存稿 | 用户明确选择自己的草稿或远端版本；选择本地稿后仍需 Save，不能自动覆盖 |
| 相同内容到达 | 对照规范化内容 hash，清除已经一致的冲突／dirty | 不产生无意义重复写入 |
| Save 的在途窗口又来新版本 | 保存返回 409；重新取快照，重新比较字段 | 不只替换 version 盲重试，不丢本地 draft；需要冲突处理时回到队列 |
| 主控删除了用户正在编辑的素材 | 保留本地稿并显示“素材已删除” | 明确丢弃本地稿或“另存为新素材”；不能按原位置覆盖别的素材 |
| 快照／事件重复或乱序 | version/cursor 去重；缺口补读快照 | 单字段不得倒退到旧版本，结果卡与左侧引用同一 operation |

Save 期间新增的键入不能被旧 response 清除：仅清除与提交快照一致的 draft，其余保留到下一次保存。MarkdownEditor 的 source、undo 和 IME composition 保留；同一字段有本地编辑时不注入远端替换，中文输入完成后再显示冲突。用户选择远端版本须明确丢弃该字段本地稿，不丢弃其它字段。

实现不是给现有 fetch 加一个定时器就完成：`BriefForm` 当前用 `defaultValue` 和一次性初始化的 sources，`readBrief` 会汇总整个表单。需将服务端快照／dirty 字段比较移入 ViewModel，让未改字段接收外部提交、保存仅发送真正的修改；不能用整份旧表单盖回服务器，也不能给整个表单换 key 强制刷新。保存与外部事件都走相同的版本收敛函数，供单测检验乱序和并发。

**素材必须有持久 ID。** 当前 `sourceSchema` 无 ID，`BriefForm` 生成的 `key` 仅在浏览器有效，`?source=N` 是位置；新增／排序会使位置不再指向同一素材。实施时为已存素材一次性补 stable sourceId，按 ID 合并并将详情 URL 改为 `?source=<id>`，直接删除位置式解析，不保留双路兼容。草稿按 sourceId 保存；sources 编辑重构为 typed create/update/delete/reorder，领域层校验 sourceRevision 和 production.version，再在聚合内原子修改；不让客户端用一份旧数组整体覆盖。稳定 ID 可通过脚本和 shared validator 验证，但不是另一套素材数据库。

### 默认上下文理解：不需要用户开启

主控默认持续在场，无需启用且不能暂停页面感知；不显示“正在理解页面”、共享状态或常驻同步提示。主控应完整理解当前工作现场，而非只拿 productionId。按 [02 · 页面上下文与 API 重构](02-page-context-api.md)，持续同步 page/session、当前对象／阶段、编辑字段／选区、所见版本、dirty draft revision、Save／冲突和素材／音频工作状态。草稿共享明确标记 browser_draft，不等于自动保存或审批；秘密字段和未发送的聊天草稿不采集。消息发送前等待 context ACK，再固定 immutable contextId，之后页面切换不重定向旧任务。主控默认按当前创作稿回应；未保存稿的修改自动走 draft proposal，精确匹配 revision/hash 后应用为可撤销编辑，仍由用户 Save，不弹通用 saved/draft 选择面板。用户可在具体指令里明确仅按已保存稿操作。批准阶段仍由左侧按钮完成，聊天里的“可以”不是审批。

主控写回后自动出现在左侧，不要求用户再点一次“应用”才能看结果；唯一例外是与未保存稿重叠时暂缓覆盖该字段。修改已批准内容仍遵循现有重开权限，主控在右侧解释需要用户在左侧重开，不擅自升级权限。

本地站点现有生产代理只有 HTTP，不假定 WebSocket 自动可用：新增仅开发态、固定生产目标的 upgrade 代理，保持 cloudflared Token 在服务进程、检查 Origin、禁用任意 URL。环境切换必须同时解除旧 stream、绑定新 siteId、检查并保留草稿，不把本地结果推入生产表单。

## 8. 数据模型与 API 增量

页面观测、WorkingDraft、context ACK、命令上下文固定与 draft proposal API 详见 [02](02-page-context-api.md)，它是本节必须实施的补充，不是可选的聊天 metadata。

保持现有 `/api/agent` 命名空间和生产 controller，不另开 Hermes 兼容层。同步更新 discovery、OpenAPI、capabilities、`llms.txt`、Token 页面及错误说明。旧 Token 可以通过原有认证验证身份，但接入 runtime 必须显式绑定 station；不能因为拿到一个旧 Token 就自动启动主机执行。

建议新增表（均为提案，尚无 migration）：

| 表 | 最小职责／关键约束 |
| --- | --- |
| `agent_stations` | 绑定 tokenId、机器状态、租约 epoch／到期、协议版本、config digest；不存秘密配置 |
| `agent_commands` | 用户消息／控制指令、productionId?、clientRequestId 唯一、领取与确认序号；target 固定 coordinator |
| `agent_tasks` | 工作目标、productionId?、状态、版本、授权范围、输入版本、结果引用；与节目 stage 分离 |
| `agent_conversations` | 本地会话 ID 的只读运行投影、lifetime／role、busy assignment、退休状态；不含 Jev 候选／概率／选模理由，不能远端直接 configure |
| `agent_events` | 用户可见的有界安全事件（排除内部 decision 事件）、全局 cursor、eventId 去重、task／conversation 关联；不写 production.events |
| `agent_artifacts` | kind、revision、父版本、private R2 key、sha256、输入版本、来源引用、审校／验收记录 |
| `agent_operations` | `(station scope, operationId)` 唯一、请求 hash、状态、结果版本／jobId、canonical 回执 |

不把频繁增长的 agent 运行史塞进 `productions.data`。R2 大文件先用不可变 key 写候选；D1 接受后成为正式索引，失败残留只按已证实未引用／保留期清理，不能把真实素材作为测试夹具。

| 路由组（拟新增） | 身份与职责 |
| --- | --- |
| `POST /admin/api/agent/commands` | 人类同源：只向主控下发，包含预期任务版本和稳定 clientRequestId |
| `GET /admin/api/agent/snapshot`、`events?after=`、`artifacts/:id` | 人类：只读安全投影和私有成果 |
| `GET /admin/api/agent/live` | 人类 Access：WebSocket upgrade；非聊天写入口 |
| `POST /api/agent/runtime/register`、`heartbeat`、`claim`、`ack` | 已绑定机器 Token：连接和指令领取；返回服务端 epoch／cursor |
| `POST /api/agent/runtime/events`、`artifacts` | 主控 adapter：上传有界事件和验收候选，必须带 assignment／输入指纹 |
| `GET /api/agent/runtime/connect` | 主控 adapter：WSS 通知，不接受任意工具指令 |
| `POST /api/agent/runtime/operations`、`GET .../operations/:id` | 幂等写回／查回执，内部复用现有 controllers；不重复实现领域规则 |
| 现有 `/api/agent/productions/*` | 领域操作保持 canonical，runtime 写入须带 task＋lease＋operation 元数据；不能留一个绕过 fencing 的旧路径 |

新增 operations 不是通用 HTTP 代理：只接受有限业务操作 enum、严格 schema，不接受任意 URL／方法／SQL。现有直接机器写路径必须统一进入同一个 operation guard；人类写路径保持人类身份，不通过机器 Token 提升权限。

任务可先不绑定节目（如一批资料调研），由主控验收后显式关联新 production；不要为了接单伪造节目。每 task 下是带依赖的 assignment DAG：`research → translation/outline → draft → review → revise → accept`；音频与简介在稿件批准后可并行。一个 production 同时只有一个文本写回 owner；其它任务可研究／产出候选，但不得互相覆盖 canonical。用户新意见成为新的 commandId，主控明确选择 steer 当前任务、排队下一轮或取消旧 assignment，并把选择回报用户。

## 9. Markdown 成果、验收与写回

文字成果为 UTF-8 `.md`，正文与 metadata 分开：`taskId / artifactId / revision / parentRevision / sha256 / sourceIds / profileVersion / productionVersion / scriptVersion / modelProfile / decisionId` 是本机结构化信封，不让模型靠 frontmatter 伪造审批字段；上传到 Web 的成果 metadata 不含 decisionId／决策参数，用户只见作者角色、输入版本、来源和验收状态。

研究资料、翻译、提纲、初稿、审校报告独立保存为 artifacts；只有主控验收的正式稿／介绍才映射到现有 `transcript / description / summary`。来源需有 URL、抓取时间、内容 hash、引用定位和必要快照；翻译保留原文对照、专名表，无法核实的事实标记，不因润色消除证据边界。

写回流程：

1. worker 提交候选 `.md`，host 校验格式、字节上限、引用 ID、输入版本和完成状态。
2. 长期／独立 reviewer 对候选 hash 审校；修改后旧审校无效。审校不是事实证明，主控仍检查证据和用户要求。
3. 主控验收具体 artifact hash，读取最新 channel profile 和 production capabilities/version。
4. profileVersion 变化：暂停验收并重新校准；不会自动撤销网站已有的人类审批。productionVersion 冲突：保留候选，展示差异，让主控基于新版本重新规划；不能盲重试覆盖。
5. 稳定 operationId 先入本地 outbox，再提交 Worker。领域变更、receipt、可见事件必须原子成功；D1 `batch()` 内某条 CAS 更新 0 行**不会自动回滚其它语句**，实现必须使用共享条件／约束并验证 changes，单测覆盖不成功时无任何“已完成”回执。
6. ACK 丢失先查询 operationId；同 ID 不同 hash 返回冲突。回执返回确切 productionVersion、artifact hash 或 audioJobId，不能用“当前内容看起来一样”推断原操作已成功。

API 的 50,000 字符 transcript、20,000 description、2,000 summary 和 750,000-byte JSON 限制继续生效，artifact 上传另设显式上限，不静默截断。长期流水线遇到 200 条 production 业务事件上限应明确阻塞并请求归档方案，不能自动删审计或偷偷复制节目绕过。

## 10. 一期播客的完整运行

| 阶段 | 主控／conversation | 写回与人工边界 |
| --- | --- | --- |
| 收集整理 | 用户给 URL／材料与目标；主控读取全局提示词；Jev 建短期研究会话 | `research.md`＋来源快照；网页是资料不是指令 |
| 翻译与术语 | Jev 选执行 profile，复用本期翻译会话或新建；长期术语角色审校 | `translation.md`，保留原文引用与术语对照 |
| 提纲／选题 | writer 输出 `outline.md`；resident reviewer 找论证缺口 | 主控写 draft 的 sources／intent，`submit_brief`；等待人类批准 |
| 初稿／改稿 | 同一短期写作 conversation 接收用户经主控转达的意见；Jev 决定是否复用 | `draft-vN.md`／`revision-notes.md`；完成后写 transcript 并 `submit_script` |
| 正式逐字稿 | 主控验收＋人类确认绑定 scriptVersion 和稿件 hash | agent 不能替用户 `approve_script`，聊天“可以了”不直接赋予审批权 |
| 音频／封面／介绍 | 主控通过已批准 API 发起 AudioWorkflow；其他会话准备封面原图、description | 音频执行仍在云端；本机无 Gemini secret；默认无 bumpers |
| 终审／交付 | 主控收齐本版资产、检查版本和试听问题、输出 `delivery.md` | `submit_final` 后人类确认；真实平台发布仍人工记录，不宣称代发 |
| 生命周期收尾 | Jev 建议复用 reviewer、退休本期短会话；主控执行 | 保留作品、回执与历史，结束活跃会话，不抹掉证据 |

“主控验收”与“人类批准”是两类独立记录。用户仍可以从现有五阶段自由导航／编辑；人工编辑触发现有重开和失效逻辑。主控收到变化事件后取消基于旧输入的待写回任务，不试图把 agent 的 state 当权威覆盖 Web。

### Markdown 与音频边界

现有音频代码将 transcript 当可直接朗读的文本。正式稿既然统一 Markdown，必须新增确定性的 spoken-text 渲染：使用已有 `marked` parser，定义标题／列表／链接／脚注／代码块／表格的播读策略；不支持的结构在批准前报错，不把 Markdown 标点直接送 TTS，也不使用模型“随意清洗”已批准稿件。

音频快照同时记录 `artifactHash + scriptVersion + rendererVersion + spokenTextHash`；Web 先展示可试听文本供人类确认。主控只提交已有批准快照的 operationId。音频 HTTP 超时先查 job，正在执行则继续观察，完成则不再生成；不能以本机恢复为理由付费重跑。上游 TTS 响应丢失仍可能重复计费，不能承诺 exactly-once billing。

## 11. 故障、恢复与控制语义

| 情况 | 行为 | 不允许 |
| --- | --- | --- |
| Web 关闭 | 本机继续运行，重新打开补快照 | 把浏览器生命周期绑定任务生命周期 |
| 网站断线／休眠 | 云端显示 stale/offline；纯本地既有文本任务可完成并排队，租约过期禁止新外部写 | 仍显示“实时在线”、无限重连刷屏 |
| daemon 崩溃 | 重建 registry、assignment schema、工具上下文与 outbox → 对账 → resume | 只恢复会话但丢失 host closure／权限，重新问 Jev 选另一种工作 |
| shell 中断 | 标记 interrupted，读文件／进程／外部结果确认后由主控安排新的尝试 | 一律 `replay: safe`、直接重放未知 CLI 副作用 |
| Jev 不可用 | waiting_decision；冻结新派发，继续观察既有任务 | 降级为主控任意挑 model／thinking |
| 409／输入过期 | 保存候选稿，重新读取和展示差异 | last-write-wins、覆盖人工新稿 |
| Token 到期／撤销 | auth_required；停止新外部效果和写回，等待用户换本机配置 | 从浏览器或其它 CLI 偷取凭据 |
| 取消／暂停具体任务 | 用户指令先到主控；host 控制路径不等待 LLM 才停止；记录请求和实际 stopped | 把“取消已收到”当“所有外部效果已撤回” |
| 云端音频已开始 | 本地取消不等于 AudioWorkflow 停止；显示独立 job 状态及可能费用，禁止重复启动 | 宣称本机 kill 可以撤销云端音频 |
| 重试／预算耗尽 | 限制时长、改稿轮次和并发，进入 needs_attention | 长期 conversation 无限制烧 token |

恢复中的 shell 进程可能仍存活；PID 复用不能作为唯一证明。记录工具 operation 和进程标识，先检查实际文件／job，无法判定即停下。代码／extension 升级也会影响旧 durable task：存协议和 extension schema 版本，不支持的在途任务进入 needs_attention，而不是静默用新语义重放。

## 12. 安全与隐私：不夸大边界

用户要求无沙箱、获得全部本机 CLI；采用 `NodeExecutionEnv` 和 CodingTools。cwd 是工作目录，不是 jail；同一个系统用户可以读其它文件、访问网络、使用已有 CLI 身份。

因此“只有主控持有网站 API”在本方案中是**程序结构和工具注册规则**：不将 Token 放进 prompt、子任务、工具参数、child env、Web 状态和日志；唯一产品 client 在主控 host。**它不是对恶意模型或恶意 CLI 的安全隔离**：同用户全 CLI 能读 `~/.config/his.fm/config.json`，甚至自行 curl 网站。若用户要求不可绕过隔离，必须改用独立系统身份／受限工具／沙箱，与当前需求冲突；这是必须 Review 的取舍，不默默选择。

来源、历史会话、网页、PDF、工具输出均是未经信任资料。不会因其中一句“忽略审批／上传密钥”获得权限。网站永远不授予 agent human actor，不能审批／管理 Token／改频道策略／记录平台发布。全 CLI 也可能利用本机已登录的人类浏览器或 cloudflared 绕过应用层：禁止并审计此路径，但不能保证恶意代码无法绕过。此信任风险必须由用户明确接受。

远端仅上传 allowlisted 结构化事件和人工可读摘要；不直接序列化 Pi 的完整 `viewState`／`watchEvents`，它们可能包含模型推理、秘密工具输出、系统提示词。终端长输出默认仅本机保存；脱敏是降低风险，不是数学保证。Markdown 用现有 safe renderer；禁止原始 HTML／脚本注入，外部图像／链接的加载要显式处理，私有引用不自动公开。

## 13. 目录与现有模块的改造计划

待批准后再创建：

```text
packages/agent/
  src/cli.ts                 本机 start/status/stop；不开放入站 HTTP
  src/config.ts              一份私有 JSON 与 profile 预检
  src/runtime.ts             Harness、registry、实例锁和启动恢复次序
  src/coordinator.ts         root 对话、派发／验收和控制消息
  src/conversations.ts       身份／lifetime／assignment 持久状态
  src/decision.ts            Jev 有限方案选择、概率验证、冻结结果
  src/transport.ts           唯一 product client、lease、WSS、outbox
  src/tools.ts               显式主控／执行 extensions 与 CLI 行为
  src/artifacts.ts            Markdown 信封、hash、来源和验收
packages/contracts/           抽取已有纯 schema，并新增 agent 协议
apps/web/worker/agent-runtime/  任务收件箱、回执、租约、事件、private artifacts
apps/web/worker/agent-hub.ts    仅连接与扇出 DO
apps/web/src/admin/agent/       viewmodel/service/views；嵌入现有工作室的主控右栏、实时字段合并
```

不是先建空文件树：每层随可运行纵向切片落地。`packages/contracts` 只抽已有跨端共享数据契约，避免 agent 反向依赖 Web；迁移调用点后删除旧引用，不保留重复 schema 和兼容转发。

具体接入：

- `apps/web/cloudflare.config.ts`、`worker/entry.ts`：新增 AgentHub 导出／binding，不改现有 AudioWorkflow 身份。
- `apps/web/cloudflare.config.ts`、成果 controller：新增不公开的 `AGENT_ARTIFACTS` R2 binding；私有材料不能复用公开 MEDIA 存储路径。
- `worker/agent-api.ts`、`agent-contract.ts`、`agent-tokens.ts`：身份、station binding、runtime 路由及所有机器写回的 operation guard。
- `worker/production.ts`、`production-store.ts`、`production-model.ts`：复用规则，在领域变化时发布可见事件，保持版本和人工身份验证。
- `worker/audio-routes.ts`、`audio-workflow.ts`、`production-prompts.ts`：operation 去重、Markdown 播读快照；现有“输出纯播讲文字”提示词改为 Markdown 成果＋独立确定性播读规则，不另造本机 TTS 调度器。
- `src/admin/production/useProduction.ts`、`ProductionEditor.tsx`、`MarkdownEditor.tsx`：新增 context publisher、selection/composition adapter 和 canonical／draft 双读模型，按 02 约束同步与消息固定。
- `src/shared/production.ts`、`worker/production.ts`、`src/admin/production/BriefForm.tsx`、`SourceEditor.tsx`：增加持久 sourceId、资料 revision／provenance、ID 路由与字段级草稿合并；去掉每次 mount 随机 key 作为业务身份的依赖。
- `src/admin/AdminShell.tsx`、`production/ProductionList.tsx`、`ProductionEditor.tsx`、`PromptPanel.tsx`、`StudioSettings.tsx`、`channel/ChannelPage.tsx`：保留现有左侧流程、表单和 Save，挂载持续主控右栏；新增逐字段 draft/CAS/冲突状态，删除复制 Hermes 任务的旧产品路径。
- `scripts/production-proxy.ts`：开发环境的固定目标 WebSocket upgrade；不能把生产 token 发给浏览器。
- `migrations/`：添加新表与索引，保留现有节目、审批和 Token 哈希数据；删除过时 UI／协议不是删除用户数据。
- `docs/hermes.md` 改为原生 agent onboarding，现有文档、发现入口与 UI 同一次切换；不保留并行 Hermes workflow。
- root 命令、Vitest／Biome／Husky／CI：覆盖 web、agent、contracts；agent 不能以“本机包”为由逃过质量门禁。

## 14. 分层交付、测试与原子提交

不一次堆出半成品多 agent 平台。每层必须端到端可用，人工制作仍可用。

1. **契约与身份**：抽纯 schema；任务／站点／lease／operation receipts；先以假 daemon 完成 Web 下发→确认→断线补读。新增 API 逐条验证鉴权和版本。
2. **单主控闭环**：本机 config＋实例锁＋SQLite Harness；只做一个 Markdown 文本任务；左侧可手工 Save，右侧持续聊天；主控已保存修改实时出现在左侧，含素材列表／详情和重叠冲突。此时没有虚假的多角色 UI。
3. **Jev＋会话生命周期**：加入有限 profile、长期 reviewer、短期 writer、多轮返工、独立审校、退休；验证不同模型／think 与重启复用。
4. **全生产集成**：研究／翻译／提纲 artifacts，五阶段、人工重开、音频幂等与 spoken-text；替换 Hermes 产品路径。
5. **恢复与运行验收**：Web 实时投影、DO hibernation、断线／撤销／接管／存储恢复、运行预算和日志隐私。

各层独立原子提交，hook 正常运行；每次部署遵循项目 **Z+1** 规则。本轮设计提交不发版、不部署。

质量计划（不是认证声明）：

- **L1**：schema／有限候选验证、状态机、权限、CAS／receipt、防重复、版本失效、Markdown 播读、lifetime、outbox、config，四项覆盖率均 ≥95%，strict types、Biome 零警告；保留 index-snapshot gate。
- **L2**：本地 Worker＋真实 HTTP／WebSocket＋临时 SQLite＋模型／Jev stub，覆盖重放、重复消息、事件缺口、丢 ACK、lease 过期／旧 epoch、撤销、并发人类编辑、音频 job 查询。测试不读取用户 `~/.config/his.fm`，不访问线上 Token。
- **L3**：用户只聊主控、不能聊子会话；聊天和常规事件无 Jev 过程；五阶段、素材稳定 ID、同字段冲突／不同字段同步、Save 409、Save 中继续键入、中文 IME、切页和断线补读均不丢草稿；桌面／手机、中文输入、断线／阻塞／人工确认；用假源材料和假音频，绝不付费生成。
- **G2**：密钥扫描／依赖扫描、未经信任 Markdown、恶意资料指令、WebSocket Origin、私有 R2、日志脱敏及生产代理边界。
- **隔离**：测试使用临时 HOME／config／storage、假 CLI 和本地端口；运行时无沙箱不意味着测试可以动真实文件／远端服务。
- **恢复验收**：在决策保存前后、conversation 创建后、API 已成功但 ACK 丢失、CLI 中途、音频已开始等窗口 kill/reopen；分别证明最多一次 canonical 写回和“不知道是否执行时停下”，不声称任意外部副作用 exactly-once。

## 15. 需要哥 Review 的选择

| 编号 | 推荐方案 | 另一种解释／代价 |
| --- | --- | --- |
| R1 本机信任 | 接受无沙箱＋全 CLI，主控独占 API 是逻辑约束 | 若要求不可绕过安全隔离，需要改变全 CLI／同用户约束 |
| R2 审批 | 保留 brief/script/final 人工确认和人工平台发布 | 若要主控代批，这是权限产品变更，不能从“自动工作”推导 |
| R3 执行配置 | 主控与执行 model、thinking 两者都不同；Jev 只选合法 profile | 可放宽为不同 profile，但须明确允许相同 model／档位 |
| R4 会话销毁 | 逻辑退休＋保留作品／审计，物理清理另定保留期 | 立即物理删除会失去可恢复性和来源，需要额外可验证策略 |
| R5 工作室集成（本轮已确定） | 左侧保留现有操作／Save，右侧持续主控聊天；已保存修改即时更新，dirty 重叠时明确选版 | 不做另一个 agent 工作台，不用整页刷新覆盖本地输入 |
| R6 自动范围 | 主控自动交付可编辑文本，付费音频仅在稿件已批准且任务授权后开始 | 每次 canonical 写回都先人类批准更保守，但增加交互成本 |
| R7 故障与模型 | Jev 不可用暂停新派发，不静默换模型；默认单机器 | 自动 fallback／多机接管需额外授权与状态复制设计 |
| R8 实时方案 | D1 权威队列／回执＋DO WebSocket 扇出，本机主动连接 | 纯短轮询更简单但进度延迟和请求量更高；本提案不双栈并存 |

交互页可逐项填写立场并导出 Markdown review；记录仅留当前浏览器，不写网站或本机配置。

## 16. 参考与证据

- [Pi Durable 公告](https://earendil.com/posts/pi-durable/)（2026-10-01；本次 2026-10-03 阅读）。
- [Pi Durable README](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md)；本地安装版本 1.0.0 的 README／类型作为当前 API 依据。
- [Cloudflare DO WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)；新连接枢纽仍需实现验证，不当作现有项目能力。
- [Giraffe agent 基线](https://github.com/nocoo/giraffe/tree/bfd595b63bc9dd8efed58334e8b81707d5d160b7/packages/agent)。
- 本项目现有 [生产流程](production.md)、[Agent API](agent-api.md)、[音频](audio.md)、[编辑器](markdown-editing.md) 和上文源码锚点。旧文档在设计期仍描述 Hermes 现状，批准实施时再统一替换。
