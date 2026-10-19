#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CURSOR="$ROOT/.cursor"
errors=0

fail() { echo "- $*" >&2; errors=$((errors + 1)); }
contains() { grep -Fq -- "$2" "$1" || fail "$3 missing=$2"; }

agent_count=$(find "$CURSOR/agents" -maxdepth 1 -type f ! -name '.*' -name '*.md' | wc -l | tr -d ' ')
skill_count=$(find "$CURSOR/skills" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -exec test -f '{}/SKILL.md' ';' -print | wc -l | tr -d ' ')
workflow_count=$(find "$CURSOR/workflows" -name '.*' -prune -o -type f -name '*.yaml' -print | wc -l | tr -d ' ')
rule_count=$(find "$CURSOR/rules" -name '.*' -prune -o -type f -name '*.mdc' -print | wc -l | tr -d ' ')
[[ "$agent_count" == 6 ]] || fail "AGENT_COUNT expected=6 actual=$agent_count"
[[ "$skill_count" == 21 ]] || fail "SKILL_COUNT expected=21 actual=$skill_count"
[[ "$workflow_count" == 3 ]] || fail "WORKFLOW_COUNT expected=3 actual=$workflow_count"
[[ "$rule_count" == 79 ]] || fail "RULE_COUNT expected=79 actual=$rule_count"

while IFS= read -r file; do
    name="$(basename "$file" .md)"
    grep -Eq "^name:[[:space:]]*$name[[:space:]]*$" "$file" || fail "AGENT_NAME file=$file"
    grep -Eq '^description:[[:space:]]*.+' "$file" || fail "AGENT_DESCRIPTION file=$file"
done < <(find "$CURSOR/agents" -maxdepth 1 -type f ! -name '.*' -name '*.md' | sort)

while IFS= read -r file; do
    name="$(basename "$(dirname "$file")")"
    grep -Eq "^name:[[:space:]]*$name[[:space:]]*$" "$file" || fail "SKILL_NAME file=$file"
    grep -Eq '^description:[[:space:]]*(>|.+)' "$file" || fail "SKILL_DESCRIPTION file=$file"
done < <(find "$CURSOR/skills" -mindepth 1 -maxdepth 1 -type d ! -name '.*' -exec test -f '{}/SKILL.md' ';' -print | sed 's|$|/SKILL.md|' | sort)

while IFS= read -r file; do
    line1="$(sed -n '1p' "$file")"
    line2="$(sed -n '2p' "$file")"
    line3="$(sed -n '3p' "$file")"
    line4="$(sed -n '4p' "$file")"
    line5="$(sed -n '5p' "$file")"
    if [[ "$line1" != '---' || "$line2" != description:* || "$line4" != 'alwaysApply: true' && "$line4" != 'alwaysApply: false' || "$line5" != '---' ]]; then
        fail "RULE_FRONTMATTER field order file=$file"
    fi
    [[ "$line2" =~ ^description:\ .+；在.+时 ]] || fail "RULE_DESCRIPTION file=$file"
    [[ "$line3" == 'globs:' || "$line3" =~ ^globs:\ \"[^\"]+\"$ ]] || fail "RULE_GLOBS quoted-scalar file=$file"
    if [[ "$line4" == 'alwaysApply: true' && "$line3" != 'globs:' ]]; then
        fail "RULE_ACTIVATION always rule must have empty globs file=$file"
    fi
    for heading in '# ' '## 适用范围' '## 强制规则' '## 验证清单'; do
        grep -Fq "$heading" "$file" || fail "RULE_STRUCTURE missing=$heading file=$file"
    done
    if grep -Eq '^## (补充规则|补充说明|其他要求|其它|其他)[[:space:]]*$' "$file"; then
        fail "RULE_STRUCTURE catch-all heading file=$file"
    fi
    if grep -Eq '閿欒|缁勫|瑙勭害|�' "$file"; then
        fail "RULE_ENCODING mojibake marker file=$file"
    fi
    if [[ "$file" == *'/rules/projects/broker/'* ]]; then
        grep -Eq '^alwaysApply: false$' "$file" || fail "PROJECT_RULE alwaysApply file=$file"
        [[ "$line3" == 'globs:' || "$line3" =~ ^globs:\ \".*broker.*\"$ ]] || fail "PROJECT_RULE globs file=$file"
        [[ "$(basename "$file")" == broker-* ]] || fail "PROJECT_RULE name file=$file"
    fi
    if [[ "$file" == *'/rules/projects/b2cmall/'* ]]; then
        grep -Eq '^alwaysApply: false$' "$file" || fail "PROJECT_RULE alwaysApply file=$file"
        [[ "$line3" == 'globs:' || "$line3" =~ ^globs:\ \".*b2cmall.*\"$ ]] || fail "PROJECT_RULE globs file=$file"
        [[ "$(basename "$file")" == b2cmall-* ]] || fail "PROJECT_RULE name file=$file"
    fi
    if [[ "$file" == *'/rules/projects/yunshang/'* ]]; then
        grep -Eq '^alwaysApply: false$' "$file" || fail "PROJECT_RULE alwaysApply file=$file"
        [[ "$line3" == 'globs:' || "$line3" =~ ^globs:\ \".*yunshang.*\"$ ]] || fail "PROJECT_RULE globs file=$file"
        [[ "$(basename "$file")" == yunshang-* ]] || fail "PROJECT_RULE name file=$file"
    fi
done < <(find "$CURSOR/rules" -name '.*' -prune -o -type f -name '*.mdc' -print | sort)

authoring="$CURSOR/skills/harness-resource-authoring"
for rel in SKILL.md references/agent-template.md references/skill-template.md references/rule-template.mdc; do
    [[ -f "$authoring/$rel" ]] || fail "AUTHORING_SKILL missing=$rel"
done
for forbidden in README.md agents scripts; do
    [[ ! -e "$authoring/$forbidden" ]] || fail "AUTHORING_SKILL forbidden=$forbidden"
done

# Active playbook semantics and reference checks live in the read-only Node guard.
[[ ! -d "$ROOT/docs/migrations" ]] || fail 'DOCS_MIGRATIONS must remain removed'

templates=(
    task.md design.md verification.md migration.md
)
for rel in "${templates[@]}"; do
    [[ -f "$ROOT/docs/templates/$rel" ]] || fail "TEMPLATE_COVERAGE missing=$rel"
done

contains "$CURSOR/rules/correction-detection.mdc" 'workflow/memory-change.md' MEMORY_CANDIDATE
contains "$CURSOR/rules/correction-detection.mdc" '状态为 `PENDING`' MEMORY_CANDIDATE
contains "$CURSOR/rules/correction-detection.mdc" '禁止直接修改任何 `.mdc`' MEMORY_CANDIDATE
contains "$CURSOR/agents/memory-consolidator.md" '状态为 `APPROVED`' MEMORY_APPROVAL
contains "$CURSOR/agents/memory-consolidator.md" '目标语义章节' MEMORY_APPROVAL
contains "$CURSOR/agents/memory-consolidator.md" '状态更新为 `APPLIED`' MEMORY_APPROVAL

if find "$CURSOR/scripts" -maxdepth 1 -type f -name '*.py' | grep -q .; then
    fail 'SCRIPT_TYPE Python files remain in .cursor/scripts'
fi

hooks_json="$CURSOR/hooks.json"
hook_scripts=(
  hooks/handle-before-submit.mjs
  hooks/handle-pre-tool-use.mjs
  hooks/handle-session-start.mjs
  hooks/lib/rules-engine.mjs
)
[[ -f "$hooks_json" ]] || fail 'HOOKS_JSON missing=.cursor/hooks.json'
hooks_text="$(cat "$hooks_json")"
for marker in beforeSubmitPrompt preToolUse sessionStart; do
  [[ "$hooks_text" == *"$marker"* ]] || fail "HOOKS_JSON missing=$marker"
done
for rel in "${hook_scripts[@]}"; do
  [[ -f "$CURSOR/$rel" ]] || fail "HOOK_SCRIPT missing=$rel"
done

routing_sync="$CURSOR/scripts/check-rule-routing-sync.mjs"
[[ -f "$routing_sync" ]] || fail 'RULE_ROUTING_SYNC missing=check-rule-routing-sync.mjs'
node "$routing_sync" || fail 'RULE_ROUTING_SYNC failed (rules-loader vs rules-engine drift)'

context_budget="$CURSOR/scripts/check-context-budget.mjs"
[[ -f "$context_budget" ]] || fail 'CONTEXT_BUDGET missing=check-context-budget.mjs'
if [[ -f "$context_budget" ]]; then
    node "$context_budget" || fail 'CONTEXT_BUDGET failed platform=cursor'
fi

safety_guard="$CURSOR/scripts/check-safety-guard.mjs"
[[ -f "$safety_guard" ]] || fail 'SAFETY_GUARD missing=check-safety-guard.mjs'
if [[ -f "$safety_guard" ]]; then
    node "$safety_guard" || fail 'SAFETY_GUARD failed platform=cursor'
fi

review_topology="$CURSOR/scripts/check-review-topology.mjs"
[[ -f "$review_topology" ]] || fail 'REVIEW_TOPOLOGY missing=check-review-topology.mjs'
if [[ -f "$review_topology" ]]; then
    node "$review_topology" || fail 'REVIEW_TOPOLOGY failed platform=cursor'
fi

artifact_budget="$CURSOR/scripts/check-artifact-budget.mjs"
[[ -f "$artifact_budget" ]] || fail 'ARTIFACT_BUDGET missing=check-artifact-budget.mjs'
if [[ -f "$artifact_budget" ]]; then
    node "$artifact_budget" || fail 'ARTIFACT_BUDGET failed platform=cursor'
fi

workflow_diet="$CURSOR/scripts/check-workflow-diet.mjs"
[[ -f "$workflow_diet" ]] || fail 'WORKFLOW_DIET missing=check-workflow-diet.mjs'
if [[ -f "$workflow_diet" ]]; then
    node "$workflow_diet" --platform=cursor || fail 'WORKFLOW_DIET failed platform=cursor'
fi

node "$CURSOR/scripts/check-environment-profiles.mjs" || fail 'ENVIRONMENT_PROFILES failed'

codearts_pipeline="$CURSOR/scripts/check-codearts-pipeline.mjs"
[[ -f "$codearts_pipeline" ]] || fail 'CODEARTS_PIPELINE missing=check-codearts-pipeline.mjs'
if [[ -f "$codearts_pipeline" ]]; then
    node "$codearts_pipeline" || fail 'CODEARTS_PIPELINE failed'
fi

apifox_openapi_sync_test="$CURSOR/skills/apifox-openapi-sync/tests/sync-openapi.test.mjs"
[[ -f "$apifox_openapi_sync_test" ]] || fail 'APIFOX_OPENAPI_SYNC missing=sync-openapi.test.mjs'
if [[ -f "$apifox_openapi_sync_test" ]]; then
    node --test "$apifox_openapi_sync_test" || fail 'APIFOX_OPENAPI_SYNC failed'
fi

node --test "$CURSOR/skills/git-update-recovery/tests/git-update-recovery.test.mjs" || fail 'GIT_UPDATE_RECOVERY failed'
node --test "$CURSOR/scripts/check-nacos-read.mjs" || fail 'NACOS_READ failed'
node --test "$CURSOR/scripts/check-nacos-config-write.mjs" || fail 'NACOS_CONFIG_WRITE failed'

node "$CURSOR/scripts/check-resource-consolidation.mjs" || fail 'RESOURCE_CONSOLIDATION failed'

if (( errors > 0 )); then
    echo "Harness resource validation failed: $errors error(s)" >&2
    exit 1
fi
echo 'Harness resource validation passed'
