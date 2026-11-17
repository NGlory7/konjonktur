@echo off
rem KONJONKTUR - sunucuyu (calismiyorsa) baslatir ve Edge'i adres cubugu olmayan uygulama penceresinde acar
cd /d "%~dp0"
netstat -ano | findstr ":8090" | findstr "LISTENING" >nul
if errorlevel 1 (
  start "KONJONKTUR sunucu" /min node server.js
  timeout /t 3 /nobreak >nul
)
start "" msedge --app=http://127.0.0.1:8090 --window-size=1600,900
