---
name: feature-delivery-workflow
description: >-
  Optional guidance for complex features or durable resume; no phases.
---

# 功能交付 Playbook 辅助

## 前置条件

- 用户授权和当前需求范围已明确；未明确业务/权限决定时请求确认。
- 只读取主 feature-delivery.yaml 的意图、建议、完成条件、风险升级与 Artifact policy。
- 主 playbook 位于 `.cursor/workflows/feature-delivery.yaml`。

## 操作流程

1. 当前 Coding Agent 根据事实选择下一项有用行动；主 playbook 是 guidance，不是待执行阶段表。
2. 小 Feature 可直接 inspect/edit/test；只有真实契约、Schema、模块或安全/迁移风险才按需设计。
3. 使用 conversation、repo、Git 和工具结果；L0/L1 不要求 Artifact 或初始化。
4. 跨会话恢复时按需读 task.md、design.md、verification.md 的相关部分，重新核对仓库和证据版本；不恢复 phase index。
5. 代码修改需满足 evidence contract：适用机械证据、至少一个 current-diff fresh 综合 Review 结果、风险专项审查、确定性 Decision，以及 `done-verify` 对完整性与 freshness 的判定；不规定固定执行顺序或 Review 次数。

## 失败处理

- 关键事实冲突、范围或权限不清时暂停；不猜测旧进度或写入替代状态文件。

## 输出契约

- 当前任务的行动、证据、未决风险；L2+ 才按生命周期合并必要 durable state。

## 边界

不启动固定阶段链或维护 workflow-state、
decision-log、固定 Agent 列表或 mandatory plan。发布飞书设计只在明确请求时按需进行。
