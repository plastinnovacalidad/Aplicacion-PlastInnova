@echo off
REM ==========================================================================
REM  Plast Innova - COPIA DE PRUEBA de la app usando SQL Server
REM
REM  - Usa la base de ensayo de SQL Server (la del .env: MSSQL_*).
REM  - Corre en el puerto 3002: abrir http://localhost:3002
REM  - La app normal (SQLite, la de siempre) puede seguir abierta al mismo tiempo.
REM  - No arranca el bot de WhatsApp ni las tareas automaticas (sincronizacion
REM    con Excel, cierre de lotes ISO, limpieza de obsoletas).
REM  - Para cerrarla: Ctrl + C en esta ventana.
REM ==========================================================================
cd /d "%~dp0"
set MOTOR_BD=sqlserver
set PORT=3002
set SIN_WHATSAPP=1
set SIN_TAREAS_AUTOMATICAS=1
set ARCHIVO_SESIONES=sesiones_prueba_sqlserver.json
echo.
echo  Copia de prueba con SQL Server - http://localhost:3002
echo.
node app_circuitos.js
echo.
pause
