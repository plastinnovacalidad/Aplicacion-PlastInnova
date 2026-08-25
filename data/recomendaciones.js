const { getDb } = require('../db/connection');
const { ahoraISO } = require('../utils/fechas');

function listarRecomendaciones(referencia, soloPropias, usuarioId) {
  const db = getDb();
  let query = `
    SELECT r.id, r.referencia, r.recomendacion, r.usuario_id, r.usuario_nombre, r.fecha_creacion,
           u.nombre as autor_nombre
    FROM recomendaciones r
    LEFT JOIN usuarios u ON r.usuario_id = u.id
    WHERE r.referencia = ? AND (r.eliminada = 0 OR r.eliminada IS NULL)
  `;
  const params = [referencia];
  if (soloPropias) {
    query += ' AND r.usuario_id = ?';
    params.push(usuarioId);
  }
  query += ' ORDER BY r.fecha_creacion ASC';
  return db.all(query, params);
}

function crearRecomendacion(referencia, recomendacion, usuarioId, usuarioNombre) {
  return getDb().run(
    'INSERT INTO recomendaciones (referencia, recomendacion, usuario_id, usuario_nombre, fecha_creacion) VALUES (?, ?, ?, ?, ?)',
    [referencia, recomendacion, usuarioId, usuarioNombre, ahoraISO()]
  );
}

function eliminarRecomendacion(id, usuarioId) {
  return getDb().run(
    'UPDATE recomendaciones SET eliminada = 1, eliminada_por = ?, fecha_eliminacion = ? WHERE id = ? AND (eliminada = 0 OR eliminada IS NULL)',
    [usuarioId, ahoraISO(), id]
  );
}

module.exports = { listarRecomendaciones, crearRecomendacion, eliminarRecomendacion };
