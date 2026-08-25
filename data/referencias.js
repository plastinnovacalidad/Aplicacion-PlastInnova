const { getDb } = require('../db/connection');
const { ahoraISO } = require('../utils/fechas');
const { registrarCambio } = require('./auditoria');

// ---- Referencias ----
function existeReferenciaPorCodigo(codigoBase) {
  return getDb().get('SELECT id FROM referencias WHERE codigo_base = ?', [codigoBase]);
}

function crearReferencia(codigoBase, usuarioId) {
  return getDb().run(
    'INSERT INTO referencias (codigo_base, creado_por, created_at) VALUES (?, ?, ?)',
    [codigoBase, usuarioId, ahoraISO()]
  );
}

function buscarReferenciaPorCodigo(codigoBase) {
  return getDb().get('SELECT * FROM referencias WHERE codigo_base = ?', [codigoBase]);
}

function buscarIdReferenciaPorCodigo(codigoBase) {
  return getDb().get('SELECT id FROM referencias WHERE codigo_base = ?', [codigoBase]);
}

function buscarReferenciaPorId(id) {
  return getDb().get('SELECT * FROM referencias WHERE id = ?', [id]);
}

function listarCodigosReferencias() {
  return getDb().all('SELECT codigo_base FROM referencias ORDER BY codigo_base');
}

// Para el punto rojo "necesita prueba" en la lista de Circuitos SMD: antes
// esa lista solo traía los códigos (sin este dato), así que el punto nunca
// se pintaba para nada que no fuera la referencia seleccionada en pantalla
// en ese momento — Julio no lo pidió explícitamente pero se encontró
// revisando el módulo, y como el punto solo se usa hoy para decidir "on/off"
// alcanza con la lista de códigos cuya VERSIÓN ACTIVA todavía necesita
// prueba (no hace falta traer el resto de campos de esa versión).
function listarCodigosConPruebaPendiente() {
  return getDb().all(`
    SELECT DISTINCT r.codigo_base
    FROM referencias r
    JOIN versiones v ON v.referencia_id = r.id
    WHERE LOWER(v.estado) = 'activa' AND v.necesita_prueba = 1
  `);
}

function buscarReferenciaConCreador(codigoBase) {
  return getDb().get(`
    SELECT r.id, r.codigo_base, r.creado_por, r.created_at, u.nombre as creado_por_nombre
    FROM referencias r
    LEFT JOIN usuarios u ON r.creado_por = u.id
    WHERE r.codigo_base = ?
  `, [codigoBase]);
}

// ---- Versiones ----
function crearVersion(referenciaId, version, imagenRuta, estado, usuarioId, necesitaPrueba) {
  return getDb().run(
    'INSERT INTO versiones (referencia_id, version, imagen_ruta, estado, creado_por, created_at, necesita_prueba) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [referenciaId, version, imagenRuta, estado, usuarioId, ahoraISO(), necesitaPrueba]
  );
}

// Usada al crear una nueva versión, al modificar la versión actual, y en
// /api/fotos/* para mostrar la foto en Circuitos SMD — las tres necesitan
// ponerse de acuerdo en cuál es "la" versión activa de una referencia.
//
// Antes /api/fotos/* usaba una consulta APARTE (buscarVersionActivaPrimera,
// sin ORDER BY) mientras que crear/modificar versión usaba esta con
// "ORDER BY id DESC". Mientras solo hubiera una fila 'activa' por
// referencia daba igual, pero cuando por algún motivo quedan dos (ver nota
// en marcarVersionObsoleta más abajo) cada consulta podía devolver una
// distinta — entonces SMD mostraba una foto, y "Modificar versión"/"Nueva
// versión" editaba la OTRA, dando la sensación de que el cambio "no pegaba".
// Por eso ahora hay una sola función para las dos cosas.
function buscarVersionActivaMasReciente(referenciaId) {
  return getDb().get(
    'SELECT * FROM versiones WHERE referencia_id = ? AND LOWER(estado) = ? ORDER BY id DESC LIMIT 1',
    [referenciaId, 'activa']
  );
}

// Alias histórico de buscarVersionActivaMasReciente — se deja el nombre por
// si algo más lo importa, pero ya no es una consulta distinta (ver nota
// arriba: tener dos consultas separadas fue justamente la causa de que
// mostrar y editar la versión activa pudieran no coincidir).
const buscarVersionActivaPrimera = buscarVersionActivaMasReciente;

function existeVersion(referenciaId, version) {
  return getDb().get('SELECT id FROM versiones WHERE referencia_id = ? AND version = ?', [referenciaId, version]);
}

// Red de seguridad: al crear o modificar una versión, deja como 'activa'
// SOLO la que corresponde (idQueQuedaActiva) y pasa a 'obsoleta' cualquier
// otra fila de esa misma referencia que hubiera quedado marcada 'activa'
// por error (por ejemplo, versiones importadas de la app vieja de Valores y
// Cableado, o versiones viejas que un bug anterior no alcanzó a retirar).
// Así, aunque hoy existan referencias con más de una versión activa, se van
// autocorrigiendo solas la próxima vez que Julio las edite.
function retirarOtrasVersionesActivas(referenciaId, idQueQuedaActiva) {
  return getDb().run(
    "UPDATE versiones SET estado = 'obsoleta' WHERE referencia_id = ? AND LOWER(estado) = 'activa' AND id != ?",
    [referenciaId, idQueQuedaActiva]
  );
}

// Antes de aplicar la red de seguridad de arriba, esto deja ver QUÉ filas
// se van a retirar (id + imagen_ruta) — así quien la llama puede mover el
// archivo de cada una a obsoletas antes de marcarla, en vez de solo
// cambiarle el estado en la base de datos y dejar la foto abandonada en la
// carpeta de fotos activas (ver uso en routes/referencias.js, junto a
// marcarVersionObsoletaConRuta/marcarVersionObsoleta).
function listarOtrasVersionesActivas(referenciaId, idQueQuedaActiva) {
  return getDb().all(
    "SELECT id, imagen_ruta FROM versiones WHERE referencia_id = ? AND LOWER(estado) = 'activa' AND id != ?",
    [referenciaId, idQueQuedaActiva]
  );
}

function marcarVersionObsoletaConRuta(imagenRuta, id) {
  return getDb().run('UPDATE versiones SET estado = ?, imagen_ruta = ? WHERE id = ?', ['obsoleta', imagenRuta, id]);
}

function marcarVersionObsoleta(id) {
  return getDb().run('UPDATE versiones SET estado = ? WHERE id = ?', ['obsoleta', id]);
}

function actualizarImagenVersion(imagenRuta, id) {
  return getDb().run('UPDATE versiones SET imagen_ruta = ? WHERE id = ?', [imagenRuta, id]);
}

function marcarNecesitaPrueba(id, valor) {
  return getDb().run('UPDATE versiones SET necesita_prueba = ? WHERE id = ?', [valor, id]);
}

function listarVersionesPorReferencia(referenciaId) {
  return getDb().all('SELECT * FROM versiones WHERE referencia_id = ? ORDER BY id DESC', [referenciaId]);
}

// ---- Seguimiento de cambios (con validación de integridad) ----
async function insertarSeguimientoCambios(referenciaId, tipoCambio, cambioObj, hechoPor, motivo) {
  const db = getDb();
  // DEBUG: Verificar integridad referencial antes de insertar
  const refCheck = await db.get('SELECT id, codigo_base FROM referencias WHERE id = ?', [referenciaId]);
  if (!refCheck) {
    console.error(`🚨 INTEGRIDAD: referencia_id=${referenciaId} NO EXISTE en tabla referencias. Tipo cambio: ${tipoCambio}`);
    console.error(`🚨 Stack trace conceptual: tipo=${tipoCambio}, hecho_por=${hechoPor}`);
    console.error(`🚨 Cambio intentado:`, JSON.stringify(cambioObj, null, 2));
    throw new Error(`referencia_id ${referenciaId} no existe en tabla referencias. Posible corrupción de datos.`);
  }
  // Antes esto también se guardaba en su propia tabla (seguimiento_cambios);
  // ahora todo el historial de cambios de la aplicación vive en un solo
  // lugar (registro_cambios, ver migración #8/#9 en db/init.js y
  // data/auditoria.js), para no tener la misma información repartida en
  // varias tablas ni arriesgarse a que queden desincronizadas.
  await registrarCambio({
    modulo: 'Circuitos SMD', entidad: 'referencias', entidadId: refCheck.codigo_base,
    accion: tipoCambio && tipoCambio.startsWith('creacion') ? 'Creación' : 'Edición',
    detalle: motivo || (typeof cambioObj === 'string' ? cambioObj : JSON.stringify(cambioObj)),
    usuarioId: hechoPor
  });
}

// Ya no lee de la tabla seguimiento_cambios (eliminada, ver migración #9):
// el historial de una referencia ahora se filtra directamente sobre la
// bitácora global por su código, que es como también se puede consultar
// desde la pestaña "Registro de Cambios" en Gestión.
function listarSeguimientoPorReferencia(codigoBase) {
  return getDb().all(
    `SELECT accion as tipo_cambio, detalle as cambio, detalle as motivo,
            COALESCE(hecho_por_nombre, (SELECT nombre FROM usuarios WHERE id = registro_cambios.hecho_por), 'Sistema') as hecho_por_nombre,
            hecho_por, fecha as fecha_cambio
     FROM registro_cambios
     WHERE entidad = 'referencias' AND entidad_id = ?
     ORDER BY fecha DESC`,
    [codigoBase]
  );
}

module.exports = {
  existeReferenciaPorCodigo,
  crearReferencia,
  buscarReferenciaPorCodigo,
  buscarIdReferenciaPorCodigo,
  buscarReferenciaPorId,
  listarCodigosReferencias,
  listarCodigosConPruebaPendiente,
  buscarReferenciaConCreador,
  crearVersion,
  buscarVersionActivaMasReciente,
  buscarVersionActivaPrimera,
  retirarOtrasVersionesActivas,
  listarOtrasVersionesActivas,
  existeVersion,
  marcarVersionObsoletaConRuta,
  marcarVersionObsoleta,
  actualizarImagenVersion,
  marcarNecesitaPrueba,
  listarVersionesPorReferencia,
  insertarSeguimientoCambios,
  listarSeguimientoPorReferencia,
};
