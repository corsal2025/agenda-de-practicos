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

set "NODE=node"
if exist "runtime\node.exe" set "NODE=%~dp0runtime\node.exe"

REM 1) Verificar que hay una actualizacion aplicable ANTES de detener nada.
echo Buscando actualizaciones...
git fetch
if errorlevel 1 (
  echo No se pudo conectar con GitHub. No se cambio nada.
  pause
  exit /b 1
)
git merge-base --is-ancestor HEAD @{u}
if errorlevel 1 (
  echo Hay cambios locales que impiden actualizar ^(no es avance directo^). No se cambio nada.
  pause
  exit /b 1
)

REM 2) Respaldo obligatorio: sin backup no se actualiza.
echo Respaldando la base antes de actualizar...
"%NODE%" --no-warnings server\backup.js
if errorlevel 1 (
  echo ERROR: no se pudo respaldar la base. Se cancela la actualizacion; no se cambio nada.
  pause
  exit /b 1
)

for /f %%C in ('git rev-parse HEAD') do set "PREV=%%C"

echo Deteniendo el sistema...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":4900 " ^| findstr LISTENING') do taskkill /PID %%P /F >nul 2>nul

echo Descargando actualizaciones...
git pull --ff-only
if errorlevel 1 (
  echo No se pudo actualizar. Se vuelve a iniciar la version anterior.
  call :iniciar
  pause
  exit /b 1
)

call npm install --omit=dev
if errorlevel 1 (
  echo ERROR: fallo la instalacion de dependencias. Se vuelve a la version anterior ^(%PREV%^).
  git reset --hard %PREV%
  call npm install --omit=dev
  call :iniciar
  pause
  exit /b 1
)

echo Iniciando el sistema actualizado...
call :iniciar
if errorlevel 1 (
  pause
  exit /b 1
)
start "" http://localhost:4900
echo Listo.
pause
exit /b 0

REM Rota el log (mas de 5 MB pasa a servidor.log.1), inicia el servidor y espera hasta 15 s a que responda.
:iniciar
if not exist data mkdir data
for %%F in (data\servidor.log) do if %%~zF GTR 5000000 move /y "data\servidor.log" "data\servidor.log.1" >nul
start "" /min cmd /c ""%NODE%" --no-warnings server\index.js >> data\servidor.log 2>&1"
powershell -NoProfile -Command "for ($i = 0; $i -lt 15; $i++) { try { Invoke-WebRequest http://localhost:4900/api/meta -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } }; exit 1"
if errorlevel 1 (
  echo ERROR: el sistema no respondio despues de iniciar. Revisa data\servidor.log
  exit /b 1
)
exit /b 0
