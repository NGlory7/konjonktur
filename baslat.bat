@echo off
rem KONJONKTUR - sunucuyu baslatir ve Edge'i adres cubugu olmayan uygulama penceresinde acar
cd /d "%~dp0"
start "KONJONKTUR sunucu" /min node server.js
timeout /t 2 /nobreak >nul
start "" msedge --app=http://localhost:8090 --window-size=1600,900
