# Agent architecture review

[打开 Archify 交互架构图](index.html) · [架构 JSON](system.architecture.json) · [工作室交互原型](../01-agent-workflow/index.html) · [文档目录](../README.md)

这是 his.fm **拟新增 agent 的完整集成提案**，不是当前运行拓扑，也不是实现许可。先看系统图，再决定模块／边界是否合理；此轮不继续扩写实现代码。

## 怎么看

- 默认全图：浏览器 → Cloudflare → 本机三个区域，12 个主节点。
- 顶部五个章节：页面协作、常驻实时链路、主控与执行会话、作品与审批、本机信任边界。
- 点节点看职责和直接关系；支持搜索、关系追踪、缩放、深浅主题和 SVG/PNG 导出。
- 节点标签区分复用已有能力与拟新增。所有 agent runtime／DO／上下文能力仍是设计。

箭头表示调用／交付发起关系；标注“往返”“双向”的链路包含响应，不表示网络只能沿箭头单向传输。生产领域服务和 WSS gateway 同属一个 Worker，图中分开表示职责而非多个后端部署。

## 图中的几项聚合

- **唯一主控**包含确定性 Host 与 Pi root conversation。只有 Host 持有网站 client；子会话拿到固定输入包，返回 Markdown 成果，不直接写网站。
- **长期／短期 conversation**都是同一个本机 Pi Harness 中的持久会话。长期角色跨节目复用，短期角色绑定某次具体工作；不同 model/think 由 Jev 从本机配置的合法 profile 中选择。
- **本机 CLI / 文件**表示共享 NodeExecutionEnv 能力。为保持全图清晰，仅绘制短期执行的代表性工具调用边；长期执行角色同样可按任务使用本机工具。没有 OS 沙箱，不把网站 client 的逻辑归属说成安全隔离。
- **配置 / SQLite**是本机持久层聚合，实际包含一份 `~/.config/his.fm/config.json` 和独立运行状态数据库，不表示配置写进 SQLite。
- **R2 成果存储**聚合两个权限不同的 bucket：现有公开音频／封面，拟新增无公开 CDN 的私有 Markdown／资料。不能混用公开路径。
- **AgentHub DO**不跑模型、不采画面；它保持主控与后台的常驻双向连接。后台权威状态仍在 D1；本机断点／outbox 在 Pi SQLite。
- **Web 工作室**保留左侧操作与 Save，右侧主控默认在场，无启用／暂停开关或“正在理解页面”提示。page/entity/field/edit-state 来自 Router／ViewModel；正文按 API 或固定草稿引用获取，绝无截图、OCR、终端屏幕采集或全量 DOM。

人工确认仍由 Web 的人类身份执行，主控验收不能代替审批或平台发布。Eagle 仅作为实时传输实现的参考，不带入其屏幕 polling 和远程终端输入。

## Archify 来源与可再生成性

使用本机参考 `/Users/nocoo/workspace/references/archify/archify` 原生 renderer，不是手工仿造样式。

- Reference revision: `10722002bb8777ecb639d93c49586fae4adf3ae4`
- Renderer version: `2.17.0-dev.1`
- Source: `system.architecture.json`；schema v1、`architecture`、`zh-CN`、`showcase`。
- `index.html` 是自包含生成产物，不手工编辑；修改只改 JSON 后重新验证／生成。
- 许可证见 `ARCHIFY-LICENSE.txt`，第三方说明见 `THIRD_PARTY_NOTICES.md`。未使用第三方品牌标记；内嵌字体条款由 Archify 产物保留。

从仓库根目录执行，`ARCHIFY_DIR` 指向既有参考，不需要安装依赖：

```sh
ARCHIFY_DIR=/Users/nocoo/workspace/references/archify/archify
node "$ARCHIFY_DIR/bin/archify.mjs" validate architecture docs/agent-architecture/system.architecture.json --quality showcase --json
node "$ARCHIFY_DIR/bin/archify.mjs" deliver architecture docs/agent-architecture/system.architecture.json docs/agent-architecture/index.html --quality showcase --json
node "$ARCHIFY_DIR/bin/archify.mjs" visual-check docs/agent-architecture/index.html --json
node docs/agent-architecture/verify.mjs
```

## 本次验证

- `delivery.json` 是原始生成回执：9/9 showcase checks、0 errors、0 warnings。
- Specification SHA-256: `081cd3c98ab6529dd4464700ae54c772376e59d8cbf8ea429f84eaac043946ac`
- Artifact SHA-256: `b718ada8de4877616211c411245f95f7b93d82edc1ac6acdbbc9aedafbf40f01`
- 自动浏览器证据：passed。1440×900、1600×1000、1920×1080、2048×1320 全部无横向／纵向页面溢出。
- 感知审阅：已实际查看 2048×1320 light 与 1440×900 dark 截图，关系无节点遮挡，主链路和三个边界可分辨。小屏看细节可使用内置缩放；不将自动测试等同于用户审批。
- 截图和 Archify 原始浏览器回执在被忽略的 `.local/archify-agent/`，不作为应用媒体提交。

更详细的契约在 [01](../01-agent-workflow.md)、[02](../02-page-context-api.md)、[03](../03-realtime-agent-link.md)，它们辅助评审，不取代这张系统图。
