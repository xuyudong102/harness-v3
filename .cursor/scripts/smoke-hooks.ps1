# Harness Hook 冒烟测试（Windows）
#
# 用途：
#   验证 Context Diet Hook：beforeSubmitPrompt 只返回简短发现索引，
#   preToolUse 放行普通开发并阻断只读、PRE/PROD 和破坏性操作。
#
# 运行：
#   powershell -NoProfile -ExecutionPolicy Bypass -File .cursor/scripts/smoke-hooks.ps1
#
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$failures = [System.Collections.Generic.List[string]]::new()

function Add-Failure([string]$Message) { $script:failures.Add($Message) }

$hooksJson = Join-Path $Root '.cursor\hooks.json'
$requiredScripts = @(
  '.cursor\hooks\handle-before-submit.mjs',
  '.cursor\hooks\handle-pre-tool-use.mjs',
  '.cursor\hooks\handle-session-start.mjs',
  '.cursor\hooks\lib\rules-engine.mjs'
)

if (-not (Test-Path $hooksJson)) {
  Add-Failure 'HOOKS_JSON missing=.cursor/hooks.json'
} else {
  $hooksText = Get-Content $hooksJson -Raw
  foreach ($marker in @('beforeSubmitPrompt', 'preToolUse', 'sessionStart', 'handle-before-submit.mjs', 'handle-pre-tool-use.mjs')) {
    if ($hooksText -notmatch [regex]::Escape($marker)) {
      Add-Failure "HOOKS_JSON missing=$marker"
    }
  }
}

foreach ($rel in $requiredScripts) {
  $path = Join-Path $Root $rel
  if (-not (Test-Path $path)) {
    Add-Failure "HOOK_SCRIPT missing=$rel"
    continue
  }
  & node --check $path
  if ($LASTEXITCODE -ne 0) {
    Add-Failure "HOOK_SCRIPT syntax=$rel"
  }
}

$prompt = '{"prompt":"实现 UserController","open_files":["src/main/java/com/broker/Foo.java"],"conversation_id":"smoke-hook"}'
$beforeOutput = $prompt | & node (Join-Path $Root '.cursor\hooks\handle-before-submit.mjs') 2>&1
if ($LASTEXITCODE -ne 0) {
  Add-Failure 'HOOK_SMOKE beforeSubmitPrompt exit-code'
} elseif ($beforeOutput -notmatch 'additional_context') {
  Add-Failure 'HOOK_SMOKE beforeSubmitPrompt missing additional_context'
} elseif ($beforeOutput -notmatch 'Harness Rule Discovery') {
  Add-Failure 'HOOK_SMOKE beforeSubmitPrompt missing discovery marker'
} elseif ($beforeOutput.Length -ge 12000) {
  Add-Failure "HOOK_SMOKE beforeSubmitPrompt exceeds context budget chars=$($beforeOutput.Length)"
}

$enumPrompt = '{"prompt":"update OrderStatusEnum values","open_files":["src/main/java/com/broker/OrderStatusEnum.java"],"conversation_id":"smoke-hook-enums"}'
$enumOutput = $enumPrompt | & node (Join-Path $Root '.cursor\hooks\handle-before-submit.mjs') 2>&1
if ($LASTEXITCODE -ne 0) {
  Add-Failure 'HOOK_SMOKE enums beforeSubmitPrompt exit-code'
} elseif ($enumOutput -notmatch 'enums\.mdc') {
  Add-Failure 'HOOK_SMOKE enums scenario missing enums.mdc injection'
}

$hygienePrompt = '{"prompt":"初始化 Git 仓库并创建 .gitignore","conversation_id":"smoke-hook-repository-hygiene"}'
$hygieneOutput = $hygienePrompt | & node (Join-Path $Root '.cursor\hooks\handle-before-submit.mjs') 2>&1
if ($LASTEXITCODE -ne 0) {
  Add-Failure 'HOOK_SMOKE repository hygiene beforeSubmitPrompt exit-code'
} elseif ($hygieneOutput -notmatch 'repository-hygiene\.mdc') {
  Add-Failure 'HOOK_SMOKE repository hygiene scenario missing repository-hygiene.mdc injection'
}

$writeGate = '{"tool_name":"Write","tool_input":{"path":"src/main/java/com/broker/Foo.java"},"conversation_id":"smoke-hook-gate"}'
$gateOutput = $writeGate | & node (Join-Path $Root '.cursor\hooks\handle-pre-tool-use.mjs') 2>&1
if ($LASTEXITCODE -ne 0) {
  Add-Failure 'HOOK_SMOKE preToolUse exit-code'
} elseif ($gateOutput -notmatch '"permission"\s*:\s*"allow"') {
  Add-Failure "HOOK_SMOKE preToolUse unexpected output=$gateOutput"
}

$readonlyGate = '{"tool_name":"Write","tool_input":{"path":"src/main/java/com/broker/Foo.java"},"prompt":"只读审计，不要修改"}'
$readonlyOutput = $readonlyGate | & node (Join-Path $Root '.cursor\hooks\handle-pre-tool-use.mjs') 2>&1
if ($readonlyOutput -notmatch '"permission"\s*:\s*"deny"') {
  Add-Failure 'HOOK_SMOKE read-only write was not blocked'
}

$forcePush = '{"tool_name":"Shell","tool_input":{"command":"git push --force origin main"}}'
$forcePushOutput = $forcePush | & node (Join-Path $Root '.cursor\hooks\handle-pre-tool-use.mjs') 2>&1
if ($forcePushOutput -notmatch '"permission"\s*:\s*"deny"') {
  Add-Failure 'HOOK_SMOKE force push was not blocked'
}

if ($failures.Count -gt 0) {
  Write-Host 'Hook smoke failed:' -ForegroundColor Red
  $failures | ForEach-Object { Write-Host "- $_" -ForegroundColor Red }
  exit 1
}

Write-Host 'Hook smoke passed' -ForegroundColor Green
