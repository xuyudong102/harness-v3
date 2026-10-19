---
name: safe-refactoring
description: >-
  Refactor incrementally with behavior checks when needed; optional.
---

# 安全重构

## 前置条件

- 从当前会话或存在的 `task.md`、legacy plan 读取行为基线和相关测试。
- 确认当前步骤范围及验证命令。

## 操作步骤

1. 选择一个可独立验证的安全切片；不要求正式 Planner 或固定阶段。
2. 新建源文件前调用 `codegen-guard`。
3. 保持公共接口、业务行为、数据语义和异常契约不变。
4. 完成一步立即运行该步验证和相关回归。
5. 验证失败时停止，不叠加下一步；定位是实现错误还是计划错误。
6. 以 Git diff 和测试作为事实；L2+ 将必要进度/证据合并进 `task.md` 或 `verification.md`，普通任务不维护 change manifest。

## 失败与降级

- 发现非授权功能变化时停止，由当前 Coding Agent 重新评估；需业务决定或扩大范围时询问用户。
- 行为基线不充分时先补保护性测试。

## 关联 Rule

遵守 `change-implementation`、`scope-guard`、`test-guard`、`codegen-guard` 和 `human-checkpoint`。
