const express = require('express');
const { validarToken, requerirPermiso } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const produccionData = require('../data/produccion');

const router = express.Router();

// ======================== PRODUCCIÓN POR FÁBRICA (RECHAZOS + LOTES + ENTREGAS) ========================
// Módulo de solo lectura, igual que el tablero de Calidad: se reutiliza el
// mismo permiso 'calidad.ver' (admin e inspector ya lo tienen), no hace
// falta ningún permiso nuevo. Ya registrado en app_circuitos.js.
//
// Actualizado 01/09 (ver MIGRACIÓN #22 en db/init.js): desde que Julio agregó
// Produccion.xlsx, la producción (entregas_produccion) SÍ trae fábrica, así
// que todos los endpoints de este archivo ahora aceptan ?fabrica= (antes
// solo los de rechazos lo aceptaban). El tablero (Public/produccion.html)
// usa esto para armar una pestaña "General" (sin filtro) y una pestaña por
// cada fábrica que devuelva /produccion/resumen-fabricas.
const puedeVerProduccion = requerirPermiso('calidad.ver');

router.get('/produccion/resumen-fabricas', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const resumen = await produccionData.obtenerResumenPorFabrica();
  res.json(resumen);
}));

router.get('/produccion/rechazos/tendencia', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const tendencia = await produccionData.obtenerTendenciaRechazos(req.query.fabrica, req.query.meses);
  res.json(tendencia);
}));

router.get('/produccion/rechazos/motivos', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const motivos = await produccionData.obtenerMotivosFrecuentes(req.query.fabrica, req.query.meses, req.query.limite);
  res.json(motivos);
}));

router.get('/produccion/rechazos/lineas', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const lineas = await produccionData.obtenerLineasConMasRechazos(req.query.fabrica, req.query.meses, req.query.limite);
  res.json(lineas);
}));

// Producción de lotes (entregas_produccion, operación "Calidad"): ahora sí
// filtrable por fábrica.
router.get('/produccion/lotes/tendencia', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const tendencia = await produccionData.obtenerTendenciaProduccion(req.query.meses, req.query.fabrica);
  res.json(tendencia);
}));

router.get('/produccion/lotes/top-referencias', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const top = await produccionData.obtenerProduccionPorReferencia(req.query.meses, req.query.fabrica, req.query.limite);
  res.json(top);
}));

// Ranking de % de desperdicio por referencia (top peores) — nuevo endpoint,
// pedido por Julio para reemplazar la sola tabla de "más producidas" con una
// vista centrada en desperdicio.
router.get('/produccion/lotes/desperdicio-por-referencia', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const ranking = await produccionData.obtenerDesperdicioPorReferencia(req.query.fabrica, req.query.meses, req.query.limite);
  res.json(ranking);
}));

// Cruce por lote (bueno vs. malo) — ver el comentario extenso en
// data/produccion.js sobre la llave de cruce (lote_produccion = no_lote) y
// por qué no es un simple JOIN directo.
router.get('/produccion/lotes/buscar', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const lotes = await produccionData.obtenerLotesConDetalle(req.query.q, req.query.meses, req.query.fabrica, req.query.limite);
  res.json(lotes);
}));

router.get('/produccion/bueno-vs-malo', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const datos = await produccionData.obtenerBuenoVsMaloPorMes(req.query.meses, req.query.fabrica);
  res.json(datos);
}));

// Reemplaza la vieja "tasa de rechazo global": ahora es % de desperdicio
// real (rechazado / producido), filtrable por fábrica.
router.get('/produccion/desperdicio', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const desperdicio = await produccionData.obtenerDesperdicio(req.query.fabrica, req.query.meses);
  res.json(desperdicio);
}));

module.exports = router;
