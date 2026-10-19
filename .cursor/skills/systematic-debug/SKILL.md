---
name: systematic-debug
description: >-
  Compare evidence-based hypotheses for difficult or uncertain bugs; optional.
---

# 系统化根因分析

## 前置条件

- 获取当前会话中的问题描述；存在时按需读取 `task.md` 或 legacy `context/issue-context.md`。
- 按需读取 `context/log-evidence.md`、`analysis/log-investigation.md`、复现输出和最近变更。
- 输入不足时先记录缺口，不猜测 traceId、环境、时间和业务条件。

## 调查方法

- 明确可观察现象、影响、复现条件和当前证据缺口。
- 从堆栈、日志、失败断言、调用链和数据流缩小代码范围；证据不足以区分根因时，再建立可区分的竞争假设。
- 按 information gain、cost、risk、reversibility 和成功概率选择验证动作；不要求固定数量的假设或统一调查顺序。
- 用 Git 历史、运行时事实和同模式搜索校验触发条件与影响范围，区分事实、推断和未验证部分。
- L0/L1 在当前会话输出根因；L2 合并进 `task.md`；L3/L4 仅在需要独立生命周期时写入 `design.md` 或 legacy 分析文件。

## 根因报告模板

```markdown
# 根因分析

## 问题与影响
## 复现结果
## 调用链与数据流
## 假设验证记录
| 假设 | 验证方法 | 证据 | 结论 |
|---|---|---|---|
## 已确认根因
## 触发条件
## 影响范围
## 修复方向与回归建议
## 未解决风险
```

## 失败与降级

- 无法复现时记录环境差异，继续使用静态和历史证据，但降低结论置信度。
- 同类验证反复失败或边际信息增益明显下降时执行 `REPLAN`，不要无界更换启动方式或参数。
- 阻塞主要来自环境、权限或外部系统，且人工操作明显更便宜可靠时执行 `ASK_HUMAN`，说明操作、理由、已有证据、完成信号和恢复事项。
- 证据仍无法区分假设时列出最小补充证据；只有涉及新授权、实质风险或人工协作时才进入相应人工处理。
- 外部系统不可用时保留查询条件，不伪造结果。

## 关联 Rule

遵守 `execution-boundary`、`environment-boundary`、`human-checkpoint` 和当前场景由 `rules-loader` 激活的规则。
