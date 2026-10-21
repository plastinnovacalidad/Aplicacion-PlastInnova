# CLAUDE.md — Instrucciones para Claude

## 1. OBJETIVO DEL PROYECTO

Esta aplicación es un sistema interno de Plast Innova utilizado para apoyar
las operaciones de calidad, producción, inspección, seguimiento de incidencias
y generación de reportes.

La aplicación funciona principalmente de forma local y está orientada al uso
en tablets y equipos Windows.

La prioridad del proyecto es:

1. Estabilidad
2. Mantener la funcionalidad existente
3. Seguridad e integridad de datos
4. Usabilidad
5. Diseño
6. Refactorización, únicamente cuando sea realmente necesaria

---

## 2. REGLA PRINCIPAL

Antes de modificar cualquier cosa:

1. Entender cómo funciona actualmente.
2. Identificar los archivos relacionados.
3. Revisar dependencias y efectos secundarios.
4. Proponer mentalmente el cambio mínimo necesario.
5. Implementar.
6. Verificar que no se haya roto funcionalidad existente.

NO realizar cambios innecesarios solamente para "mejorar" el código.

NO reescribir módulos completos si solamente se necesita modificar una parte.

NO eliminar funcionalidad existente sin autorización explícita.

---

## 3. FORMA DE TRABAJO

Trabajar siempre siguiendo:

ANALIZAR → PLANIFICAR → MODIFICAR → VERIFICAR → INFORMAR

Antes de realizar cambios importantes, explicar brevemente:

- qué se encontró;
- qué se va a modificar;
- qué archivos serán afectados;
- qué riesgos existen.

Después de modificar:

- comprobar sintaxis;
- revisar errores;
- comprobar que las funciones existentes continúan funcionando;
- comprobar permisos y autenticación cuando corresponda;
- comprobar responsive en tablet;
- comprobar impresión/PDF cuando corresponda.

---

## 4. ARQUITECTURA EXISTENTE

La aplicación utiliza principalmente:

- Node.js
- Express
- SQLite
- HTML
- CSS
- JavaScript vanilla
- PDFKit
- WhatsApp Web.js
- Integraciones con Excel/PowerShell
- Sistema de autenticación y permisos

Respetar la arquitectura existente.

No introducir frameworks nuevos salvo que sea estrictamente necesario y
se autorice expresamente.

---

## 5. BASE DE DATOS SQLITE

La base de datos es crítica.

Antes de modificar tablas:

- revisar el esquema existente;
- revisar consultas relacionadas;
- revisar rutas que utilizan esas tablas;
- evitar romper datos existentes;
- mantener compatibilidad con la información actual.

No eliminar migraciones existentes.

Si se necesita modificar el esquema, utilizar una migración nueva
y conservar las anteriores.

No borrar datos existentes durante una modificación salvo autorización explícita.

Respetar transacciones existentes.

---

## 6. AUTENTICACIÓN Y PERMISOS

La aplicación posee usuarios, sesiones y permisos.

Nunca eliminar ni saltarse:

- autenticación;
- autorización;
- comprobaciones de permisos;
- restricciones por usuario/rol.

Cualquier cambio relacionado con acceso debe revisarse cuidadosamente.

No asumir que una página puede ser accesible simplemente porque el frontend
oculta un botón.

Las restricciones importantes deben mantenerse también en backend.

---

## 7. PRODUCCIÓN, EXCEL Y POWERSHELL

La sincronización con producción y las integraciones con Excel/PowerShell
son áreas críticas.

No modificar estas partes como consecuencia secundaria de un cambio visual
o funcional que no las necesite.

No cambiar rutas de archivos, nombres de hojas, estructuras de Excel,
scripts PowerShell o procesos de sincronización sin revisar primero
sus dependencias.

---

## 8. WHATSAPP

WhatsApp Web.js forma parte de la aplicación.

No modificar el flujo de WhatsApp salvo que la tarea lo requiera.

Cualquier cambio debe comprobar:

- conexión;
- reconexión;
- envío;
- generación del mensaje;
- manejo de errores.

---

## 9. INTELIGENCIA ARTIFICIAL

La aplicación contiene funcionalidades relacionadas con IA.

La IA utilizada dentro de la aplicación debe mantener sus restricciones
actuales, especialmente cuando consulta información de la base de datos.

No permitir que una función de IA pueda modificar datos si actualmente
solo tiene permisos de consulta.

Las consultas generadas deben continuar siendo controladas y limitadas.

---

## 10. FRONTEND

Las páginas principales están dentro de:

Public/

Muchas páginas contienen HTML, CSS y JavaScript.

No convertir automáticamente toda la aplicación a un framework.

Cuando se solicite mejorar una página:

1. conservar la funcionalidad;
2. mejorar la estructura cuando sea necesario;
3. mantener compatibilidad con el backend;
4. mantener los endpoints existentes;
5. mantener nombres de campos y parámetros salvo que exista una razón real;
6. evitar duplicación innecesaria.

---

## 11. TABLETS

La aplicación está diseñada principalmente para tablets.

Todo cambio visual debe comprobarse especialmente en:

- 768 px
- 820 px
- 1024 px
- orientación vertical
- orientación horizontal

Evitar:

- desbordamiento horizontal;
- botones demasiado pequeños;
- texto ilegible;
- tablas imposibles de utilizar;
- formularios incómodos;
- elementos que queden fuera de pantalla.

Los controles táctiles deben tener un tamaño razonable.

---

## 12. IMPRESIÓN Y REPORTES

La aplicación genera reportes y utiliza impresión/PDF.

Cuando una página tenga impresión:

- no romper los estilos de impresión;
- comprobar tablas largas;
- comprobar saltos de página;
- comprobar imágenes;
- comprobar encabezados;
- comprobar contenido que pueda cortarse.

El resultado visual en pantalla y el resultado impreso son igualmente importantes
cuando la página tenga función de impresión.

---

## 13. PLAST INNOVA DESIGN SYSTEM

Existe un Design System local en:

Plast Innova design system/

Debe utilizarse como fuente principal de referencia visual.

Revisar sus archivos antes de crear o modificar interfaces importantes.

Respetar:

- colores;
- tipografías;
- espaciado;
- componentes;
- botones;
- tarjetas;
- iconografía;
- tablas;
- formularios;
- estados;
- patrones visuales.

No inventar un sistema visual diferente.

No utilizar gradientes morados.

No utilizar emojis como iconos de interfaz.

Utilizar los assets oficiales del proyecto cuando corresponda.

La interfaz debe mantener una apariencia:

- corporativa;
- industrial;
- limpia;
- profesional;
- consistente;
- apropiada para producción/calidad.

---

## 14. ICONOS

Preferir Font Awesome y los iconos establecidos por el proyecto.

No utilizar emojis como sustitutos de iconos de interfaz.

Los iconos deben tener significado claro y consistente.

---

## 15. IDIOMA Y CONTENIDO

La interfaz está dirigida a usuarios de Colombia.

Utilizar español claro y profesional.

Preferir tuteo cuando corresponda.

No cambiar textos funcionales existentes sin necesidad.

Mantener consistencia en:

- nombres de estados;
- botones;
- mensajes;
- títulos;
- fechas;
- números;
- unidades.

---

## 16. CAMBIOS DE DISEÑO

Cuando el usuario proporcione un diseño, boceto, captura o referencia:

- utilizarlo como objetivo visual;
- adaptarlo a la arquitectura existente;
- conservar la funcionalidad actual;
- no copiar ciegamente elementos que contradigan el Design System;
- mantener responsive;
- mantener impresión si existe.

El diseño debe integrarse con la aplicación, no convertirse en una página
aislada que no respete el sistema existente.

---

## 17. COLABORACIÓN CON OPENCODE

Claude es el implementador principal.

OpenCode/Nemotron 3 Ultra Free se utiliza como auditor técnico.

Por lo tanto:

Claude:
- analiza;
- implementa;
- corrige.

OpenCode:
- audita;
- detecta problemas;
- propone correcciones;
- puede realizar correcciones controladas cuando se le solicite.

No asumir que un cambio sugerido por OpenCode necesariamente debe aplicarse.

No reescribir trabajo existente solamente por diferencias de estilo.

Priorizar errores reales, riesgos reales y problemas funcionales.

---

## 18. GIT

No realizar:

- git reset destructivo;
- git checkout destructivo;
- eliminación masiva de archivos;
- sobrescritura de cambios del usuario;

sin autorización explícita.

Antes de cambios grandes revisar el estado del repositorio.

No modificar archivos que no estén relacionados con la tarea.

---

## 19. VERIFICACIÓN

Antes de considerar terminada una tarea:

### Código
- revisar sintaxis;
- revisar errores evidentes;
- revisar imports/requires;
- revisar referencias.

### Backend
- comprobar rutas;
- comprobar respuestas;
- comprobar permisos.

### Base de datos
- comprobar consultas;
- comprobar integridad;
- comprobar compatibilidad.

### Frontend
- comprobar JavaScript;
- comprobar formularios;
- comprobar botones;
- comprobar responsive.

### Tablet
- comprobar 768/820/1024 px cuando corresponda.

### Impresión
- comprobar impresión/PDF cuando corresponda.

---

## 20. NO HACER

No:

- refactorizar toda la aplicación por una tarea pequeña;
- cambiar tecnologías sin autorización;
- eliminar funcionalidad existente;
- modificar la base de datos innecesariamente;
- cambiar endpoints sin necesidad;
- cambiar rutas críticas sin revisar dependencias;
- cambiar el diseño de otras páginas sin relación con la tarea;
- corregir problemas no relacionados solamente porque fueron encontrados.

Si encuentras otro problema que no pertenece a la tarea:

INFORMARLO, pero no solucionarlo automáticamente.

---

## 21. INFORME FINAL

Al terminar una tarea, informar:

### Cambios realizados
- archivo;
- cambio;
- motivo.

### Verificaciones realizadas
- sintaxis;
- funcionalidad;
- responsive;
- impresión;
- permisos;
- base de datos, cuando corresponda.

### Problemas encontrados
Indicar cualquier problema adicional descubierto que no haya sido modificado.

### Riesgos
Indicar cualquier riesgo que requiera atención posterior.

Mantener el informe claro y breve.

---

## PRINCIPIO FINAL

No buscar hacer más cambios.

Buscar hacer exactamente los cambios necesarios,
de la forma más segura posible,
manteniendo estable la aplicación existente.

ESTABILIDAD > CAMBIOS MÍNIMOS > SEGURIDAD > FUNCIONALIDAD > DISEÑO > REFACTORIZACIÓN