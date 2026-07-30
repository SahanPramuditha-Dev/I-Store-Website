@echo off
setlocal EnableDelayedExpansion
title I-Store ERP — Dev Launcher

:: ============================================================
::  I-STORE ERP — Development Launcher with Diagnostics
::  Starts: Database check → Backend (FastAPI) → Frontend (Vite)
::  Shows real-time status panel in the console window
:: ============================================================

color 0A
cls

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║         I-STORE ERP  —  Development Launcher        ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

powershell -ExecutionPolicy Bypass -File "%~dp0start_dev.ps1"

if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo.
    echo  [ERROR] Launcher encountered errors. See above for details.
    echo.
    pause
    exit /b 1
)
