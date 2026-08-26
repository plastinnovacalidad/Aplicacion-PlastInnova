const { getDb } = require('../db/connection');

function listarUsuarios() {
  return getDb().all(`
    SELECT u.id, u.nombre, u.usuario, u.rol_id, r.nombre as rol_nombre
    FROM usuarios u LEFT JOIN roles r ON u.rol_id = r.id ORDER BY u.nombre
  `);
}

function crearUsuario(nombre, usuario, contrasenaHash, rolId, creadoEn) {
  return getDb().run(
    'INSERT INTO usuarios (nombre, usuario, contrasena, rol_id, created_at) VALUES (?, ?, ?, ?, ?)',
    [nombre, usuario, contrasenaHash, rolId || null, creadoEn]
  );
}

function actualizarUsuario(id, sets, vals) {
  return getDb().run(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`, vals);
}

function eliminarUsuario(id) {
  return getDb().run('DELETE FROM usuarios WHERE id = ?', [id]);
}

// Para el registro de cambios: poder describir "se eliminó a Fulano" en vez
// de solo un ID, sin tener que volver a traer la lista completa.
function buscarUsuarioPorId(id) {
  return getDb().get('SELECT id, nombre, usuario, rol_id FROM usuarios WHERE id = ?', [id]);
}

module.exports = { listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario, buscarUsuarioPorId };
