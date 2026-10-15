@echo off
chcp 65001 >nul
title VozFlow - crear instalador
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" call npm install
echo.
echo   Armando el instalador. Tarda unos minutos...
echo.
call npm run dist
if errorlevel 1 (
  echo.
  echo   No se pudo crear el instalador.
  pause
  exit /b 1
)
echo.
echo   Listo. El instalador esta en la carpeta dist.
start "" "%~dp0dist"
pause
