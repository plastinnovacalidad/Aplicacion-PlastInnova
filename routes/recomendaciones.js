const express = require('express');
const { validarToken, requerirPermiso, requerirPermisoAlternativo, tienePermiso } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const recData = require('../data/recomendaciones');

const router = express.Router();

// ======================== RECOMENDACIONES ========================
router.get('/recomendaciones/:referencia', validarToken, requerirPermisoAlternativo(['recomendaciones.ver', 'recomendaciones.crear']), asyncHandler(async (req, res) => {
  const referencia = decodeURIComponent(req.params.referencia || '');
  const puedeVerTodas = tienePermiso(req.usuario.rol_id, 'recomendaciones.ver');
  const rows = await recData.listarRecomendaciones(referencia, !puedeVerTodas, req.usuario.id);
  res.json({ recomendaciones: rows.map(r => ({ id: r.id, referencia: r.referencia, recomendacion: r.recomendacion, usuario_id: r.usuario_id, autor: r.usuario_nombre || r.autor_nombre || 'Usuario', fecha: r.fecha_creacion })) });
}));

router.post('/recomendacion', validarToken, requerirPermiso('recomendaciones.crear'), asyncHandler(async (req, res) => {
  const { referencia, recomendacion } = req.body;
  if (!referencia || !recomendacion?.trim()) return res.status(400).json({ error: 'Referencia y recomendación requeridas' });
  const result = await recData.crearRecomendacion(referencia, recomendacion.trim(), req.usuario.id, req.usuario.nombre);
  res.json({ success: true, id: result.lastID });
}));

router.delete('/recomendacion/:id', validarToken, requerirPermiso('recomendaciones.eliminar'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const result = await recData.eliminarRecomendacion(id, req.usuario.id);
  if (result.changes === 0) return res.status(404).json({ error: 'No encontrada' });
  res.json({ success: true });
}));

module.exports = router;
