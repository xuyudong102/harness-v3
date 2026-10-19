---
status: ACTIVE # ACTIVE|WAITING_FOR_HUMAN|WAITING_FOR_EXTERNAL|DONE
resume_anchors:
  - repo: "{repository-path-or-url}"
    branch: "{branch}"
    head: "{commit-or-unborn}"
    diff: "{clean-or-diff-fingerprint}"
---

# Task

## Goal

{goal}

## Scope

{in-scope-and-out-of-scope}

## Authorization and Acceptance

- Authorization: {read-only-or-allowed-writes-and-environments}
- Hard acceptance: {evidence-required-before-done}
- Preferred evidence: {useful-but-negotiable-evidence}

## Key Decisions

{only-decisions-that-must-survive-this-session}

## Important Evidence

| Type | Source | Result | Applicability | Freshness |
|---|---|---|---|---|
| {evidence-type} | {command-link-or-runtime-source} | {PASS \| FAIL \| NOT_AVAILABLE \| STALE} | {covered-scope} | {head-or-diff-fingerprint-and-assumptions} |

## Changes

{semantic-change-summary-and-git-reference}

## Verification

{commands-results-and-verification-link}

## Open Risks

{none-or-unresolved-risks-and-owner}

## Blockers

| Fact | Owner | Resume condition |
|---|---|---|
| {verified-blocker} | {agent \| human \| external-system} | {observable-completion-signal} |

## Evidence Gaps

| Requirement | Status |
|---|---|
| {task-contract-requirement} | {missing \| stale \| waiting-for-human \| waiting-for-external} |

## Next Options

- {candidate-action-and-expected-value}

Next Options 是恢复时重新评估的候选动作，不是 `next` transition，也不授权扩大范围。
