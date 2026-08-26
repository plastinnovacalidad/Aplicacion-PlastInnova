const { getDb } = require('../db/connection');

function buscarUsuarioPorLogin(usuario) {
  const db = getDb();
  return db.get(
    'SELECT u.*, r.nombre as rol_nombre, r.id as rol_id FROM usuarios u LEFT JOIN roles r ON u.rol_id = r.id WHERE u.usuario = ?',
    [usuario]
  );
}

function buscarNombreRol(rolId) {
  const db = getDb();
  return db.get('SELECT nombre FROM roles WHERE id = ?', [rolId]);
}

module.exports = { buscarUsuarioPorLogin, buscarNombreRol };
