const express = require('express');
const { validarToken, requerirPermiso } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const auditoria = require('../data/auditoria');

const router = express.Router();

// ======================== REGISTRO DE CAMBIOS (AUDITORÍA GLOBAL) ========================
// Solo lectura: alimenta la pestaña "📜 Registro de Cambios" en Gestión.
// Ver data/auditoria.js para el detalle de cómo se escriben estos registros
// desde cada módulo, y db/init.js (migración #8) para el esquema de la tabla.
const puedeVerAuditoria = requerirPermiso('auditoria.ver');

router.get('/auditoria/cambios', validarToken, puedeVerAuditoria, asyncHandler(async (req, res) => {
  const { modulo, entidad, accion, usuario, desde, hasta, q } = req.query;
  const cambios = await auditoria.listarCambios({ modulo, entidad, accion, usuario, desde, hasta, q });
  res.json(cambios);
}));

router.get('/auditoria/filtros', validarToken, puedeVerAuditoria, asyncHandler(async (req, res) => {
  const filas = await auditoria.listarModulosYEntidades();
  res.json(filas);
}));

module.exports = router;
