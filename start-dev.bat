@echo off
setlocal

cd /d "%~dp0"
title TaskFlow-AI Dev

echo [1/3] Checking dependencies...
if not exist node_modules (
  echo node_modules not found, running npm install...
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo [2/3] Preparing database...
call npm run setup
if errorlevel 1 (
  echo.
  echo npm run setup failed.
  pause
  exit /b 1
)

echo [3/3] Starting dev server...
call npm run dev

endlocal
