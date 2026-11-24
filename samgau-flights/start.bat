@echo off
cd /d "%~dp0"
set "NODE=node"
where node >nul 2>nul || if exist "%~dp0..\dtabase2026\node.exe" set "NODE=%~dp0..\dtabase2026\node.exe"
if exist "%~dp0node.exe" set "NODE=%~dp0node.exe"
if not exist node_modules\express if exist "%~dp0..\dtabase2026\node_modules\express" set "NODE_PATH=%~dp0..\dtabase2026\node_modules"
if not exist node_modules\express if not defined NODE_PATH call npm install
start "" http://localhost:3000
"%NODE%" server.js
pause
