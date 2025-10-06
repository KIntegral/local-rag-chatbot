@echo off
title DataTalks 2025 - Dual Kiosk

echo Starting DataTalks 2025 Chatbot...

REM Kill previous instances
taskkill /F /IM chrome.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

REM Start backend
cd /d "%~dp0"
start "Backend" /MIN cmd /c "node backend/server.js"
timeout /t 8 /nobreak

REM Open Chrome on Monitor 1 (left)
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --kiosk ^
  --window-position=0,0 ^
  --window-size=1920,1080 ^
  --user-data-dir="%TEMP%\chrome_kiosk_1" ^
  --disable-infobars ^
  --no-first-run ^
  http://localhost:3000

timeout /t 3 /nobreak

REM Open Chrome on Monitor 2 (right)
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --kiosk ^
  --window-position=1920,0 ^
  --window-size=1920,1080 ^
  --user-data-dir="%TEMP%\chrome_kiosk_2" ^
  --disable-infobars ^
  --no-first-run ^
  http://localhost:3000

echo.
echo ✅ Both touchscreens are running!
echo Press any key to stop...
pause >nul

taskkill /F /IM chrome.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1
