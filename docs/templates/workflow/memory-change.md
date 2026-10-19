# Rule 固化候选

## 候选信息

- 候选 ID：{memory-candidate-id}
- 状态：{PENDING|APPROVED|REJECTED|APPLIED}
- 创建时间：{timestamp}
- 目标 Rule：`.cursor/rules/{rule-path}.mdc`
- 目标章节：{强制规则|禁止事项|验证清单|specific-section}
- 作用域：{common|project:<project-name>}

## 纠正证据

| 次数 | 时间/任务 | 原错误 | 用户纠正 | 证据链接 |
|---|---|---|---|---|
| 1 | {context} | {error} | {correction} | {evidence} |
| 2 | {context} | {error} | {correction} | {evidence} |

## 拟固化规则

{single-actionable-rule}

## 影响检查

- 现有规则是否已覆盖：{NO|YES-with-location}
- 是否存在冲突：{NO|YES-with-details}
- 是否扩大适用范围：{NO|YES-with-details}
- description 影响：{none-or-change}
- globs 影响：{none-or-change}
- 加载关系影响：{none-or-change}

## 拟议差异

```diff
{proposed-diff}
```

## 人工决定

- 决定：{PENDING|APPROVED|REJECTED}
- 决定人：{user}
- 决定时间：{timestamp}
- 说明：{reason}

## 应用结果

- 实际差异：{diff-or-not-applied}
- 资源校验：{PASS|FAIL|NOT_RUN}
- 交叉引用检查：{PASS|FAIL|NOT_RUN}
- 最终状态：{PENDING|APPROVED|REJECTED|APPLIED}
