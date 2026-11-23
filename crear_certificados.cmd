@echo off
REM ==========================================================================
REM  Plast Innova - Crear los certificados HTTPS de la app (se hace UNA vez)
REM
REM  Ejecutar con doble clic EN EL EQUIPO SERVIDOR (calidad-1), con el mismo
REM  usuario de Windows que arranca la app. Crea la autoridad de Plast Innova
REM  (para instalar en las tablets) y el certificado del servidor.
REM  Si la autoridad ya existe, NO la reemplaza: solo emite de nuevo el del
REM  servidor (igual que renovar_certificado.cmd).
REM
REM  Detalle en scripts\certificados_https.ps1
REM ==========================================================================
title Plast Innova - Crear certificados
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\certificados_https.ps1"
echo.
pause
