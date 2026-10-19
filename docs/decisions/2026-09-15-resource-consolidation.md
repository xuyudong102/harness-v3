# Historical / removed adapter

This file is a historical decision record. The third host adapter it mentions was removed and is not a supported Coding Agent host. Current hosts are Cursor and Codex only.

# Phase 5 Resource Consolidation

Baseline: 3f99a00d8e2360013c2098b34ca5f2e2c153de18; clean branch feature-1.2.1-xyd.
User approved physical cleanup and the external managed Codex adapter on 2026-09-15.
This document records migration decisions, not an active Agent/Workflow catalog.

## Baseline inventory / reverse-reference audit

Each platform: 22 Agents, 15 Skills, 72 Rules, 3 adaptive playbooks + 8 inactive phases.
57 template files (excluding README); 13 generated Codex wrappers.
Detailed file-and-caller audit: .agent-work/phase5-reverse-reference-audit.json (local audit, not executable discovery).
Agent candidates were read and reverse-searched across playbooks/Skills/Rules/tests/docs;
role-only references are replaced with current Coding Agent, not another orchestrator.
All 16 phase files had legacy:true/default_execution:false, no main/Skill/resume/adapter execution consumer.
The old phase-presence test is replaced with physical absence/source-link validation, not phase execution.

## Agent mapping

| Agent | Before | After / reason |
|---|---|---|
| requirements-analyst | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| problem-analyst | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| solution-architect | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| database-designer | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| api-designer | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| detail-designer | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| implementation-planner | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| refactoring-planner | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| implementer | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| static-analysis-reviewer | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| logic-correctness-reviewer | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| maintainability-reviewer | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| test-adequacy-reviewer | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| consistency-reviewer | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| quality-gate-reviewer | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| diagnosability-reviewer | LEGACY / UNUSED | REMOVED; cognition role or redundant simulated review; no independent active capability |
| integrated-reviewer | ACTIVE | KEPT ACTIVE; independent read-only comprehensive Review |
| security-reviewer | OPTIONAL | KEPT OPTIONAL; actual-risk independent review |
| data-concurrency-reviewer | OPTIONAL | KEPT OPTIONAL; actual-risk independent review |
| issue-context-fetcher | OPTIONAL | KEPT OPTIONAL; ONES ground truth / limited permissions |
| log-investigator | OPTIONAL | KEPT OPTIONAL; Loki ground truth / limited permissions |
| memory-consolidator | OPTIONAL governance | KEPT WITH REASON; approved candidate → minimal Rule change → APPLIED |

## Skill mapping

All 15 canonical Skills are kept, not removed for a numerical KPI.
- safe-refactoring: OPTIONAL method/tool capability; linked into TRAE; Codex wrapper uses canonical name.
- done-verify: ACTIVE completion verification; linked into TRAE; Codex wrapper uses canonical name.
- systematic-debug: OPTIONAL method/tool capability; linked into TRAE; Codex wrapper uses canonical name.
- quality-review-routing: OPTIONAL method/tool capability; linked into TRAE; Codex wrapper uses canonical name.
- writing-plans: OPTIONAL method/tool capability; linked into TRAE; Codex wrapper uses canonical name.
- harness-resource-authoring: OPTIONAL resource authoring; linked into TRAE; Codex wrapper uses canonical name.
- git-worktree: OPTIONAL method/tool capability; linked into TRAE; Codex wrapper uses canonical name.
- feature-delivery-workflow: OPTIONAL method/tool capability; linked into TRAE; Codex wrapper uses canonical name.
- hld-to-feishu: OPTIONAL method/tool capability; linked into TRAE; Codex wrapper uses canonical name.
- brainstorming: OPTIONAL method/tool capability; linked into TRAE; Codex wrapper uses canonical name.
- refactor-plan: OPTIONAL method/tool capability; linked into TRAE; Codex wrapper uses canonical name.
- codegen-guard: OPTIONAL method/tool capability; linked into TRAE; Codex wrapper uses canonical name.
- lld-to-feishu: OPTIONAL method/tool capability; linked into TRAE; Codex wrapper uses canonical name.
- tdd-bugfix: OPTIONAL method/tool capability; linked into TRAE; Codex wrapper uses canonical name.
- harness-debug-logger: OPTIONAL method/tool capability; linked into TRAE; Codex wrapper uses canonical name.

Planning/brainstorming/refactor methods remain optional because current playbooks actually list them.
Publishing Skills retain real external-write contracts. Debug/worktree methods lose old phase/role dispatch
and default trace state, not evidence, isolation or authorization.
README / metadata converge with the source, especially optional complex systematic debugging.

## Workflow mapping

Three main adaptive playbooks retained unchanged in behavior; TRAE links the same source.
All eight phases removed from both physical platform trees; no phase index/resume fallback remains.
No author Agent chain / AI design Gate introduced.

## Rule inventory and disposition

No enterprise/safety/project Rule is deleted. Activation and engineering constraints are retained.
- api-design.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- change-implementation.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- code-style-format.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- collections.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- comments.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- compile-guard.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- concurrency.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- constants.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- control-flow.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- correction-detection.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- cross-ref-guard.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- database.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- datetime.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- dependencies.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- design-doc.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- enums.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- environment-boundary.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- er-diagram.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- error-codes.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- exceptions.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- execution-boundary.mdc: ACTIVE GLOBAL → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- git-branch.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- git-commit.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- human-checkpoint.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- java-edit-self-check.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- lint-guard.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- logging.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- mcp.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- message-queue.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- method-design.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- microservice.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- mybatis.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- naming.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- null-safety.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- numeric.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- obs.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- oop.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- pojo.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- project-architecture.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/b2cmall/b2cmall-architecture.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/b2cmall/b2cmall-context.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/b2cmall/b2cmall-error-code.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/b2cmall/b2cmall-feign-rpc.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/b2cmall/b2cmall-job.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/b2cmall/b2cmall-microservice.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/b2cmall/b2cmall-mq.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/b2cmall/b2cmall-naming.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/b2cmall/b2cmall-package-structure.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/b2cmall/b2cmall-pagination.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/b2cmall/b2cmall-persistence.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/broker/broker-architecture.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/broker/broker-context.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/broker/broker-error-code.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/broker/broker-feign-rpc.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/broker/broker-job.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/broker/broker-microservice.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/broker/broker-mq.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/broker/broker-naming.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/broker/broker-package-structure.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/broker/broker-pagination.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- projects/broker/broker-persistence.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- redis.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- rules-loader.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- schema-guard.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- scope-guard.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- security.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- session-title.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- stage-contracts.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- task-decomposition.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- tenant-isolation.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- test-guard.mdc: ACTIVE ON-DEMAND → KEEP canonical; TRAE link/adaptation (session-title is host-specific).
- testing.mdc: ACTIVE ON-DEMAND / precise Auto Attached → KEEP canonical; TRAE link/adaptation (session-title is host-specific).

MCP Rule changes consumer labels only, removing deleted role names; server keys/capabilities/permissions/config do not change.
Existing L4 schema/database/formal-blocker output constraints keep their templates rather than silently weakening policy.

## Template mapping

- design.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- task.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- delivery/sql/001-data-fix.sql: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- delivery/publication-links.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- delivery/change-manifest.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- delivery/migration-record.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- delivery/rollout-record.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- workflow/harness-debug.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- workflow/intent-routing.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- workflow/workflow-state.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- workflow/memory-change.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- workflow/review-routing.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- workflow/decision-log.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- verification.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- migration.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- plans/test-plan.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- plans/implementation-plan.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- plans/refactoring-plan.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- plans/rollout-plan.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/verification-report.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/evidence/implementation/test-report.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/evidence/implementation/dependency-scan-report.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/evidence/implementation/coverage-report.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/evidence/implementation/compile-report.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/evidence/implementation/static-analysis-report.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/evidence/implementation/lint-report.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/gates/implementation/consistency.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/gates/implementation/security.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- quality/gates/implementation/integrated-review.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- quality/gates/implementation/diagnosability.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/gates/implementation/maintainability.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/gates/implementation/static-analysis.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/gates/implementation/logic-correctness.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/gates/implementation/data-concurrency.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- quality/gates/implementation/quality-gate.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- quality/gates/implementation/test-adequacy.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/gates/lld-design/consistency.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/gates/lld-design/quality-gate.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/gates/hld-design/consistency.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- quality/gates/hld-design/quality-gate.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- analysis/feature-list.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- analysis/log-investigation.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- analysis/root-cause.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- analysis/impact-analysis.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- context/log-evidence.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- context/issue-context.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- context/prd-source.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- context/repository-context.md: REMOVED; legacy-only/no surviving durable consumer, mechanical evidence merges into verification.md
- tooling/maven-test-coverage-integration.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- tooling/maven-jacoco-surefire.xml: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- design/sql/002-rollback-ddl.sql: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- design/sql/001-forward-ddl.sql: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- design/hld.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- design/brainstorm-result.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- design/ddl.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- design/api-contract.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md
- design/lld.md: KEPT; consumer or L4/external purpose documented in docs/templates/README.md

## Adapter ownership / rollback

External source: /Users/xuyudong/Workspace/ai/scripts/sync-codex.sh; now a thin caller of versioned canonical sync-codex.mjs.
Backup: /Users/xuyudong/Workspace/ai/.agent-work/backups/phase5-20260915-hw1Fk7; backup-manifest.md records SHA-256 and original paths outside active discovery.
Temp-run precedes actual catalog update. Wrapper ownership is checked before writes; extra/user files or conflicting
Skill paths abort. Only exact managed SKILL.md and symlink targets are deleted; no recursive broad deletion.
MCP examples, personal Skill links and unrelated Codex files remain unchanged.

## Historical facts

docs/design contains existing project-specific source examples, not orchestration resources; no project facts are deleted.
They do not participate in active resource indexes. Git history preserves removed templates/roles/phases.
