@echo off
chcp 65001 >nul
title VozFlow
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No encontre Node.js en esta computadora.
  echo   Instala la version LTS desde nodejs.org y vuelve a abrir este archivo.
  start "" https://nodejs.org/es/download
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -v') do set NV=%%v
set NV=%NV:v=%
if %NV% LSS 22 (
  echo.
  echo   Tu Node.js es muy viejo. VozFlow necesita la version 22 o mas nueva.
  echo   Instala la version LTS desde nodejs.org y vuelve a abrir este archivo.
  start "" https://nodejs.org/es/download
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo   Instalando VozFlow por primera vez. Tarda un par de minutos...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   La instalacion fallo. Revisa tu conexion a internet y vuelve a intentarlo.
    pause
    exit /b 1
  )
)

start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
