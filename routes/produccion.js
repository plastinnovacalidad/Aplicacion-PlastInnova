const express = require('express');
const { validarToken, requerirPermiso } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const produccionData = require('../data/produccion');
const { sincronizarProduccion } = require('../scripts/sincronizar_produccion');

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
//
// MIGRACIÓN #38 (07-08/09, pedido por Julio): la sección "TRAZABILIDAD DE
// SOLUCIONES" (registrar causa raíz/medidas de un problema del tablero) y el
// "CATÁLOGO DE CAUSAS RAÍZ Y MEDIDAS" que vivían en este archivo se mudaron
// por completo al módulo unificado "Problemas" (ver routes/problemas.js) --
// trazabilidad_problemas se eliminó, así que ya no tiene sentido que este
// archivo la administre. Producción por Fábrica sigue siendo, como siempre,
// solo un tablero de lectura de rechazos/lotes/entregas.
const puedeVerProduccion = requerirPermiso('calidad.ver');

router.get('/produccion/resumen-fabricas', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const resumen = await produccionData.obtenerResumenPorFabrica();
  res.json(resumen);
}));

router.get('/produccion/rechazos/tendencia', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const tendencia = await produccionData.obtenerTendenciaRechazos(req.query.fabrica, req.query.meses);
  res.json(tendencia);
}));

// ?referencia= (04/09, pedido por Julio): acota la lista a los motivos de
// rechazo QUE HA TENIDO esa referencia puntual -- lo usa el selector que se
// abre al hacer clic en el 🛠️ de una fila de Referencias (ver
// abrirSelectorMotivosPorReferencia en Public/produccion.html), antes de
// pasar a trabajar la causa raíz del motivo elegido (ahora en el módulo
// Problemas, ver routes/problemas.js).
router.get('/produccion/rechazos/motivos', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const motivos = await produccionData.obtenerMotivosFrecuentes(req.query.fabrica, req.query.meses, req.query.limite, req.query.desde, req.query.hasta, req.query.linea, req.query.proceso, req.query.referencia);
  res.json(motivos);
}));

router.get('/produccion/rechazos/lineas', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const lineas = await produccionData.obtenerLineasConMasRechazos(req.query.fabrica, req.query.meses, req.query.limite, req.query.desde, req.query.hasta, req.query.motivo);
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
  const ranking = await produccionData.obtenerDesperdicioPorReferencia(req.query.fabrica, req.query.meses, req.query.limite, req.query.desde, req.query.hasta, req.query.motivo, req.query.linea, req.query.proceso);
  res.json(ranking);
}));

// Cruce por lote (bueno vs. malo) — ver el comentario extenso en
// data/produccion.js sobre la llave de cruce (lote_produccion = no_lote) y
// por qué no es un simple JOIN directo.
router.get('/produccion/lotes/buscar', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const lotes = await produccionData.obtenerLotesConDetalle(req.query.q, req.query.meses, req.query.fabrica, req.query.limite, req.query.desde, req.query.hasta, req.query.motivo, req.query.linea, req.query.proceso);
  res.json(lotes);
}));

// Resumen agregado (unidades, veces, referencias distintas) de un motivo o
// línea específicos -- para el recuadro que aparece al hacer clic en una
// barra de motivos/líneas en el tablero.
router.get('/produccion/rechazos/resumen-filtro', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const resumen = await produccionData.obtenerResumenFiltroRechazo(req.query.fabrica, req.query.meses, req.query.desde, req.query.hasta, req.query.motivo, req.query.linea, req.query.proceso);
  res.json(resumen);
}));

// Evolución mensual de un motivo o línea ya filtrados -- para cuando el
// usuario hace clic en una barra de motivo/línea, la gráfica/tabla
// principal cambia a mostrar en qué meses salió más eso (pedido por
// Julio). Siempre trae toda la ventana general, nunca se recorta a un mes.
router.get('/produccion/rechazos/por-mes', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const datos = await produccionData.obtenerRechazosPorMesFiltrado(req.query.fabrica, req.query.meses, req.query.desde, req.query.hasta, req.query.motivo, req.query.linea, req.query.proceso);
  res.json(datos);
}));

router.get('/produccion/bueno-vs-malo', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const datos = await produccionData.obtenerBuenoVsMaloPorMes(req.query.meses, req.query.fabrica, req.query.desde, req.query.hasta);
  res.json(datos);
}));

// Reemplaza la vieja "tasa de rechazo global": ahora es % de desperdicio
// real (rechazado / producido), filtrable por fábrica.
router.get('/produccion/desperdicio', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const desperdicio = await produccionData.obtenerDesperdicio(req.query.fabrica, req.query.meses, req.query.desde, req.query.hasta);
  res.json(desperdicio);
}));

router.post('/produccion/refrescar', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  await sincronizarProduccion(true);
  res.json({ success: true, mensaje: 'Hojas de Excel refrescadas y sincronizadas correctamente' });
}));

// Pedido por Julio (04/09): al entrar a un problema de tipo Motivo (desde el
// módulo Problemas, ver routes/problemas.js), se ven dos gráficas de
// contexto -- cuánto salió ese motivo por mes, y en qué referencias se
// presenta más. Se quedan en este archivo (no dependen de trazabilidad_
// problemas ni de la tabla `problemas` -- solo leen datos de rechazos), con
// el mismo permiso base del tablero de Producción.
router.get('/produccion/trazabilidad/graficas/por-mes', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const datos = await produccionData.obtenerRechazosPorMesFiltrado(req.query.fabrica, req.query.meses, undefined, undefined, req.query.motivo);
  res.json(datos);
}));

router.get('/produccion/trazabilidad/graficas/referencias-por-motivo', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const datos = await produccionData.obtenerReferenciasPorMotivo(req.query.fabrica, req.query.meses, req.query.limite, undefined, undefined, req.query.motivo);
  res.json(datos);
}));

// Lista de solo lectura de motivos de rechazo para Gestión → Catálogos --
// mismo permiso que los demás catálogos de Gestión. No depende de
// trazabilidad_problemas -- se queda en este archivo.
router.get('/produccion/rechazos/motivos-catalogo', validarToken, requerirPermiso('catalogos.gestionar'), asyncHandler(async (req, res) => {
  const motivos = await produccionData.obtenerMotivosCatalogo(req.query.fabrica);
  res.json(motivos);
}));

module.exports = router;
