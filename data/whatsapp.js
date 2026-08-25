const { getDb } = require('../db/connection');

function listarSesionesActivas() {
  return getDb().all('SELECT * FROM whatsapp_sesiones_activas');
}

function listarRegistros(limite) {
  return getDb().all('SELECT * FROM whatsapp_registros ORDER BY id DESC LIMIT ?', [limite]);
}

module.exports = { listarSesionesActivas, listarRegistros };
