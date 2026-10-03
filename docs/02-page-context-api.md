# 02 · 页面上下文与主控 API 重构

状态：待评审设计；不修改生产实现。2026-10-03。延续 [01 · Agent 工作流](01-agent-workflow.md) 的左右工作室布局，本篇细化此前没有定义完整的 API／上下文契约。

[交互原型](01-agent-workflow/index.html) · [文档目录](README.md)

## 1. 产品目标：知道你在做什么，而不是只知道节目 ID

主控与用户共用同一个工作现场。用户说“整理一下这份资料”“这段太长”“继续刚才的修改”，主控应知道这些指代对应哪一个对象、哪一份内容、哪一次编辑，而非猜测当前网页或反复让用户复制全文。

“完整掌握”是 **覆盖已声明的工作室状态，并明确哪些已知、过期、缺失或被暂停共享**，不是全知。API 不能推断用户意图、证明人已经读过某段文字，也不能把没有收到的页面状态伪装为实时事实。

三个独立平面：

| 平面 | 权威 | 主控可以知道 | 不能推导 |
| --- | --- | --- | --- |
| `CanonicalContext` | Worker／D1 | 已保存节目、来源、全局提示词、审批、素材／音频任务和领域能力 | 浏览器尚未保存的文本、光标、选区 |
| `PageContext` | 当前浏览器标签页的 ViewModel | 当前页面／节目／阶段／素材、所见版本、编辑字段、选区、编辑模式、加载／保存／冲突／试听状态 | 服务端权限、其它标签页的“真正当前页”、人类批准 |
| `WorkingDraft` | 该浏览器 editor buffer | 未保存字段值、基准值 hash、revision、用户最后编辑、选区对应文本 | 已保存稿、已批准稿或可以直接覆盖 canonical 的授权 |

三者拼成一个**带 provenance、时间和完整性标记的上下文包**，但不合并成一份“最新 production”。用户 Save、agent canonical 提交和浏览器草稿 patch 是三个不同的操作。

```text
左侧路由／ViewModel／MarkdownEditor
  ├─ 当前位置、选区、编辑／保存行为 ──→ PageContext
  └─ 未保存文字与 revision ─────────→ WorkingDraft
                       ↓ snapshot + ACK（不是 Save）
Worker Context Service ← D1 已保存内容／领域权限
                       ↓ 三层事实包、完整性、时间与版本向量
本机主控：读当前上下文；对每条命令固定发送时快照
  ├─ canonical operation ──→ 领域 CAS → 网站保存 → 左侧更新
  └─ draft proposal ────────→ 原 tab 校验 → 草稿应用 ACK → 用户 Save
```

## 2. 现状为何不够

核对基线 `deb053e`，下列均是实际代码行为，不是新功能：

| 当前代码 | 缺口 | 必要改造 |
| --- | --- | --- |
| `apps/web/worker/agent-api.ts`：`productionCapabilities`、`/productions/:id/prompts` | 只知道生产记录、阶段与领域权限 | 新增主控专用 context service，返回 canonical＋页面报告＋draft 及分别的完整性 |
| `apps/web/src/admin/production/ProductionEditor.tsx` | `step/source` 来自 URL，`dirty` 只有 boolean，阶段切换可能重挂载表单 | context publisher 从路由＋ViewModel 取结构化信息；各字段 dirty 和 draftRevision 可查询 |
| `BriefForm.tsx`、`SourceEditor.tsx` | `defaultValue`、局部 sources 状态、临时 key、位置式 `?source=N` | stable sourceId、稳定 fieldRef、草稿 store、单份素材操作和 provenance |
| `MarkdownEditor.tsx` | 有编辑／预览／分栏，但没有面向主控的 selection／composition 契约 | 对外提供只读 editor context adapter；不暴露完整 DOM、扩展对象或 editor instance |
| `useProduction.ts` | GET／手动刷新，只有音频忙时轮询 | canonical events、context ACK 与 field reconcile，各自处理乱序，避免相互覆盖 |
| `production/service.ts` | 聚合字段 PUT、动作 POST；没有页面／草稿 API | schema 驱动 command/context/operation client，禁止自由 URL tool |
| `production-model.ts`、`production-store.ts` | 现有人工审批／版本 CAS 完整 | 保留为统一领域层，新的“能看页面”不能绕过它 |

结论：不能只多传 `productionId + route`，也不能加一个 `get_page_html` 就称为完整上下文。重构的是契约、ViewModel 状态来源和写操作边界，不是让模型遥控 UI。

## 3. 页面需要描述哪些信息

### 3.1 Context Header

`siteId`（服务端生成，不由 URL 猜）、environment、protocolVersion、ownerSessionId、tabId、pageEpoch、contextSeq、serverReceivedAt、expiresAt、contextId、shareState。

- 每个 tab 有独立 tabId 和单调递增的 seq；每次切节目／环境／页面对象递增 pageEpoch。刷新创建新 page session，不复用可能冲突的序号。
- route 使用允许的路由类型和参数，不收任意地址／查询参数／浏览器历史；mode 与后端 stage 是不同字段，用户点“发布”不代表节目已经 ready。
- 相邻状态可合并，旧 seq 不能覆盖新 seq。同 seq／同 digest 为幂等；同 seq／不同 digest 拒绝。
- 原始 client timestamp 仅供诊断，是否 stale 由服务端接收时间与 TTL 判断。

### 3.2 页面定位与可见对象

`pageKind`、productionId?、step?、sourceId?、assetTab?、artifactId?、filter/sort/pageCursor?、selectedEntityIds、panelMode、activeDialog、lastEditorFieldRef、editorMode。

`lastEditorFieldRef` 与焦点在聊天输入框是两件事：从逐字稿点击右侧聊天后，仍保留最后操作的稿件／选区；切换到另一素材时必须失效，不能把 A 的选区套到 B 上。

每个 fieldRef 为类型化对象，不允许任意 JSON Pointer／对象属性：

```json
{
  "entityType": "source",
  "productionId": "production-001",
  "sourceId": "source-uuid",
  "field": "content"
}
```

来源 URL 仍是资料，不是可执行工具指令。支持未保存的新素材：创建时生成 UUID，暂时标 `localOnly: true`；相同 ID 保存后转 canonical，不能一边用本地 ID、一边在聊天里指向另一份“素材 2”。临时来源被丢弃后，其引用返回 `target_missing`。

### 3.3 编辑／工作状态

- `viewedProductionVersion`、`latestProductionVersion`、profileVersion、scriptVersion，各自明确，不伪装单个“版本号”。
- dirtyFields：fieldRef、draftRevision、baseProductionVersion、baseValueHash、valueHash、contentRef、byteLength。
- `saveState: idle|saving|saved|failed|conflict`、submittedDraftRevision、errorCode、conflictedFields；禁止上传原始异常／token。
- 字段编辑模式、composition 状态（中文输入法未完成时不发送中间字节）、当前 selection anchor/head、其对应文本 hash、节／段定位。offset 约定 JS／CodeMirror 的 UTF-16 code units；相反选择方向可保留，实际替换使用 min/max，验证文本 hash 才能应用。
- `interactionSummary` 为有界事实事件，例如 opened_source、edited_field、save_requested、save_succeeded、save_failed、conflict_detected、conflict_resolved、approval_requested/result、audio_started/completed、preview_opened、playback_paused。按钮被点过和请求成功必须分开。
- 音频仅 report asset/job/version、playback position、playing/paused/error；播放到末尾不等于“已试听通过”。文件上传仅上传类型、状态、目标和字节数；未完成上传的本地文件字节不自动加入上下文。
- 稿件未改但用户只是在看：报告可见章节／段落范围，不采集像素级滚动轨迹。范围可由 preview／editor adapter 提供，不截图整页。

### 3.4 上下文覆盖矩阵

| 页面 | 应当知道 | 按需取全量 | 明确不收集 |
| --- | --- | --- | --- |
| 制作列表 | 筛选／排序、当前页、已选节目、可见 ID、加载状态 | 当前结果页与所选节目 | 将“当前页”冒充全部节目 |
| 选题／素材详情 | 选题字段、素材 ID／revision、正在编辑哪份资料、draft／选区／冲突 | 指定素材原文、来源快照、brief 其它字段 | 一次性抓所有隐私材料、位置索引代替 ID |
| 逐字稿 | 文本来源是 saved 还是 draft、selection、章节、edit/preview、scriptVersion、saveState | 指定 revision 的完整 Markdown／边界上下文 | 浏览器未收到的新 canonical 稿冒充“用户所见” |
| 成品制作 | cover/audio/description 子页、所选参数、上传／音频任务进度 | 已授权资产 metadata 与 description draft | Gemini secret、未授权本地文件、未完成上传的完整文件 |
| 最终检查／发布 | 缺项、用户正在对照哪份产物、操作结果、URL 表单 draft | 当前批准与平台 publication 状态 | 主控因“看见确认弹窗”取得人工审批权 |
| 频道／设置／Token | 页面类别、可协助的非秘密字段、全局 profile 版本 | 仅 server capabilities 允许的内容 | Token／API key／密码输入、刚生成的一次性 secret、Access cookie、剪贴板、未发送聊天草稿 |

频道全局提示词已有专门只读 API；页面的 profile 草稿可帮助解释“你准备怎么改”，但不是 active policy，任何 agent 都无权通过草稿覆盖其规范优先级。

## 4. 共享策略：草稿可见，但 Save 仍由用户控制

推荐“协作开启后，自动共享当前工作室的创作上下文”，右栏始终可见 `页面同步中／已同步／暂停／过期`。本提案把上一版“只有 Save 后才能理解内容”改为：主控可以看见未保存的创作内容，并明确标记 `browser_draft`；**草稿同步不是自动 Save**。

上下文只在站点已有授权 owner 的协作范围共享。当前网站是单 owner 工作室，不借此扩展多租户；未来引入多用户时必须让 context owner／token scope 独立可验证，不能把任意 Access 用户的页面汇入同一个“最近上下文”。

首次开启解释共享范围，并允许随时暂停／恢复。暂停后立即递增 shareEpoch，停止新采集／取值，清除云端 live draft 引用；旧请求不能重新打开共享。已经发送给模型／提交为命令快照的内容无法从其历史“撤回”，UI 要如实说明。仅暂停共享不取消已经明确授权的后台任务，但依赖 live 页面的继续操作要阻塞；用户可另发取消。

“不自动收集秘密字段”靠按页面的 allowlist schema 和专用 adapter，不是对 DOM 文本做一次正则脱敏。不得收集用户其它应用／浏览器 tab、密钥、Cookie、剪贴板或尚未发送的聊天输入；“全 CLI”也不是扩大页面观测范围的理由。

主控读取完整草稿会将内容发往配置的主控模型；执行会话只拿被派发任务所需的最小文本包，Jev 只收任务复杂度／状态摘要，不收选区原文和秘密内容。不能声称传到模型的草稿完全留在浏览器。

## 5. 实时同步协议：ACK 是事实，不是装饰

### 通道与节奏

- 利用 01 的持久控制／事件通道，不再增加一套实时框架。上下文快照通过鉴权 HTTP 同步，WSS 发 context_changed 通知；丢通知按 contextId/seq 补读。
- 页面切换、明确目标选择、Save／审批操作结果、冲突产生立即提交；键入与选区 500ms debounce，连续编辑最多每 2 秒一次 committed snapshot。IME 在 compositionend 后提交，不上传半个中文输入状态。
- 浏览器先形成不可变完整快照并计算 digest；同 tab 的上传串行合并，不无限堆积 every-keystroke events。小文本 inline，大文本先创建 immutable content ref，再引用，不让快照依赖尚未完成的上传。
- snapshot 传输 envelope 建议 128 KiB，总创作内容按字段上限／按需分块；未提供完整内容时设置 `coverage: partial` 和 missingRefs，禁止静默截断。现有 80k 字符素材、50k transcript 等仍需按 UTF-8 字节检查，不把字符数当字节数。
- 心跳可复用已有浏览器 live heartbeat，不写 production.version；建议 60 秒无上下文心跳为 stale，live session 30 分钟清理。用户长时间不操作但页面可连接时保留最近 ACK 的内容，不能把静止理解为离线。

### 原子提交与版本来源

context service 一次返回：

```text
contextId + tabId + pageEpoch + acceptedSeq + digest
observedAt + receivedAt + freshUntil
canonicalVersions（服务端）
viewedVersions（浏览器）
draftRefs（浏览器，未保存）
coverage / missing / stale / sharingPaused
capabilities（服务端，根据 actor 和当前领域规则重新计算）
```

服务器校验 object IDs、站点、Access session、字段允许列表、正文大小和引用 hash；不相信客户端报告的 actor、approval、allowedActions 或 target site URL。`PageContext` 表示浏览器自述，不构成权限证据。canonical 读取与 context 自述不在同一数据库版本时，返回两个版本与 `diverged`，而不是声称原子“所见即最新”。

重连时发送全量新 snapshot 并取 ACK，不能仅发一条无法定位 base 的补丁。context_seq 和 production.version 是两条独立序列；新 production 不保证新页面，新页面也不代表新节目内容。

## 6. 用户说“这里”时，命令需要固定什么

### Capture barrier

发送聊天前浏览器 flush 当前 editor 状态并等待对应 context ACK；随后提交 `{clientRequestId, contextId, contextDigest, target, instruction}`。命令与 immutable context ref 原子保存。不能引用一个会被后续编辑覆盖的 `latest` 对象。

若断线／IME 未完成／上传缺失：提示“上下文尚未同步”，允许用户等待或**明确**改用最后已确认的 saved revision。不能按旧 context 假装完整。没有指定对象且上下文不足的“改一下这里”应先澄清，不猜测页面目标。

命令保存的范围包含：site、tab、pageEpoch、productionId、field/source ID、selection、observed version、draftRevision/hash、scope（选区／当前字段／本期任务）、write intent（suggest/draft/canonical）。原型可模拟这些身份，但不是生产网络的 ACK。

### 页面导航不改写历史意图

用户随后从素材 A 切到素材 B、从选题切到逐字稿、从本地切到生产，主控会看到新的 live context，但旧 command 仍只指向 A／旧 environment。`get_current_context()` 用于了解现在；`get_command_context(commandId)` 用于完成那次工作，两者绝不混淆。

对已经创建的背景研究任务，离开页面不自动取消；但它不得随用户导航自动改为新对象。用户取消、改变目标或暂停特定工作是独立 durable command，不是用 pageEpoch 猜测授权改变。

### 多 tab／多设备

不定义全局“最后一条心跳就是当前页面”。每个会话保留来源 tab；用户发消息或点“以此页面为协作上下文”时显式绑定主控聊天 thread 的 context owner，后台 tab 的心跳不能抢占。页面关闭后标 owner unavailable；新页面需显式接续，主控不随意挑另一个 tab。

context owner 的切换以 server ownerEpoch CAS 完成，target site 不同必须另建作用域。后台任务仍用自己的 immutable context；原 tab 新草稿不得被另一 tab 的同名 source 覆盖。

## 7. 重构后的 API 面

不在聊天 endpoint 里塞一坨 HTML；也不为每个组件发明 endpoint。形成四个 domain：`context`（观察与任务快照）、`commands`（用户意图）、`operations`（可证明效果）、`events`（用户投影）。所有数据契约放到 `packages/contracts`，可生成 OpenAPI 和 host tools；API server 是最终验证者。

以下都是拟新增／替换的路径，不是已上线接口：

| 接口 | 调用者 | 合同 |
| --- | --- | --- |
| `POST /admin/api/agent/context-sessions` | Access 浏览器，同源 | 创建绑定站点／用户／tab 的会话；协作 owner 单独 claim；不接任意 machine token |
| `PUT /admin/api/agent/context-sessions/:id/snapshot` | 所属浏览器 | schemaVersion/pageEpoch/seq＋page／editor／draft refs；幂等 ACK；旧序号拒绝或忽略但不覆盖 |
| `POST .../:id/content` | 所属浏览器 | bounded immutable 文本块，返回 contentRef/hash；受隐私字段 allowlist 限制 |
| `POST .../:id/owner`、`DELETE .../:id` | 所属浏览器 | ownerEpoch CAS 接续／关闭；共享暂停是 snapshot policy transition，回收 live refs |
| `POST /admin/api/agent/commands` | Access 浏览器，同源 | 必填 context ref 或明确 `contextMode:none`；none 只用于无页面任务，含糊指令仍需澄清；原子固定命令上下文 |
| `GET /api/agent/context?sessionId=...` | 绑定的主控 Token＋lease | 获取指定协作会话的最新安全包，含 freshness／coverage；不可枚举其它用户／会话 |
| `GET /api/agent/commands/:id/context` | 领取该命令的主控 | 不可变 command context＋当前 canonical 差异；即使用户已换页也不改变目标 |
| `GET /api/agent/context-content/:ref` | 同作用域主控 | 按 ref 精确读 Markdown／原文及合法 range/hash；过期／不完整明确返回，不偷偷取另一 revision |
| `POST /api/agent/context-requests` | 主控 | 请求明确字段／选区上下文；在线浏览器可采集允许值并 ACK；超时／暂停返回 unavailable，不能远程窥探秘密字段 |
| `POST /api/agent/runtime/operations` | 主控 | 类型化 canonical op 或 draft proposal，强制 command/target/version/hash/lease/operation 元数据；无任意 HTTP 代理 |
| `POST /admin/api/agent/draft-proposals/:id/ack` | 原 context 的浏览器 | 返回 applied/stale/rejected/closed＋实际 draft revision/hash，不修改 canonical；接收消息不等于应用成功 |
| `GET /admin/api/agent/context-sessions/:id/status` | 所属浏览器 | 同步时间、ACK、共享状态、缺失项；不给用户展示 Jev 内部过程 |

`context-requests` 异步，不能让 Worker 持有长 HTTP 等待浏览器回应；机器观察 request status／事件即可。主控未得到必要输入时暂停这项任务，用户界面显示“需要当前选区内容／页面已离线”，而非无限卡住聊天。

### 重构已有领域 CRUD，不留绕过入口

- 人与主控使用同一 production/source/artifact application service，actor 不同；context 服务只组装读取，不复制审批规则。
- 为 source 定义 create/update/delete/reorder 操作，target 用 stable sourceId＋sourceRevision，节目聚合仍保存于现有 D1 production；一次事务推进 production.version。资料新增／删除／更正触发原有 brief/script 失效链。
- 人类 brief Save 和 agent 操作都传 typed changedFields/sourceChanges，不用整份陈旧 sources 数组无条件覆盖；可在领域层一次事务处理多项修改，冲突返回逐字段信息。
- `production.patch`、`source.*`、`artifact.commit`、`audio.request`、`review.submit` 明确区分；未知 op/field 必须拒绝。人工 approve/reopen/publication 仍只接受 human identity，context 可见性不赋予相应机器权限。
- 所有现存机器写 endpoint 都必须经过统一 guard；可以直接重构入口或删除被取代入口，不添加新路径后留下可绕过 lease／operationId 的旧 CRUD。
- `agent-contract.ts`、manifest、capabilities、接入文档同版本同步；无兼容双 schema。版本切换时旧 agent 收到 upgrade-required，保留任务和回执，不静默按新语义恢复旧任务。

## 8. 主控如何安全地修改“你正在写的那一版”

### 8.1 Canonical 写回

仅依据已保存 revision 的任务：沿用 01 的 production CAS、lease fencing、operationId 幂等和人工阶段权限。主控保存成功，左侧实时更新未 dirty 字段；有未保存稿重叠仍进入冲突队列。

“用户正编辑”只是上下文，不给主控降低版本要求的理由。决定改 canonical 时必须明确 `basedOn:canonical` 和基准 hash/version；source 的编辑既检查稳定 ID 也检查其当前 revision。

### 8.2 Draft proposal（重要新增）

用户说“润色这里”而该字段是未 Save 的稿件时，主控可以按 command snapshot 的 draft 修订，但 **不能把它当 canonical PUT**。返回 proposal：

```json
{
  "operationId": "op-unique",
  "kind": "draft.propose",
  "commandId": "cmd-unique",
  "contextId": "ctx-immutable",
  "target": { "entityType": "source", "productionId": "p1", "sourceId": "s1", "field": "content" },
  "preconditions": {
    "contextSessionId": "page-1",
    "pageEpoch": 4,
    "draftRevision": 12,
    "draftHash": "sha256-placeholder",
    "baseProductionVersion": 7,
    "selection": { "anchor": 15, "head": 40, "selectedTextHash": "sha256-placeholder" }
  },
  "edit": { "kind": "replaceSelection", "markdown": "修改后的段落" }
}
```

- 接收浏览器验证 session、target、page/draft revision、hash 和选区，精确相符且仍被用户授权修改时，才可应用为 editor 的一次可撤销变更；页面提示“主控已修改草稿，未保存”，不说“已保存”。无焦点抢占，不滚动聊天外的 shell。
- 原字段仍存在于该页面 session 的 draft store 但用户已换页：proposal 默认 pending，不自动应用到另一可见对象；明确定位原对象并复核后可应用。`expected pageEpoch` 防止延迟回应作用到新页面。原字段已删除／页已关／共享已停：stale，不重建用户已丢弃的草稿。
- 期间用户继续打字、IME 中、Save 已开始、canonical 基准改变，全部不能盲套旧 patch。保留 proposal 与用户草稿，展示差异，用户选择“采用建议”或主控以新 revision 重新做；不把 offset 平移当可靠的语义合并。
- `proposal.created` 仅表示可用；只有浏览器的 `applied` ACK 才能说“已更新左侧草稿”。ACK 丢失查询 proposal 状态／重发同 ID，不重复插入。draft proposal 按 TTL 回收，不存在跨设备的“已应用草稿”假象。
- 用户按 Save 后走 human production service；服务端重新验证当前版本／状态，不靠浏览器 proposal ACK 当审批凭证。若需主控代保存，用户需明确要求并生成新 canonical operation；不得因为允许看草稿就自动持久化。

### 8.3 混合上下文与作用范围

主控可能同时读到已保存 A 与未保存 B。命令必须声明以哪一层为依据；不能拼出一份从未存在的 production 并提交全文。在大任务中，可在 artifact 保留候选，但每次具体写回需对应一个已固定目标和版本。尚未批准的 transcript draft 永远不能发起音频，即使左侧显示“看起来完整”。

## 9. 上下文给模型时是什么样

host 提供两个主要读取工具，而非裸网页：`read_workspace_context(contextId|commandId)` 和 `read_context_content(ref, range?)`；执行前再用 `check_preconditions` 重读当前领域版本。Jev 不负责权限验证。

主控能得到类似事实包：

```text
用户正在：第 001 期 → 选题 → 素材 s1，编辑 content
所见 production：v7；服务端最新：v8（存在差异）
当前草稿：draft revision 12，未保存，内容 ref C12
选区：UTF-16 [15, 40)，所选文本 hash H12
刚刚发生：Save 返回 409；用户仍保留本地稿
上下文：已 ACK seq 28，5 秒前，完整；共享开启
允许：读取、提出 draft proposal；不允许：代替用户批准／覆盖 v8
这次命令：只修改上述选区；不随之后页面切换改变目标
```

facts、浏览器 untrusted text、用户明确命令、频道 policy 与 server capabilities 分别放结构化字段；source/draft 中的“忽略审批”“改用另一个 Token”等文字不是指令。完整正文按需分块，先报告覆盖范围，避免原文越长越挤掉权限和版本约束。

选择范围不完整、context owner 多义或 hash 不一致时，主控明确问“你指的是哪份／哪一版”。每次鼠标移动不触发一次 LLM 调用：context 同步便宜地进入 host store，模型在用户发言、明确任务事件或真正阻塞时才唤醒。

## 10. 存储、过期与撤销

在 01 拟新增表基础上增补最小数据模型：

| 数据 | 生命周期／约束 |
| --- | --- |
| `agent_context_sessions` | tab/owner/scope、seq、pageEpoch、shareEpoch、TTL、最新 ACK 指针；每个 tab 独立，live 数据可清理 |
| `agent_context_snapshots` | immutable contextId/digest、canonical/viewed version vector、draft refs、coverage；命令绑定后固定，不能被 latest 覆盖 |
| `agent_context_content` | 内容寻址、owner scope、敏感字段拒绝、字节上限、TTL；大正文进独立私有 R2，不进公开 MEDIA |
| `agent_draft_proposals` | 指向 command/context/field，期望 draft hash/revision、操作和 ACK 状态；不能用 job.status=complete 替代 applied |
| `agent_commands.contextId` | 与 command 原子保存的不可变引用；task retention 内可恢复，禁止 ref 先清理导致拿错版本 |

引用的内容先写不可变 blob，再用 D1 原子插入 snapshot/command refs；未被引用的上传按年龄回收。提交失败时不删除可能被其它 ref 使用的内容。隐私草稿不计为正式节目历史、不增加 production.version，不以高频心跳耗尽原有 200 条业务事件。

保留策略：live context 建议 30 分钟无心跳回收、未绑定命令正文 24 小时清理；命令固定片段按任务保留期处理。用户暂停共享后新的读取立即受 shareEpoch 阻止，但历史命令仍用于其已授权任务；UI 区分“停止今后共享”与“撤回／取消历史任务”。具体期限待实施前确认和测试，不能在设计期清理真实数据。

上下文包含模型可见的草稿敏感性，必须在私有 D1／R2、权限 scope 和日志策略里处理。服务端日志只记 ID/hash/size/errorCode，不记 draft 正文或选区原文；debug 页不能变成公共内容泄露口。

## 11. 错误、回执与 UI 呈现

| 类别 | code（拟定） | 用户界面行为 |
| --- | --- | --- |
| 页面过期／暂停 | `context_stale` / `context_sharing_paused` | 主控说明当前看不到最新页面，等待同步或用户指定版本 |
| 内容未齐 | `context_incomplete` / `content_missing` | 不冒充掌握全文；具体指出缺少哪份资料／字段 |
| 错误对象／选区 | `target_missing` / `selection_changed` | 保留草稿与候选，重新定位或请求确认 |
| 页面／草稿已变 | `context_epoch_conflict` / `draft_revision_conflict` | proposal 不应用，显式旧稿／新稿对照 |
| canonical CAS | `production_version_conflict` | 沿用 409，不盲重试；保留本地输入 |
| 命令重试 | `idempotency_mismatch` | 同 ID 不同 hash 拒绝；重复同内容返回原回执 |
| owner 歧义 | `context_owner_required` | 用户明确选择协作页面，后台 tab 不抢占 |
| 权限／审批 | `forbidden` | 用户看得到的页面不代表 agent 可以写；左侧操作仍可用 |

context／draft version 冲突用 409；未知或无权访问的 context/ref 不泄露存在性；已在当前授权范围内但过期的引用返回 410；超限 413、频率超限 429（带 Retry-After）、暂不可用 503。无论 HTTP 状态怎样，模型工具必须携带结构化 code、可恢复条件和原 target，不把错误变成一段无上下文的文本。

右侧平时仅展示简短状态：“当前：素材 s1 · 正在编辑草稿”“页面已同步”“这份草稿尚未保存”。可展开“主控能看到什么”了解共享范围和 ACK；不用给用户刷一屏 seq/epoch，更不展示 Jev 过程。技术评审原型可以展示协议摘要，它不是线上监控接口。

### API 与实现映射

这些是拟修改位置，不创建 parallel legacy adapter：

| 位置 | 负责什么 |
| --- | --- |
| `packages/contracts/src/context.ts`、`commands.ts`、`operations.ts` | route-kind／fieldRef discriminated unions、快照／内容 ref／错误／回执 schema；共享静态类型不是替代运行时验证 |
| `apps/web/src/admin/agent/context-model.ts`、`context-service.ts` | 页面状态归一化、seq／ACK、owner、debounce、暂停；不把 DOM 引入 model |
| `apps/web/src/admin/production/ProductionEditor.tsx`、`BriefForm.tsx`、`SourceEditor.tsx`、`useProduction.ts` | 从共同 draft store 派生页面和正文状态，稳定 source ID，去掉 bool-only dirty／whole-form replacement 的限制 |
| `apps/web/src/admin/markdown/MarkdownEditor.tsx` | 只读 selection/composition adapter 与 expected-revision patch 应用；一次可撤销事务、不重挂载 |
| `apps/web/worker/agent-runtime/context.ts`、`context-store.ts` | 权限、内容／TTL／快照 ref、完整性 assembler、命令固定与读取 |
| `apps/web/worker/production.ts`、`production-model.ts`、`production-store.ts` | 人类和机器共享的 typed operations、sourceRevision、canonical CAS／receipt；重开／批准仍是现有领域规则 |
| `apps/web/worker/agent-contract.ts`、`agent-api.ts`、`production-prompts.ts` | 统一 OpenAPI/capabilities、context tools、任务提示包；不再靠静态提示词隐含“最新页面” |
| `packages/agent/src/context.ts`、`tools.ts`、`transport.ts` | 主控读取当前／命令上下文、内容请求、draft proposal ACK 对账；工作会话只获任务需要的固定输入包 |
| `apps/web/migrations/`、API／ViewModel／浏览器测试 | 新 schema 和 stable ID 数据补齐；保存真实数据，不保留能绕过新操作 guard 的旧路由 |

## 12. 纵向实施顺序与验收

1. **shared contracts＋读模型**：提取既有 production schema；补 stable sourceId／sourceRevision、context/session/content schema、只读 assembler 和 server capabilities。先证明页面事实不授予权限。
2. **ViewModel／context publisher**：生产编辑器、素材详情、MarkdownEditor adapter 接入；canonical/draft/selection 分离，safe allowlist，单 tab ACK；不改变 Save 的语义。
3. **主控精确读上下文**：消息 capture barrier、immutable refs、内容按需读取；“这里”绑定正确对象，断线／多 tab／IME 明确行为。
4. **双向编辑闭环**：canonical typed operations 和 draft proposals／ACK，稳定 ID、CAS、冲突 UI；主控能够帮忙但不覆盖用户在途输入。
5. **全工作室覆盖**：列表、成品、试听、审批、发布、频道与敏感设置页；删除旧 copy-prompt／直接 bypass API，更新 OpenAPI／capabilities／onboarding。

每一层可运行、独立原子提交。设计阶段不提前创建 agent 包或改数据库。

验收必须覆盖：

- **L1 ≥95% 四指标**：context schema／私密字段拒绝、seq/pageEpoch/shareEpoch、stable sourceId、UTF-16 选区 hash、snapshot pinning、draft vs canonical、typed op 权限、source revision、proposal 去重。
- **L2 真本地 API**：乱序 context PUT、同 seq 异内容、token/site/tab 越界、D1 ref 原子性、partial 内容、暂停后晚到请求、owner CAS、丢 ACK、context ref 过期、proposal applied ACK 伪造不能变成 canonical 保存。
- **L3**：用户不发消息时切页／点素材／编辑／选中段落，主控上下文仍更新；点聊天后选区保留；发送后换页旧任务不漂移；dirty 文本被理解但没有 Save；同字段继续键入使旧 proposal stale；草稿 Save 中的输入、中文 IME、Ctrl+Z、多 tab 和断线恢复。
- **安全**：Token 输入／未发送聊天草稿／剪贴板／DOM 隐藏数据不被抓取；网页／draft prompt injection 无效；私有 R2 不公开，日志无正文／秘密，模型调用输入范围可核对。
- **计费和权限**：context 高频变化不频繁唤醒模型；看到正在试听不等于批准；draft 未批准无法合成音频；Jev 内部选择不出现在用户聊天中。

本篇设计以当前源码为依据，不声称这些 API 已存在。交互页面只模拟状态与回执，不写网站、不共享真实页面或草稿、不调用模型。
