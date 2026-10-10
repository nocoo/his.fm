# 文档目录

## 待评审设计

- **[先看整套 Agent 架构图（Archify）](agent-architecture/index.html)** — 浏览器／Cloudflare／本机三边界、12 个组件、5 个聚焦视图；[图源与校验证据](agent-architecture/README.md)。

- [01 · 核心 Agent 工作流](01-agent-workflow.md) — Pi Durable、本机 Jev、长期／短期 conversation、网站集成与恢复契约；尚未实施。
- [02 · 页面上下文与主控 API 重构](02-page-context-api.md) — 默认后台理解页面／草稿／正式内容，无启用暂停或感知提示；命令快照、选区定位、双向修改与完整接口契约。
- [03 · 常驻双向实时连接](03-realtime-agent-link.md) — 参考 Eagle 的传输生命周期；仅结构化上下文，不含屏幕采集。
- [工作室协同原型与交互架构图](01-agent-workflow/index.html) — 左侧可编辑并 Save，右侧与主控聊天；可演练实时更新／冲突并导出 Markdown 评审意见。

## 当前产品与工程

- [Native agent implementation and local operation](agent-implementation.md) — executable status, local acceptance and explicit limits.
- [Frogie integration](frogie-integration.md) — definition ownership, compiled package delivery, native Host adapter and execution-state boundaries.
- [Local agent development and debugging](local-agent-debug.md) — shared startup, read-only SQLite diagnostics and loopback inspection.

- [系统架构](architecture.md)
- [播客生产流程](production.md)
- [Agent API](agent-api.md)
- [本机 Agent 接入](native-agent.md) — 本机运行、显式站点绑定、实时协议和权限边界。
- [栏目管理](categories.md) — 栏目名称、图标、颜色、私有 Markdown 提示词与逐字稿注入顺序。
- [音频生产](audio.md)
- [Markdown 编辑](markdown-editing.md)
- [外观与素材](appearance.md)
- [设计研究](design/README.md)
- [本地与生产运维](operations.md)
- [CI/CD](ci-cd.md)
