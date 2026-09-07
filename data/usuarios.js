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

// Para el registro de cambios: poder describir "se eliminó a Fulano" en vez
// de solo un ID, sin tener que volver a traer la lista completa.
function buscarUsuarioPorId(id) {
  return getDb().get('SELECT id, nombre, usuario, rol_id, telefono FROM usuarios WHERE id = ?', [id]);
}

module.exports = { listarUsuarios, listarUsuariosConTelefono, crearUsuario, actualizarUsuario, eliminarUsuario, buscarUsuarioPorId };
