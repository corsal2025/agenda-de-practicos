@echo off
REM Quita el inicio automatico de la Agenda de Practicos.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Agenda de Practicos.vbs" 2>nul
echo Inicio automatico quitado.
pause
