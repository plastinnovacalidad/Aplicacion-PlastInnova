@echo off
REM ==========================================================================
REM  Plast Innova - Arranque de la app (la normal, con SQLite, puerto del .env)
REM
REM  Pensado para que Windows lo ejecute solo al iniciar sesion (Programador
REM  de tareas). Tambien se puede abrir a mano con doble clic.
REM
REM  Que hace:
REM   1. Espera a que la carpeta de la app en la red (unidad P:) responda.
REM   2. Si la app ya esta encendida (puerto ocupado), no abre otra: dos apps
REM      a la vez duplican el bot de WhatsApp y la sincronizacion con Excel.
REM   3. Arranca la app en esta ventana (aqui sale el codigo QR de WhatsApp
REM      si hace falta volver a vincularlo).
REM   4. Si la app se cae por un error, la vuelve a levantar a los 15 s.
REM
REM  Para cerrarla: Ctrl + C en esta ventana y responder S.
REM ==========================================================================
title Plast Innova - App
setlocal EnableExtensions

set "PUERTO=3001"
set "CARPETA_P=P:\1. Equipo Produccion\15.3 Calidad\Proyectos aplicaciones\Aplicacion Plast Innova"

REM --- 1. Esperar la carpeta de la app (hasta 5 minutos) -------------------
set /a INTENTOS=0
:esperar_red
if exist "%CARPETA_P%\app_circuitos.js" (
  cd /d "%CARPETA_P%"
  goto red_lista
)
REM Si la unidad P: todavia no esta conectada, se usa la carpeta donde esta
REM este archivo (sirve cuando la tarea lo abre por la ruta de red \\...).
if exist "%~dp0app_circuitos.js" (
  pushd "%~dp0"
  goto red_lista
)
set /a INTENTOS+=1
if %INTENTOS% GEQ 30 (
  echo.
  echo  No se pudo llegar a la carpeta de la app en la red despues de 5 minutos.
  echo  Revisa que la unidad P: este conectada y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
echo  Esperando la conexion con la unidad P: ... intento %INTENTOS% de 30
timeout /t 10 /nobreak >nul
goto esperar_red

:red_lista
echo  Carpeta de la app: %CD%

REM --- 2. No abrir una segunda app ------------------------------------------
netstat -ano | findstr /r /c:":%PUERTO% .*LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo  La app ya esta encendida en el puerto %PUERTO%. No se abre otra.
  echo.
  timeout /t 15 >nul
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No se encontro Node.js en este equipo. Instala Node.js y vuelve a intentar.
  echo.
  pause
  exit /b 1
)

REM --- 3 y 4. Arrancar y volver a levantar si se cae ------------------------
:arrancar
echo.
echo  ============================================================
echo   Iniciando la app - %DATE% %TIME%
echo  ============================================================
node app_circuitos.js
set "CODIGO=%ERRORLEVEL%"
if "%CODIGO%"=="0" (
  echo.
  echo  La app se cerro normalmente.
  goto fin
)
echo.
echo  La app se detuvo con un error (codigo %CODIGO%). Se vuelve a iniciar en 15 segundos...
echo  Para no reiniciarla, cierra esta ventana.
timeout /t 15 /nobreak >nul
goto arrancar

:fin
endlocal
