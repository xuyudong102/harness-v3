---
name: writing-plans
description: >-
  Plan verifiable implementation slices when complexity needs it; optional.
---

# 编写实现计划

## 前置条件

- 从当前会话或 durable state 获取目标与范围。
- 功能实现按需读取 `design.md`/legacy LLD；复杂 Bug 读取 `task.md`/legacy 根因分析。
- 按需读取 HLD、DDL、API、影响分析和决策记录。

## 操作步骤

1. 提取必须交付的行为、文件类型、外部契约和验收条件。
2. 搜索实际模块和测试位置，禁止编造路径。
3. 按可独立验证的最小单元拆分任务。
4. 为每个任务声明文件范围、依赖、是否可并行、完成标准和验证命令。
5. 将数据库、API、配置和兼容性变更放在正确依赖顺序。
6. 检查所有上游要求均被某个任务覆盖，且无范围外工作。
7. L0/L1 在当前会话维护计划；L2 合并进 `task.md`；L3/L4 仅在计划具有独立生命周期时保留 legacy plan。

## 计划模板

```markdown
# 实现计划
## 输入制品与范围
## 任务依赖图
## 任务清单
### 任务 N
- 目标：
- 文件范围：
- 依赖：
- 可并行：
- 完成标准：
- 验证方式：
## 风险与人工检查点
```

## 失败与降级

- 找不到真实模块或路径时记录待确认项，不生成猜测路径。
- 上游设计不足以决定实现时停止并由当前 Coding Agent 重新评估设计。

## 关联 Rule

遵守 `task-decomposition`、`scope-guard`、`stage-contracts` 和 `human-checkpoint`。
