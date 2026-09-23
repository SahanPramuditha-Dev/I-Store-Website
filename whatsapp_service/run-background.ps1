$ErrorActionPreference = 'Stop'
$senderRoot = $PSScriptRoot
$taskMutex = [System.Threading.Mutex]::new($false, 'Local\IStoreWhatsAppPortalSender')
if (!$taskMutex.WaitOne(0)) { exit 0 }
try {
    # Respect an already running sender, including one started manually by POS.
    if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { exit 0 }
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    $logDir = Join-Path $senderRoot 'logs'
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    $stdout = Join-Path $logDir 'sender.log'
    $stderr = Join-Path $logDir 'sender-error.log'
    # One previous run retained; no unbounded accumulation of run logs.
    foreach ($logPath in @($stdout, $stderr)) {
        if (Test-Path -LiteralPath $logPath) { Move-Item -LiteralPath $logPath -Destination ($logPath + '.previous') -Force }
    }
    for ($attempt = 0; $attempt -lt 4; $attempt++) {
        $process = Start-Process -FilePath $nodePath -ArgumentList @('--use-system-ca','--max-old-space-size=256','--expose-gc','server.js') -WorkingDirectory $senderRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
        $process.WaitForExit()
        $process.Refresh()
        if ($process.ExitCode -eq 0) { exit 0 }
        # Restart only the child we launched, never a different listener/process.
        if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { exit 1 }
        if ($attempt -lt 3) { Start-Sleep -Seconds ([Math]::Min(60,15 * [Math]::Pow(2,$attempt))) }
    }
    exit 1 # Task Scheduler also has bounded restart-on-failure settings.
} finally {
    $taskMutex.ReleaseMutex()
    $taskMutex.Dispose()
}
