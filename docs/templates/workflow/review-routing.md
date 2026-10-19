# 质量审查路由

- 任务 ID：{task-id}
- 路由时间：{timestamp}
- 变更清单：`delivery/change-manifest.md`
- 路由版本：{change-version-or-commit}

| Reviewer | 模式 | 路由状态 | 触发或不触发证据 | 输出文件 |
|---|---|---|---|---|
| integrated-reviewer | 默认 | DEFAULT | 所有实现变更 | quality/gates/implementation/integrated-review.md |
| security-reviewer | 条件 Specialist | {TRIGGERED|NOT_TRIGGERED|HUMAN_REQUIRED} | {auth-tenant-input-secret-injection-evidence} | quality/gates/implementation/security.md |
| data-concurrency-reviewer | 条件 Specialist | {TRIGGERED|NOT_TRIGGERED|HUMAN_REQUIRED} | {transaction-idempotency-schema-mq-money-evidence} | quality/gates/implementation/data-concurrency.md |

## 路由结论

- Specialist 并行组：`specialist-review`
- 条件成员：`security-review`、`data-concurrency-review`
- 应到报告：`integrated-review.md` + {triggered-specialist-reports}
- 最终状态：由 `review-decision` 按固定优先级聚合，不调用 AI gate
