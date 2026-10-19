# done-verify

以 [SKILL.md](SKILL.md) 为权威能力和使用条件。

评估编译、测试、覆盖率、Lint、静态分析、依赖和范围证据的完整性、适用性与 freshness，并按 Artifact level 报告或持久化。只有缺失、失败或 stale 的适用证据才需要补齐或重跑。不得用于语义质量裁决、修改代码以掩盖失败或覆盖历史 Run。

当前 Coding Agent 自主选择行动；不通过本说明启动 Workflow、旧角色交接或阶段恢复。
L0/L1 使用当前会话、仓库和工具证据；需要持久化时遵守 progressive Artifact policy。
