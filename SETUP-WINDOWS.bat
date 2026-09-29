@echo off
title LUMORA Launcher - Windows Setup
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Install the current Node.js LTS from the official Node.js website, then run this file again.
  pause
  exit /b 1
)
echo Installing LUMORA dependencies...
call npm install
if errorlevel 1 (
  echo npm install failed.
  pause
  exit /b 1
)
echo.
echo LUMORA is ready.
echo Starting the Windows app...
call npm start
pause
