param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$PfxPath,
    [Parameter(Mandatory = $true)][string]$Password,
    [int]$MaxAttempts = 15
)

$securePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText
$certificate = Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation Cert:\CurrentUser\My -Password $securePassword

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
        Set-AuthenticodeSignature -FilePath $FilePath -Certificate $certificate -ErrorAction Stop | Out-Null
        Write-Host "Signed: $FilePath"
        exit 0
    } catch {
        if ($attempt -eq $MaxAttempts) { throw }
        Start-Sleep -Seconds 2
    }
}
