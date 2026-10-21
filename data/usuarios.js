const { getDb } = require('../db/connection');

function listarUsuarios() {
  return getDb().all(`
    SELECT u.id, u.nombre, u.usuario, u.rol_id, u.telefono, r.nombre as rol_nombre
    FROM usuarios u LEFT JOIN roles r ON u.rol_id = r.id ORDER BY u.nombre
  `);
}

// Usados por Reportes por Áreas (07/09) para elegir a quién avisar de un
// Reporte Rápido: solo tiene sentido ofrecer los usuarios que ya tienen un
// número cargado (ver MIGRACIÓN #34) -- a los que no, no hay a dónde
// mandarles el aviso.
function listarUsuariosConTelefono() {
  return getDb().all(`
    SELECT id, nombre, telefono FROM usuarios
    WHERE telefono IS NOT NULL AND TRIM(telefono) <> '' ORDER BY nombre
  `);
}

function crearUsuario(nombre, usuario, contrasenaHash, rolId, creadoEn, telefono) {
  return getDb().run(
    'INSERT INTO usuarios (nombre, usuario, contrasena, rol_id, created_at, telefono) VALUES (?, ?, ?, ?, ?, ?)',
    [nombre, usuario, contrasenaHash, rolId || null, creadoEn, telefono || null]
  );
}

function actualizarUsuario(id, sets, vals) {
  return getDb().run(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`, vals);
}

function eliminarUsuario(id) {
  return getDb().run('DELETE FROM usuarios WHERE id = ?', [id]);
}

// FASE 6 (09/09, pedido por Julio): con PRAGMA foreign_keys activado,
// borrar un usuario que ya creó/firmó algo en cualquier módulo (garantías
// no aplica, no guarda usuario -- pero sí reportes, causas raíz, moldes,
// trazabilidad, observaciones, recomendaciones, registro de cambios...)
// haría fallar el DELETE con un error de SQLite en vez de dejarlo claro.
// Esto cuenta esas 21 columnas repartidas en 15 tablas para poder avisar
// antes de intentar borrar, en vez de que el usuario vea un error crudo.
async function contarActividadDeUsuario(id) {
  const db = getDb();
  const filas = await db.all(
    `SELECT 'Referencias' AS tabla, COUNT(*) AS total FROM Referencias WHERE creado_por = ?
     UNION ALL SELECT 'causas_raiz', COUNT(*) FROM causas_raiz WHERE responsable_id = ? OR autor_id = ?
     UNION ALL SELECT 'medidas', COUNT(*) FROM medidas WHERE responsable_id = ? OR autor_id = ?
     UNION ALL SELECT 'moldes_inspecciones', COUNT(*) FROM moldes_inspecciones WHERE creado_por = ?
     UNION ALL SELECT 'moldes_referencias', COUNT(*) FROM moldes_referencias WHERE creado_por = ?
     UNION ALL SELECT 'moldes_versiones', COUNT(*) FROM moldes_versiones WHERE creado_por = ?
     UNION ALL SELECT 'observaciones', COUNT(*) FROM observaciones WHERE actualizado_por = ?
     UNION ALL SELECT 'problemas', COUNT(*) FROM problemas WHERE autor_id = ?
     UNION ALL SELECT 'problemas_adjuntos', COUNT(*) FROM problemas_adjuntos WHERE autor_id = ?
     UNION ALL SELECT 'recomendaciones', COUNT(*) FROM recomendaciones WHERE usuario_id = ? OR eliminada_por = ?
     UNION ALL SELECT 'registro_cambios', COUNT(*) FROM registro_cambios WHERE hecho_por = ?
     UNION ALL SELECT 'reportes', COUNT(*) FROM reportes WHERE autor_id = ?
     UNION ALL SELECT 'reportes_adjuntos', COUNT(*) FROM reportes_adjuntos WHERE autor_id = ?
     UNION ALL SELECT 'trazabilidad_causas', COUNT(*) FROM trazabilidad_causas WHERE autor_id = ? OR responsable_id = ?
     UNION ALL SELECT 'trazabilidad_medidas', COUNT(*) FROM trazabilidad_medidas WHERE autor_id = ? OR responsable_id = ?
     UNION ALL SELECT 'trazabilidad_problemas', COUNT(*) FROM trazabilidad_problemas WHERE creado_por = ?`,
    Array(21).fill(id)
  );
  const total = filas.reduce((acc, f) => acc + f.total, 0);
  return { total, detalle: filas.filter(f => f.total > 0) };
}

// Para el registro de cambios: poder describir "se eliminó a Fulano" en vez
// de solo un ID, sin tener que volver a traer la lista completa.
function buscarUsuarioPorId(id) {
  return getDb().get('SELECT id, nombre, usuario, rol_id, telefono FROM usuarios WHERE id = ?', [id]);
}

module.exports = { listarUsuarios, listarUsuariosConTelefono, crearUsuario, actualizarUsuario, eliminarUsuario, buscarUsuarioPorId, contarActividadDeUsuario };
