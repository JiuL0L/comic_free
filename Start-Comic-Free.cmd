@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Comic Free needs Node.js 26.x on PATH. Install it separately, then run this file again.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo Comic Free needs pnpm 10.x on PATH. Install it separately, then run this file again.
  pause
  exit /b 1
)

node --import tsx scripts\launch-reader.ts
set "COMIC_FREE_EXIT=%ERRORLEVEL%"
if not "%COMIC_FREE_EXIT%"=="0" pause
endlocal & exit /b %COMIC_FREE_EXIT%
