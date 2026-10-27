@echo off
title OpenWA WhatsApp Gateway (:2785)
cd /d "%~dp0openwa"
set "PATH=C:\Users\manga\tools\node;%PATH%"
echo Starting OpenWA Gateway on http://localhost:2785 ...
node dist/main.js
pause
