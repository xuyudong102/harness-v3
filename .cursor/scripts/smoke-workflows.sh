#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node "$ROOT/.cursor/scripts/check-workflow-diet.mjs" --platform=cursor
node "$ROOT/.cursor/scripts/check-artifact-budget.mjs" --platform=cursor
echo 'Workflow smoke passed: adaptive guidance; zero auxiliary handoffs/phases/transitions; read-only investigation and required code-change completion.'
