$whitelist = @(
    'rules-loader.mdc',
    'correction-detection.mdc',
    'cross-ref-guard.mdc',
    'java-edit-self-check.mdc'
)
$pattern = '[A-Za-z0-9_-]+\.mdc'
$rulesDir = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..\rules'
$violations = @()

function Test-VisibleResourcePath([string]$Base, [string]$FullName) {
    $relative = $FullName.Substring($Base.Length).TrimStart([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    foreach ($segment in ($relative -split '[\\/]')) {
        if ($segment.StartsWith('.')) { return $false }
    }
    return $true
}

Get-ChildItem -Path $rulesDir -Recurse -Filter *.mdc -File | Where-Object {
    Test-VisibleResourcePath $rulesDir $_.FullName
} | ForEach-Object {
    $file = $_
    if ($whitelist -contains $file.Name) { return }

    $lineNo = 0
    foreach ($line in Get-Content -LiteralPath $file.FullName) {
        $lineNo++
        foreach ($match in [regex]::Matches($line, $pattern)) {
            if ($match.Value -ieq $file.Name) { continue }
            $violations += [pscustomobject]@{
                File = $file.Name
                Line = $lineNo
                Ref  = $match.Value
                Text = $line.Trim()
            }
        }
    }
}

if ($violations.Count -gt 0) {
    Write-Host ("[FAIL] cross-ref check failed: found {0} leaf-rule cross-file reference(s):" -f $violations.Count)
    foreach ($v in $violations) {
        Write-Host ("  {0}:{1}  ->  {2}" -f $v.File, $v.Line, $v.Ref)
        Write-Host ("      {0}" -f $v.Text)
    }
    exit 1
}

Write-Host '[PASS] cross-ref check passed: no cross-file .mdc references in leaf rules.'
exit 0
