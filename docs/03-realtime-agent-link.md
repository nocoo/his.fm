# 03 · 常驻双向连接：参考 Eagle 的 AgentHub DO 方案

Implementation note (2026-10-03): the local native-agent slice is now implemented and locally exercised. This document remains the broader reviewed design, not a claim that every proposed capability exists. See [current implementation status and limits](agent-implementation.md).

状态：设计提案，未实施／未部署。2026-10-03。补充 [01 · Agent 工作流](01-agent-workflow.md) 与 [02 · 页面上下文 API](02-page-context-api.md)。本篇取代它们此前“WSS 只通知、工作靠 HTTP 领取”的弱实时描述；业务权威和审批规则不变。

[Archify 整体架构图](agent-architecture/index.html) · [文档目录](README.md)

## 1. 结论

**采用一个按站点／频道寻址的 `AgentHub` Durable Object，作为 Web ↔ 云端 ↔ 本机主控的常驻、双向、可恢复链路。** 本机 daemon 启动就连接，不由浏览器是否打开来决定连接／执行生命周期。网页在授权工作室内默认连接，没有“开启实时／暂停 agent／共享页面”开关，也不新增常驻上下文提示。

- 工作中：用户消息、控制请求、页面 context 引用、主控答复、任务进度、草稿建议和提交回执走类型化 WSS 帧，不依靠数秒级 GET 轮询驱动工作。
- 空闲时：模型不运行，但本机到 Hub 的会话仍在，保持有界心跳；Web 关闭后主控继续工作并接收服务端任务事件。
- 断线时：明确区分传输不可用、任务已持久化、执行结果未知；自动重连／补发同一逻辑消息，不重做业务副作用。
- 大正文和媒体：鉴权 HTTPS 上传／读取不可变内容，WSS 只传引用，避免大文件堵塞取消、心跳与聊天。
- D1／现有 application services 仍是命令、租约、业务状态和幂等回执的权威；DO 不运行 LLM，也不另建一套节目／审批数据库。

“持续实时”是产品的工作期要求，不是永不断线的网络承诺。机器睡眠、操作系统冻结或网络断开时不可能保持真正在线；方案提供检测、持久化、自动重连与恢复，而不是假装连接仍好。

### 轻量上下文，不是屏幕采集

**明确排除截图、录屏、OCR、视觉模型看屏幕、终端画面流、完整 DOM／可访问性树快照、鼠标坐标和滚动轨迹采集。** Eagle 只借鉴连接、心跳、重连、身份和背压，不复用其 `pane.read`、屏幕 polling、terminal frame 或远程按键注入。

页面本来就知道用户在哪，直接由 Router／ViewModel／编辑器 adapter 发送少量结构化事件即可。例如：

```json
{
  "type": "context.snapshot",
  "payload": {
    "tabId": "tab-1",
    "pageEpoch": 4,
    "contextSeq": 28,
    "page": "production",
    "productionId": "p1",
    "step": "brief",
    "sourceId": "s1",
    "field": "content",
    "activity": "editing",
    "viewedVersion": 7,
    "draftRevision": 12,
    "dirty": true
  }
}
```

这只是上下文 payload 示例，实际使用第 4 节统一 envelope。只有发生相应业务状态变化才更新；心跳不附带整份稿件，更不采样画面。选区只在用户明确选中文本并有修改需要时提供语义范围；正文按 API／固定 draft revision 读取。上下文足够定位，缺少内容时按需补取，而不是不断收集整页。

## 2. Eagle 的实际依据

只读检查 `../eagle`，工作区干净，固定提交 `8e0593c8100275984d8a0a9e65afa1b448b2558a`。没有运行 Eagle agent、远程输入、Herdr 采集或生产网络验证；以下是源码／文档证据，不是本轮运行证明。

| Eagle 文件／实现 | 已有行为 | his.fm 采用或调整 |
| --- | --- | --- |
| `src/worker/index.ts`，`/api/v1/realtime-agent` | 本机 Bearer header＋机器身份匹配；15 分钟最大授权期；浏览器 Access＋严格 Origin | 采用握手身份／到期约束，改为 his.fm station/token/site scope；Token 不进 URL／浏览器 |
| `src/worker/realtime.ts`，`LiveRelay.connect` | `acceptWebSocket`、role 附件、一台机器一条 agent 连接、多 viewer | 采用 hibernatable 双向中继；每频道一个主控 station，浏览器只是观察／向主控发指令 |
| `LiveRelay.prune/schedule` | 35 秒未收到消息关闭；DO alarm 取最早到期时间；按凭据撤销连接 | 采用空闲检查＋授权撤销，不把 socket 活着等同于有效写租约 |
| `LiveRelay.send` | viewer 未确认输出超过 2 MiB 或 128 帧时关闭慢连接 | 借鉴应用级收取确认和背压；终态／回执不丢，浏览器从 snapshot/cursor 恢复 |
| `LiveRelay.message` | 先存输入 seq 再转发，回执 submitted/rejected/unknown，旧 subscriptionId 不接收新帧 | 借鉴身份和“ACK 不等于完成”；his.fm 任务需 D1 durable enqueue，不只是转发终端按键 |
| `agent/realtime.ts`，`realtimeWatch` | 主动连出；首个 ping；每 10 秒心跳，30 秒无入站消息 terminate；1–30 秒 backoff；401/403 停止 | 采用，增加 jitter、hello/resume 完成后才算 ready；仅 open 不能清空故障计数 |
| `agent/realtime.ts` 的 `bufferedAmount` | 出站缓存 >512 KiB 就停止采集并断开，不无限积压 | 借鉴有界缓存；his.fm 不杀掉已经持久化的写稿任务，而是停传输并保存 outbox |
| `src/web/Realtime.tsx` | immediate ping；5 秒心跳；30 秒超时；重连 1–15 秒；按 subscription/terminal identity 接受结果 | 采用身份／代际校验；his.fm 的阶段、素材切换不销毁 socket，使用同链路更新订阅／context |
| `MachineState.webSocket* / alarm` | hibernation 回调＋附件重建、close 清理、D1 outbox alarm 共用最早截止 | 采用连接清理和合并 alarm，不设置阻止 hibernation 的常驻 DO timer |
| `tests/api.test.ts`、`tests/realtime-agent.test.ts` | 有真实 Miniflare DO／D1 与本机桥接替身测试，包含过期、慢 viewer、突发断开、身份和输入未知结果 | 作为验收用例来源，不复制 Eagle 的现场凭据或资源 |

Eagle 文档：[`REALTIME.md`](https://github.com/nocoo/eagle/blob/8e0593c8100275984d8a0a9e65afa1b448b2558a/docs/REALTIME.md)。源码入口：[relay](https://github.com/nocoo/eagle/blob/8e0593c8100275984d8a0a9e65afa1b448b2558a/src/worker/realtime.ts)、[本机连接](https://github.com/nocoo/eagle/blob/8e0593c8100275984d8a0a9e65afa1b448b2558a/agent/realtime.ts)、[浏览器连接](https://github.com/nocoo/eagle/blob/8e0593c8100275984d8a0a9e65afa1b448b2558a/src/web/Realtime.tsx)。

### 不照搬的行为

1. Eagle 的最后一个 viewer 离开会停止该 Space 的屏幕采集；his.fm **没有 viewer 也继续任务与本机 WSS**，不能把任务 runner 放在前端订阅 effect 里。
2. Eagle 浏览器隐藏时主动关闭实时页、重连后重新申请终端控制；his.fm 不因路由切换／隐藏自动停主控。浏览器受 OS 冻结时允许 socket 被回收，恢复自动 resync，不能要求用户点“重新开启”。
3. Eagle 输入是可能产生任意外部效果的终端按键，因此 unknown 不重放；his.fm 可重传有 requestId 的持久 command／operation，但 **未知 shell／付费效果仍先对账**，不能一概重试。
4. Eagle 中继不存终端屏幕／输入；his.fm 必须保存正式命令、消息、任务事件和回执，页面草稿按 02 的私有短生命周期保存。原始内部推理、Token 和完整 CLI 屏幕依然不上云。
5. 不复制 Eagle 的独立 `realtime-watch` 进程。his.fm 的传输 loop 与唯一主控同进程运行，避免两个服务争相注册同一 station。Pi 的长任务不阻塞传输事件循环。
6. 不复制 Eagle 的手动“接管／释放终端控制”产品 UI；浏览器没有直接控制子会话／shell 的权力。具体任务可取消，ambient 主控和页面理解没有开关。

## 3. 拓扑与职责

```text
                         Cloudflare
Web 工作室 ─── WSS ───┐
                      ▼
                AgentHub DO（site/channel）
                      ▲         │
本机主控 ───── WSS ───┘         ├─ typed command/context/event 路由与优先级
  │ 主动连出，无入站端口         ├─ hibernatable sockets / connectionGeneration
  │ 独立传输 loop               └─ 调用统一 application service
  ├─ Pi conversations                      │
  └─ SQLite outbox + cursors                ▼
                                   D1 commands/events/receipts/lease
                                            │
                                     transactional relay outbox
                                            │
                         DO 送达 / 重连同步 / alarm 修复未唤醒记录

Web / 主控 ── 鉴权 HTTPS ── Worker ── 私有 R2 内容引用
AudioWorkflow ── 统一事件记录／wake ── AgentHub ── 主控与 Web
```

Worker 只负责公开入口的身份、Origin、协议和站点路由，生成内部身份上下文后转给 DO。不能让客户端伪造 `x-internal-role` 变成可信身份。DO handler 直接复用同一 application service／D1 adapter，HTTP 内容接口也用这些服务；不要从 DO 再 HTTP 调自己的公网域名，形成递归或凭据泄露。

DO 自己的 SQLite/KV 只存 transport generation、恢复水位、唤醒／调度元数据；业务记录仍在 D1。正文不能塞入 `serializeAttachment`，attachment 控制在平台 2 KiB 限制内并留余量，仅放 role、授权 ID、generation、游标、到期等。用户当前页面 state 是 02 的私有 context 服务数据，不是随 socket hibernation 消失的 JS Map。

DO 全局单线程不代表跨 `await` 的多个外部写天然原子。D1 command/op persistence 使用唯一约束与 CAS；`blockConcurrencyWhile` 仅用于短的初始化，不能拿它包模型调用／上传／等待 agent ACK。

## 4. 一条连接内的类型化消息

两端都只有一个连接 supervisor；所有创建／关闭／重试由它拥有。相同 station 只允许一条已接受的 agent connectionGeneration；握手已存在冲突先安全拒绝，不能仅因“新 socket 到达”就默默抢占仍健康的进程。

示意 envelope（不是最终生成 schema）：

```json
{
  "protocolVersion": 1,
  "connectionId": "issued-by-server",
  "generation": 3,
  "stream": "command",
  "type": "command.submit",
  "messageId": "logical-id-stable-across-reconnects",
  "replyTo": null,
  "payload": {
    "clientRequestId": "request-uuid",
    "contextId": "immutable-context-id",
    "instruction": "缩短选中的这段"
  }
}
```

connectionId/generation 服务端签发；messageId 是逻辑消息身份，不随重新连线换一个。帧内 siteId／stationId／actor 即使存在也不能作为鉴权依据，必须与握手绑定相符。相同 messageId＋不同 hash 返回冲突。跨流不用一个序列号假装全局顺序：contextSeq、command cursor、event cursor、stream revision、operationId 分别定义语义。

| 帧组 | 方向 | 承诺与处理 |
| --- | --- | --- |
| `hello / welcome / resume / ready` | 双向 | 协议版本、授权、站点、generation、已 ACK 游标／未定 operation 清单；完成 replay barrier 后才接受新副作用 |
| `ping / pong` | 双向 | 仅证明链路可交换消息，不表示 job 进展、批准或 business ACK |
| `context.snapshot / context.accepted / context.available` | Web → Hub → 主控 | 通过 context service 验证并持久化／返回 ACK，常态只传页面／字段／版本等小元数据；需要正文时按精确 content ref 读取，不采集画面 |
| `command.submit / command.persisted / command.deliver / command.accepted` | Web → Hub → 主控 | D1 入库 ACK 与本机 SQLite 领取 ACK 分开；没有第二个 ACK 不能称为开始执行 |
| `task.control / control.persisted / control.applied` | Web → Hub → Host | 用户仍只向主控发取消／暂停具体任务；确定性 host 快路处理，不等待长 LLM turn，确认实际停止后才 applied |
| `assistant.delta / task.progress / conversation.presence` | 主控 → Hub → Web | 只含允许的可见内容；delta 可合并／重置，进度不伪造百分比；Jev 内部事件不在 schema 中 |
| `message.commit / task.state / artifact.ready` | 主控 → Hub → Web | 主控先本地持久，Hub 经 D1 durable commit 后 ACK，再扇出；不可被 token 流挤掉 |
| `operation.submit / operation.receipt` | 主控 ↔ Hub | 统一领域服务执行；production CAS＋lease fencing＋稳定 operationId；ack 丢失先按 ID 查回执 |
| `draft.propose / proposal.available / draft.applied` | 主控 → Hub → Web → Hub | 原 tab 依据 context/draft hash 校验；传输 ACK 不是“左侧草稿已应用” |
| `delivery.ack / resync.required / snapshot` | 双向 | 有界送达窗口、slow consumer recovery；明确 resync 与旧 token stream reset |

HTTP content／snapshot 查询用于大内容、初始引导和精确对账；不另写一套 HTTP 业务实现，更不在 socket 失败时静默切到定时轮询并称其“实时已恢复”。生产现有人类 Save 请求可以继续用 HTTPS，经同一 service 将事件写入 outbox 并立即送到 Hub。

02 的 HTTP 风格接口仍描述 application service 的动作、返回和权限；工作期的小消息通过这些 WSS 类型调用同一服务。context／command 的首选路径不再是“HTTP 写、WebSocket 仅通知、agent GET 领取”。

## 5. ACK 与持久化：四种成功不能混为一谈

1. **transport received**：帧通过验证并进入有限缓冲，没有业务保证。
2. **server persisted**：D1 已保存 command/event/receipt/context ref；用户指令可以称“已收到”，机器尚未必开始。
3. **agent accepted**：assignment、固定输入、requestId 已写本机 SQLite；随后由 Pi scheduler 执行。
4. **effect committed / draft applied**：网站领域事务成功或原浏览器确实更新了 draft，才是用户关心的结果；审批仍是另一种 human action。

主控看到的 server receipt 同样要落入自己的 SQLite 后再推进本地 ACK 水位。SQLite 突然断电可能丢最新写入：重连重读服务端 receipts 并按 logical ID 去重，不能用 socket send 返回值作为 durable 证据。

### 防止 D1 成功、通知丢失

领域变化与一条 `relay_outbox` 记录在同一 D1 事务／共享条件下写入，包括人类 Save 和 AudioWorkflow 完成。提交成功后立即 invoke Hub flush；没有收到 wake 不应丢工作。

**服务中的 Hub 在接受连接前就设置 repair deadline，工作期每 15 秒最多一次扫未 ACK outbox 作为修复网，不是常规配送。** 普通配送由提交后主动 wake／已有 socket 触发。alarm 每次重新安排最近 deadline；没有连接时记录仍在 D1，下一次站点握手必定从 outbox/cursor 对账。单次 repair 按字节和行数上限分页，失败退避、不报“已送达”。不能“写完 outbox 之后才首次设 alarm”却宣称覆盖两者之间的崩溃窗口。

DO 消费 D1 变更需要 session consistency：canonical writer 返回 bookmark／确切 version，内部新 session 必须用对应 bookmark 或强制 primary 读取，不能把异步 replica 上的旧 lease／旧 snapshot 当最新状态。命令、租约与回执的正确性由 primary transaction/CAS 保证，不靠 D1 read replica 的最终一致性猜测。

retention 不得早于可恢复任务／receipt 所需水位。只有超过预算的可替换 progress/delta 能丢弃；过期历史用明确的 snapshot reset，不把 terminal/control 消息悄悄抹掉。

## 6. 保活、授权与重连参数

以下是从 Eagle 经验收敛的 **his.fm 初始目标值，未实测**。同一配置／schema 定义一次，客户端与 Hub 不各抄一份常量。

| 项 | 初始选择 | 原因 |
| --- | --- | --- |
| 握手超时 | 10 秒 | 防止卡在 opening；机器禁止跟随跨域 redirect 发送 Authorization |
| 连接后首帧 | 立即 `hello`，随后 `resume`；不能只等服务端说话 | 发现协议／身份问题，也覆盖 Eagle 记录的首条应用消息之前 close 边界 |
| 应用心跳 | agent／活跃 Web 每 10 秒 | 即使模型调用等待数分钟，链路仍响应 |
| 客户端静默超时 | 30 秒无有效入站消息 | terminate 后进入一个 supervisor 重连，不保留幽灵连接 |
| Hub 存活截止 | 35 秒无合法帧 | alarm 回收；旧连接的晚到帧被 generation 校验拒绝 |
| 重连退避 | 1、2、4…30 秒上限＋20% jitter | 减少重连风暴；只有 hello/resume 成功且稳定约 30 秒才重置计数 |
| socket 最大授权期 | 15 分钟与凭据实际到期的较小值 | 到期前静默重新鉴权；不是无限使用首次握手身份 |
| station 写租约 | D1 60 秒、每 20 秒持有效鉴权续租 | 与 transport 保活分开；pongs 不能自动延长写权限 |
| context 新鲜性 | 沿用 02，且连接断开立刻标为不可视为实时 | UI 不加徽章，但主控不能用 stale 页面猜“这里” |
| 工作期修复检查 | 最多 15 秒一次 outbox repair | 只补主动唤醒崩溃窗口；普通消息不等下一次定时器 |

认证失败 401／403、Token 撤销、协议不支持／schema 错误停止无限重试，保留安全的待办与本地稿；不能偷偷开浏览器登录或改用其它账户。授权正常的 15 分钟续期自动完成，不向用户弹出“启用”提示。站点永久变更需新 namespace，不能把一个网站 outbox 发往另一个 origin。

长连仍定期核对撤销状态：写帧每次验证 Token／station／lease，心跳和续租也检查；撤销路由主动关闭 Hub 内对应 socket，丢通知仍在下一次检查失效。已有 WebSocket 不等于永远有效的 Access JWT，浏览器到期重新走 Worker Access 验证。

单机重连在确认前一代连接不再占有后更新 connectionGeneration；重新拿到当前有效 station lease 前不启动新副作用。显式另一机器接管才变更 station 所有权；相同 stationId 不是任意两个 daemon 能同时写的通行证。

## 7. 断线恢复顺序与不重做原则

状态机：`disconnected → connecting → authenticated → resuming → ready → reconnecting`；终止态为 `auth_required / protocol_mismatch / stopped`。这些是内部状态，不做常驻产品条幅。

`authenticated` 还不能开工，必须完成：

1. 本机传输 loop 先恢复独立于模型的 inbox/outbox、receipt 水位，向 Hub 上报最后 durable ACK 和未确定 operationId。
2. Hub 读取 D1 真相、当前 lease 和 command/event 高水位，发送限定范围的 replay batch；context 只补最新合法 snapshot，不重放每次键入。
3. 主控按 commandId/requestId 匹配已持久 assignment。已经完成的 operation 查 receipt，已经 accepted 的任务继续恢复，不新建 conversation 再跑一次。
4. 主控在本地持久化 reconcile 结果后 ACK；Hub 发 `ready` 和 generation。期间新消息暂存在 durable queue，先控制／取消，再派发新工作。
5. 才恢复 Pi 的安全 scheduler；中断 CLI 或 paid effect outcome unknown 继续 needs_attention／对账，不能为了“恢复在线”自动重放。

超出 replay retention 的浏览器得到 `resync.required`＋最新 snapshot，并保留本地 dirty 字段做 02 的合并。**snapshot 不负责标记未知操作已执行**，operation receipts 单独对账。

本机短暂离线时已启动的纯文本生成可以完成并写本地 outbox；到达外部效果边界必须重新验证有效链路／授权／租约。不能仅因为 D1 lease 尚剩 10 秒就允许网络不确定期间新付费调用。远端取消已经入库但尚未送达时 UI 必须表示“取消待送达”，不谎称本机停止。

## 8. 模型／CLI 不得阻塞实时链路

保持一个 his.fm daemon，无需另建独立常驻进程。内部三条逻辑队列：transport/control、Pi assignments、可见 telemetry。WSS message/heartbeat 回调不 `await` 一个完整写稿或 shell 命令；先落盘、排队、快速返回。

- 外部 CLI 通过异步子进程运行，有限 stdout/stderr、超时和 AbortSignal。禁止在实时 loop 用 `execSync/spawnSync` 跑长命令。
- 昂贵本机纯 CPU／大文件处理使用异步流或短生命周期 worker thread／已有 CLI，不能持续阻塞 Node event loop。仍是同一 supervisor 的受控任务，不新增拥有网站 Token 的自治 agent。
- 取消消息有优先级，但仍是给主控 host 的正式命令；host 立即触发对应 cancellation scope，不等待模型先读到一句“停止”。Web 没有直接给子 conversation 或 shell 发输入的接口。
- “工作在运行”“模型无输出”“连接活着”“heartbeat 正常”分别记录。心跳不刷新任务的实际进展时间，也不被转换成“任务完成”。

## 9. Hibernation、背压与资源预算

使用 `ctx.acceptWebSocket()`、`getWebSockets()`、attachment、`webSocketMessage/Close/Error` 和 alarm；重建所有必需 routing 状态，不能依赖被驱逐的 JS Map。处理 close 时不发送保留的 1005/1006/1015 close code，error／abrupt close 都释放 attachment／generation 资源。

Cloudflare 自动处理 **WebSocket protocol ping/pong**，可不唤醒 DO；我们的 JSON `ping` 是**应用消息**，会进入 handler，也会唤醒 DO。不能既宣称每 10 秒查授权，又宣称整个连接免费长期 hibernate。首版保留简单应用心跳和准确授权／存活检查；后续如采用 auto-response 优化，必须另有授权到期／D1 租约 alarm，不能让 auto-pong 无限续命。

候选预算（待压测）：

- 每频道 1 个主控 station／1 条 agent socket，浏览器连接上限 12（不是 12 个模型主控）。多标签正常订阅，过量连接返回明确容量错误。
- 单帧 64 KiB；context envelope 大于帧预算时先上传内容块再传 ref。不能直接继承 Eagle 256 KiB terminal frame 作为自己任意 JSON 体上限。
- node socket `bufferedAmount` 超过 512 KiB 进入背压；控制／ACK 队列保留专用预算，先合并 progress/token delta，必要时关闭 socket 从 durable outbox 恢复。
- 每浏览器未确认投递最多 128 帧／2 MiB；确认只能推进已经送出的合法 watermark。这个 ACK 是客户端接收／状态 reducer 应用，不证明人已经看过。
- 模型可见输出增量最多 5 帧／秒；切换、完成、错误和取消有独立优先级。批量记录 cursor，浏览器落后时用 snapshot 替换临时流；正式 final message 永远按 messageId 去重并持久化。
- 内部队列／SQLite outbox 达容量上限停止新派发、继续处理取消和错误；不得无限占内存、磁盘爆满后删未 ACK 结果。

一个慢 viewer 不能拖住主控与其他网页。没有 viewer 只停止前端 delta 扇出，不停止主控连接或持久任务事件记录。浏览器隐藏时允许降低渲染频率、缩减可替换帧；不能通过页面 visibility 事件取消本机工作。浏览器被系统冻结后从新 generation＋cursor 自动恢复。

## 10. 与 02 的页面上下文合流

页面编辑仍是本地 ViewModel → context publisher。现在 publisher 在现有 WebSocket 上发 `context.snapshot`，Hub 内的 context service 返回 `context.accepted`；主控同一常驻链接立刻收到新 contextId／可用正文引用。

发送“改这里”先 flush 当前草稿／选区并等 **server persisted context ACK**，随后 `command.submit` 固定 contextId。并行传输可能使主控先收到 command 通知、后收到 context.available，但它能按 immutable ID 从同一协议查询／读取正文；不拿“目前最新页面”代替命令快照。

正文 ref 过期、页面世代切换、站点切换、source 删除和 draft 变化仍按 02 拒绝错误应用。socket 顺序只保证单连接帧顺序，不能取代跨 Web/agent/HTTP/音频的版本检查。

开发环境现有 `apps/web/scripts/production-proxy.ts` 必须新增固定 upstream 的 upgrade 路径；只转发指定 agent live endpoint，验证 Origin，Access 身份只在代理进程读取和注入，不发给浏览器、不代理任意 ws URL。真实部署不附带这个开发代理。

## 11. 实施边界与验收

待批准后改造，不在本轮启动任何长连或 provision 云资源：

| 文件／模块 | 变更 |
| --- | --- |
| `apps/web/worker/agent-hub.ts` | SQLite-backed hibernatable DO、握手／角色／generation、消息 router、alarm、backpressure |
| `apps/web/worker/agent-runtime/*` | 单一服务层、D1 commands/events/receipts/context/relay_outbox；供 DO 与 HTTP 共用 |
| `apps/web/worker/entry.ts`、`apps/web/cloudflare.config.ts` | 导出 AgentHub，通过 cf `exports.durableObject({ storage: 'sqlite' })` 和 `bindings.durableObject(...)` 配置；不引回 Wrangler |
| `apps/web/worker/production-store.ts`、`audio-workflow.ts` | canonical 成功与 outbox 同边界持久化；commit 后唤醒 Hub；失败可补发 |
| `packages/contracts/src/realtime.ts` | strict 双向 schema、帧预算、close/retry code、ACK 层级、protocol version |
| `packages/agent/src/transport.ts` | 独立于模型工作的 supervisor、heartbeat、jitter reconnect、resume barrier、local inbox/outbox |
| `apps/web/src/admin/agent/*` | 挂在工作室 shell 的单连接 client、reducer／cursor、默认后台 context 与消息控制 |
| `apps/web/scripts/production-proxy.ts` | 固定目标 WSS upgrade、安全 Origin／Access 边界 |

配置 mode 必须给本地与生产不同 DO namespace／site identity；本地测试不能访问生产绑定。cf 配置语法以实现时安装的版本验证，参考文档而非照抄 Eagle 的 wrangler migrations。

### 必须跑的测试

- **常驻性**：长 LLM 等待、CLI 持续输出期间心跳仍按时；无浏览器／隐藏 tab／切阶段，主控连接与任务不停。
- **真实 DO 生命周期**：Miniflare 多 socket、hibernation/重建可测试面、abort close、15 分钟授权、最早 alarm 不被晚 deadline 覆盖；本地不可模拟的真实驱逐需独立生产前验收，不能捏造已覆盖。
- **提交窗口**：D1 成功但 wake 丢失、server persisted ACK 丢失、本机 accepted ACK 丢失、effect 已成功但 ACK 丢失，每处 kill/reopen 不产生重复 canonical 写回或错误完成状态。
- **重连与身份**：hello 前断开、反复 open 但 resume 失败、旧 generation 晚到帧、同 station 双进程、Token 撤销、Access 到期、协议版本错误；无无限 retry storm 或失效身份写入。
- **消息优先级**：大正文／token 流／慢 viewer 下取消仍可送达；只终止慢端，其他 viewer 与主控正常；outbox 达上限不丢 terminal/control。
- **轻量范围**：不安装／调用屏幕或终端采集器；消息 schema 不接受图像帧、任意 DOM dump 或坐标轨迹；心跳不携带文本正文。
- **页面上下文**：切页不换连接，但 pageEpoch 改变；旧 command 始终绑定原对象，draft proposal 对原 revision 校验；断线恢复不覆盖未保存字段。
- **自动恢复体验**：无开启／暂停控制，无常驻上下文提示；只有实际影响工作时主控给可操作说明，连接恢复无需用户“重新启用”。
- **本地隔离**：fake Token／模型／CLI、临时 SQLite＋本地 DO，测试不用真 Falcon、不执行 Eagle／Herdr 输入、不生成真实音频。

性能验收目标而非当前承诺：可用网络下，durable command 入库后到 agent accepted 的 P95 ≤1 秒；已提交事件到可用浏览器应用 P95 ≤1 秒；本机活跃控制指令接收 P95 ≤1 秒，实际停止时延单独衡量。测量分段 RTT／排队／落盘，不把 LLM 推理耗时混进传输 SLA。故障期没有低延迟承诺，只有可追溯的安全恢复。

## 12. 参考

- [Eagle 固定版本](https://github.com/nocoo/eagle/tree/8e0593c8100275984d8a0a9e65afa1b448b2558a) 及上文文件。只读代码参考，不等于已复用／运行。
- [Cloudflare WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)：2026-10-03 检索；协议 ping 与应用消息的行为不同。
- [cf configuration](https://developers.cloudflare.com/cf/projects/cloudflare-config/)：DO export／binding 配置入口。
- [01](01-agent-workflow.md) 的审批／幂等／本机权限；[02](02-page-context-api.md) 的 context/draft/selection 契约继续生效，传输方式以本篇为准。
