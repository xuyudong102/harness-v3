# Agent 模板

```markdown
---
name: <agent-name>
description: >-
  <负责什么、何时调度、明确不负责什么>
---

# <角色名称>

## 角色与使命

## 权限与模式

## 输入

## 输出制品

## 完成标准

## Skill 调用条件

## 禁止事项
```

## 编写约束

- 使用 lowercase-hyphen 名称，文件名必须与 `name` 一致。
- Agent 只定义 WHO + WHAT + CONTRACT + ROLE POLICY。
- 输入输出描述语义和内容要求，不复制完整 Workflow 阶段链。
- 完整方法论、命令和工具操作移入 Skill。
- 岗位工作原则、上下游交接、停止与升级条件仅在确有需要时增加。
- Agent 与 Skill 不要求一一对应。
- 质量 Agent 默认省略 `model`，由用户后续按 Cursor 能力手工配置。
- 重命名时直接重构全部当前引用，不保留 alias 或旧名兼容层。

## 引用检查

- 搜索 Workflow `agents/<name>`。
- 搜索 Agent、Skill、Rule、AGENTS、README 和 docs 中的旧名与新名。
- 检查输入制品存在生产者、输出制品存在消费者。
- 更新资源数量校验和 Agent 清单。
