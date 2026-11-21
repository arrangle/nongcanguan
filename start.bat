@echo off
cd /d %~dp0
start "nongcanguan server" cmd /k node server.js
timeout /t 2 >nul
start "" http://localhost:3000
