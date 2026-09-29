@echo off
title Build LUMORA Launcher
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
call npm run dist
echo.
echo The packaged Windows builds are in the dist folder.
pause
