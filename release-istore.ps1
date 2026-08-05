[CmdletBinding(DefaultParameterSetName = 'Run')]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Version,

    [Parameter()]
    [switch]$AutoCommit,

    [Parameter()]
    [switch]$SkipGitChecks,

    [Parameter()]
    [switch]$SkipGitHub,

    [Parameter()]
    [switch]$SkipGitTagPush
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message"
}

function Write-Warn {
    param([string]$Message)
    Write-Warning $Message
}

function Write-ErrorAndExit {
    param([string]$Message)
    Write-Error $Message
    Exit 1
}

function Run-Command {
    param(
        [Parameter(Mandatory = $true)] [string]$Command,
        [string]$WorkingDirectory
    )

    if ($WorkingDirectory) {
        Push-Location $WorkingDirectory
    }

    try {
        Write-Info "Running: $Command"
        Invoke-Expression $Command
    }
    finally {
        if ($WorkingDirectory) {
            Pop-Location
        }
    }
}

function Ensure-Tool {
    param(
        [Parameter(Mandatory = $true)] [string]$ToolName
    )

    $command = Get-Command $ToolName -ErrorAction SilentlyContinue
    if (-not $command) {
        Write-ErrorAndExit "Required tool '$ToolName' is not available in PATH."
    }
    return $command.Source
}

function Get-GitOutput {
    param([string[]]$Arguments)
    $git = Ensure-Tool git
    $quotedArgs = $Arguments | ForEach-Object {
        if ($_ -match '\s') {
            '"{0}"' -f $_
        }
        else {
            $_
        }
    }
    $psi = [System.Diagnostics.ProcessStartInfo]::new($git, $quotedArgs -join ' ')
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $process = [System.Diagnostics.Process]::Start($psi)
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    if ($process.ExitCode -ne 0) {
        Write-ErrorAndExit "Git command failed: git $($quotedArgs -join ' ')`n$stderr"
    }

    return $stdout.TrimEnd()
}

function Ensure-CleanGitState {
    $status = Get-GitOutput -Arguments @('status', '--porcelain')
    if ($status -ne '') {
        if (-not $AutoCommit) {
            Write-Warn "Git working tree is not clean. Commit or stash changes before publishing.`n$status"
            return
        }

        Write-Info 'Git working tree contains changes. Auto-commit is enabled.'
    }
}

function Commit-VersionUpdateIfNeeded {
    $changes = Get-GitOutput -Arguments @('status', '--porcelain')
    if ($changes -eq '') {
        Write-Info 'No workspace changes detected after version update.'
        return
    }

    if (-not $AutoCommit) {
        Write-Warn "Version updates produced changes. Commit the version bump manually before publishing, or rerun with -AutoCommit.`n$changes"
        return
    }

    Write-Info 'Staging version update changes...'
    & git add -A
    $diffExitCode = 0
    & git diff --cached --quiet
    $diffExitCode = $LASTEXITCODE

    if ($diffExitCode -eq 0) {
        Write-Info 'No staged changes found after update. Nothing to commit.'
        return
    }

    Write-Info "Committing version update as 'Release v$Version'..."
    & git commit -m "Release v$Version"
}

function Ensure-PathExists {
    param(
        [Parameter(Mandatory = $true)] [string]$Path,
        [string]$Message
    )

    if (-not (Test-Path $Path)) {
        Write-ErrorAndExit $Message
    }
}

function Get-PreviousTagNotes {
    try {
        $previousTag = Get-GitOutput -Arguments @('describe', '--tags', '--abbrev=0', 'HEAD^')
        if ($previousTag) {
            return Get-GitOutput -Arguments @('log', '--pretty=format:- %s', "$previousTag..HEAD")
        }
    }
    catch {
        # ignore; will fallback to newest commits
    }

    return Get-GitOutput -Arguments @('log', '--pretty=format:- %s', '-n', '20')
}

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Resolve-Path $ScriptRoot | Select-Object -ExpandProperty Path
if (-not $Root) { $Root = $ScriptRoot }

$FrontendDir = Join-Path $Root 'frontend'
$ElectronDir = Join-Path $Root 'electron'
$BackendDir = Join-Path $Root 'backend'
$DistDir = Join-Path $Root 'dist-electron'
$BackendDistDir = Join-Path $ElectronDir 'backend-dist\IStoreBackend'
$PythonVenv = Join-Path $Root '.venv\Scripts\python.exe'
$PythonExe = if (Test-Path $PythonVenv) { $PythonVenv } elseif (Get-Command python -ErrorAction SilentlyContinue) { (Get-Command python).Source } else { $null }

$ReleaseTag = "v$Version"
$InstallerName = "I-Store-ERP-Setup-$Version.exe"
$InstallerPath = Join-Path $DistDir $InstallerName
$LatestYamlPath = Join-Path $DistDir 'latest.yml'
$BlockmapPattern = "I-Store-ERP-Setup-$Version.exe.blockmap"
$ReleaseNotesFile = Join-Path $Root "release-notes-$Version.md"
$ChecksumFile = Join-Path $Root "release-checksums-$Version.txt"

Write-Host "==============================================="
Write-Host " iStore Release Automation"
Write-Host " Version: $Version"
Write-Host " Root:    $Root"
Write-Host "===============================================`n"

Ensure-Tool git | Out-Null
Ensure-Tool npm | Out-Null
if (-not $SkipGitHub) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Warn "GitHub CLI 'gh' was not found. Releases will not be published. Install 'gh' and authenticate with 'gh auth login', or rerun with -SkipGitHub."
        $SkipGitHub = $true
    }
}
else {
    Write-Warn 'Skipping GitHub CLI validation and release upload because -SkipGitHub is set.'
}
if (-not $PythonExe) {
    Write-ErrorAndExit 'Python executable not found. Install Python or create .venv in the repository root.'
}

if (-not $SkipGitChecks) {
    Write-Info 'Checking git status...'
    Push-Location $Root
    try {
        Ensure-CleanGitState
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Warn 'Skipping git status checks because -SkipGitChecks is set.'
}

Write-Info 'Updating application version numbers...'
$UpdateScript = Join-Path $ElectronDir 'scripts\update-version.ps1'
Ensure-PathExists $UpdateScript "Version updater script not found: $UpdateScript"
Ensure-PathExists (Join-Path $ElectronDir 'package.json') "Electron package.json not found."
Ensure-PathExists (Join-Path $FrontendDir 'package.json') "Frontend package.json not found."
Ensure-PathExists (Join-Path $ElectronDir 'installer.iss') "Installer script not found: electron\installer.iss"

& powershell -NoProfile -ExecutionPolicy Bypass -File `"$UpdateScript`" -Version `"$Version`" -ElectronPkg `"$ElectronDir\package.json`" -FrontendPkg `"$FrontendDir\package.json`" -IssFile `"$ElectronDir\installer.iss`"

if (-not $SkipGitChecks) {
    Commit-VersionUpdateIfNeeded
}
else {
    Write-Warn 'Skipping git commit operations because -SkipGitChecks is set.'
}

Write-Info 'Running backend tests...'
if (-not (Test-Path $BackendDir)) {
    Write-ErrorAndExit 'Backend directory not found.'
}
Push-Location $BackendDir
try {
    & "$PythonExe" -m pytest -q
}
finally {
    Pop-Location
}

Write-Info 'Building frontend...'
Ensure-PathExists (Join-Path $FrontendDir 'package.json') "Frontend package.json not found."
Push-Location $FrontendDir
try {
    if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
        Write-Info 'Installing frontend dependencies...'
        npm ci
    }
    npm run build
}
finally {
    Pop-Location
}

Write-Info 'Preparing electron frontend bundle...'
$ElectronFrontendDist = Join-Path $ElectronDir 'frontend-dist'
if (Test-Path $ElectronFrontendDist) {
    Remove-Item -Force -Recurse $ElectronFrontendDist
}

Copy-Item -Path (Join-Path $FrontendDir 'dist') -Destination $ElectronFrontendDist -Recurse

Write-Info 'Building FastAPI backend executable...'
if (-not (Test-Path $PythonExe)) {
    Write-ErrorAndExit 'Python executable not found for backend packaging.'
}

if (Test-Path (Join-Path $ElectronDir 'backend-dist\IStoreBackend')) {
    Remove-Item -Force -Recurse (Join-Path $ElectronDir 'backend-dist\IStoreBackend')
}
if (Test-Path (Join-Path $ElectronDir 'build-backend')) {
    Remove-Item -Force -Recurse (Join-Path $ElectronDir 'build-backend')
}

Push-Location $Root
try {
    & "$PythonExe" -m PyInstaller --noconfirm --clean --onedir --name IStoreBackend --distpath "$ElectronDir\backend-dist" --workpath "$ElectronDir\build-backend" --specpath "$ElectronDir\build-backend" --paths "$BackendDir" --hidden-import app.main --collect-all certifi --collect-all passlib --collect-submodules app --collect-data app "$BackendDir\desktop_server.py"
}
finally {
    Pop-Location
}

Write-Info 'Packaging Electron installer...'
Push-Location $ElectronDir
try {
    if (-not (Test-Path (Join-Path $ElectronDir 'node_modules'))) {
        Write-Info 'Installing electron dependencies...'
        npm ci
    }
    npm run dist
}
finally {
    Pop-Location
}

Write-Info 'Validating release artifacts...'
Ensure-PathExists $InstallerPath "Installer file not found: $InstallerPath"
Ensure-PathExists $LatestYamlPath "Update metadata not found: $LatestYamlPath"

$blockmapFiles = Get-ChildItem -Path $DistDir -Filter '*.blockmap' -File -ErrorAction SilentlyContinue
if (-not $blockmapFiles -or $blockmapFiles.Count -eq 0) {
    Write-ErrorAndExit 'No .blockmap files were generated in the release directory.'
}

if (-not (Test-Path $BackendDistDir)) {
    Write-ErrorAndExit "Backend executable bundle not found: $BackendDistDir"
}

Write-Info 'Computing SHA256 checksums for release artifacts...'
$artifactFiles = @($InstallerPath, $LatestYamlPath) + ($blockmapFiles | ForEach-Object { $_.FullName })
$checksumLines = @()
foreach ($file in $artifactFiles) {
    $hash = Get-FileHash -Algorithm SHA256 -Path $file
    $checksumLines += "$($hash.Hash)  $file"
}
$checksumLines | Set-Content -Path $ChecksumFile -Encoding UTF8
$checksumLines | ForEach-Object { Write-Host $_ }

Write-Info 'Generating release notes...'
$releaseNotes = @()
$releaseNotes += "# iStore ERP $ReleaseTag Release Notes"
$releaseNotes += ''
$releaseNotes += "**Built on:** $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$releaseNotes += ''
$releaseNotes += '## Changes'
$releaseNotes += Get-PreviousTagNotes
$releaseNotes | Set-Content -Path $ReleaseNotesFile -Encoding UTF8

if (-not $SkipGitTagPush) {
    Write-Info 'Creating git tag and pushing changes...'
    Push-Location $Root
    try {
        & git rev-parse -q --verify "refs/tags/$ReleaseTag" 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Tag $ReleaseTag already exists. Reusing it."
        }
        else {
            & git tag -a $ReleaseTag -m "iStore ERP $ReleaseTag"
            if ($LASTEXITCODE -ne 0) {
                Write-ErrorAndExit "Failed to create git tag $ReleaseTag."
            }
        }

        & git push origin HEAD
        if ($LASTEXITCODE -ne 0) {
            Write-ErrorAndExit 'Failed to push commits to origin.'
        }

        & git push origin $ReleaseTag
        if ($LASTEXITCODE -ne 0) {
            Write-ErrorAndExit "Failed to push tag $ReleaseTag to origin."
        }
    }
    finally {
        Pop-Location
    }
}
else {
    Write-Warn 'Skipping git tag and push operations because -SkipGitTagPush is set.'
}

if (-not $SkipGitHub) {
    Write-Info 'Creating GitHub release with artifacts...'
    $artifactPaths = $artifactFiles
    if (-not $artifactPaths) {
        Write-ErrorAndExit 'No artifacts available to upload to GitHub release.'
    }

    try {
        $releaseViewOutput = & gh release view $ReleaseTag 2>&1 | Out-String
        $releaseViewExitCode = $LASTEXITCODE
    }
    catch {
        $releaseViewOutput = $_ | Out-String
        $releaseViewExitCode = 1
    }

    if ($releaseViewExitCode -eq 0) {
        Write-Info "Release $ReleaseTag already exists. Uploading artifacts to existing release..."
        & gh release upload $ReleaseTag $artifactPaths --clobber
        if ($LASTEXITCODE -ne 0) {
            Write-ErrorAndExit "Failed to upload artifacts to release $ReleaseTag."
        }

        & gh release edit $ReleaseTag --notes-file $ReleaseNotesFile --title "I-Store ERP $ReleaseTag"
        if ($LASTEXITCODE -ne 0) {
            Write-ErrorAndExit "Failed to update release notes for $ReleaseTag."
        }
    }
    elseif ($releaseViewOutput -match 'not found|release not found') {
        Write-Info "Creating new release $ReleaseTag..."
        & gh release create $ReleaseTag $artifactPaths --notes-file $ReleaseNotesFile --title "I-Store ERP $ReleaseTag"
        if ($LASTEXITCODE -ne 0) {
            Write-ErrorAndExit "Failed to create GitHub release $ReleaseTag."
        }
    }
    else {
        Write-ErrorAndExit "Failed to query GitHub release $ReleaseTag.`n$releaseViewOutput"
    }
}
else {
    Write-Warn 'Skipping GitHub release creation because -SkipGitHub is set.'
}

Write-Host '==============================================='
Write-Host "Release $ReleaseTag completed successfully."
Write-Host "Installer: $InstallerPath"
Write-Host "Release notes: $ReleaseNotesFile"
Write-Host "Checksum file: $ChecksumFile"
Write-Host '==============================================='
