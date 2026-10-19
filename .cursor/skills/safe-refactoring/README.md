# safe-refactoring

以 [SKILL.md](SKILL.md) 为权威能力和使用条件。

按当前会话或 durable state 中的计划逐步执行行为保持的安全重构，每步立即验证并在失败时停止。 当前 Coding Agent 在复杂行为保持重构中按需选择；普通重构不强制调用。 不用于功能开发、未建立行为基线或一次执行多种不可分离重构。

当前 Coding Agent 自主选择行动；不通过本说明启动 Workflow、旧角色交接或阶段恢复。
L0/L1 使用当前会话、仓库和工具证据；需要持久化时遵守 progressive Artifact policy。
