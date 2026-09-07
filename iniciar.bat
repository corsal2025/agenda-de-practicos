@echo off
REM Inicia el servidor de la Agenda de Practicos y abre el navegador.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instalalo desde https://nodejs.org (version 22.5 o superior).
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install
)

start "" http://localhost:4173
node server\index.js
pause
