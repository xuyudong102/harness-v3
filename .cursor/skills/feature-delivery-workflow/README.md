# feature-delivery-workflow

以 [SKILL.md](SKILL.md) 为权威能力和使用条件。

按需读取 Feature adaptive playbook，并根据当前仓库事实和必要 durable state 恢复任务。 在复杂功能交付需要 playbook 或跨会话恢复时使用；普通小 Feature 不要求调用。 不运行固定 phases、Agent handoff、design gate、transition 或 Workflow state engine。

当前 Coding Agent 自主选择行动；不通过本说明启动 Workflow、旧角色交接或阶段恢复。
L0/L1 使用当前会话、仓库和工具证据；需要持久化时遵守 progressive Artifact policy。
