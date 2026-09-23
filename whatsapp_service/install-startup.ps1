$ErrorActionPreference = 'Stop'
$runner = Join-Path $PSScriptRoot 'run-background.ps1'
if (!(Test-Path -LiteralPath $runner)) { throw 'Background runner missing' }
$taskName = 'IStore-WhatsApp-Portal'
$userName = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $runner + '"') -WorkingDirectory $PSScriptRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userName
$principal = New-ScheduledTaskPrincipal -UserId $userName -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.Arguments -notlike ('*' + $runner + '*')) { throw 'A different task already uses this name; not replacing it' }
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'PC WhatsApp sender and outbound Cloudflare portal bridge; no paid hosting.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'WhatsApp sender registered for this user at Windows sign-in and started.'
