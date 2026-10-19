# Progressive durable templates

L0/L1 不复制模板、不创建任务目录。核心模板只有 task / design / verification / migration。
下表完整列出保留的独立消费者或 L4/external purpose；名称不表示默认阶段或强制文件。
机械工具结果是 ground truth，普通任务的 Decision/Findings/Evidence 可留在会话。

| Template | Active consumer or documented L4 / external purpose |
|---|---|
| `task.md` | L2+ durable task contract、单仓或多仓 resume anchors、blocker 与 evidence gap |
| `design.md` | L3/L4 substantial design |
| `verification.md` | L3/L4 mechanical evidence |
| `migration.md` | Migration approvals / rollback / Final Verification |
| `context/issue-context.md` | skills/systematic-debug/SKILL.md |
| `context/log-evidence.md` | skills/systematic-debug/SKILL.md |
| `analysis/log-investigation.md` | skills/systematic-debug/SKILL.md |
| `design/hld.md` | skills/hld-to-feishu/SKILL.md |
| `design/lld.md` | skills/codegen-guard/SKILL.md, skills/lld-to-feishu/SKILL.md |
| `design/ddl.md` | skills/codegen-guard/SKILL.md, rules/schema-guard.mdc, rules/database.mdc |
| `design/api-contract.md` | skills/codegen-guard/SKILL.md, rules/error-codes.mdc |
| `design/brainstorm-result.md` | skills/brainstorming/SKILL.md |
| `plans/implementation-plan.md` | skills/git-worktree/SKILL.md, rules/method-design.mdc |
| `delivery/change-manifest.md` | rules/database.mdc |
| `delivery/publication-links.md` | skills/hld-to-feishu/SKILL.md, skills/lld-to-feishu/SKILL.md |
| `workflow/harness-debug.md` | skills/harness-debug-logger/SKILL.md |
| `workflow/review-routing.md` | skills/quality-review-routing/SKILL.md |
| `workflow/memory-change.md` | rules/correction-detection.mdc |
| `workflow/decision-log.md` | skills/harness-debug-logger/SKILL.md, rules/schema-guard.mdc |
| `quality/gates/implementation/security.md` | Security specialist L4 audit contract |
| `quality/gates/implementation/data-concurrency.md` | Data/concurrency specialist L4 audit contract |
| `quality/gates/implementation/integrated-review.md` | Integrated reviewer L4 audit contract |
| `quality/gates/implementation/quality-gate.md` | done-verify existing L4 deterministic Decision input; not AI arbitration |
| `tooling/maven-test-coverage-integration.md` | External Maven/JaCoCo setup runbook |
| `tooling/maven-jacoco-surefire.xml` | External Maven/JaCoCo configuration sample |
| `design/sql/001-forward-ddl.sql` | L4 forward migration SQL |
| `design/sql/002-rollback-ddl.sql` | L4 independently executable rollback SQL |
| `delivery/sql/001-data-fix.sql` | L4 data-fix script with precheck and rollback purpose |

只有相关独立生命周期才使用 context / analysis / plans / delivery / quality / workflow 子目录。
quality-gate.md 因 done-verify 的已有 L4 审计契约保留，只记录确定性 Decision，不新增 AI Review。
批准、回滚与迁移证据由 migration.md 承载，需要独立可执行时再引用 SQL。
保留 Check / Run 追加历史的约定，禁止覆盖历史证据；不镜像本目录生成空白任务。
