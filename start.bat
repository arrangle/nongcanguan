@echo off
cd /d %~dp0
start "shike server" cmd /k node server.js
timeout /t 2 >nul
start "" http://localhost:3000
