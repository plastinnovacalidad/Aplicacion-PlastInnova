@echo off
REM ==========================================================================
REM  Plast Innova - Renovar el certificado HTTPS del servidor
REM
REM  Usar cuando la app avise que el certificado esta por vencer (llega aviso
REM  por WhatsApp y sale en esta ventana de la app 30 dias antes).
REM
REM  Ejecutar con doble clic EN EL EQUIPO SERVIDOR (calidad-1), con el mismo
REM  usuario de Windows que arranca la app. Despues, reiniciar la app.
REM  Las tablets NO hay que tocarlas.
REM
REM  Detalle en scripts\certificados_https.ps1
REM ==========================================================================
title Plast Innova - Renovar certificado
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\certificados_https.ps1" -Renovar
echo.
pause
