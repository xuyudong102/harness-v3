# L4 确定性 Review Decision 记录

## Check 001

- 时间：{timestamp}
- 生成方式：当前 Coding Agent 应用已批准的确定性 Decision 规则（无 AI Gate）
- 代码版本：{version}
- 路由版本：{review-routing-version}
- 最终结论：{PASS|CHANGES_REQUIRED|HUMAN_REQUIRED}

## 报告完整性

| 来源 | 应到 | 最新 Check/Run | Decision/结果 | 状态 |
|---|---|---|---|---|
| {reviewer} | {yes-no} | {NNN-or-missing} | {result} | {received-missing-not-triggered} |

## 未解决问题

| 问题 ID | 来源 | 级别 | 状态 | 裁决 |
|---|---|---|---|---|
| {id} | {report} | {severity} | {status} | {decision} |

## 聚合规则

1. 当前版本 Mechanical Verification 失败：`CHANGES_REQUIRED`。
2. Integrated 或已触发 Specialist 任一为 `CHANGES_REQUIRED`：`CHANGES_REQUIRED`。
3. 否则任一为 `HUMAN_REQUIRED`：`HUMAN_REQUIRED`。
4. 其余情况：`PASS`。

本文件只记录规则应用结果，不进行新的 AI 审查、去重或冲突裁决。

## 需要更新的证据

- 修复目标：{none-or-action}
- 必须重采集的 Run：{none-or-list}
- 必须重跑的 Review：{none-or-list}
- 人工决策问题：{none-or-list}
