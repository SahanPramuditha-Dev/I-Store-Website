$ROOT = $PSScriptRoot

function Test-PortListening {
    param([int]$Port)
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Test-FrontendApp {
    param([string]$Url = "http://127.0.0.1:5173/")
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
        return ($response.Content -like '*data-istore-app="frontend"*' -or $response.Content -like '*<title>iStore OS</title>*')
    }
    catch {
        return $false
    }
}

Write-Host "Starting I Store website..." -ForegroundColor Cyan

$backendCmd = @"
cd '$ROOT\backend';
if (Test-Path '.\.venv\Scripts\activate') { .\.venv\Scripts\activate }
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
"@

if (Test-PortListening -Port 8000) {
    Write-Host "Backend already running on http://127.0.0.1:8000" -ForegroundColor Yellow
}
else {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd
}

if (Test-PortListening -Port 5173 -and (Test-FrontendApp -Url "http://127.0.0.1:5173/")) {
    Write-Host "Frontend already running on http://127.0.0.1:5173" -ForegroundColor Yellow
}
else {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$ROOT\frontend'; npm run dev -- --host 127.0.0.1 --port 5173 --strictPort"
}

Write-Host "Website URL: http://127.0.0.1:5173" -ForegroundColor Green
Write-Host "Backend URL:  http://127.0.0.1:8000" -ForegroundColor Green
