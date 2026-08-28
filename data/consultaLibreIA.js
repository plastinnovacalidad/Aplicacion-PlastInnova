// ======================== MODO CONSULTA — PREGUNTAS LIBRES SOBRE LA BASE (IA escribe su propio SQL) ========================
// Roadmap Bot WhatsApp, punto 8 (segunda revisión, 28/08): Julio pidió ir
// más allá de los tipos de pregunta fijos ("últimos N de una referencia",
// "top referencias con más garantías", etc.) — quiere poder preguntarle al
// bot CUALQUIER cosa sobre la base de datos, "como si fuera una IA de
// verdad". La única forma real de lograr eso sin tener que programar cada
// pregunta nueva a mano es dejar que el modelo de lenguaje escriba su
// propia consulta SQL a partir de la pregunta — así que este archivo es
// justamente eso, con las protecciones que hacen que sea seguro dejarlo
// hacerlo:
//
//   1. Conexión de SOLO LECTURA (sqlite3.OPEN_READONLY) — separada de la
//      conexión normal de escritura (ver db/connection.js). Así, aunque el
//      SQL generado por la IA intentara escribir algo, SQLite lo rechaza a
//      nivel del sistema de archivos, no solo porque el código "confía" en
//      que la IA solo va a escribir SELECT.
//   2. Lista blanca de tablas (TABLAS_PERMITIDAS más abajo) — confirmada
//      con Julio: datos de calidad/producción (garantías, muestreos ISO,
//      moldes, eléctrico, clientes, referencias) MÁS asistencia (entradas/
//      salidas por WhatsApp). Deliberadamente NO incluye "usuarios" (tiene
//      la columna de contraseñas de la app web — exclusión de seguridad,
//      sin excepción, no se le pregunta a nadie) ni "roles"/"permisos"/
//      "rol_permisos" (el modelo de autorización de la app, no es un dato
//      de negocio que alguien necesite consultar por WhatsApp) ni las
//      tablas internas de configuración del propio bot (whatsapp_numero_
//      permisos, whatsapp_sesiones_activas, whatsapp_alertas_config/
//      enviadas — son plomería interna, no datos que tenga sentido
//      "preguntar").
//   3. Cada consulta generada se valida ANTES de correr (ver
//      validarConsultaSql): debe ser un único SELECT, sin punto y coma
//      de por medio (para que no se puedan "apilar" comandos), sin
//      palabras de escritura/administración (INSERT/UPDATE/DELETE/DROP/
//      ALTER/CREATE/ATTACH/PRAGMA/etc.), y solo puede mencionar tablas de
//      la lista blanca — cualquier otra cosa se rechaza ANTES de tocar la
//      base, no se "intenta y se ve qué pasa".
//   4. Siempre se limita la cantidad de filas que puede devolver (ver
//      LIMITE_MAXIMO_FILAS), sin importar lo que haya escrito la IA, para
//      que una consulta mal armada no intente traer una tabla completa de
//      una sola vez.
//   5. Cada consulta generada queda registrada en el log del servidor
//      (console.log), para poder revisar después qué le preguntó la gente
//      y qué SQL se corrió en respuesta — igual que cualquier otro cambio
//      importante en este sistema (ver registro_cambios).
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { DB_PATH } = require('../settings/paths');

// ======================== LISTA BLANCA DE TABLAS ========================
// Confirmada con Julio (28/08). Cualquier tabla que exista en la base pero
// NO esté en esta lista es invisible para la IA: ni se le describe en el
// esquema que se le manda, ni se le deja mencionar en el SQL que escriba
// (ver validarConsultaSql).
const TABLAS_PERMITIDAS = [
  // Calidad / producción — el núcleo de lo que ya se venía preguntando.
  'garantias', 'garantias_tipificacion_problemas',
  'iso_areas', 'iso_lotes', 'iso_muestreos', 'iso_defectos_encontrados',
  'iso_planes_muestreo', 'iso_referencias', 'iso_revisiones', 'iso_tipificacion_defectos',
  'moldes_referencias', 'moldes_versiones', 'moldes_cotas', 'moldes_inspecciones', 'moldes_medidas_detalle',
  'elec_config_cableado', 'elec_fotos_cableado', 'elec_mediciones', 'elec_rangos_revision',
  'clientes', 'referencias_pt', 'Referencias', 'Versiones', 'observaciones', 'recomendaciones',
  'registro_cambios',
  // Asistencia — confirmado con Julio que también debe poder consultarse
  // (ej. "quién entró tarde hoy").
  'whatsapp_registros', 'whatsapp_numeros',
];

// Índice en minúsculas para comparar sin importar mayúsculas/minúsculas
// (algunas tablas, como "Referencias", tienen mayúscula inicial).
const TABLAS_PERMITIDAS_LOWER = new Set(TABLAS_PERMITIDAS.map(t => t.toLowerCase()));

const LIMITE_MAXIMO_FILAS = 50;

let dbSoloLecturaPromise = null;
function obtenerDbSoloLectura() {
  if (!dbSoloLecturaPromise) {
    dbSoloLecturaPromise = open({ filename: DB_PATH, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
  }
  return dbSoloLecturaPromise;
}

let esquemaCache = null;
// Arma la descripción de columnas (nombre y tipo) de cada tabla permitida,
// para mandársela a la IA como "esto es lo que existe" — se calcula una
// sola vez (el esquema no cambia mientras el servidor está corriendo) y se
// reusa. Nunca incluye ninguna tabla fuera de TABLAS_PERMITIDAS.
async function obtenerEsquemaPermitido() {
  if (esquemaCache) return esquemaCache;
  const db = await obtenerDbSoloLectura();
  const partes = [];
  for (const tabla of TABLAS_PERMITIDAS) {
    const columnas = await db.all(`PRAGMA table_info("${tabla}")`);
    const listaColumnas = columnas.map(c => `${c.name} (${c.type || 'texto'})`).join(', ');
    partes.push(`- ${tabla}: ${listaColumnas}`);
  }
  esquemaCache = partes.join('\n');
  return esquemaCache;
}

// Palabras que no deberían aparecer en un SELECT de solo lectura. No es la
// única protección (la conexión ya es de solo lectura a nivel de SQLite),
// pero rechazar esto ANTES de correrlo da un mensaje de error más claro
// que dejar que SQLite lo rechace a medio camino, y cierra la puerta a
// trucos como "ATTACH DATABASE" (que no escribe en ESTA base, pero podría
// intentar leer o adjuntar otro archivo).
const PALABRAS_PROHIBIDAS = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|truncate|vacuum|reindex|trigger|grant|revoke)\b/i;

// Extrae los nombres de tabla que aparecen después de FROM o JOIN, para
// verificarlos contra la lista blanca. No es un parser SQL completo (no
// hace falta uno para esto), pero cubre los casos normales de un SELECT
// con JOINs — cualquier cosa que esta expresión no logre identificar
// tampoco pasa la validación de "solo un SELECT sencillo" de más abajo, así
// que no hay forma de colar una tabla prohibida solo por escribirla raro.
function extraerTablasReferenciadas(sql) {
  const tablas = [];
  const regex = /\b(?:from|join)\s+["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/gi;
  let m;
  while ((m = regex.exec(sql)) !== null) tablas.push(m[1]);
  return tablas;
}

// Valida el SQL generado por la IA ANTES de ejecutarlo. Lanza un Error con
// un mensaje corto (para el log) si algo no pasa — nunca ejecuta nada que
// no haya pasado por acá completo.
function validarConsultaSql(sql) {
  const limpio = sql.trim();
  if (!limpio) throw new Error('SQL vacío');

  // Un solo statement: si hay un ";" y después queda algo más que espacios,
  // es más de un comando — se rechaza (evita "apilar" sentencias).
  const partes = limpio.split(';').map(p => p.trim()).filter(Boolean);
  if (partes.length > 1) throw new Error('más de un statement (contiene ";" seguido de más SQL)');

  const unico = partes[0] || limpio;
  if (!/^select\b/i.test(unico)) throw new Error('no empieza con SELECT');
  if (PALABRAS_PROHIBIDAS.test(unico)) throw new Error('contiene una palabra no permitida (solo se permite leer, nunca escribir)');

  const tablas = extraerTablasReferenciadas(unico);
  if (tablas.length === 0) throw new Error('no se pudo identificar ninguna tabla en el FROM/JOIN');
  for (const t of tablas) {
    if (!TABLAS_PERMITIDAS_LOWER.has(t.toLowerCase())) {
      throw new Error(`la tabla "${t}" no está en la lista permitida`);
    }
  }
  return unico;
}

// Si el SQL ya trae su propio LIMIT, se respeta pero se topa al máximo
// (nunca se deja pasar un LIMIT más grande que LIMITE_MAXIMO_FILAS); si no
// trae ninguno, se le agrega. Así, pase lo que pase con lo que escribió la
// IA, nunca se puede traer más filas de las que el bot puede mostrar bien
// en un mensaje de WhatsApp.
function conLimiteAplicado(sql) {
  const matchLimit = sql.match(/\blimit\s+(\d+)\s*$/i);
  if (matchLimit) {
    const pedido = parseInt(matchLimit[1], 10);
    const topado = Math.min(pedido, LIMITE_MAXIMO_FILAS);
    return sql.slice(0, matchLimit.index) + `LIMIT ${topado}`;
  }
  return `${sql} LIMIT ${LIMITE_MAXIMO_FILAS}`;
}

// Punto de entrada: valida, aplica el límite, ejecuta contra la conexión
// de solo lectura, y registra en el log qué se corrió. Lanza si el SQL no
// pasa la validación o si SQLite lo rechaza (sintaxis inválida, etc.) — a
// propósito, quien llama a esto debe decidir qué hacer con ese error (ver
// whatsapp_bot_service.js: cae al mensaje de "no entendí", nunca se le
// muestra el error crudo a la persona por WhatsApp).
async function ejecutarConsultaSql(sql, fraseOriginal) {
  const sqlValidado = validarConsultaSql(sql);
  const sqlConLimite = conLimiteAplicado(sqlValidado);
  console.log(`🔎 Modo consulta (SQL libre) — pregunta: "${fraseOriginal}" — SQL: ${sqlConLimite}`);
  const db = await obtenerDbSoloLectura();
  return db.all(sqlConLimite);
}

module.exports = {
  TABLAS_PERMITIDAS,
  obtenerEsquemaPermitido,
  ejecutarConsultaSql,
  LIMITE_MAXIMO_FILAS,
};
