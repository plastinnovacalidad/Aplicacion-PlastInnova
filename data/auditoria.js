const { getDb } = require('../db/connection');
const { ahoraISO } = require('../utils/fechas');

// ======================== REGISTRO DE CAMBIOS (AUDITORÍA GLOBAL) ========================
// Bitácora única para todo el sistema (ver migración #8 en db/init.js).
// Antes de esto, cada módulo que quería guardar "quién cambió qué" tenía
// que crear su propia tabla (seguimiento_cambios, moldes_seguimiento_cambios,
// iso_historial_planes...). De ahora en adelante, cualquier ruta que cree,
// edite o elimine algo importante llama a registrarCambio() en vez de
// inventar una tabla nueva, y todo queda visible y filtrable en un solo
// lugar (pestaña "📜 Registro de Cambios" en Gestión).
//
// `entidad` es el nombre técnico de la tabla/concepto afectado (p. ej.
// 'defectos_iso', 'usuarios', 'garantias') — es la columna por la que se
// filtra. `modulo` agrupa varias entidades relacionadas para el filtro más
// general (p. ej. 'Catálogos' agrupa 'defectos_iso', 'areas_iso', etc.).
async function registrarCambio({ modulo, entidad, entidadId, accion, detalle, usuarioId, usuarioNombre }) {
  try {
    await getDb().run(
      `INSERT INTO registro_cambios (modulo, entidad, entidad_id, accion, detalle, hecho_por, hecho_por_nombre, fecha)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [modulo, entidad, entidadId != null ? String(entidadId) : null, accion, detalle || null, usuarioId || null, usuarioNombre || null, ahoraISO()]
    );
  } catch (e) {
    // Un fallo al registrar la auditoría nunca debe tumbar la operación
    // real que la originó (crear/editar/eliminar ya se hizo con éxito) —
    // solo se deja constancia en consola para poder investigarlo después.
    console.error('⚠️ Error registrando cambio en auditoría:', e.message);
  }
}

function listarCambios(filtros = {}) {
  const condiciones = [];
  const params = [];
  if (filtros.modulo) { condiciones.push('rc.modulo = ?'); params.push(filtros.modulo); }
  if (filtros.entidad) { condiciones.push('rc.entidad = ?'); params.push(filtros.entidad); }
  if (filtros.accion) { condiciones.push('rc.accion = ?'); params.push(filtros.accion); }
  if (filtros.usuario) { condiciones.push('(rc.hecho_por_nombre LIKE ? OR u.nombre LIKE ?)'); params.push(`%${filtros.usuario}%`, `%${filtros.usuario}%`); }
  if (filtros.desde) { condiciones.push('rc.fecha >= ?'); params.push(filtros.desde); }
  if (filtros.hasta) { condiciones.push('rc.fecha <= ?'); params.push(filtros.hasta + ' 23:59:59'); }
  if (filtros.q) { condiciones.push('(rc.detalle LIKE ? OR rc.entidad_id LIKE ?)'); params.push(`%${filtros.q}%`, `%${filtros.q}%`); }
  const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';
  return getDb().all(
    `SELECT rc.*, COALESCE(rc.hecho_por_nombre, u.nombre, 'Sistema') as usuario_nombre
     FROM registro_cambios rc LEFT JOIN usuarios u ON rc.hecho_por = u.id
     ${where}
     ORDER BY rc.fecha DESC, rc.id DESC
     LIMIT 500`,
    params
  );
}

// Para llenar los filtros desplegables con solo los módulos/entidades que
// realmente tienen registros (en vez de una lista fija que se desactualiza).
function listarModulosYEntidades() {
  return getDb().all('SELECT DISTINCT modulo, entidad FROM registro_cambios ORDER BY modulo, entidad');
}

module.exports = { registrarCambio, listarCambios, listarModulosYEntidades };
