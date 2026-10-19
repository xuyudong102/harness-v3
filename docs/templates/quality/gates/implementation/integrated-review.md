# 综合实现审查

## Check 001

- 时间：{timestamp}
- Reviewer：integrated-reviewer
- 代码版本：{version}
- 已消费机械证据：{evidence-list}
- Decision：{PASS|CHANGES_REQUIRED|HUMAN_REQUIRED}

## 审查范围

- 需求/根因：{relevant-source}
- Diff 与调用链：{changed-paths-and-context}
- 测试：{tests-and-assertions}
- 未验证范围：{none-or-list}

## Findings

| ID | 级别 | 位置 | 触发条件与证据 | 影响 | 最小修复要求 | 状态 |
|---|---|---|---|---|---|---|
| {id} | {BLOCKER|WARNING|ADVISORY} | {path:line} | {evidence} | {impact} | {requirement} | {OPEN|RESOLVED|STILL_OPEN|REGRESSED} |

## Specialist Escalation

| Specialist | {TRIGGERED|NOT_TRIGGERED|HUMAN_REQUIRED} | 证据 |
|---|---|---|
| security-reviewer | {status} | {diff-path-dependency-or-contract-evidence} |
| data-concurrency-reviewer | {status} | {diff-path-dependency-or-contract-evidence} |

## 剩余风险

{warnings-advisories-and-evidence-gaps}
