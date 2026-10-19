$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Cursor = Join-Path $Root '.cursor'
$errors = [System.Collections.Generic.List[string]]::new()

function Add-ValidationError([string]$Message) { $script:errors.Add($Message) }
function Read-Utf8([string]$Path) { [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) }
function Test-VisibleResourcePath([string]$Base, [string]$FullName) {
    $relative = $FullName.Substring($Base.Length).TrimStart([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    foreach ($segment in ($relative -split '[\\/]')) {
        if ($segment.StartsWith('.')) { return $false }
    }
    return $true
}
function Assert-Contains([string]$Text, [string]$Value, [string]$Code) {
    if (-not $Text.Contains($Value)) { Add-ValidationError "$Code missing=$Value" }
}

$agentsRoot = Join-Path $Cursor 'agents'
$skillsRoot = Join-Path $Cursor 'skills'
$workflowsRoot = Join-Path $Cursor 'workflows'
$rulesRoot = Join-Path $Cursor 'rules'
$agents = @(Get-ChildItem $agentsRoot -Filter '*.md' -File | Where-Object { Test-VisibleResourcePath $agentsRoot $_.FullName })
$skills = @(Get-ChildItem $skillsRoot -Directory | Where-Object { (Test-VisibleResourcePath $skillsRoot $_.FullName) -and (Test-Path (Join-Path $_.FullName 'SKILL.md') -PathType Leaf) })
$workflows = @(Get-ChildItem $workflowsRoot -Filter '*.yaml' -File -Recurse | Where-Object { Test-VisibleResourcePath $workflowsRoot $_.FullName })
$rules = @(Get-ChildItem $rulesRoot -Filter '*.mdc' -File -Recurse | Where-Object { Test-VisibleResourcePath $rulesRoot $_.FullName })
if ($agents.Count -ne 6) { Add-ValidationError "AGENT_COUNT expected=6 actual=$($agents.Count)" }
if ($skills.Count -ne 21) { Add-ValidationError "SKILL_COUNT expected=21 actual=$($skills.Count)" }
if ($workflows.Count -ne 3) { Add-ValidationError "WORKFLOW_COUNT expected=3 actual=$($workflows.Count)" }
if ($rules.Count -ne 79) { Add-ValidationError "RULE_COUNT expected=79 actual=$($rules.Count)" }

foreach ($agent in $agents) {
    $text = Read-Utf8 $agent.FullName
    if ($text -notmatch "(?m)^name:\s*$([regex]::Escape($agent.BaseName))\s*$") {
        Add-ValidationError "AGENT_NAME file=$($agent.Name)"
    }
    if ($text -notmatch '(?m)^description:\s*.+') { Add-ValidationError "AGENT_DESCRIPTION file=$($agent.Name)" }
}
foreach ($skill in $skills) {
    $path = Join-Path $skill.FullName 'SKILL.md'
    $text = Read-Utf8 $path
    if ($text -notmatch "(?m)^name:\s*$([regex]::Escape($skill.Name))\s*$") {
        Add-ValidationError "SKILL_NAME folder=$($skill.Name)"
    }
    if ($text -notmatch '(?m)^description:\s*(>|.+)') { Add-ValidationError "SKILL_DESCRIPTION folder=$($skill.Name)" }
}

foreach ($rule in $rules) {
    $text = (Read-Utf8 $rule.FullName).TrimStart([char]0xFEFF).Replace("`r`n", "`n")
    $meta = [regex]::Match(
        $text,
        '\A---\ndescription: (?<description>[^\n]+)\nglobs:(?<globs>[^\n]*)\nalwaysApply: (?<always>true|false)\n---\n'
    )
    if (-not $meta.Success) {
        Add-ValidationError "RULE_FRONTMATTER file=$($rule.FullName)"
        continue
    }
    $description = $meta.Groups['description'].Value.Trim()
    $globs = $meta.Groups['globs'].Value.Trim()
    $always = $meta.Groups['always'].Value
    if ($description -notmatch '；在.+时') {
        Add-ValidationError "RULE_DESCRIPTION missing trigger semantics file=$($rule.FullName)"
    }
    if ($globs -and ($globs -notmatch '^"[^"\r\n]+"$')) {
        Add-ValidationError "RULE_GLOBS must be quoted scalar file=$($rule.FullName)"
    }
    if ($always -eq 'true' -and $globs) {
        Add-ValidationError "RULE_ACTIVATION always rule must have empty globs file=$($rule.FullName)"
    }
    foreach ($heading in @('# ', '## 适用范围', '## 强制规则', '## 验证清单')) {
        if (-not $text.Contains($heading)) {
            Add-ValidationError "RULE_STRUCTURE missing=$heading file=$($rule.FullName)"
        }
    }
    if ($text -match '(?m)^## (补充规则|补充说明|其他要求|其它|其他)\s*$') {
        Add-ValidationError "RULE_STRUCTURE catch-all heading file=$($rule.FullName)"
    }
    if ($text -match "[\uE000-\uF8FF\uFFFD]|閿欒|缁勫|瑙勭害") {
        Add-ValidationError "RULE_ENCODING mojibake marker file=$($rule.FullName)"
    }
    if ($rule.FullName -match '[\\/]rules[\\/]projects[\\/]broker[\\/]') {
        if ($always -ne 'false' -or ($globs -and $globs -notmatch 'broker')) {
            Add-ValidationError "PROJECT_RULE_SCOPE invalid broker activation file=$($rule.FullName)"
        }
        if (-not $rule.BaseName.StartsWith('broker-')) {
            Add-ValidationError "PROJECT_RULE_NAME missing broker prefix file=$($rule.FullName)"
        }
    }
    if ($rule.FullName -match '[\\/]rules[\\/]projects[\\/]b2cmall[\\/]') {
        if ($always -ne 'false' -or ($globs -and $globs -notmatch 'b2cmall')) {
            Add-ValidationError "PROJECT_RULE_SCOPE invalid b2cmall activation file=$($rule.FullName)"
        }
        if (-not $rule.BaseName.StartsWith('b2cmall-')) {
            Add-ValidationError "PROJECT_RULE_NAME missing b2cmall prefix file=$($rule.FullName)"
        }
    }
    if ($rule.FullName -match '[\\/]rules[\\/]projects[\\/]yunshang[\\/]') {
        if ($always -ne 'false' -or ($globs -and $globs -notmatch 'yunshang')) {
            Add-ValidationError "PROJECT_RULE_SCOPE invalid yunshang activation file=$($rule.FullName)"
        }
        if (-not $rule.BaseName.StartsWith('yunshang-')) {
            Add-ValidationError "PROJECT_RULE_NAME missing yunshang prefix file=$($rule.FullName)"
        }
    }
}

$authoringSkill = Join-Path $Cursor 'skills\harness-resource-authoring'
foreach ($rel in @('SKILL.md','references\agent-template.md','references\skill-template.md','references\rule-template.mdc')) {
    if (-not (Test-Path (Join-Path $authoringSkill $rel))) {
        Add-ValidationError "AUTHORING_SKILL missing=$rel"
    }
}
foreach ($forbidden in @('README.md','agents','scripts')) {
    if (Test-Path (Join-Path $authoringSkill $forbidden)) {
        Add-ValidationError "AUTHORING_SKILL forbidden=$forbidden"
    }
}

# Active playbooks are validated as guidance/completion contracts, not step DSLs.
if (Test-Path (Join-Path $Root 'docs\migrations')) { Add-ValidationError 'DOCS_MIGRATIONS must remain removed' }

$expectedTemplates = @('task.md','design.md','verification.md','migration.md')
foreach ($rel in $expectedTemplates) {
    if (-not (Test-Path (Join-Path $Root (Join-Path 'docs\templates' $rel)))) {
        Add-ValidationError "TEMPLATE_COVERAGE missing=$rel"
    }
}

$correction = Read-Utf8 (Join-Path $Cursor 'rules\correction-detection.mdc')
$memoryAgent = Read-Utf8 (Join-Path $Cursor 'agents\memory-consolidator.md')
foreach ($marker in @('workflow/memory-change.md','状态为 `PENDING`','禁止直接修改任何 `.mdc`')) {
    Assert-Contains $correction $marker 'MEMORY_CANDIDATE'
}
foreach ($marker in @('状态为 `APPROVED`','目标语义章节','状态更新为 `APPLIED`')) {
    Assert-Contains $memoryAgent $marker 'MEMORY_APPROVAL'
}

$oldAgents = @('ones-issue-fetcher','loki-log-investigator','prd-splitter','bug-analyst','architect-hld','db-ddl','lld-author','impl-planner','spec-reviewer','code-quality-reviewer','code-reviewer')
& node (Join-Path $PSScriptRoot 'check-resource-consolidation.mjs')
if ($LASTEXITCODE -ne 0) { Add-ValidationError 'RESOURCE_CONSOLIDATION failed' }
$textFiles = @(Get-ChildItem $Cursor,(Join-Path $Root 'docs') -File -Recurse | Where-Object {
    $_.Extension -in @('.md','.mdc','.yaml','.yml','.ps1','.sh') -and
    $_.FullName -notmatch '[\\/]archive[\\/]' -and
    $_.Name -ne 'check-harness-resources.ps1'
}) + @(Get-Item (Join-Path $Root 'README.md'))
foreach ($file in $textFiles) {
    $text = Read-Utf8 $file.FullName
    foreach ($old in $oldAgents) {
        if ($text -match "(?<![a-z0-9-])$([regex]::Escape($old))(?![a-z0-9-])") {
            Add-ValidationError "OLD_AGENT name=$old file=$($file.FullName)"
        }
    }
}

$pythonFiles = @(Get-ChildItem $PSScriptRoot -Filter '*.py' -File)
if ($pythonFiles.Count -gt 0) { Add-ValidationError "SCRIPT_TYPE python files remain=$($pythonFiles.Name -join ',')" }

$hooksJson = Join-Path $Cursor 'hooks.json'
$hookScripts = @(
  'hooks\handle-before-submit.mjs',
  'hooks\handle-pre-tool-use.mjs',
  'hooks\handle-session-start.mjs',
  'hooks\lib\rules-engine.mjs'
)
if (-not (Test-Path $hooksJson)) {
  Add-ValidationError 'HOOKS_JSON missing=.cursor/hooks.json'
} else {
  $hooksText = Read-Utf8 $hooksJson
  foreach ($marker in @('beforeSubmitPrompt', 'preToolUse', 'sessionStart')) {
    if (-not $hooksText.Contains($marker)) { Add-ValidationError "HOOKS_JSON missing=$marker" }
  }
}
foreach ($rel in $hookScripts) {
  if (-not (Test-Path (Join-Path $Cursor $rel))) {
    Add-ValidationError "HOOK_SCRIPT missing=$rel"
  }
}

$routingSync = Join-Path $PSScriptRoot 'check-rule-routing-sync.ps1'
if (-not (Test-Path $routingSync)) {
  Add-ValidationError 'RULE_ROUTING_SYNC missing=check-rule-routing-sync.ps1'
} else {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $routingSync
  if ($LASTEXITCODE -ne 0) {
    Add-ValidationError 'RULE_ROUTING_SYNC failed (rules-loader vs rules-engine drift)'
  }
}

$contextBudget = Join-Path $PSScriptRoot 'check-context-budget.mjs'
if (-not (Test-Path $contextBudget)) {
  Add-ValidationError 'CONTEXT_BUDGET missing=check-context-budget.mjs'
} else {
  & node $contextBudget
  if ($LASTEXITCODE -ne 0) { Add-ValidationError 'CONTEXT_BUDGET failed platform=cursor' }
}

$safetyGuard = Join-Path $PSScriptRoot 'check-safety-guard.mjs'
if (-not (Test-Path $safetyGuard)) {
  Add-ValidationError 'SAFETY_GUARD missing=check-safety-guard.mjs'
} else {
  & node $safetyGuard
  if ($LASTEXITCODE -ne 0) { Add-ValidationError 'SAFETY_GUARD failed platform=cursor' }
}

$reviewTopology = Join-Path $PSScriptRoot 'check-review-topology.mjs'
if (-not (Test-Path $reviewTopology)) {
  Add-ValidationError 'REVIEW_TOPOLOGY missing=check-review-topology.mjs'
} else {
  & node $reviewTopology
  if ($LASTEXITCODE -ne 0) { Add-ValidationError 'REVIEW_TOPOLOGY failed platform=cursor' }
}

$artifactBudget = Join-Path $PSScriptRoot 'check-artifact-budget.mjs'
if (-not (Test-Path $artifactBudget)) {
  Add-ValidationError 'ARTIFACT_BUDGET missing=check-artifact-budget.mjs'
} else {
  & node $artifactBudget
  if ($LASTEXITCODE -ne 0) { Add-ValidationError 'ARTIFACT_BUDGET failed platform=cursor' }
}

$workflowDiet = Join-Path $PSScriptRoot 'check-workflow-diet.mjs'
& node $workflowDiet '--platform=cursor'
if ($LASTEXITCODE -ne 0) { Add-ValidationError 'WORKFLOW_DIET failed platform=cursor' }

& node (Join-Path $PSScriptRoot 'check-environment-profiles.mjs')
if ($LASTEXITCODE -ne 0) { Add-ValidationError 'ENVIRONMENT_PROFILES failed' }

$codeartsPipeline = Join-Path $PSScriptRoot 'check-codearts-pipeline.mjs'
if (-not (Test-Path $codeartsPipeline)) {
    Add-ValidationError 'CODEARTS_PIPELINE missing=check-codearts-pipeline.mjs'
} else {
    & node $codeartsPipeline
    if ($LASTEXITCODE -ne 0) { Add-ValidationError 'CODEARTS_PIPELINE failed' }
}

& node --test (Join-Path $Cursor 'skills/git-update-recovery/tests/git-update-recovery.test.mjs')
if ($LASTEXITCODE -ne 0) { Add-ValidationError 'GIT_UPDATE_RECOVERY failed' }
& node --test (Join-Path $Cursor 'scripts/check-nacos-read.mjs')
if ($LASTEXITCODE -ne 0) { Add-ValidationError 'NACOS_READ failed' }
& node --test (Join-Path $Cursor 'scripts/check-nacos-config-write.mjs')
if ($LASTEXITCODE -ne 0) { Add-ValidationError 'NACOS_CONFIG_WRITE failed' }

$apifoxOpenApiSyncTest = Join-Path $Cursor 'skills/apifox-openapi-sync/tests/sync-openapi.test.mjs'
if (-not (Test-Path $apifoxOpenApiSyncTest)) {
    Add-ValidationError 'APIFOX_OPENAPI_SYNC missing=sync-openapi.test.mjs'
} else {
    & node --test $apifoxOpenApiSyncTest
    if ($LASTEXITCODE -ne 0) { Add-ValidationError 'APIFOX_OPENAPI_SYNC failed' }
}

if ($errors.Count -gt 0) {
    Write-Host 'Harness resource validation failed:' -ForegroundColor Red
    $errors | ForEach-Object { Write-Host "- $_" -ForegroundColor Red }
    exit 1
}
Write-Host 'Harness resource validation passed' -ForegroundColor Green
