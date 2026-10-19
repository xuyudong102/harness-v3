# codegen-guard

以 [SKILL.md](SKILL.md) 为权威能力和使用条件。

在新建源文件前检查分层架构、包路径、命名、复用与必需元素，防止不合规代码入库。 在创建新 .java/.kt/.xml/.yaml 等源文件或新增类/接口前、当前 Coding Agent 生成新文件前使用。 不用于仅修改已有方法/字段的小改动、纯文档/规则变更、删除或重命名文件。

当前 Coding Agent 自主选择行动；不通过本说明启动 Workflow、旧角色交接或阶段恢复。
L0/L1 使用当前会话、仓库和工具证据；需要持久化时遵守 progressive Artifact policy。
