@echo off
REM Descarga la ultima version desde GitHub y reinicia el sistema.
REM Los datos (data\), el .env y los backups NO se tocan: no estan en GitHub.
setlocal
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo Falta Git. Instalalo desde https://git-scm.com y vuelve a ejecutar.
  pause
  exit /b 1
)

echo Respaldando la base antes de actualizar...
set "NODE=node"
if exist "runtime\node.exe" set "NODE=%~dp0runtime\node.exe"
"%NODE%" --no-warnings server\backup.js

echo Deteniendo el sistema...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4900 " ^| findstr LISTENING') do taskkill /PID %%P /F >nul 2>nul

echo Descargando actualizaciones...
git pull --ff-only
if errorlevel 1 (
  echo No se pudo actualizar ^(hay cambios locales o no hay conexion^). No se cambio nada.
  pause
  exit /b 1
)

call npm install --omit=dev

echo Iniciando el sistema actualizado...
start "" /min cmd /c ""%NODE%" --no-warnings server\index.js >> data\servidor.log 2>&1"
timeout /t 3 >nul
start "" http://localhost:4900
echo Listo.
pause
