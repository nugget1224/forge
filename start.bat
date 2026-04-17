@echo off
echo Starting Forge fitness tracker...

:: Start the Node.js server in a new window
start "Forge Server" cmd /k "cd /d C:\Users\Brennan\forge && node server.js"

:: Tailscale Funnel runs persistently in the background -- no need to restart it.
:: If it ever stops, run: tailscale funnel --bg 3000

echo.
echo Forge is running!
echo Local:  http://localhost:3000
echo Remote: https://desktop-riari8u.tailca74c1.ts.net
echo.
echo You can close this window. Keep the "Forge Server" window open.
pause
