// ======================== CONFIGURACIÓN (rutas y constantes fijas) ========================
// Todo lo que antes vivía suelto arriba de app_circuitos.js ahora vive aquí,
// para que cualquier módulo (routes/, data/, middleware/) pueda importarlo
// sin tener que pasar por app_circuitos.js.
require('dotenv').config();

const fs = require('fs');
const path = require('path');

// __dirname aquí es .../settings, así que subimos un nivel para que las rutas
// relativas (sesiones.json, la carpeta db/, etc.) sigan apuntando a la raíz
// del proyecto, exactamente como antes.
const RAIZ_PROYECTO = path.join(__dirname, '..');

const SESSIONS_FILE = path.join(RAIZ_PROYECTO, 'sesiones.json');
// La base de datos vivía suelta en la raíz del proyecto; ahora vive junto con
// db/connection.js y db/init.js, todo lo relacionado con SQLite en un mismo
// lugar. SQLite crea automáticamente base_datos.db-wal y base_datos.db-shm
// al lado de este archivo mientras el servidor está corriendo (modo WAL).
const DB_PATH = path.join(RAIZ_PROYECTO, 'db', 'base_datos.db');

// Tiempo máximo de inactividad antes de cerrar la sesión sola (equipos compartidos)
const SESSION_INACTIVITY_MS = 60 * 60 * 1000; // 1 hora

const SALT_ROUNDS = 10;

// Estas carpetas se definen en el archivo .env (variable CARPETAS_FOTOS,
// rutas separadas por "|"). Si no existe el .env o la variable, se usan estos
// mismos valores de siempre como respaldo, para que nada se rompa.
const CARPETAS_FOTOS = process.env.CARPETAS_FOTOS
  ? process.env.CARPETAS_FOTOS.split('|').map(p => p.trim()).filter(Boolean)
  : [
      'E:\\',
      'C:\\Users\\produ\\OneDrive\\Escritorio\\27.2 Imagen_Circuito',
      'C:\\Users\\produ\\OneDrive\\Escritorio\\Fotos planos'
    ];

// Carpeta donde viven las fotos de "forma de cableado" del módulo Valores y
// Cableado (antes eran links de Google Drive; ahora Julio sube el archivo
// real y este servidor lo guarda/busca aquí, con el mismo nombre que ya
// tenía en el catálogo — ej. "1017.jpg"). Configurable en .env
// (CARPETA_FOTOS_CABLEADO); si no existe, se usa esta ruta real como
// respaldo, igual que las demás carpetas de arriba.
const CARPETA_FOTOS_CABLEADO = process.env.CARPETA_FOTOS_CABLEADO
  || 'C:\\Users\\produ\\OneDrive\\Escritorio\\FOTOS Formas de cablear';

// Rutas de los CSV de importación inicial de metrología (configurables en .env)
const RUTAS_CSV_PATH = process.env.RUTAS_CSV_PATH || 'C:\\Users\\produ\\OneDrive\\Escritorio\\Rutas.csv';
const COTAS_CSV_PATH = process.env.COTAS_CSV_PATH || 'C:\\Users\\produ\\OneDrive\\Escritorio\\cotas.csv';

// Números de WhatsApp autorizados a usar el bot, con su nombre para mostrar.
// Formato en .env: "numero:nombre|numero:nombre" (variable WHATSAPP_NUMEROS).
// Si no existe el .env o la variable, se usan estos mismos números de siempre
// como respaldo, para que nada se rompa.
function parseNumerosWhatsApp(raw) {
  const ALLOWED_NUMBERS = [];
  const NOMBRES = {};
  raw.split('|').forEach(par => {
    const partes = par.split(':');
    const numero = (partes[0] || '').trim();
    if (!numero) return;
    ALLOWED_NUMBERS.push(numero);
    NOMBRES[numero] = partes.slice(1).join(':').trim() || numero;
  });
  return { ALLOWED_NUMBERS, NOMBRES };
}

const WHATSAPP_NUMEROS = process.env.WHATSAPP_NUMEROS
  ? parseNumerosWhatsApp(process.env.WHATSAPP_NUMEROS)
  : {
      ALLOWED_NUMBERS: ['199939468558544@lid', '573202502529@c.us'],
      NOMBRES: { '199939468558544@lid': 'Julio', '573202502529@c.us': 'Compañero 1' },
    };

// Número que recibe el resumen diario y puede usar el comando "cerrar <numero>".
// Debe ser uno de los números listados arriba en WHATSAPP_NUMEROS.
const WHATSAPP_ADMIN_NUMERO = process.env.WHATSAPP_ADMIN_NUMERO || '199939468558544@lid';

// Mensaje de despedida al cerrar el registro del día (admite {nombre}).
const WHATSAPP_MENSAJE_SALIDA = process.env.WHATSAPP_MENSAJE_SALIDA
  || '¡Buen trabajo {nombre}! Descansa y nos vemos mañana. 👋';

const OBSOLETAS_DIR = path.join(RAIZ_PROYECTO, 'uploads', 'obsoletas');
const TMP_DIR = path.join(RAIZ_PROYECTO, 'uploads', 'tmp');
const EVIDENCIAS_DIR = path.join(RAIZ_PROYECTO, 'uploads', 'evidencias');

// Cuántos días se guarda un archivo en uploads/obsoletas (fotos y planos que
// quedaron reemplazados por una versión nueva) antes de borrarlo en la
// limpieza periódica automática. Configurable por si 90 días no es lo que se
// necesita; con el valor de siempre (no se borraba nada) bastaba con no
// definir la variable en el .env.
const DIAS_RETENCION_OBSOLETAS = process.env.DIAS_RETENCION_OBSOLETAS
  ? parseInt(process.env.DIAS_RETENCION_OBSOLETAS, 10)
  : 90;

// Cuántos días sin ningún muestreo nuevo tienen que pasar para que un lote
// de Muestreos ISO 2859-1 que sigue "Pendiente" se cierre solo (sin llegar a
// tener una Auditoría Final). Nace de un problema real: en Producción a
// veces se le hacen varias pasadas "En Proceso" a un lote pero nunca queda
// claro cuándo terminó esa corrida, así que el lote se quedaba en Pendiente
// para siempre. Configurable por si 5 días no calza con el ritmo real de la
// planta.
const DIAS_INACTIVIDAD_CIERRE_LOTES_ISO = process.env.DIAS_INACTIVIDAD_CIERRE_LOTES_ISO
  ? parseInt(process.env.DIAS_INACTIVIDAD_CIERRE_LOTES_ISO, 10)
  : 5;

// Antes existían dos copias del logo: una en config/ (para la marca de agua
// de las fotos y para GET /api/logo) y otra en Public/img/ (para el logo que
// se ve en el encabezado y el login de las 8 páginas). Luego se unificaron
// en una sola copia en Public/img/logo.png. Ahora Public/img/ ya no se usa
// para nada (el logo del header y del login se sirven directo desde
// "Plast Innova design system/assets" vía /marca — ver app_circuitos.js),
// así que este PATH también apunta ahí: usa app-logo.png (el logo a color
// compacto), porque tanto la marca de agua sobre fotos como el PDF de ISO
// 2859 se dibujan sobre fondo blanco/claro, donde la versión "ng" (blanca)
// del manual de marca no se vería.
const LOGO_PATH = path.join(RAIZ_PROYECTO, 'Plast Innova design system', 'assets', 'app-logo.png');

[OBSOLETAS_DIR, TMP_DIR, EVIDENCIAS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// A diferencia de las de arriba, esta carpeta SÍ puede no existir todavía
// (vive en el escritorio de Julio, fuera del proyecto) — se crea sola la
// primera vez que hace falta, en vez de fallar si todavía no existe.
if (!fs.existsSync(CARPETA_FOTOS_CABLEADO)) {
  try { fs.mkdirSync(CARPETA_FOTOS_CABLEADO, { recursive: true }); } catch (e) { /* se reintenta más adelante si hace falta */ }
}

const PORT = process.env.PORT || 3000;

module.exports = {
  RAIZ_PROYECTO,
  SESSIONS_FILE,
  DB_PATH,
  SESSION_INACTIVITY_MS,
  SALT_ROUNDS,
  CARPETAS_FOTOS,
  CARPETA_FOTOS_CABLEADO,
  RUTAS_CSV_PATH,
  COTAS_CSV_PATH,
  OBSOLETAS_DIR,
  TMP_DIR,
  EVIDENCIAS_DIR,
  DIAS_RETENCION_OBSOLETAS,
  DIAS_INACTIVIDAD_CIERRE_LOTES_ISO,
  LOGO_PATH,
  PORT,
  WHATSAPP_NUMEROS,
  WHATSAPP_ADMIN_NUMERO,
  WHATSAPP_MENSAJE_SALIDA,
};
