# AGENTS.md — Reglas de trabajo para Aplicacion-PlastInnova

## 1. OBJETIVO DEL PROYECTO

Esta aplicación es un sistema interno de Plast-Innova utilizado para apoyar los procesos de calidad, producción, seguimiento de incidencias, referencias, metrología, garantías, cableado, ISO, WhatsApp y otros procesos relacionados.

El proyecto funciona principalmente como una aplicación local y está diseñada para utilizarse en equipos/tablets dentro de la operación.

La prioridad es mantener una aplicación estable, sencilla de mantener y segura.

---

## 2. REGLA PRINCIPAL: CAMBIOS CONTROLADOS

NO modificar código que no esté relacionado con la tarea solicitada.

NO hacer refactorizaciones generales solo porque parezcan mejores.

NO cambiar la arquitectura completa del proyecto.

NO migrar tecnologías (por ejemplo a React, Vue, TypeScript, etc.) salvo que el usuario lo solicite explícitamente.

NO mover archivos de carpetas sin una razón directamente relacionada con la tarea.

Antes de modificar código:

1. Identificar exactamente qué solicita el usuario.
2. Localizar los archivos relacionados.
3. Leer y comprender el código existente.
4. Revisar dependencias y posibles impactos.
5. Explicar brevemente el plan cuando el cambio sea importante.
6. Realizar el cambio mínimo necesario.
7. Verificar que el cambio funciona.
8. Revisar posibles regresiones.

La estabilidad existente tiene prioridad sobre una "mejora" arquitectónica.

---

## 3. FORMA DE TRABAJO

Trabajar siempre de forma incremental:

ANALIZAR → PLANEAR → MODIFICAR → VERIFICAR → REPORTAR

No realizar muchos cambios independientes en una sola operación si pueden hacerse de forma segura por etapas.

Si una modificación puede afectar varias áreas del sistema, identificar primero esas áreas.

Si existe una duda importante sobre el comportamiento esperado, detenerse y explicarla antes de asumir una solución.

---

## 4. MODOS DE TRABAJO

### MODO AUDITORÍA

Cuando el usuario solicite revisar, auditar, analizar o verificar:

- NO modificar archivos automáticamente.
- Revisar el código existente.
- Identificar errores reales.
- Identificar riesgos.
- Diferenciar problemas críticos, importantes y menores.
- Explicar dónde está el problema.
- Proponer una solución concreta.
- Esperar autorización antes de realizar cambios importantes.

No convertir una auditoría en una refactorización.

### MODO IMPLEMENTACIÓN

Cuando el usuario solicite implementar una función:

- Revisar primero la implementación existente.
- Reutilizar la arquitectura actual siempre que sea posible.
- Hacer cambios mínimos.
- No modificar módulos no relacionados.
- Verificar sintaxis y funcionamiento después del cambio.

---

## 5. BASE DE DATOS SQLITE

La aplicación utiliza SQLite.

La base de datos es crítica.

No eliminar tablas, columnas, índices, migraciones o datos existentes sin autorización explícita.

Respetar el sistema de migraciones existente en `db/init.js`.

Respetar las transacciones existentes.

Antes de modificar el esquema:

1. Revisar las migraciones existentes.
2. Determinar si realmente se necesita una nueva migración.
3. Evitar modificar migraciones antiguas que ya pudieron ejecutarse.
4. Preferir agregar una nueva migración cuando corresponda.
5. Verificar compatibilidad con bases de datos existentes.

Nunca asumir que la base de datos está vacía.

---

## 6. PRODUCCIÓN Y ARCHIVOS EXCEL

El módulo de producción depende de archivos Excel, PowerShell y rutas locales/NAS.

Archivos relacionados incluyen:

- `scripts/sincronizar_produccion.js`
- módulos de producción
- archivos Excel de Calidad, Lotes y Producción.

Esta parte es CRÍTICA.

NO refactorizar ni modernizar este sistema sin autorización explícita.

No cambiar rutas, nombres de archivos, comandos PowerShell, estructura de sincronización o lógica de importación sin analizar primero el impacto.

---

## 7. WHATSAPP

La aplicación utiliza WhatsApp mediante `whatsapp-web.js`.

No modificar el sistema de WhatsApp sin revisar primero:

- sesiones
- autenticación
- permisos
- alertas
- números configurados
- envío de mensajes
- recepción de mensajes.

No eliminar ni reiniciar sesiones automáticamente como parte de una modificación no relacionada.

---

## 8. AUTENTICACIÓN Y PERMISOS

La aplicación tiene:

- usuarios
- roles
- permisos
- sesiones
- autenticación mediante token.

No eliminar controles de permisos para "simplificar" una función.

Toda nueva ruta API debe analizar si necesita autenticación y qué permiso corresponde.

No almacenar nuevas credenciales o secretos directamente en el código.

Los secretos deben utilizar variables de entorno.

No imprimir tokens, contraseñas, claves API u otra información sensible en logs.

---

## 9. SEGURIDAD

Mantener las validaciones existentes.

Los archivos subidos por usuarios deben continuar pasando por las validaciones existentes de tipo/tamaño/contenido.

No eliminar validaciones de archivos simplemente para solucionar un problema de carga.

No desactivar Helmet, autenticación, CORS, validaciones o controles de seguridad sin una razón explícita y documentada.

Si se detecta un problema de seguridad durante otra tarea:

- señalarlo;
- explicar el riesgo;
- no realizar cambios de seguridad no relacionados sin autorización.

---

## 10. IA Y CONSULTAS SQL

La aplicación utiliza Gemini para determinadas funciones de consulta.

Las consultas generadas por IA deben permanecer limitadas a operaciones de lectura.

No permitir que una función de IA ejecute:

- INSERT
- UPDATE
- DELETE
- DROP
- ALTER
- CREATE
- ATTACH
- DETACH
- PRAGMA
- VACUUM
- REINDEX
- TRIGGER
- GRANT
- REVOKE

o cualquier otra operación que modifique la base de datos.

No ampliar las tablas permitidas para consultas de IA sin revisar primero las implicaciones de seguridad.

---

## 11. FRONTEND

Las páginas principales están dentro de:

`Public/`

El proyecto utiliza HTML, CSS y JavaScript.

No convertir páginas a otro framework salvo solicitud explícita.

Cuando se modifique una página existente:

- conservar la funcionalidad actual;
- conservar las API existentes;
- conservar IDs utilizados por JavaScript;
- conservar nombres de campos y estructuras necesarias;
- revisar eventos y formularios existentes.

No eliminar funciones simplemente porque no sean visibles en la interfaz.

---

## 12. TABLETS Y RESPONSIVE

La aplicación se utiliza principalmente en tablets.

Toda modificación visual debe comprobar:

- 768px aproximadamente;
- 1024px aproximadamente;
- orientación horizontal;
- orientación vertical cuando sea relevante.

Evitar:

- desbordamiento horizontal innecesario;
- botones demasiado pequeños;
- textos cortados;
- tablas imposibles de leer;
- formularios que requieran zoom constante.

Los controles importantes deben ser cómodos para interacción táctil.

---

## 13. IMPRESIÓN Y PDF

La aplicación genera e imprime información utilizada en procesos reales.

Cuando se modifique una página que tenga impresión:

- revisar `@media print`;
- revisar saltos de página;
- revisar tablas largas;
- revisar fotografías;
- revisar encabezados y pies;
- revisar que los controles de la interfaz no aparezcan innecesariamente en la impresión.

No asumir que una interfaz correcta en pantalla también funciona correctamente al imprimir.

---

## 14. DISEÑO PLAST-INNOVA

Existe un sistema de diseño oficial en:

`Plast Innova design system`

Este directorio es la referencia principal para decisiones visuales.

Antes de realizar cambios importantes de diseño, revisar el sistema de diseño existente.

### Colores principales

Azul corporativo:

`#2C43A2`

Rojo corporativo:

`#FF0000`

No inventar colores corporativos.

No utilizar gradientes morados.

### Tipografía

Rubik para lenguaje/interfaz.

Segoe UI para datos, tablas, KPIs, lotes y referencias.

### Iconografía

Utilizar Font Awesome 6 cuando corresponda.

No utilizar emojis como iconografía de interfaz.

### Componentes

Las tarjetas normalmente utilizan:

- fondo blanco;
- borde `#DFE3EA`;
- radio aproximado de 16px;
- sombras suaves azuladas.

No utilizar sombras negras fuertes.

### Logo

Nunca dibujar manualmente el logo.

Utilizar los recursos oficiales existentes en:

`Plast Innova design system/assets`

### Imágenes

No inventar fotografías de productos.

Cuando no exista una imagen real, utilizar el sistema de placeholder establecido por el diseño.

---

## 15. IDIOMA Y CONTENIDO

La interfaz está dirigida a usuarios de Colombia.

Utilizar español de Colombia.

Utilizar "tú" cuando corresponda.

Mantener una comunicación profesional, clara y directa.

Para valores monetarios utilizar formatos colombianos apropiados, por ejemplo:

`$189.900`

Para números decimales utilizar coma cuando corresponda:

`4,8`

---

## 16. API Y BACKEND

El backend utiliza Node.js y Express.

Las rutas están principalmente organizadas en:

`routes/`

La lógica de datos se encuentra principalmente en:

`data/`

Antes de crear una nueva ruta:

- revisar si ya existe una ruta equivalente;
- revisar si existe una función de datos reutilizable;
- mantener el patrón existente.

No duplicar lógica innecesariamente.

Mantener el manejo centralizado de errores existente.

---

## 17. ARCHIVOS Y RUTAS LOCALES

La aplicación depende de rutas locales para determinados recursos.

Algunas funcionalidades dependen específicamente de Windows, OneDrive, Excel, PowerShell o recursos de red.

NO reemplazar estas rutas por rutas inventadas.

NO eliminar compatibilidad con Windows.

Cuando una ruta deba modificarse, comprobar primero cómo se utiliza en todo el proyecto.

Las rutas específicas de instalación y secretos deben preferentemente utilizar variables de entorno.

---

## 18. ARCHIVOS CRÍTICOS

Tratar con especial cuidado:

- `app_circuitos.js`
- `db/init.js`
- `db/connection.js`
- `middleware/auth.js`
- `routes/auth.js`
- `settings/paths.js`
- `scripts/sincronizar_produccion.js`
- `whatsapp_bot_service.js`

Antes de realizar cambios importantes en ellos, analizar dependencias e impacto.

---

## 19. DEPENDENCIAS

No instalar paquetes nuevos si la funcionalidad puede realizarse con las dependencias existentes.

Antes de añadir una dependencia:

1. comprobar si ya existe una solución en el proyecto;
2. comprobar si realmente es necesaria;
3. explicar por qué se necesita.

No actualizar múltiples dependencias como parte de una tarea no relacionada.

---

## 20. GIT

No ejecutar automáticamente:

- `git reset --hard`
- `git clean`
- `git checkout` destructivo
- eliminación masiva de archivos.

No sobrescribir trabajo realizado por otros agentes o por el usuario.

El repositorio puede contener cambios realizados en paralelo.

Antes de tocar un archivo que ya tiene cambios pendientes, revisar primero su estado.

---

## 21. TRABAJO CON CLAUDE

Claude y OpenCode pueden trabajar sobre el mismo repositorio.

Claude puede realizar la implementación principal de una funcionalidad.

OpenCode/Gemini debe actuar como:

- analista técnico;
- auditor;
- revisor de código;
- detector de errores;
- verificador;
- implementador de correcciones específicas cuando el usuario lo solicite.

No asumir que OpenCode debe rehacer el trabajo realizado por Claude.

Cuando revise código creado por Claude:

1. entender primero la intención;
2. identificar errores reales;
3. diferenciar problemas reales de preferencias personales;
4. evitar reescribir código simplemente por estilo;
5. proponer cambios concretos.

---

## 22. VERIFICACIÓN

Después de modificar JavaScript:

- comprobar sintaxis;
- revisar referencias a funciones;
- revisar rutas;
- revisar variables;
- revisar errores evidentes.

Después de modificar HTML/CSS:

- revisar estructura;
- revisar JavaScript relacionado;
- revisar responsive;
- revisar impresión cuando corresponda.

Después de modificar backend:

- revisar rutas;
- permisos;
- base de datos;
- manejo de errores;
- compatibilidad con frontend.

Si existen pruebas automatizadas, ejecutarlas.

Si no existen pruebas automatizadas para esa funcionalidad, realizar las verificaciones disponibles y explicarlas.

---

## 23. NO OCULTAR PROBLEMAS

Si una tarea revela un problema existente que no está relacionado directamente:

NO ocultarlo.

Informarlo al usuario como:

- Crítico
- Alto
- Medio
- Bajo

Explicar brevemente:

- qué ocurre;
- dónde ocurre;
- qué riesgo tiene;
- qué solución se recomienda.

No arreglar automáticamente problemas ajenos a la tarea salvo autorización.

---

## 24. ANTES DE TERMINAR UNA TAREA

Comprobar:

- qué archivos fueron modificados;
- qué funcionalidad fue modificada;
- si existen errores de sintaxis;
- si hay referencias rotas;
- si hay efectos secundarios evidentes;
- si el diseño sigue el sistema Plast-Innova;
- si la interfaz funciona en tablet;
- si la impresión sigue funcionando cuando corresponda.

Informar claramente al usuario qué se hizo.

---

## 25. PRINCIPIO FINAL

La prioridad es:

ESTABILIDAD > CAMBIOS MÍNIMOS > SEGURIDAD > FUNCIONALIDAD > DISEÑO > REFACTORIZACIÓN

No hacer cambios por hacer cambios.

Primero comprender.

Después modificar.

Finalmente verificar.

La aplicación ya tiene una arquitectura funcional y no debe tratarse como un proyecto nuevo desde cero.