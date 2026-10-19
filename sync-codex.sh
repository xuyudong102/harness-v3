#!/usr/bin/env bash
# Portable Harness-owned entrypoint. Canonical sync semantics live in .cursor/scripts/sync-codex.mjs.
set -euo pipefail

harness_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec node "$harness_root/.cursor/scripts/sync-codex.mjs" "$@"
