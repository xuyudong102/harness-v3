<#
.SYNOPSIS
    将 Harness Cursor 配置链接到目标业务项目。

.DESCRIPTION
    集合链接: .cursor、docs（逐项软链/硬链子项，含 docs/templates）
    本地目录: docs/artifacts/work, docs/artifacts/archive

.PARAMETER Target
    目标业务项目根目录（必填）

.PARAMETER Force
    覆盖已存在的链接或 MCP 工作区文件

.EXAMPLE
    .\link-cursor-config.ps1 -Target "D:\Work\Project\Java\broker"
    .\link-cursor-config.ps1 -Target "D:\Work\Project\Java\broker" -Force
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$Target,

    [switch]$Force
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$Source = $PSScriptRoot

if (-not (Test-Path $Source)) {
    Write-Error "源目录不存在: $Source"
    exit 1
}
if (-not (Test-Path $Target)) {
    Write-Error "目标目录不存在: $Target"
    exit 1
}

$Target = (Resolve-Path $Target).Path
$Source = (Resolve-Path $Source).Path

if ($Target -eq $Source) {
    Write-Error "目标目录不能是 Harness 源目录本身"
    exit 1
}
if ($Target.StartsWith($Source + [IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Error "目标目录不能位于 Harness 源目录内部，避免产生循环链接: $Target"
    exit 1
}

$collections = @(
    @{ Rel = ".cursor"; Exclude = @() }
    @{ Rel = "docs"; Exclude = @() }
)

$localDirs = @(
    "docs\artifacts\work"
    "docs\artifacts\archive"
)

$successCount = 0
$skipCount = 0
$failCount = 0

function Write-LinkResult {
    param(
        [string]$RelPath,
        [string]$Mode,
        [bool]$Ok,
        [string]$Detail = ""
    )
    if ($Ok) {
        Write-Host "[OK] $RelPath ($Mode)" -ForegroundColor Green
        if ($Detail) {
            Write-Host "     $Detail" -ForegroundColor DarkGray
        }
        $script:successCount++
    } else {
        Write-Host "[SKIP] $RelPath — $Detail" -ForegroundColor Yellow
        $script:skipCount++
    }
}

function Ensure-ParentDirectory {
    param([string]$Path)
    $parent = Split-Path $Path -Parent
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
}

function Remove-ExistingTarget {
    param(
        [string]$DstPath,
        [bool]$IsDir
    )
    if (-not (Test-Path $DstPath)) {
        return $true
    }

    $existing = Get-Item $DstPath -Force
    if ($existing.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        if ($Force) {
            $existing.Delete()
            Write-Host "  移除旧链接: $DstPath" -ForegroundColor Yellow
            return $true
        }
        return $false
    }

    if ($Force) {
        if ($IsDir) {
            Remove-Item $DstPath -Recurse -Force
        } else {
            Remove-Item $DstPath -Force
        }
        Write-Host "  移除已有项: $DstPath" -ForegroundColor Yellow
        return $true
    }

    return $false
}

function Ensure-CollectionDirectory {
    param([string]$RelPath)

    $dstDir = Join-Path $Target $RelPath
    Ensure-ParentDirectory -Path $dstDir

    if (-not (Test-Path $dstDir)) {
        New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
        return $dstDir
    }

    $existing = Get-Item $dstDir -Force
    if ($existing.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        if (-not (Remove-ExistingTarget -DstPath $dstDir -IsDir $true)) {
            throw "集合目录 $RelPath 已是链接，请使用 -Force 覆盖"
        }
        New-Item -ItemType Directory -Path $dstDir -Force | Out-Null
    }

    return $dstDir
}

function Link-CollectionEntry {
    param(
        [string]$RelPath,
        [string]$SrcPath,
        [string]$DstPath,
        [bool]$IsDir
    )

    if (-not (Test-Path $SrcPath)) {
        Write-LinkResult -RelPath $RelPath -Mode $(if ($IsDir) { "junction" } else { "hardlink" }) -Ok $false -Detail "源不存在"
        return
    }

    Ensure-ParentDirectory -Path $DstPath
    if (-not (Remove-ExistingTarget -DstPath $DstPath -IsDir $IsDir)) {
        Write-LinkResult -RelPath $RelPath -Mode $(if ($IsDir) { "junction" } else { "hardlink" }) -Ok $false -Detail "已存在（使用 -Force 覆盖）"
        return
    }

    try {
        if ($IsDir) {
            cmd /c mklink /J "$DstPath" "$SrcPath" | Out-Null
            Write-LinkResult -RelPath $RelPath -Mode "junction" -Ok $true -Detail "$SrcPath -> $DstPath"
        } else {
            fsutil hardlink create "$DstPath" "$SrcPath" | Out-Null
            Write-LinkResult -RelPath $RelPath -Mode "hardlink" -Ok $true -Detail "$SrcPath -> $DstPath"
        }
    } catch {
        Write-Error "[FAIL] $RelPath : $_"
        $script:failCount++
    }
}

Write-Host ""
Write-Host "=== 链接集合 ===" -ForegroundColor Cyan
foreach ($collection in $collections) {
    $rel = $collection.Rel
    $exclude = @($collection.Exclude)
    $srcDir = Join-Path $Source $rel

    if (-not (Test-Path $srcDir)) {
        Write-LinkResult -RelPath $rel -Mode "collection" -Ok $false -Detail "源集合不存在"
        continue
    }

    try {
        $dstDir = Ensure-CollectionDirectory -RelPath $rel
    } catch {
        Write-LinkResult -RelPath $rel -Mode "collection" -Ok $false -Detail $_.Exception.Message
        continue
    }

    Write-Host "  -> $rel" -ForegroundColor DarkCyan

    Get-ChildItem -Path $srcDir -Force | ForEach-Object {
        if ($exclude -contains $_.Name) {
            Write-Host "     [SKIP] $rel\$($_.Name) — 排除项，不链接" -ForegroundColor DarkGray
            return
        }
        if ($rel -eq "docs" -and $_.Name -eq "artifacts") {
            Write-Host "     [SKIP] docs\artifacts — 使用目标项目本地目录" -ForegroundColor DarkGray
            return
        }

        $entryRel = Join-Path $rel $_.Name
        $dstPath = Join-Path $dstDir $_.Name
        Link-CollectionEntry -RelPath $entryRel -SrcPath $_.FullName -DstPath $dstPath -IsDir:$_.PSIsContainer
    }
}

Write-Host ""
Write-Host "=== 初始化目标项目本地目录 ===" -ForegroundColor Cyan
foreach ($rel in $localDirs) {
    $dstPath = Join-Path $Target $rel
    if (-not (Test-Path $dstPath)) {
        New-Item -ItemType Directory -Path $dstPath -Force | Out-Null
        Write-LinkResult -RelPath $rel -Mode "local" -Ok $true -Detail "目标项目独立目录，不链接回 Harness"
    } else {
        Write-Host "[OK] $rel (local, 已存在)" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "完成: 成功 $successCount, 跳过 $skipCount, 失败 $failCount" -ForegroundColor Cyan

Write-Host ""
Write-Host "[提示] MCP 配置" -ForegroundColor Magenta
Write-Host "  在 Cursor Settings → MCP 中按需启用服务" -ForegroundColor DarkGray

Write-Host ""
Write-Host "[提示] 可选：CodeGraph 索引（在业务项目根）" -ForegroundColor Magenta
Write-Host "  cd `"$Target`"; codegraph init -i ." -ForegroundColor DarkGray

if ($failCount -gt 0) {
    exit 1
}
