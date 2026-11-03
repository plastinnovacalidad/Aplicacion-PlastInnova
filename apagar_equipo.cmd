@echo off
REM ==========================================================================
REM  Plast Innova - Cierre programado
REM
REM  Pensado para que Windows lo ejecute solo a una hora fija (Programador de
REM  tareas). Tambien se puede abrir a mano con doble clic.
REM
REM  Que hace:
REM   1. Cierra la app (la ventana "Plast Innova - App" y su servidor).
REM   2. Hace la copia de respaldo diaria de la base de datos en
REM      db\respaldos\diario\ y borra las de mas de 30 dias.
REM      Lo que pase queda anotado en db\respaldos\diario\registro.log
REM   3. Apaga el computador con 2 minutos de aviso.
REM      Para cancelar el apagado en esos 2 minutos: abrir cmd y escribir
REM      shutdown /a
REM ==========================================================================
title Plast Innova - Apagado
setlocal EnableExtensions

set "PUERTO=3001"
set "CARPETA_P=P:\1. Equipo Produccion\15.3 Calidad\Proyectos aplicaciones\Aplicacion Plast Innova"

if exist "%CARPETA_P%\app_circuitos.js" (
  cd /d "%CARPETA_P%"
) else (
  pushd "%~dp0"
)
echo  Carpeta de la app: %CD%

REM --- 1. Cerrar la app ----------------------------------------------------
echo.
echo  Cerrando la app...
REM Primero la ventana de iniciar_app.cmd (si no, la volveria a levantar).
taskkill /fi "WINDOWTITLE eq Plast Innova - App*" /t /f >nul 2>nul
REM Por si se abrio de otra forma (npm start, etc.): lo que ocupe el puerto.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":%PUERTO% .*LISTENING"') do (
  taskkill /pid %%P /t /f >nul 2>nul
)
timeout /t 5 /nobreak >nul

REM --- 2. Copia de respaldo de la base -------------------------------------
echo.
echo  Haciendo la copia de respaldo de la base de datos...
if not exist "db\respaldos\diario" mkdir "db\respaldos\diario"
node scripts\respaldar_base.js >> "db\respaldos\diario\registro.log" 2>&1
if errorlevel 1 (
  echo  La copia de respaldo fallo. Revisa db\respaldos\diario\registro.log
) else (
  echo  Copia de respaldo lista.
)

REM --- 3. Apagar el computador ---------------------------------------------
echo.
echo  El computador se apagara en 2 minutos.
echo  Para cancelarlo: abre cmd y escribe   shutdown /a
shutdown /s /t 120 /c "Apagado programado (app Plast Innova). Para cancelarlo: abre cmd y escribe shutdown /a"
timeout /t 10 >nul
endlocal
