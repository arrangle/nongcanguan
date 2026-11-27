@echo off
chcp 65001 >nul
cd /d %~dp0

echo.
echo ============================================
echo   农餐馆 · 现场演示启动
echo ============================================
echo.

start "nongcanguan server" cmd /k node server.js
timeout /t 3 >nul

echo 电脑（大屏）打开：  http://localhost:3000
echo.
echo 手机（连同一个 Wi-Fi / 热点）在小程序右上角齿轮里填：
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do (
    echo %%b | findstr /b /c:"169.254" >nul || echo     http://%%b:3000
  )
)
echo.
echo 提示：手机要先在微信里「打开调试」，才允许连接这个地址。
echo       演示机建议连手机热点，避开会场 Wi-Fi 的隔离。
echo.
start "" http://localhost:3000
pause
