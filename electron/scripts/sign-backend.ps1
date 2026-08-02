param(
    [Parameter(Mandatory = $true)][string]$BackendDirectory,
    [Parameter(Mandatory = $true)][string]$PfxPath,
    [Parameter(Mandatory = $true)][string]$Password
)

$signer = Join-Path $PSScriptRoot "sign-file.ps1"
Get-ChildItem -Path $BackendDirectory -Filter "*.exe" -File -Recurse | ForEach-Object {
    & $signer -FilePath $_.FullName -PfxPath $PfxPath -Password $Password
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
