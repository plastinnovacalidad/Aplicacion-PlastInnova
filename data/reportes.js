const { getDb } = require('../db/connection');

// ======================== REPORTES POR ÁREAS (SOLO INFORMATIVO) ========================
// MIGRACIÓN #38 (07-08/09, pedido por Julio): este módulo tenía 3 tipos de
// reporte en una sola tabla (`reportes`, columna `tipo`) -- Rápido, Completo
// e Informativo. Julio pidió rehacer el diseño: Rápido y Completo (una
// incidencia de línea con causa raíz y medidas de solución) eran en el
// fondo la misma necesidad que Trazabilidad de Producción, solo que sin
// compartir nada entre los dos -- ambos se fusionan ahora en el módulo
// "Problemas" (ver data/problemas.js y MIGRACIÓN #38 en db/init.js).
//
// Reporte Informativo (un boletín/comunicado entre áreas, NO es un
// "problema" -- Julio confirmó explícitamente que se queda aparte, sin
// fusionar) sigue viviendo aquí, en la tabla `reportes`, que de aquí en
// adelante solo tiene registros tipo='informativo' (los Rápido/Completo que
// hubiera, confirmados de prueba, se borraron en la MIGRACIÓN #38).
const TIPOS_REPORTE = ['informativo'];

function nowSql() {
  // Mismo formato que usa el resto del esquema para DATETIME
  // (datetime('now','localtime')) -- se calcula en JS para poder usarlo
  // también como valor de parámetro, no solo como default de columna.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ======================== ÁREAS (catálogo reusado de iso_areas) ========================
function listarAreasActivas() {
  return getDb().all(`SELECT id, nombre, encargado FROM iso_areas WHERE estado = 'Activo' ORDER BY nombre`);
}

// ======================== LISTADO Y DETALLE ========================
function listarReportes({ area_id, q, limit } = {}) {
  const condiciones = ["r.tipo = 'informativo'"];
  const params = [];
  if (area_id) { condiciones.push('r.area_origen_id = ?'); params.push(area_id); }
  if (q) {
    condiciones.push('(r.titulo LIKE ? OR r.descripcion LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const where = 'WHERE ' + condiciones.join(' AND ');
  const tope = Math.max(1, Math.min(500, parseInt(limit, 10) || 200));
  params.push(tope);
  return getDb().all(
    `SELECT r.*, a.nombre AS area_origen_nombre, a.encargado AS area_origen_encargado,
       (SELECT COUNT(*) FROM reportes_adjuntos ad WHERE ad.reporte_id = r.id) AS total_adjuntos,
       (SELECT GROUP_CONCAT(ai.nombre, ', ') FROM reportes_destinos rd JOIN iso_areas ai ON ai.id = rd.area_id WHERE rd.reporte_id = r.id) AS areas_destino_nombres
     FROM reportes r
     LEFT JOIN iso_areas a ON a.id = r.area_origen_id
     ${where}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ?`,
    params
  );
}

async function obtenerReporteCompleto(id) {
  const db = getDb();
  const reporte = await db.get(
    `SELECT r.*, a.nombre AS area_origen_nombre, a.encargado AS area_origen_encargado
     FROM reportes r
     LEFT JOIN iso_areas a ON a.id = r.area_origen_id
     WHERE r.id = ? AND r.tipo = 'informativo'`,
    [id]
  );
  if (!reporte) return null;
  const adjuntos = await db.all('SELECT * FROM reportes_adjuntos WHERE reporte_id = ? ORDER BY fecha ASC, id ASC', [id]);
  const destinos = await db.all(
    `SELECT ai.id, ai.nombre FROM reportes_destinos rd JOIN iso_areas ai ON ai.id = rd.area_id WHERE rd.reporte_id = ? ORDER BY ai.nombre`,
    [id]
  );
  return { ...reporte, adjuntos, destinos };
}

// ======================== CREAR ========================
// Reporte Informativo: boletín entre áreas. `areasDestino` es un arreglo de
// ids de iso_areas (multi-selección).
async function crearReporteInformativo({ area_origen_id, titulo, contenido, fecha_vigencia, areasDestino, autorId, autorNombre }) {
  const db = getDb();
  const result = await db.run(
    `INSERT INTO reportes (tipo, area_origen_id, titulo, descripcion, fecha_vigencia, autor_id, autor_nombre)
     VALUES ('informativo', ?, ?, ?, ?, ?, ?)`,
    [area_origen_id || null, titulo, contenido, fecha_vigencia || null, autorId || null, autorNombre || null]
  );
  const reporteId = result.lastID;
  for (const areaId of areasDestino || []) {
    await db.run('INSERT OR IGNORE INTO reportes_destinos (reporte_id, area_id) VALUES (?, ?)', [reporteId, areaId]);
  }
  return obtenerReporteCompleto(reporteId);
}

// ======================== EDITAR ========================
// "Poder editarlos después de que los creemos" (pedido por Julio, 07/09) --
// `cambios` solo trae las claves que de verdad se quieren cambiar (comparar
// con undefined, no con falsy, para poder borrar un campo opcional a
// propósito). `areasDestino`, si viene, reemplaza la lista completa de
// destinos.
async function actualizarReporte(id, cambios) {
  const db = getDb();
  const reporte = await db.get("SELECT * FROM reportes WHERE id = ? AND tipo = 'informativo'", [id]);
  if (!reporte) return { error: 'no_encontrado' };

  const sets = [];
  const vals = [];
  if (cambios.area_origen_id !== undefined) { sets.push('area_origen_id = ?'); vals.push(cambios.area_origen_id || null); }
  if (cambios.titulo !== undefined) { sets.push('titulo = ?'); vals.push(cambios.titulo); }
  if (cambios.contenido !== undefined) { sets.push('descripcion = ?'); vals.push(cambios.contenido); }
  if (cambios.fecha_vigencia !== undefined) { sets.push('fecha_vigencia = ?'); vals.push(cambios.fecha_vigencia || null); }
  if (sets.length === 0 && !Array.isArray(cambios.areasDestino)) return { error: 'nada_que_actualizar' };

  if (sets.length > 0) {
    sets.push('actualizado_en = ?');
    vals.push(nowSql());
    vals.push(id);
    await db.run(`UPDATE reportes SET ${sets.join(', ')} WHERE id = ?`, vals);
  }

  if (Array.isArray(cambios.areasDestino)) {
    await db.run('DELETE FROM reportes_destinos WHERE reporte_id = ?', [id]);
    for (const areaId of cambios.areasDestino) {
      await db.run('INSERT OR IGNORE INTO reportes_destinos (reporte_id, area_id) VALUES (?, ?)', [id, areaId]);
    }
  }

  return { reporte: await obtenerReporteCompleto(id) };
}

// ======================== ADJUNTOS ========================
function agregarAdjunto({ reporte_id, archivo, nombre_original, autor_id, autor_nombre }) {
  return getDb().run(
    `INSERT INTO reportes_adjuntos (reporte_id, archivo, nombre_original, autor_id, autor_nombre) VALUES (?, ?, ?, ?, ?)`,
    [reporte_id, archivo, nombre_original || null, autor_id || null, autor_nombre || null]
  );
}

function obtenerAdjunto(reporteId, adjuntoId) {
  return getDb().get('SELECT * FROM reportes_adjuntos WHERE id = ? AND reporte_id = ?', [adjuntoId, reporteId]);
}

function eliminarAdjunto(reporteId, adjuntoId) {
  return getDb().run('DELETE FROM reportes_adjuntos WHERE id = ? AND reporte_id = ?', [adjuntoId, reporteId]);
}

module.exports = {
  TIPOS_REPORTE,
  listarAreasActivas,
  listarReportes,
  obtenerReporteCompleto,
  crearReporteInformativo,
  actualizarReporte,
  agregarAdjunto,
  obtenerAdjunto,
  eliminarAdjunto,
};
