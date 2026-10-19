# 概要设计（HLD）

## 元数据

- 任务 ID：{task-id}
- 输入版本：{feature-list-and-brainstorm-version}
- 作者：{producer}
- 更新时间：{timestamp}
- 状态：{DRAFT|IN_REVIEW|APPROVED}

## 背景、目标与非目标

{context-goals-and-non-goals}

## 需求追踪

| 功能 ID | 设计章节 | 模块 | 验收方式 |
|---|---|---|---|
| {F-NNN} | {section} | {module} | {verification} |

## 系统边界与模块职责

{context-diagram-and-responsibilities}

## 关键流程

{normal-failure-degradation-and-recovery-sequences}

## 数据与外部契约

{data-ownership-api-mq-cache-and-external-dependencies}

## 关键设计决策

| 决策 | 约束 | 备选 | 取舍 | 可逆性 |
|---|---|---|---|---|
| {decision} | {constraints} | {alternatives} | {tradeoff} | {reversibility} |

## 非功能设计

- 权限与租户：{security}
- 一致性/幂等/并发：{consistency}
- 性能与容量：{performance}
- 可观测性：{observability}
- 兼容、迁移与回滚：{compatibility}

## 风险与待验证假设

- {risk-assumption-validation-owner}
