# 详细设计（LLD）

## 元数据

- 任务 ID：{task-id}
- 上游版本：{hld-ddl-api-version}
- 作者：{producer}
- 状态：{DRAFT|IN_REVIEW|APPROVED}

## 设计范围与追踪

| HLD/契约条目 | 实现组件 | 测试点 |
|---|---|---|
| {source} | {component} | {test} |

## 受影响组件

| 类/组件 | 职责 | 新增/修改 | 依赖 |
|---|---|---|---|
| {component} | {responsibility} | {change} | {dependencies} |

## 方法与数据结构

### `{Type.method(Signature)}`

- 前置条件：{preconditions}
- 输入/输出：{input-output}
- 核心步骤：{steps}
- 副作用：{side-effects}
- 异常映射：{exceptions}

## 交互与状态变化

{sequence-state-machine-and-validation-order}

## 事务、幂等与并发

{transaction-boundary-idempotency-locking-retry-and-compensation}

## 外部资源与可排查性

{db-api-mq-cache-timeout-logs-metrics-trace}

## 测试设计

{unit-integration-contract-regression-boundary-and-failure-tests}

## 文件级影响清单

- {file-and-change-purpose}
