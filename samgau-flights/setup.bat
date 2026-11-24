@echo off
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || if exist "%~dp0..\dtabase2026\node.exe" set "NODE=%~dp0..\dtabase2026\node.exe"
if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"
if not exist node_modules\pg if exist "%~dp0..\dtabase2026\node_modules\pg" set "NODE_PATH=%~dp0..\dtabase2026\node_modules"
if not exist node_modules\pg if not defined NODE_PATH call npm install
echo Creating database and loading data (this resets all bookings)...
"%NODE%" scripts\setup-db.js
pause
