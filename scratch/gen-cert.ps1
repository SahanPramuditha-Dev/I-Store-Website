$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=I-Store ERP Dev' -CertStoreLocation 'Cert:\CurrentUser\My'
Write-Host "Created certificate: $($cert.Thumbprint)"

$certDir = ".\electron\certs"
if (-not (Test-Path $certDir)) {
    New-Item -ItemType Directory -Path $certDir -Force
}

$pfxPath = ".\electron\certs\dev-cert.pfx"
$pwd = ConvertTo-SecureString -String "123456" -Force -AsPlainText

Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $pwd
Write-Host "Exported PFX to: $pfxPath"

# Import into Trusted Root & Trusted Publisher for local machine trust
$storeRoot = New-Object System.Security.Cryptography.X509Certificates.X509Store("Root", "CurrentUser")
$storeRoot.Open("ReadWrite")
$storeRoot.Add($cert)
$storeRoot.Close()

$storePub = New-Object System.Security.Cryptography.X509Certificates.X509Store("TrustedPublisher", "CurrentUser")
$storePub.Open("ReadWrite")
$storePub.Add($cert)
$storePub.Close()

Write-Host "Self-signed certificate created & trusted successfully."
