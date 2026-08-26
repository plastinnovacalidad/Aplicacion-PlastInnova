# Checklist manual antes de cada despliegue

Lista de verificación para revisar a mano cada vez que se suben cambios de código a
producción. No reemplaza pruebas automáticas (este proyecto no tiene todavía), pero
ayuda a no repetir errores ya conocidos.

## 1. Antes de tocar nada

- [ ] Hacer un respaldo de `db/base_datos.db` (con el servidor detenido, o copiando
      también `db/base_datos.db-wal` y `db/base_datos.db-shm` si el servidor sigue
      corriendo). Ver la sección "Respaldo de la base de datos" del README.
- [ ] Confirmar en qué rama o copia de código se está trabajando, para no mezclar
      cambios a medio probar con la versión que ya funciona en producción.

## 2. Arrancar el servidor

- [ ] `npm install` (por si el cambio agregó o quitó alguna dependencia).
- [ ] `npm start` y revisar la consola: debe llegar hasta `🚀 Servidor en
      http://localhost:3000` sin ningún `Error` antes de esa línea.
- [ ] Si se tocó algo del bot de WhatsApp: confirmar que dice `✅ Bot de WhatsApp
      listo y conectado!` (o que pide escanear un QR nuevo, si es la primera vez).

## 3. Ingreso y permisos

- [ ] Iniciar sesión con un usuario `admin`, uno `inspector` y uno `operario` (o los
      roles que existan) y confirmar que cada uno ve solo los módulos y botones que le
      corresponden.
- [ ] Si se agregó o cambió algún permiso: crear (o revisar) un rol de prueba con
      *solo* ese permiso nuevo, y confirmar que puede hacer esa acción y ninguna otra.

## 4. Revisar cada módulo que haya sido tocado por el cambio

- [ ] **Circuitos SMD**: ver fotos de una referencia, subir una nueva versión,
      agregar una observación/recomendación.
- [ ] **Metrología**: ver un plano, ampliarlo (zoom con rueda y arrastre), agregar o
      editar una cota, subir una nueva versión de plano.
- [ ] **Garantías**: crear una garantía, editarla, ver el tablero (dashboard).
- [ ] **Gestión**: crear/editar un usuario, crear/editar un rol y sus permisos.
- [ ] **Bot de WhatsApp**: enviar un mensaje de prueba desde un número autorizado y
      confirmar que se registra; revisar que el resumen diario se siga enviando.

## 5. Cosas fáciles de romper sin darse cuenta

- [ ] Si se cambió algo en `settings/paths.js`: confirmar que las carpetas que se
      auto-crean (`uploads/obsoletas`, `uploads/tmp`, `uploads/evidencias`) existen y
      tienen los archivos esperados.
- [ ] Si se cambió algo de la base de datos (`db/init.js`): parar y volver a
      arrancar el servidor dos veces seguidas, y confirmar que la segunda vez no
      aparece ningún error (las migraciones deben poder correr muchas veces sin
      problema).
- [ ] Revisar la consola del navegador (F12) en al menos una página por módulo: no
      deben aparecer errores rojos nuevos.
- [ ] Confirmar que `/config` ya no existe como ruta pública y que no quedó ninguna
      referencia rota a la carpeta `config/` (fue eliminada del proyecto).

## 6. Después de desplegar

- [ ] Dejar el servidor corriendo un rato y revisar la consola por si aparece algún
      error inesperado con el uso real (no solo con las pruebas manuales de arriba).
- [ ] Anotar en `docs/Plan_de_mejora_app_circuitos_smd.xlsx` cualquier tarea nueva
      que haya salido de este despliegue (bug encontrado, mejora pendiente, etc.).
