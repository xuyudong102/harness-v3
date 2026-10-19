---
name: tdd-bugfix
description: >-
  Reproduce an authorized bug fix with a failing test and verify regression.
---

# TDD Bug 修复

## 前置条件

- 从当前会话或存在的 `task.md`、legacy 根因/计划文件读取已确认根因。
- 明确修复前失败行为、修复后期望和回归范围。

## 操作步骤

1. 编写或选择能稳定复现根因的最小失败测试。
2. 运行测试，确认失败原因与根因一致；不一致则由当前 Coding Agent 重新调查。
3. 实施只针对根因的最小修复。
4. 运行目标测试、相关模块测试和必要回归。
5. 检查相同错误模式是否存在于本次影响范围内。
6. 以 Git diff 作为变更事实；L0/L1 在会话报告测试和风险，L2+ 写入 `task.md`/`verification.md`。仅当部署或外部协调语义无法由 Git 表达时维护 change manifest。

## 失败与降级

- 无法稳定复现时不得以偶然绿灯完成修复。
- 修复需要改变需求、API 或数据语义时触发人工检查点。

## 关联 Rule

遵守 `test-guard`、`compile-guard`、`scope-guard`、`change-implementation` 和 `human-checkpoint`。
