const { getDb } = require('../db/connection');
const { ahoraISO } = require('../utils/fechas');

function buscarIdReferenciaPorCodigo(codigoBase) {
  return getDb().get('SELECT id FROM referencias WHERE codigo_base = ?', [codigoBase]);
}

function buscarObservacionPorReferencia(referenciaId) {
  return getDb().get(`
    SELECT o.*, u.nombre as actualizado_por_nombre
    FROM observaciones o
    LEFT JOIN usuarios u ON o.actualizado_por = u.id
    WHERE o.referencia_id = ?
  `, [referenciaId]);
}

function existeObservacion(referenciaId) {
  return getDb().get('SELECT id FROM observaciones WHERE referencia_id = ?', [referenciaId]);
}

function actualizarObservacion(observacion, usuarioId, id) {
  return getDb().run(
    'UPDATE observaciones SET observacion = ?, actualizado_por = ?, actualizado_en = ? WHERE id = ?',
    [observacion || '', usuarioId, ahoraISO(), id]
  );
}

function crearObservacion(referenciaId, observacion, usuarioId) {
  return getDb().run(
    'INSERT INTO observaciones (referencia_id, observacion, actualizado_por, actualizado_en) VALUES (?, ?, ?, ?)',
    [referenciaId, observacion || '', usuarioId, ahoraISO()]
  );
}

module.exports = {
  buscarIdReferenciaPorCodigo,
  buscarObservacionPorReferencia,
  existeObservacion,
  actualizarObservacion,
  crearObservacion,
};
