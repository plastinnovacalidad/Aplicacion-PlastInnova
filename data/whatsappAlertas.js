const { getDb } = require('../db/connection');
const { PERMISOS_BOT_DISPONIBLES } = require('../settings/permisosBot');

// ======================== NÚMEROS AUTORIZADOS (whatsapp_numeros) ========================
// Reemplaza a WHATSAPP_NUMEROS/WHATSAPP_ADMIN_NUMERO del .env como fuente de
// verdad (esos siguen existiendo solo como respaldo de siembra inicial, ver
// MIGRACIÓN #13 en db/init.js). Cualquier cambio aquí requiere avisarle a
// whatsapp_bot_service.js para que recargue su caché en memoria — eso lo
// hacen las rutas (routes/whatsapp.js) llamando a recargarNumerosWhatsApp()
// después de cada escritura, igual que roles.js hace con recargarPermisos().

// Trae los números junto con la lista de códigos de permiso que tiene cada
// uno (whatsapp_numero_permisos), para que la pantalla de administración
// pueda mostrar y editar las casillas sin tener que pedirlas aparte por
// cada número. Se arma en JS (una consulta para los números, otra para
// todos los permisos) en vez de un JOIN con GROUP_CONCAT, para no
// depender de que la build de SQLite tenga esa función.
async function listarNumeros() {
  const db = getDb();
  const numeros = await db.all('SELECT * FROM whatsapp_numeros ORDER BY es_admin DESC, nombre');
  const permisos = await db.all('SELECT numero_id, permiso FROM whatsapp_numero_permisos');
  const porNumero = new Map();
  permisos.forEach(p => {
    if (!porNumero.has(p.numero_id)) porNumero.set(p.numero_id, []);
    porNumero.get(p.numero_id).push(p.permiso);
  });
  return numeros.map(n => ({ ...n, permisos: porNumero.get(n.id) || [] }));
}

// La usa whatsapp_bot_service.js para construir su caché en memoria (ver
// recargarNumerosWhatsApp) — por eso también trae los permisos de cada
// número, para no tener que consultarlos aparte por cada mensaje que llega.
async function listarNumerosActivos() {
  const db = getDb();
  const numeros = await db.all('SELECT * FROM whatsapp_numeros WHERE activo = 1');
  const permisos = await db.all(`
    SELECT np.numero_id, np.permiso FROM whatsapp_numero_permisos np
    JOIN whatsapp_numeros n ON n.id = np.numero_id
    WHERE n.activo = 1
  `);
  const porNumero = new Map();
  permisos.forEach(p => {
    if (!porNumero.has(p.numero_id)) porNumero.set(p.numero_id, new Set());
    porNumero.get(p.numero_id).add(p.permiso);
  });
  return numeros.map(n => ({ ...n, permisos: porNumero.get(n.id) || new Set() }));
}

function obtenerNumeroPorId(id) {
  return getDb().get('SELECT * FROM whatsapp_numeros WHERE id = ?', [id]);
}

// Un número nuevo siempre nace con 'registro_entrada' (marcar entrada/
// salida es la base, igual que antes de que existieran estos permisos
// granulares); si se marca como administrador, además recibe todos los
// permisos de calidad, para que quede funcional de una vez sin tener que
// entrar aparte a marcarle cada casilla.
async function crearNumero({ telefono, nombre, es_admin }) {
  const db = getDb();
  const result = await db.run(
    'INSERT INTO whatsapp_numeros (telefono, nombre, es_admin) VALUES (?, ?, ?)',
    [telefono, nombre, es_admin ? 1 : 0]
  );
  const permisosIniciales = ['registro_entrada', ...(es_admin ? PERMISOS_BOT_DISPONIBLES.map(p => p.codigo) : [])];
  await asignarPermisosANumero(result.lastID, permisosIniciales);
  return result;
}

function actualizarNumero(id, { nombre, es_admin, activo }) {
  const sets = [];
  const vals = [];
  if (nombre !== undefined) { sets.push('nombre = ?'); vals.push(nombre); }
  if (es_admin !== undefined) { sets.push('es_admin = ?'); vals.push(es_admin ? 1 : 0); }
  if (activo !== undefined) { sets.push('activo = ?'); vals.push(activo ? 1 : 0); }
  if (sets.length === 0) return Promise.resolve({ changes: 0 });
  vals.push(id);
  return getDb().run(`UPDATE whatsapp_numeros SET ${sets.join(', ')} WHERE id = ?`, vals);
}

function eliminarNumero(id) {
  // ON DELETE CASCADE en whatsapp_numero_permisos se encarga de limpiar sus
  // permisos también.
  return getDb().run('DELETE FROM whatsapp_numeros WHERE id = ?', [id]);
}

// ======================== PERMISOS POR NÚMERO (whatsapp_numero_permisos) ========================

function listarPermisosDeNumero(numeroId) {
  return getDb().all('SELECT permiso FROM whatsapp_numero_permisos WHERE numero_id = ?', [numeroId]).then(rows => rows.map(r => r.permiso));
}

// Reemplaza el conjunto completo de permisos de un número (borra todos los
// que tenía e inserta la lista nueva) — mismo patrón que
// borrarPermisosDeRol/asignarPermisoARol en data/roles.js para los roles de
// la app. Filtra contra PERMISOS_BOT_DISPONIBLES para no guardar códigos
// inventados si algún día llega un valor raro desde el formulario.
async function asignarPermisosANumero(numeroId, permisos) {
  const db = getDb();
  const validos = new Set(PERMISOS_BOT_DISPONIBLES.map(p => p.codigo));
  const lista = (Array.isArray(permisos) ? permisos : []).filter(p => validos.has(p));
  await db.run('DELETE FROM whatsapp_numero_permisos WHERE numero_id = ?', [numeroId]);
  for (const permiso of lista) {
    await db.run('INSERT OR IGNORE INTO whatsapp_numero_permisos (numero_id, permiso) VALUES (?, ?)', [numeroId, permiso]);
  }
}

// ======================== CONFIGURACIÓN DE ALERTAS (whatsapp_alertas_config) ========================

function listarConfigAlertas() {
  return getDb().all('SELECT * FROM whatsapp_alertas_config ORDER BY tipo');
}

function obtenerConfigAlerta(tipo) {
  return getDb().get('SELECT * FROM whatsapp_alertas_config WHERE tipo = ?', [tipo]);
}

function actualizarConfigAlerta(tipo, { activo, umbral, ventana_dias }) {
  const sets = ["actualizado_en = datetime('now','localtime')"];
  const vals = [];
  if (activo !== undefined) { sets.push('activo = ?'); vals.push(activo ? 1 : 0); }
  if (umbral !== undefined) { sets.push('umbral = ?'); vals.push(umbral === null ? null : parseInt(umbral, 10)); }
  if (ventana_dias !== undefined) { sets.push('ventana_dias = ?'); vals.push(ventana_dias === null ? null : parseInt(ventana_dias, 10)); }
  vals.push(tipo);
  return getDb().run(`UPDATE whatsapp_alertas_config SET ${sets.join(', ')} WHERE tipo = ?`, vals);
}

// ======================== DEDUPLICACIÓN DE ENVÍOS (whatsapp_alertas_enviadas) ========================

async function yaSeEnvio(tipo, clave) {
  const fila = await getDb().get(
    'SELECT id FROM whatsapp_alertas_enviadas WHERE tipo = ? AND clave = ?',
    [tipo, clave]
  );
  return !!fila;
}

function marcarEnviado(tipo, clave) {
  return getDb().run(
    'INSERT OR IGNORE INTO whatsapp_alertas_enviadas (tipo, clave) VALUES (?, ?)',
    [tipo, clave]
  );
}

module.exports = {
  listarNumeros,
  listarNumerosActivos,
  obtenerNumeroPorId,
  crearNumero,
  actualizarNumero,
  eliminarNumero,
  listarPermisosDeNumero,
  asignarPermisosANumero,
  listarConfigAlertas,
  obtenerConfigAlerta,
  actualizarConfigAlerta,
  yaSeEnvio,
  marcarEnviado,
};
