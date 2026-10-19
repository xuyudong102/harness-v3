$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Script = Join-Path $PSScriptRoot 'check-rule-routing-sync.mjs'

& node $Script
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
