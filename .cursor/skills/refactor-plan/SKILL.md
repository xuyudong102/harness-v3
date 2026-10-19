---
name: refactor-plan
description: >-
  Plan complex behavior-preserving refactoring when needed; optional.
---

# 重构规划

## 前置条件

- 明确目标范围、重构目标和不可改变的外部行为。
- 收集当前测试、接口签名、性能或行为基线。

## 操作步骤

1. 扫描长方法、重复、上帝类、特性依恋、过度耦合、错误抽象和不可测试结构。
2. 为每项问题记录代码证据、影响和不处理风险。
3. 选择最小重构手法，避免同时改变结构和行为。
4. 将计划拆成每步一种重构操作，每步声明涉及文件、前置依赖和回归检查。
5. 标记新文件场景，要求实现者调用 `codegen-guard`。
6. 标记数据库、API、序列化和公共签名风险，必要时触发人工检查点。
7. L0/L1 在当前会话维护计划；L2 合并进 `task.md`；L3/L4 只有 substantial design 才写 `design.md`，legacy 分析/计划文件不再默认生成。

## 计划模板

```markdown
# 重构计划
## 目标与行为基线
## 问题清单
## 步骤
### 步骤 N：单一重构操作
- 文件范围：
- 前置依赖：
- 行为保持证据：
- 验证命令：
- 失败停止条件：
## 风险与人工检查点
```

## 失败与降级

- 无测试或行为基线时先安排保护性测试，不直接安排结构重写。
- 发现需求变化时移出重构 Workflow，重新确认范围。

## 关联 Rule

遵守 `change-implementation`、`scope-guard`、`method-design`、`testing` 和 `human-checkpoint`。
