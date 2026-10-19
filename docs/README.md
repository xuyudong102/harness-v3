# 文档索引

`docs/` 保存现行架构、使用指南、迁移说明、渐进式制品协议、资源维护指南、模板和按需任务状态。
项目简介、快速开始和能力概览请优先阅读根目录
[`README.md`](../README.md)。

## 现行文档

| 文档 | 说明 |
|---|---|
| [`usage-guide.md`](usage-guide.md) | Cursor/Codex 安装、自然语言任务、MCP、验证与排障 |
| [`architecture.md`](architecture.md) | 控制面反转、运行模型、上下文、质量、制品与分发架构 |
| [架构图索引](../image/architecture/README.md) | 正式 `.drawio` / SVG、实现依据、旧图盘点与维护方法 |
| [`v2-to-v3.md`](v2-to-v3.md) | 面向旧用户的架构变化、使用调整与兼容说明 |
| [`artifact-protocol.md`](artifact-protocol.md) | L0-L4 制品选择、持久化与归档规则 |
| [`resource-placement-guide.md`](resource-placement-guide.md) | 判断内容应放 Rule、Skill、Agent、Playbook、Template 或 docs |
| [`templates/README.md`](templates/README.md) | 核心模板与有消费者的独立持久契约 |
| [`decisions/2026-09-15-resource-consolidation.md`](decisions/2026-09-15-resource-consolidation.md) | v3 逐资源整合与删除证据 |
| [`reviews/2026-09-24-harness-v3-architecture-review.md`](reviews/2026-09-24-harness-v3-architecture-review.md) | 2026-09-24 架构审查记录；时点结论，不是实施计划 |

## 推荐阅读路径

- 第一次使用：根 README → `usage-guide.md`
- 理解架构：`architecture.md`
- 从 v2 迁移：`v2-to-v3.md`
- 维护 Harness 资源：`resource-placement-guide.md`
- 复杂/跨会话任务：`artifact-protocol.md` → `templates/README.md`

## 制品

- 活动任务：仅 L2+ 需要持久状态时使用 `artifacts/work/{task-id}/`
- 历史归档：L3/L4 或明确要求的 L2 实际文件进入 `artifacts/archive/{date}-{task-id}/`
- 重构前快照：`artifacts/archive/2026-07-13-pre-agent-skill-refactor/`

历史归档只读，不参与现行名称和目录结构校验。
