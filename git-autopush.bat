@echo off
cd /d C:\Users\Brennan\forge
git add .
git diff --cached --quiet && exit /b 0
git commit -m "auto-update %date% %time%"
git push
