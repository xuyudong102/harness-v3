$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
foreach ($script in @('check-workflow-diet.mjs', 'check-artifact-budget.mjs')) {
    & node (Join-Path $Root ".cursor\scripts\$script") '--platform=cursor'
    if ($LASTEXITCODE -ne 0) { throw "Workflow smoke failed: $script" }
}
Write-Host 'Workflow smoke passed: adaptive playbooks and required completion contracts.'
