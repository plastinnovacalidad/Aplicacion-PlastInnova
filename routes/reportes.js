const fs = require('fs');
const path = require('path');
const express = require('express');

const { validarToken, requerirPermiso, requerirPermisoAlternativo } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const { upload } = require('../utils/upload');
const { validarOBorrar } = require('../utils/validarArchivo');
const { moverArchivo } = require('../utils/archivos');
const { EVIDENCIAS_DIR } = require('../settings/paths');
const { registrarCambio } = require('../data/auditoria');
const reportesData = require('../data/reportes');
const whatsappService = require('../whatsapp_bot_service');

const router = express.Router();

// ======================== REPORTES POR ÁREAS (SOLO INFORMATIVO) ========================
// MIGRACIÓN #38 (07-08/09, pedido por Julio): Reporte Rápido y Reporte
// Completo (una incidencia con causa raíz y medidas de solución) se
// eliminaron de este módulo -- esa necesidad se fusionó con Trazabilidad de
// Producción en el módulo "Problemas" (ver routes/problemas.js). Reporte
// Informativo (boletín entre áreas, no es un "problema") se queda aparte,
// sin fusionar, tal como Julio confirmó.
const puedeVer = requerirPermiso('reportes.ver');
const puedeCrear = requerirPermiso('reportes.crear');
const puedeGestionar = requerirPermiso('reportes.gestionar');
const puedeEliminar = requerirPermiso('reportes.eliminar');
// El catálogo de áreas y los adjuntos son datos de apoyo que necesita
// cualquier pantalla del módulo -- cualquiera de los 4 permisos alcanza.
const CUALQUIER_REPORTES = ['reportes.ver', 'reportes.crear', 'reportes.gestionar', 'reportes.eliminar'];
const puedeVerModulo = requerirPermisoAlternativo(CUALQUIER_REPORTES);
const puedeAdjuntar = requerirPermisoAlternativo(['reportes.crear', 'reportes.gestionar']);

const CARPETA_ADJUNTOS = path.join(EVIDENCIAS_DIR, 'reportes');

// ======================== CATÁLOGO DE ÁREAS (reusa iso_areas) ========================
router.get('/reportes/areas', validarToken, puedeVerModulo, asyncHandler(async (req, res) => {
  res.json(await reportesData.listarAreasActivas());
}));

// ======================== LISTADO Y DETALLE ========================
router.get('/reportes', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const { area_id, q, limite } = req.query;
  const reportes = await reportesData.listarReportes({ area_id, q, limit: limite });
  res.json(reportes);
}));

router.get('/reportes/:id', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const reporte = await reportesData.obtenerReporteCompleto(req.params.id);
  if (!reporte) return res.status(404).json({ error: 'Reporte no encontrado' });
  res.json(reporte);
}));

// Editar un Informativo ya publicado -- pedido por Julio (07/09): "poder
// editarlos después de que los creemos". Mismo permiso que ya se usaba
// (reportes.gestionar), para dárselo solo a quien deba poder corregir un
// comunicado ya salido.
router.put('/reportes/:id', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const reporteActual = await reportesData.obtenerReporteCompleto(req.params.id);
  if (!reporteActual) return res.status(404).json({ error: 'Reporte no encontrado' });

  const { area_origen_id, titulo, contenido, fecha_vigencia, areas_destino } = req.body;
  const cambios = {};
  if (titulo !== undefined) {
    if (!titulo.trim()) return res.status(400).json({ error: 'El título no puede quedar vacío.' });
    cambios.titulo = titulo.trim();
  }
  if (contenido !== undefined) {
    if (!contenido.trim()) return res.status(400).json({ error: 'El contenido no puede quedar vacío.' });
    cambios.contenido = contenido.trim();
  }
  if (area_origen_id !== undefined) cambios.area_origen_id = area_origen_id;
  if (fecha_vigencia !== undefined) cambios.fecha_vigencia = fecha_vigencia;
  if (areas_destino !== undefined) {
    const areasDestino = Array.isArray(areas_destino) ? areas_destino.map((a) => parseInt(a, 10)).filter((a) => !isNaN(a)) : [];
    if (areasDestino.length === 0) return res.status(400).json({ error: 'Elige al menos un área destino.' });
    cambios.areasDestino = areasDestino;
  }

  const resultado = await reportesData.actualizarReporte(req.params.id, cambios);
  if (resultado.error === 'no_encontrado') return res.status(404).json({ error: 'Reporte no encontrado' });
  if (resultado.error === 'nada_que_actualizar') return res.status(400).json({ error: 'No se mandó ningún campo para actualizar.' });
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes', entidadId: resultado.reporte.id, accion: 'Edición',
    detalle: `Reporte Informativo editado — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.reporte);
}));

// ======================== CREAR ========================
// Reporte Informativo: boletín entre áreas. Siempre avisa por WhatsApp a los
// números configurados al publicarse -- es un aviso que la persona ya
// decidió mandar al llenar el formulario, no un juicio sobre la urgencia de
// un problema (a diferencia del viejo Reporte Rápido, que sí preguntaba a
// quién avisar -- esa parte se eliminó junto con Rápido/Completo).
router.post('/reportes/informativo', validarToken, puedeCrear, asyncHandler(async (req, res) => {
  const { area_origen_id, titulo, contenido, fecha_vigencia, areas_destino } = req.body;
  if (!titulo || !titulo.trim()) return res.status(400).json({ error: 'El título es obligatorio.' });
  if (!contenido || !contenido.trim()) return res.status(400).json({ error: 'Escribe el contenido del comunicado.' });
  const areasDestino = Array.isArray(areas_destino) ? areas_destino.map((a) => parseInt(a, 10)).filter((a) => !isNaN(a)) : [];
  if (areasDestino.length === 0) return res.status(400).json({ error: 'Elige al menos un área destino.' });

  const reporte = await reportesData.crearReporteInformativo({
    area_origen_id, titulo: titulo.trim(), contenido: contenido.trim(), fecha_vigencia,
    areasDestino, autorId: req.usuario.id, autorNombre: req.usuario.nombre,
  });
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes', entidadId: reporte.id, accion: 'Creación',
    detalle: `Reporte Informativo publicado: "${reporte.titulo}" a ${reporte.destinos.map((d) => d.nombre).join(', ')} — registrado por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });

  whatsappService.enviarAlerta(
    'reporte_informativo_publicado',
    `📢 *COMUNICADO: ${reporte.titulo}*\n\nDe: ${reporte.area_origen_nombre || req.usuario.nombre}\nPara: ${reporte.destinos.map((d) => d.nombre).join(', ')}\n\n${reporte.descripcion}`
  );

  res.status(201).json(reporte);
}));

// ======================== ADJUNTOS (evidencia / fichas técnicas) ========================
router.post('/reportes/:id/adjuntos', validarToken, puedeAdjuntar, upload.single('archivo'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Debe subir un archivo (imagen o PDF).' });
  const reporte = await reportesData.obtenerReporteCompleto(req.params.id);
  if (!reporte) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Reporte no encontrado' });
  }
  const valido = await validarOBorrar(req, res, req.file.path);
  if (!valido) return; // validarOBorrar ya respondió el error y borró el archivo

  if (!fs.existsSync(CARPETA_ADJUNTOS)) fs.mkdirSync(CARPETA_ADJUNTOS, { recursive: true });
  const nombreGuardado = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(req.file.originalname)}`;
  moverArchivo(req.file.path, path.join(CARPETA_ADJUNTOS, nombreGuardado));

  const result = await reportesData.agregarAdjunto({
    reporte_id: req.params.id, archivo: nombreGuardado, nombre_original: req.file.originalname,
    autor_id: req.usuario.id, autor_nombre: req.usuario.nombre,
  });
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes_adjuntos', entidadId: result.lastID, accion: 'Creación',
    detalle: `Adjunto "${req.file.originalname}" agregado al reporte #${req.params.id} — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.status(201).json(await reportesData.obtenerReporteCompleto(req.params.id));
}));

router.get('/reportes/:id/adjuntos/:adjId', validarToken, puedeVerModulo, asyncHandler(async (req, res) => {
  const adjunto = await reportesData.obtenerAdjunto(req.params.id, req.params.adjId);
  if (!adjunto) return res.status(404).json({ error: 'Adjunto no encontrado' });
  const ruta = path.join(CARPETA_ADJUNTOS, adjunto.archivo);
  if (!fs.existsSync(ruta)) return res.status(404).json({ error: 'El archivo ya no está disponible en el servidor.' });
  res.sendFile(ruta);
}));

router.delete('/reportes/:id/adjuntos/:adjId', validarToken, puedeEliminar, asyncHandler(async (req, res) => {
  const adjunto = await reportesData.obtenerAdjunto(req.params.id, req.params.adjId);
  if (!adjunto) return res.status(404).json({ error: 'Adjunto no encontrado' });
  await reportesData.eliminarAdjunto(req.params.id, req.params.adjId);
  const ruta = path.join(CARPETA_ADJUNTOS, adjunto.archivo);
  if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes_adjuntos', entidadId: req.params.adjId, accion: 'Eliminación',
    detalle: `Adjunto "${adjunto.nombre_original || adjunto.archivo}" eliminado del reporte #${req.params.id} — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json({ success: true });
}));

module.exports = router;
