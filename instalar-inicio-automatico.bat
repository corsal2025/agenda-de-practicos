@echo off
REM Hace que la Agenda arranque sola (oculta) al iniciar sesion en Windows,
REM desde la carpeta donde esta este archivo (disco o pendrive).
setlocal
cd /d "%~dp0"
set "NODE=node"
if exist "runtime\node.exe" set "NODE=%~dp0runtime\node.exe"
set "VBS=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Agenda de Practicos.vbs"

> "%VBS%" echo ' Inicia Agenda de Practicos al iniciar sesion (log en data\servidor.log)
>> "%VBS%" echo Set sh = CreateObject("WScript.Shell")
>> "%VBS%" echo sh.CurrentDirectory = "%~dp0"
>> "%VBS%" echo ' Rota el log: si pasa de 5 MB queda como servidor.log.1
>> "%VBS%" echo Set fso = CreateObject("Scripting.FileSystemObject")
>> "%VBS%" echo logp = "%~dp0data\servidor.log"
>> "%VBS%" echo If fso.FileExists(logp) Then
>> "%VBS%" echo   If fso.GetFile(logp).Size ^> 5000000 Then
>> "%VBS%" echo     If fso.FileExists(logp ^& ".1") Then fso.DeleteFile logp ^& ".1", True
>> "%VBS%" echo     fso.MoveFile logp, logp ^& ".1"
>> "%VBS%" echo   End If
>> "%VBS%" echo End If
>> "%VBS%" echo sh.Run "cmd /c ""%NODE%"" --no-warnings server\index.js >> data\servidor.log 2>&1", 0, False

echo Inicio automatico instalado. Se activara la proxima vez que inicies sesion.
echo Para quitarlo usa quitar-inicio-automatico.bat
pause
