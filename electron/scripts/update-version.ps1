param(
    [string]$Version,
    [string]$ElectronPkg,
    [string]$FrontendPkg,
    [string]$IssFile
)

function UpdateVersion($filePath, $newVersion, $isIss) {
    if (-not (Test-Path $filePath)) {
        Write-Host "ERROR: File not found: $filePath"
        exit 1
    }
    $content = Get-Content $filePath -Raw
    if ($isIss) {
        $content = $content -replace '#define MyAppVersion\s+"[^"]+"', "#define MyAppVersion     `"$newVersion`""
    } else {
        $content = $content -replace '"version": "[^"]+"', "`"version`": `"$newVersion`""
    }
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($filePath, $content, $utf8NoBom)
    Write-Host "    Updated: $filePath"
}

Write-Host "Updating versions to $Version ..."
UpdateVersion $ElectronPkg $Version $false
UpdateVersion $FrontendPkg $Version $false
UpdateVersion $IssFile $Version $true
Write-Host "    OK - All versions updated."
