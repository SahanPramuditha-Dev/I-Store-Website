$ErrorActionPreference = "Stop"

$installerPath = Join-Path $PSScriptRoot "..\installer.nsh"
$source = Get-Content -LiteralPath $installerPath -Raw

$forbiddenPatterns = @(
    'taskkill\s+/F\s+/IM',
    'RMDir\s+/r\s+"\$LOCALAPPDATA\\iStore"'
)

foreach ($pattern in $forbiddenPatterns) {
    if ($source -match $pattern) {
        throw "Unsafe installer directive matched: $pattern"
    }
}

foreach ($required in @('iStore.update-safety', '!macro customInit', '!macro customInstall')) {
    if (-not $source.Contains($required)) {
        throw "Required installer safety behavior is missing: $required"
    }
}

Write-Host "Installer data-safety checks passed."
