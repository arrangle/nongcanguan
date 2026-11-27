@echo off
chcp 65001 >nul
cd /d %~dp0

echo.
echo ============================================
echo   农餐馆 · 现场演示启动
echo ============================================
echo.

rem 以管理员身份运行时，顺手放行 3000 端口（只需要成功一次，规则会保留）
net session >nul 2>&1
if %errorlevel%==0 (
  netsh advfirewall firewall add rule name="nongcanguan-3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
  if %errorlevel%==0 (echo [OK] 已放行入站 TCP 3000) else (echo [提示] 放行端口失败，可手动在防火墙里添加)
) else (
  echo [提示] 手机连不上时，右键本文件选「以管理员身份运行」一次，会自动放行 3000 端口
)

start "nongcanguan server" cmd /k node server.js
timeout /t 3 >nul

echo.
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
