const express = require('express');
const { validarToken, requerirPermiso, tienePermiso } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const calidadData = require('../data/calidad');
const whatsappData = require('../data/whatsapp');
const whatsappService = require('../whatsapp_bot_service');

const router = express.Router();

// ======================== TABLERO DE CALIDAD GENERAL ========================
// Módulo de solo lectura: cruza Garantías y Muestreos ISO 2859-1 por
// referencia de producto terminado. Un solo permiso alcanza para todo el
// módulo porque no hay nada que crear, editar ni eliminar aquí.
const puedeVerCalidad = requerirPermiso('calidad.ver');

router.get('/calidad/tendencias', validarToken, puedeVerCalidad, asyncHandler(async (req, res) => {
  const tendencias = await calidadData.obtenerTendencias(req.query.meses);
  res.json(tendencias);
}));

router.get('/calidad/productos', validarToken, puedeVerCalidad, asyncHandler(async (req, res) => {
  const productos = await calidadData.obtenerResumenPorProducto();
  res.json(productos);
}));

router.get('/calidad/metrologia', validarToken, puedeVerCalidad, asyncHandler(async (req, res) => {
  const resumen = await calidadData.obtenerResumenMetrologia();
  res.json(resumen);
}));

router.get('/calidad/comentarios-smd', validarToken, puedeVerCalidad, asyncHandler(async (req, res) => {
  const limite = parseInt(req.query.limite || '8', 10);
  const comentarios = await calidadData.obtenerUltimosComentariosSMD(limite);
  res.json(comentarios);
}));

router.get('/calidad/muestreos-recientes', validarToken, puedeVerCalidad, asyncHandler(async (req, res) => {
  const limite = parseInt(req.query.limite || '15', 10);
  const muestreos = await calidadData.obtenerUltimosMuestreos(limite);
  res.json(muestreos);
}));

// El bot de WhatsApp maneja datos de asistencia del personal — un tema
// aparte de calidad. Aunque este endpoint vive bajo /calidad para que el
// tablero lo muestre en un solo lugar, solo entrega datos reales si el
// usuario también tiene el permiso whatsapp.bot.ver. Si no lo tiene,
// responde 200 con permitido:false (no 403) para que el tablero oculte esa
// tarjeta sin tratarlo como un error.
router.get('/calidad/whatsapp-activos', validarToken, puedeVerCalidad, asyncHandler(async (req, res) => {
  if (!tienePermiso(req.usuario.rol_id, 'whatsapp.bot.ver')) {
    return res.json({ permitido: false, sesiones: [] });
  }
  const sesiones = await whatsappData.listarSesionesActivas();
  const resultado = sesiones.map(s => ({ ...s, nombre: whatsappService.nombreDe(s.telefono) }));
  res.json({ permitido: true, sesiones: resultado });
}));

module.exports = router;
