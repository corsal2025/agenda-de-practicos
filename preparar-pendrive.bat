@echo off
REM Copia el sistema completo (programa, datos y Node.js portatil) a un pendrive o disco.
REM Uso: preparar-pendrive.bat E:\    (o se pregunta la unidad)
setlocal
cd /d "%~dp0"

set "DESTINO=%~1"
if "%DESTINO%"=="" set /p "DESTINO=Unidad o carpeta destino (ej: E:\): "
if "%DESTINO%"=="" exit /b 1
set "DESTINO=%DESTINO%\AgendaPracticos"

where node >nul 2>nul
if errorlevel 1 (
  echo Necesitas Node.js instalado en este PC para copiarlo al pendrive.
  pause
  exit /b 1
)
if not exist node_modules call npm install --omit=dev

echo Copiando a %DESTINO% ...
robocopy "%~dp0." "%DESTINO%" /E /XD .git .claude .atl diseno test /XF .env *.log /NFL /NDL /NJH /NP >nul
if errorlevel 8 (
  echo Error copiando archivos.
  pause
  exit /b 1
)

REM Node.js portatil: el pendrive funciona en PCs sin Node instalado.
if not exist "%DESTINO%\runtime" mkdir "%DESTINO%\runtime"
for /f "delims=" %%N in ('where node') do (
  copy /Y "%%N" "%DESTINO%\runtime\node.exe" >nul
  goto :copiado
)
:copiado

echo.
echo Listo. En el pendrive abre AgendaPracticos\iniciar.bat
echo Los datos se guardan en AgendaPracticos\data (dentro del pendrive).
echo NOTA: el archivo .env (correo y clave) NO se copia por seguridad; crealo de nuevo en el PC de destino.
pause
