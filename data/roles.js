const { getDb } = require('../db/connection');

function listarPermisos() {
  return getDb().all('SELECT * FROM permisos ORDER BY codigo');
}

function listarRoles() {
  return getDb().all('SELECT * FROM roles ORDER BY nombre');
}

function listarPermisosDeRol(rolId) {
  return getDb().all(`
    SELECT p.id, p.codigo, p.descripcion FROM permisos p
    JOIN rol_permisos rp ON p.id = rp.permiso_id
    WHERE rp.rol_id = ? ORDER BY p.codigo
  `, [rolId]);
}

function crearRol(nombre, descripcion) {
  return getDb().run('INSERT INTO roles (nombre, descripcion) VALUES (?, ?)', [nombre, descripcion || '']);
}

function asignarPermisoARol(rolId, permisoId) {
  return getDb().run('INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (?, ?)', [rolId, permisoId]);
}

function buscarRolPorId(rolId) {
  return getDb().get('SELECT * FROM roles WHERE id = ?', [rolId]);
}

function actualizarNombreRol(rolId, nombre) {
  return getDb().run('UPDATE roles SET nombre = ? WHERE id = ?', [nombre, rolId]);
}

function actualizarDescripcionRol(rolId, descripcion) {
  return getDb().run('UPDATE roles SET descripcion = ? WHERE id = ?', [descripcion, rolId]);
}

function borrarPermisosDeRol(rolId) {
  return getDb().run('DELETE FROM rol_permisos WHERE rol_id = ?', [rolId]);
}

function contarUsuariosConRol(rolId) {
  return getDb().get('SELECT COUNT(*) as total FROM usuarios WHERE rol_id = ?', [rolId]);
}

function eliminarRol(rolId) {
  return getDb().run('DELETE FROM roles WHERE id = ?', [rolId]);
}

module.exports = {
  listarPermisos,
  listarRoles,
  listarPermisosDeRol,
  crearRol,
  asignarPermisoARol,
  buscarRolPorId,
  actualizarNombreRol,
  actualizarDescripcionRol,
  borrarPermisosDeRol,
  contarUsuariosConRol,
  eliminarRol,
};
