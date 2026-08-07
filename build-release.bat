@echo off
setlocal enabledelayedexpansion
title I-Store ERP - Release Builder
echo.
echo =============================================
echo   I-Store ERP - Release Builder
echo =============================================
echo.
set /p VERSION=Enter version number (e.g. 1.2.0): 
if "%VERSION%"=="" (
    echo ERROR: No version entered. Exiting.
    pause
    exit /b 1
)
echo.
echo Building I-Store ERP v%VERSION% ...
echo ---------------------------------------------
echo.

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "FRONTEND=%ROOT%\frontend"
set "ELECTRON=%ROOT%\electron"
set "DIST=%ROOT%\dist-electron"
set "UPDATER=%ELECTRON%\scripts\update-version.ps1"
set "PYTHON=%ROOT%\.venv\Scripts\python.exe"
set "ELECTRON_BUILDER_CACHE=%ROOT%\.cache\electron-builder"
set "PUBLISH_ARG=--publish never"
if /i "%PUBLISH_GITHUB%"=="1" set "PUBLISH_ARG=--publish always"

echo [1/5] Updating version numbers to v%VERSION%...
powershell -NoProfile -ExecutionPolicy Bypass -File "%UPDATER%" -Version "%VERSION%" -ElectronPkg "%ELECTRON%\package.json" -FrontendPkg "%FRONTEND%\package.json" -IssFile "%ELECTRON%\installer.iss"
if !errorlevel! neq 0 (
    echo ERROR: Version update failed!
    pause
    exit /b 1
)
echo.

echo [2/5] Building React frontend (Vite)...
cd /d "%FRONTEND%"
call npm run build
if !errorlevel! neq 0 (
    echo ERROR: Frontend build failed!
    pause
    exit /b 1
)
echo     OK - Frontend built.
echo.

echo [3/5] Copying frontend dist to electron/frontend-dist...
if exist "%ELECTRON%\frontend-dist" rd /s /q "%ELECTRON%\frontend-dist"
xcopy /E /I /Y "%FRONTEND%\dist" "%ELECTRON%\frontend-dist" >nul
if !errorlevel! neq 0 (
    echo ERROR: Failed to copy frontend dist files.
    pause
    exit /b 1
)
echo     OK - Copied.
echo.

echo [4/5] Building the local backend service...
echo     Cleaning stale backend process and bundle...
powershell -NoProfile -Command "if (Get-Process -Name IStoreBackend -ErrorAction SilentlyContinue) { Get-Process -Name IStoreBackend -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }; if (Test-Path '%ELECTRON%\\backend-dist\\IStoreBackend') { Remove-Item -LiteralPath '%ELECTRON%\\backend-dist\\IStoreBackend' -Recurse -Force -ErrorAction SilentlyContinue }; if (Test-Path '%ELECTRON%\\build-backend\\IStoreBackend') { Remove-Item -LiteralPath '%ELECTRON%\\build-backend\\IStoreBackend' -Recurse -Force -ErrorAction SilentlyContinue }"
if not exist "%PYTHON%" (
    echo ERROR: Python virtual environment not found: %PYTHON%
    echo Run: .venv\Scripts\pip install -r backend\requirements.txt
    pause
    exit /b 1
)
cd /d "%ROOT%"
call "%PYTHON%" -m PyInstaller --noconfirm --clean --onedir --name IStoreBackend --distpath "%ELECTRON%\backend-dist" --workpath "%ELECTRON%\build-backend" --specpath "%ELECTRON%\build-backend" --paths "%ROOT%\backend" --hidden-import app.main --collect-all certifi --collect-all passlib --collect-submodules app --collect-data app "%ROOT%\backend\desktop_server.py"
if !errorlevel! neq 0 (
    echo ERROR: Backend packaging failed!
    pause
    exit /b 1
)
echo     OK - Local backend bundled.
echo.

echo [5/5] Packaging NSIS installer and update metadata...
if exist "%DIST%\*.nsis.7z" (
    echo     Removing stale NSIS archive artifacts...
    del /q "%DIST%\*.nsis.7z"
)
cd /d "%ELECTRON%"
call npx electron-builder --win nsis %PUBLISH_ARG%
if !errorlevel! neq 0 (
    echo ERROR: Electron release packaging failed!
    pause
    exit /b 1
)
echo     OK - Installer, latest.yml, and blockmap created.

echo.
echo Publishing release v%VERSION% to GitHub Releases...
where gh >nul 2>nul
if !errorlevel! == 0 (
    call gh release create v%VERSION% "%DIST%\I-Store-ERP-Setup-%VERSION%.exe" "%DIST%\I-Store-ERP-Setup-%VERSION%.exe.blockmap" "%DIST%\latest.yml" --title "v%VERSION%" --notes "Release v%VERSION%"
    if !errorlevel! == 0 (
        echo     OK - GitHub Release v%VERSION% published automatically!
    ) else (
        echo     WARNING: GitHub release creation via gh CLI failed. You can upload files manually from %DIST%.
    )
) else (
    echo     NOTE: gh CLI not logged in/found. Upload Setup .exe, .exe.blockmap, and latest.yml from %DIST% to GitHub Release v%VERSION%.
)

echo.
echo Unblocking output binaries...
powershell -NoProfile -Command "Get-ChildItem -Path '%DIST%' -Recurse -File | Unblock-File -ErrorAction SilentlyContinue"
echo.
echo =============================================
echo   BUILD COMPLETE - v%VERSION%
echo =============================================
echo Output: %DIST%
echo.
set /p OPEN=Open output folder? (Y/N): 
if /i "%OPEN%"=="Y" explorer "%DIST%"
echo.
echo Done! Press any key to exit.
pause >nul
