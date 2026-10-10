@echo off
REM Inicia la Agenda de Practicos y abre el navegador.
REM Funciona desde el disco o desde un pendrive: usa runtime\node.exe si existe.
cd /d "%~dp0"

set "NODE=node"
if exist "runtime\node.exe" set "NODE=%~dp0runtime\node.exe"

"%NODE%" -v >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js. Instalalo desde https://nodejs.org ^(22.5 o superior^)
  echo o usa preparar-pendrive.bat para copiar una version portatil.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install --omit=dev
)

REM Si ya esta corriendo, solo abre el navegador.
powershell -NoProfile -Command "try { Invoke-WebRequest http://localhost:4900/api/meta -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  start "" http://localhost:4900
  exit /b 0
)

start "" http://localhost:4900
"%NODE%" --no-warnings server\index.js
pause
