# ============================================================
#  I-STORE ERP — Development Launcher with Live Diagnostics
#  Starts: Database → Backend (FastAPI :8000) → Frontend (Vite :5173)
#  Shows a live status dashboard in the console.
# ============================================================

param(
    [switch]$SkipFrontend,
    [switch]$SkipElectron,
    [switch]$NoBrowser
)

$ROOT          = $PSScriptRoot
$BACKEND_PORT  = 8000
$FRONTEND_PORT = 5173
$DB_PATH       = Join-Path $ROOT "database\istore.db"
$ENV_FILE      = Join-Path $ROOT ".env"
$VENV_PYTHON   = Join-Path $ROOT ".venv\Scripts\python.exe"
$HEALTH_URL    = "http://127.0.0.1:$BACKEND_PORT/health"
$FRONTEND_URL  = "http://127.0.0.1:$FRONTEND_PORT"

# ── Colour helpers ────────────────────────────────────────────────────────────
function Write-Banner {
    Clear-Host
    $ts = Get-Date -Format "HH:mm:ss"
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "  ║        I-STORE ERP  v3.0  —  Dev Launcher  $ts       ║" -ForegroundColor Cyan
    Write-Host "  ╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Icon, [string]$Label, [string]$Value = "", [string]$Color = "White")
    $line = "  $Icon  $Label"
    if ($Value) { $line += "  →  $Value" }
    Write-Host $line -ForegroundColor $Color
}

function Write-Divider { Write-Host "  ──────────────────────────────────────────────────────────" -ForegroundColor DarkGray }

function Write-StatusPanel {
    param([hashtable]$Status)
    Write-Host ""
    Write-Host "  ┌─── LIVE STATUS ───────────────────────────────────────────┐" -ForegroundColor DarkCyan
    foreach ($svc in @("Database", "Backend", "Frontend", "WhatsApp")) {
        $s = $Status[$svc]
        $icon  = if ($s.Ok) { "✓" } else { "✗" }
        $color = if ($s.Ok) { "Green" } else { "Red" }
        $msg   = "  │  $icon  $svc".PadRight(28) + $s.Msg
        Write-Host $msg -ForegroundColor $color
    }
    Write-Host "  └──────────────────────────────────────────────────────────┘" -ForegroundColor DarkCyan
    Write-Host ""
}

# ── Utility: check if a TCP port is listening ─────────────────────────────────
function Test-Port {
    param([int]$Port)
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

# ── Utility: HTTP health check ────────────────────────────────────────────────
function Test-Http {
    param([string]$Url, [int]$TimeoutSec = 3)
    try {
        $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSec -ErrorAction Stop
        return $r.StatusCode -lt 400
    } catch { return $false }
}

# ── Utility: wait for a port to open (with timeout) ───────────────────────────
function Wait-ForPort {
    param([int]$Port, [int]$Seconds = 30, [string]$Label = "service")
    $elapsed = 0
    Write-Host "    Waiting for $Label on :$Port " -NoNewline -ForegroundColor Yellow
    while (-not (Test-Port $Port) -and $elapsed -lt $Seconds) {
        Start-Sleep 1
        $elapsed++
        Write-Host "." -NoNewline -ForegroundColor DarkYellow
    }
    if (Test-Port $Port) {
        Write-Host " OK ($elapsed s)" -ForegroundColor Green
        return $true
    } else {
        Write-Host " TIMEOUT" -ForegroundColor Red
        return $false
    }
}

# ─────────────────────────────────────────────────────────────────────────────
#  DIAGNOSTICS
# ─────────────────────────────────────────────────────────────────────────────
Write-Banner
Write-Host "  Running pre-launch diagnostics..." -ForegroundColor Cyan
Write-Divider
Write-Host ""

$status = @{
    Database = @{ Ok = $false; Msg = "checking..." }
    Backend  = @{ Ok = $false; Msg = "not started" }
    Frontend = @{ Ok = $false; Msg = "not started" }
}

# ── [1] Python virtual environment ────────────────────────────────────────────
Write-Step "🐍" "Python venv"
if (-not (Test-Path $VENV_PYTHON)) {
    Write-Step "  ✗" "Virtual environment not found at .venv\" "" "Red"
    Write-Host "    Run: python -m venv .venv  &&  .venv\Scripts\pip install -r backend\requirements.txt" -ForegroundColor Yellow
    exit 1
}
$pyVer = & $VENV_PYTHON --version 2>&1
Write-Step "  ✓" "Found" $pyVer "Green"

# ── [2] .env file ─────────────────────────────────────────────────────────────
Write-Step "🔑" ".env file"
if (-not (Test-Path $ENV_FILE)) {
    Write-Step "  ✗" ".env not found — creating from template" "" "Yellow"
    Copy-Item (Join-Path $ROOT ".env.example") $ENV_FILE -ErrorAction SilentlyContinue
} else {
    Write-Step "  ✓" "Present" $ENV_FILE "Green"
}

# Check SECRET_KEY
$secretKey = (Get-Content $ENV_FILE | Select-String "^SECRET_KEY=" | ForEach-Object { $_ -replace "SECRET_KEY=","" })
if (-not $secretKey -or $secretKey -eq "change-this-secret" -or $secretKey.Length -lt 32) {
    Write-Step "  ⚠" "SECRET_KEY is weak or default — generating one" "" "Yellow"
    $newKey = "istore-dev-" + ([System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24)))
    (Get-Content $ENV_FILE) -replace "^SECRET_KEY=.*", "SECRET_KEY=$newKey" | Set-Content $ENV_FILE
    Write-Step "  ✓" "Generated new SECRET_KEY" "(saved to .env)" "Green"
} else {
    Write-Step "  ✓" "SECRET_KEY" "OK ($($secretKey.Length) chars)" "Green"
}

# ── [3] Database file ─────────────────────────────────────────────────────────
Write-Host ""
Write-Step "🗄" "Database" $DB_PATH
if (-not (Test-Path $DB_PATH)) {
    Write-Step "  ⚠" "database\istore.db not found — will be created on first run" "" "Yellow"
    New-Item -ItemType Directory -Path (Join-Path $ROOT "database") -Force | Out-Null
    $status.Database = @{ Ok = $true; Msg = "will be auto-created" }
} else {
    # Validate SQLite magic bytes — use a shared FileStream so a locked DB isn't misread as corrupt
    $dbSize = [math]::Round((Get-Item $DB_PATH).Length / 1KB, 1)
    $magic  = $null
    try {
        $fs    = [System.IO.File]::Open($DB_PATH, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $slice = [byte[]]::new(16)
        $read  = $fs.Read($slice, 0, 16)
        $fs.Close()
        if ($read -gt 0) { $magic = [System.Text.Encoding]::ASCII.GetString($slice) }
    } catch {
        # File is locked by another process — treat as valid (it's in use, not corrupt)
        $magic = "SQLite format 3"
        Write-Step "  ℹ" "Database in use by another process — skipping integrity check" "" "Cyan"
    }

    if ($magic -like "SQLite format 3*") {
        Write-Step "  ✓" "Valid SQLite database" "$($dbSize) KB" "Green"
        $status.Database = @{ Ok = $true; Msg = "OK  —  $($dbSize) KB  —  $DB_PATH" }
    } else {
        Write-Step "  ✗" "CORRUPT database file detected!" $DB_PATH "Red"
        Write-Step "  ⚠" "Renaming corrupt file and starting fresh..." "" "Yellow"
        $backupName = "database\istore.db.corrupt." + (Get-Date -Format "yyyyMMdd_HHmmss")
        if (Test-Path $DB_PATH) { Copy-Item $DB_PATH $backupName -Force -ErrorAction SilentlyContinue }
        $status.Database = @{ Ok = $true; Msg = "corrupt file backed up — fresh DB will be created" }
    }
}

# ── [4] Backend (FastAPI) ─────────────────────────────────────────────────────
Write-Host ""
Write-Step "⚙" "Backend — FastAPI / Uvicorn"
if (Test-Port $BACKEND_PORT) {
    Write-Step "  ↺" "Already running on :$BACKEND_PORT" "" "Yellow"
    $backendOk = Test-Http $HEALTH_URL
    if ($backendOk) {
        Write-Step "  ✓" "Health check passed" $HEALTH_URL "Green"
        $status.Backend = @{ Ok = $true; Msg = "already running  →  $HEALTH_URL" }
    } else {
        Write-Step "  ⚠" "Port open but /health returned error — recheck manually" "" "Yellow"
        $status.Backend = @{ Ok = $false; Msg = "port open, /health failed" }
    }
} else {
    Write-Step "  ▶" "Starting backend..." "" "Cyan"

    $backendCmd = @"
Set-Location '$ROOT'
`$env:PYTHONPATH = '$ROOT\backend'
Get-Content '$ENV_FILE' | ForEach-Object {
    if (`$_ -match '^([^#=]+)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable(`$Matches[1].Trim(), `$Matches[2].Trim(), 'Process')
    }
}
& '$VENV_PYTHON' -m uvicorn app.main:app --reload --host 127.0.0.1 --port $BACKEND_PORT
"@

    Start-Process powershell -ArgumentList "-NoExit", "-NoProfile", "-Command", $backendCmd `
        -WindowStyle Normal

    $backendOk = Wait-ForPort -Port $BACKEND_PORT -Seconds 30 -Label "Backend"
    if ($backendOk) {
        Start-Sleep 1
        $healthy = Test-Http $HEALTH_URL
        if ($healthy) {
            $status.Backend = @{ Ok = $true; Msg = "running  →  $HEALTH_URL" }
        } else {
            $status.Backend = @{ Ok = $true; Msg = "running (no /health endpoint yet)  →  http://127.0.0.1:$BACKEND_PORT" }
        }
    } else {
        $status.Backend = @{ Ok = $false; Msg = "failed to start — check backend window for errors" }
    }
}

# ── [5] Frontend (Vite) ───────────────────────────────────────────────────────
Write-Host ""
Write-Step "🌐" "Frontend — Vite / React"
if ($SkipFrontend) {
    Write-Step "  -" "Skipped (--SkipFrontend)" "" "DarkGray"
    $status.Frontend = @{ Ok = $true; Msg = "skipped" }
} elseif (Test-Port $FRONTEND_PORT) {
    Write-Step "  ↺" "Already running on :$FRONTEND_PORT" "" "Yellow"
    $status.Frontend = @{ Ok = $true; Msg = "already running  →  $FRONTEND_URL" }
} else {
    Write-Step "  ▶" "Starting frontend..." "" "Cyan"

    $frontendCmd = "Set-Location '$ROOT\frontend'; npm run dev -- --host 127.0.0.1 --port $FRONTEND_PORT --strictPort"
    Start-Process powershell -ArgumentList "-NoExit", "-NoProfile", "-Command", $frontendCmd `
        -WindowStyle Normal

    $frontendOk = Wait-ForPort -Port $FRONTEND_PORT -Seconds 40 -Label "Frontend"
    if ($frontendOk) {
        $status.Frontend = @{ Ok = $true; Msg = "running  →  $FRONTEND_URL" }
    } else {
        $status.Frontend = @{ Ok = $false; Msg = "failed to start — check frontend window for errors" }
    }
}

# ── [5.5] WhatsApp Microservice ───────────────────────────────────────────────
$WHATSAPP_PORT = 3001
$WHATSAPP_DIR  = Join-Path $ROOT "whatsapp_service"
Write-Host ""
Write-Step "💬" "WhatsApp Service — Node.js / Puppeteer"
if (Test-Port $WHATSAPP_PORT) {
    Write-Step "  ↺" "Already running on :$WHATSAPP_PORT" "" "Yellow"
    $status.WhatsApp = @{ Ok = $true; Msg = "already running  →  http://127.0.0.1:$WHATSAPP_PORT" }
} else {
    Write-Step "  ▶" "Starting WhatsApp service..." "" "Cyan"

    $whatsappCmd = "Set-Location '$WHATSAPP_DIR'; node server.js"
    Start-Process powershell -ArgumentList "-NoExit", "-NoProfile", "-Command", $whatsappCmd `
        -WindowStyle Normal

    $waOk = Wait-ForPort -Port $WHATSAPP_PORT -Seconds 20 -Label "WhatsApp Service"
    if ($waOk) {
        $status.WhatsApp = @{ Ok = $true; Msg = "running  →  http://127.0.0.1:$WHATSAPP_PORT" }
    } else {
        $status.WhatsApp = @{ Ok = $false; Msg = "failed to start" }
    }
}

# ── [6] Final status panel ────────────────────────────────────────────────────
Write-Banner
Write-Divider
Write-StatusPanel -Status $status
Write-Divider

$allOk = $status.Database.Ok -and $status.Backend.Ok -and $status.Frontend.Ok

if ($allOk) {
    Write-Host "  ✅  All services running successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "    🌐  Frontend  →  $FRONTEND_URL" -ForegroundColor Cyan
    Write-Host "    ⚙   Backend   →  http://127.0.0.1:$BACKEND_PORT" -ForegroundColor Cyan
    Write-Host "    📋  API Docs  →  http://127.0.0.1:$BACKEND_PORT/docs" -ForegroundColor Cyan
    Write-Host "    🗄   Database  →  $DB_PATH" -ForegroundColor Cyan
    Write-Host ""
    if (-not $NoBrowser) {
        Write-Host "  Opening browser..." -ForegroundColor DarkGray
        Start-Process $FRONTEND_URL
    }
} else {
    Write-Host "  ⚠   One or more services failed to start. Check the windows above." -ForegroundColor Yellow
    Write-Host ""
    foreach ($svc in @("Database", "Backend", "Frontend")) {
        if (-not $status[$svc].Ok) {
            Write-Host "    ✗  $svc — $($status[$svc].Msg)" -ForegroundColor Red
        }
    }
    Write-Host ""
}

Write-Divider
Write-Host "  Press any key to close this launcher (services keep running)..." -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
