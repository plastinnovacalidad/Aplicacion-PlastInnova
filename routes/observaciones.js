const express = require('express');
const { validarToken, requerirPermiso } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const obsData = require('../data/observaciones');

const router = express.Router();

// ======================== OBSERVACIONES ========================
router.get('/observaciones/:codigo_base', validarToken, requerirPermiso('observaciones.ver'), asyncHandler(async (req, res) => {
  const codigoBase = decodeURIComponent(req.params.codigo_base || '');
  const ref = await obsData.buscarIdReferenciaPorCodigo(codigoBase);
  if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });
  const obs = await obsData.buscarObservacionPorReferencia(ref.id);
  res.json({ observacion: obs || null });
}));

router.post('/observaciones/:codigo_base', validarToken, requerirPermiso('observaciones.editar'), asyncHandler(async (req, res) => {
  const codigoBase = decodeURIComponent(req.params.codigo_base || '');
  const { observacion } = req.body;
  const usuarioId = req.usuario.id;

  const ref = await obsData.buscarIdReferenciaPorCodigo(codigoBase);
  if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });

  const existente = await obsData.existeObservacion(ref.id);
  if (existente) {
    await obsData.actualizarObservacion(observacion, usuarioId, existente.id);
  } else {
    await obsData.crearObservacion(ref.id, observacion, usuarioId);
  }
  res.json({ success: true });
}));

module.exports = router;
