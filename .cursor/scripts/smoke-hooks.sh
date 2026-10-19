#!/usr/bin/env bash
# Context Diet Hook smoke tests: compact discovery + deterministic safety guard.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
failures=()
add_failure() { failures+=("$1"); }

for rel in \
  .cursor/hooks/handle-before-submit.mjs \
  .cursor/hooks/handle-pre-tool-use.mjs \
  .cursor/hooks/handle-session-start.mjs \
  .cursor/hooks/lib/rules-engine.mjs; do
  [[ -f "$ROOT/$rel" ]] || { add_failure "HOOK_SCRIPT missing=$rel"; continue; }
  node --check "$ROOT/$rel"
done

run_before() {
  printf '%s' "$1" | node "$ROOT/.cursor/hooks/handle-before-submit.mjs"
}

run_guard() {
  printf '%s' "$1" | node "$ROOT/.cursor/hooks/handle-pre-tool-use.mjs"
}

before_output="$(run_before '{"prompt":"实现 UserController","open_files":["broker/src/main/java/com/broker/Foo.java"]}')"
[[ "$before_output" == *'additional_context'* ]] || add_failure 'beforeSubmitPrompt missing discovery context'
[[ "$before_output" == *'[Harness Rule Discovery]'* ]] || add_failure 'beforeSubmitPrompt missing discovery marker'
[[ "$before_output" != *'# Java'* ]] || add_failure 'beforeSubmitPrompt unexpectedly contains Rule body'
(( ${#before_output} < 12000 )) || add_failure "beforeSubmitPrompt exceeds context budget chars=${#before_output}"

enum_output="$(run_before '{"prompt":"update OrderStatusEnum values","open_files":["broker/src/main/java/com/broker/OrderStatusEnum.java"]}')"
[[ "$enum_output" == *'enums.mdc'* ]] || add_failure 'enum rule is not discoverable'

hygiene_output="$(run_before '{"prompt":"初始化 Git 仓库并创建 .gitignore"}')"
[[ "$hygiene_output" == *'repository-hygiene.mdc'* ]] || add_failure 'repository hygiene rule is not discoverable'

normal_write="$(run_guard '{"tool_name":"Write","tool_input":{"path":"src/main/java/com/broker/Foo.java"},"prompt":"修复 DEV Java 问题"}')"
[[ "$normal_write" == *'"permission":"allow"'* ]] || add_failure "normal DEV write blocked=$normal_write"

readonly_write="$(run_guard '{"tool_name":"Write","tool_input":{"path":"src/main/java/com/broker/Foo.java"},"prompt":"只读审计，不要修改"}')"
[[ "$readonly_write" == *'"permission":"deny"'* ]] || add_failure 'read-only source write was not blocked'

prod_write="$(run_guard '{"tool_name":"Write","tool_input":{"path":"src/main/resources/application-prod.yml","content":"deploy: production"}}')"
[[ "$prod_write" == *'"permission":"deny"'* ]] || add_failure 'PROD configuration write was not blocked'

force_push="$(run_guard '{"tool_name":"Shell","tool_input":{"command":"git push --force origin main"}}')"
[[ "$force_push" == *'"permission":"deny"'* ]] || add_failure 'force push was not blocked'

drop_table="$(run_guard '{"tool_name":"Shell","tool_input":{"command":"mysql dev -e DROP TABLE users"}}')"
[[ "$drop_table" == *'"permission":"deny"'* ]] || add_failure 'destructive DB command was not blocked'

delete_without_where="$(run_guard '{"tool_name":"Shell","tool_input":{"command":"mysql dev -e DELETE FROM users"}}')"
[[ "$delete_without_where" == *'"permission":"deny"'* ]] || add_failure 'unbounded DELETE was not blocked'

delete_with_where="$(run_guard '{"tool_name":"Shell","tool_input":{"command":"mysql dev -e DELETE FROM users WHERE id = 1"}}')"
[[ "$delete_with_where" == *'"permission":"allow"'* ]] || add_failure 'bounded DELETE was unexpectedly blocked'

hard_reset="$(run_guard '{"tool_name":"Shell","tool_input":{"command":"git reset --hard HEAD~1"}}')"
[[ "$hard_reset" == *'"permission":"deny"'* ]] || add_failure 'git reset --hard was not blocked'

prod_deploy="$(run_guard '{"tool_name":"Shell","tool_input":{"command":"kubectl apply -f deployment-prod.yaml"}}')"
[[ "$prod_deploy" == *'"permission":"deny"'* ]] || add_failure 'PROD deployment was not blocked'

dev_test="$(run_guard '{"tool_name":"Shell","tool_input":{"command":"mvn -pl broker-service test"}}')"
[[ "$dev_test" == *'"permission":"allow"'* ]] || add_failure 'normal mechanical verification was blocked'

if ((${#failures[@]} > 0)); then
  echo 'Hook smoke failed:'
  printf -- '- %s\n' "${failures[@]}"
  exit 1
fi

echo 'Hook smoke passed: compact discovery, DEV write, read-only, PRE/PROD, Git and DB guards.'
