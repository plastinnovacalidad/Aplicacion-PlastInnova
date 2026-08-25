# Sistema de Calidad y Control — Plast-Innova

Aplicación interna para el control de calidad de circuitos SMD, gestión de garantías,
metrología de moldes y registro de asistencia por WhatsApp.

## Requisitos

- Node.js 18 o superior.
- Google Chrome o Chromium instalado (lo usa el bot de WhatsApp para conectarse a WhatsApp Web).

## Instalación

1. Instalar las dependencias:

   ```
   npm install
   ```

2. Copiar `.env.example` como `.env` y ajustar las rutas según el computador donde se
   instale la aplicación (ver la sección "Variables de entorno" abajo). Si no se crea
   este archivo, la aplicación sigue funcionando con los mismos valores que tenía antes
   de agregar esta configuración (quedaron como respaldo en el código).

3. Iniciar el servidor:

   ```
   npm start
   ```

4. Abrir `http://localhost:3000` (o el puerto configurado en `PORT`) en el navegador.

La primera vez que arranca, si la base de datos no tiene usuarios, se crean tres
cuentas iniciales:

| Usuario     | Contraseña     | Rol       |
|-------------|----------------|-----------|
| admin       | admin123       | Administrador |
| inspector   | inspector123   | Inspector de calidad |
| operario    | operario123    | Operario de planta |

**Importante:** cambiar estas contraseñas desde el módulo de Gestión de Usuarios apenas
se tenga acceso, especialmente en un ambiente de producción.

## Variables de entorno

Todas son opcionales — si falta alguna (o todo el archivo `.env`), la aplicación usa el
mismo valor que tenía antes de que existiera esta configuración.

| Variable | Para qué sirve |
|---|---|
| `PORT` | Puerto donde corre el servidor (por defecto 3000). |
| `CARPETAS_FOTOS` | Carpetas donde el sistema busca las fotos de circuitos SMD, separadas por `\|`. |
| `RUTAS_CSV_PATH` | Ruta del CSV con los planos de metrología que se importa una sola vez al crear referencias que aún no existan. |
| `COTAS_CSV_PATH` | Ruta del CSV con las cotas iniciales de metrología (mismo criterio de importación única). |
| `WHATSAPP_NUMEROS` | Números autorizados a usar el bot de asistencia por WhatsApp, con su nombre. Formato: `numero:nombre\|numero:nombre`. |
| `WHATSAPP_ADMIN_NUMERO` | Número que recibe el resumen diario y puede usar el comando `cerrar <numero>`. Debe ser uno de los listados en `WHATSAPP_NUMEROS`. |
| `WHATSAPP_MENSAJE_SALIDA` | Mensaje que se envía al cerrar el registro del día. Admite `{nombre}`, `{area}`, `{duracion}`, `{horaEntrada}` y `{horaSalida}`. |

## Módulos

Todos se abren desde el portal principal (`/`) tras iniciar sesión, o directamente por
su URL:

- **Circuitos SMD** (`/smd.html`): revisión de fotos de circuitos, observaciones y
  recomendaciones técnicas por referencia.
- **Garantías** (`/garantias.html`): registro y seguimiento de garantías de producto
  terminado, con tablero analítico (dashboard).
- **Metrología** (`/metrologia.html`): planos de molde, cotas, tolerancias e
  inspecciones dimensionales.
- **Gestión** (`/gestion.html`): administración de usuarios, roles y permisos.
- **Bot de WhatsApp** (`/whatsapp_bot.html`): registro de entrada/salida del personal
  por área a través de WhatsApp, con resumen diario automático para el administrador.

## Bot de WhatsApp

Al arrancar el servidor por primera vez (o si se borra la sesión guardada), la consola
muestra un código QR: hay que escanearlo desde WhatsApp en el teléfono vinculado a la
cuenta que usará el bot (Configuración → Dispositivos vinculados). Una vez escaneado,
la sesión queda guardada localmente y no hace falta repetir este paso en los siguientes
arranques, salvo que WhatsApp invalide la sesión (por ejemplo, si se cierra desde el
celular) — en ese caso la consola muestra un aviso pidiendo volver a escanear el QR.

Si se pierde la conexión a internet, el bot reintenta reconectarse automáticamente
(con espera creciente entre intento e intento) sin necesidad de reiniciar el servidor.

## Estructura del proyecto

```
app_circuitos.js         Punto de entrada: configura Express y arranca el servidor
db/                       Conexión a SQLite, inicialización y migraciones del esquema
routes/                   Endpoints de la API, uno por módulo
data/                     Acceso a la base de datos (consultas SQL), uno por módulo
middleware/               Autenticación, permisos y manejo de errores
settings/                 Configuración (rutas, permisos disponibles, áreas y horarios del bot)
utils/                    Funciones auxiliares (archivos, validación, fechas, versiones)
Public/                   Frontend (HTML, CSS y JS servidos al navegador)
whatsapp_bot_service.js   Lógica del bot de WhatsApp
docs/                     Documentación de apoyo (plan de mejora, etc.)
```

## Respaldo de la base de datos

La base de datos es un único archivo SQLite (`db/base_datos.db`). Para respaldarla basta
con copiar ese archivo con el servidor detenido (o, si va a copiarse con el servidor
corriendo, copiar también `db/base_datos.db-wal` y `db/base_datos.db-shm` si existen,
para no perder cambios recientes que todavía no se hayan volcado al archivo principal).
