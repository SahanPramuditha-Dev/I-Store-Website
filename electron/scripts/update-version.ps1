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

# Also update React state default fallbacks in Login.jsx and SoftwareUpdatesSettingsPanel.jsx
$loginJsx = Join-Path (Split-Path $FrontendPkg) "src\pages\Login.jsx"
$settingsJsx = Join-Path (Split-Path $FrontendPkg) "src\components\settings\SoftwareUpdatesSettingsPanel.jsx"
if (Test-Path $loginJsx) {
    $c = Get-Content $loginJsx -Raw
    $c = $c -replace 'const \[appVersion, setAppVersion\] = useState\("v[^"]*"\);', "const [appVersion, setAppVersion] = useState(`"v$Version`");"
    [System.IO.File]::WriteAllText($loginJsx, $c, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "    Updated: $loginJsx"
}
if (Test-Path $settingsJsx) {
    $c = Get-Content $settingsJsx -Raw
    $c = $c -replace 'const \[appVersion, setAppVersion\] = useState\("v[^"]*"\);', "const [appVersion, setAppVersion] = useState(`"v$Version`");"
    [System.IO.File]::WriteAllText($settingsJsx, $c, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "    Updated: $settingsJsx"
}
Write-Host "    OK - All versions updated."
