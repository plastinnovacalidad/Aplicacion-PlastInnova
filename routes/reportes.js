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
const catalogoData = require('../data/trazabilidadCatalogo');
const causasRaizData = require('../data/causasRaiz');
const usuariosData = require('../data/usuarios');
const whatsappService = require('../whatsapp_bot_service');

const router = express.Router();

// ======================== PERMISOS ========================
// Mismo criterio de 4 permisos separados que ya usa Trazabilidad de
// Producción (ver settings/permisos.js para el porqué de cada uno).
const puedeVer = requerirPermiso('reportes.ver');
const puedeCrear = requerirPermiso('reportes.crear');
const puedeGestionar = requerirPermiso('reportes.gestionar');
const puedeEliminar = requerirPermiso('reportes.eliminar');
// El catálogo de áreas y los adjuntos son datos de apoyo que necesita
// cualquier pantalla del módulo -- cualquiera de los 4 permisos alcanza,
// igual que ya hace Muestreos ISO 2859-1 con sus propias consultas de apoyo.
const CUALQUIER_REPORTES = ['reportes.ver', 'reportes.crear', 'reportes.gestionar', 'reportes.eliminar'];
const puedeVerModulo = requerirPermisoAlternativo(CUALQUIER_REPORTES);
// Adjuntar evidencia tiene sentido tanto al crear (Reporte Rápido/Informativo)
// como al investigar después (Reporte Completo) -- cualquiera de los 2 basta.
const puedeAdjuntar = requerirPermisoAlternativo(['reportes.crear', 'reportes.gestionar']);

const CARPETA_ADJUNTOS = path.join(EVIDENCIAS_DIR, 'reportes');

// Resuelve la causa raíz de un Reporte Completo contra el catálogo
// compartido con Seguimiento de Producción (data/trazabilidadCatalogo.js),
// mismo criterio que ya usa routes/produccion.js -- pero acá además queda
// "amarrada" al defecto/problema del reporte (defectoId): si viene
// causa_catalogo_id, se valida que esa causa del catálogo pertenezca a ESE
// defecto (cuando ambos lo tienen definido); si viene texto libre ("Otra"),
// se agrega al catálogo YA asociada a ese defecto, para que la próxima vez
// que alguien elija el mismo problema, esta causa aparezca en su lista
// filtrada (pedido explícito de Julio: "que si yo pongo un problema solo
// me traiga las causas de ese problema").
async function resolverCausaConCatalogo({ causa_catalogo_id, texto, defectoId }, mensajeVacio) {
  if (causa_catalogo_id) {
    const cat = await catalogoData.obtenerCausaCatalogoPorId(causa_catalogo_id);
    if (!cat) return { error: 'La causa del catálogo elegida no existe.' };
    if (defectoId && cat.defecto_id && String(cat.defecto_id) !== String(defectoId)) {
      return { error: 'Esa causa del catálogo no corresponde al problema elegido.' };
    }
    return { texto: cat.texto, causaCatalogoId: cat.id };
  }
  if (!texto || !texto.trim()) return { error: mensajeVacio };
  const cat = await catalogoData.obtenerOCrearCausaCatalogo(texto, defectoId || null);
  return { texto: cat.texto, causaCatalogoId: cat.id };
}

// ======================== CATÁLOGO DE ÁREAS (reusa iso_areas) ========================
router.get('/reportes/areas', validarToken, puedeVerModulo, asyncHandler(async (req, res) => {
  res.json(await reportesData.listarAreasActivas());
}));

// ======================== CATÁLOGO DE DEFECTOS ("el problema", reusa iso_tipificacion_defectos) ========================
router.get('/reportes/defectos', validarToken, puedeVerModulo, asyncHandler(async (req, res) => {
  res.json(await reportesData.listarDefectosActivos());
}));

// ======================== CATÁLOGO DE CAUSAS (compartido con Seguimiento de Producción) ========================
// Mismo catálogo que ya usa Producción (data/trazabilidadCatalogo.js),
// filtrado por defecto_id cuando el frontend ya sabe cuál es "el problema"
// (?defecto_id=) -- así solo aparecen las causas ya asociadas a ese
// problema. Sin ?defecto_id se devuelve el catálogo sin filtrar (uso
// interno/administrativo, no el flujo normal de creación).
router.get('/reportes/catalogo-causas', validarToken, puedeVerModulo, asyncHandler(async (req, res) => {
  const defectoId = (req.query.defecto_id !== undefined && req.query.defecto_id !== '')
    ? parseInt(req.query.defecto_id, 10) : undefined;
  res.json(await catalogoData.listarCatalogoCompleto({ soloActivas: true, defectoId }));
}));

// ======================== RÁPIDOS RECIENTES (para autocompletar un Completo) ========================
router.get('/reportes/rapidos-recientes', validarToken, puedeVerModulo, asyncHandler(async (req, res) => {
  const limite = req.query.limite ? parseInt(req.query.limite, 10) : undefined;
  res.json(await reportesData.listarRapidosRecientesPendientes({ limit: limite }));
}));

// ======================== DESTINATARIOS (usuarios con teléfono, para el aviso por WhatsApp) ========================
router.get('/reportes/destinatarios', validarToken, puedeVerModulo, asyncHandler(async (req, res) => {
  res.json(await usuariosData.listarUsuariosConTelefono());
}));

// ======================== LISTADO Y DETALLE ========================
router.get('/reportes', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const { tipo, estado, area_id, urgencia, q, limite } = req.query;
  const reportes = await reportesData.listarReportes({ tipo, estado, area_id, urgencia, q, limit: limite });
  res.json(reportes);
}));

router.get('/reportes/:id', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const reporte = await reportesData.obtenerReporteCompleto(req.params.id);
  if (!reporte) return res.status(404).json({ error: 'Reporte no encontrado' });
  res.json(reporte);
}));

// Editar un reporte ya creado -- pedido por Julio (07/09): "poder editarlos
// después de que los creemos", sin importar el estado (Pendiente, Revisado,
// En_Proceso, Implementado...) ni el tipo. Cada campo es opcional -- solo se
// cambia lo que venga en el body. Mismo permiso que escalar/marcar
// Revisado/agregar causas (reportes.gestionar), no el de solo crear.
router.put('/reportes/:id', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const reporteActual = await reportesData.obtenerReporteCompleto(req.params.id);
  if (!reporteActual) return res.status(404).json({ error: 'Reporte no encontrado' });

  const cambios = {};
  if (reporteActual.tipo === 'informativo') {
    const { area_origen_id, titulo, contenido, fecha_vigencia, areas_destino } = req.body;
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
  } else {
    const { area_origen_id, urgencia, referencia, lote, descripcion, defecto_id } = req.body;
    if (area_origen_id !== undefined && !area_origen_id) return res.status(400).json({ error: 'El área de origen es obligatoria.' });
    if (descripcion !== undefined && !descripcion.trim()) return res.status(400).json({ error: 'La descripción no puede quedar vacía.' });
    if (urgencia !== undefined && urgencia && !reportesData.URGENCIAS.includes(urgencia)) {
      return res.status(400).json({ error: `Urgencia inválida. Debe ser: ${reportesData.URGENCIAS.join(', ')}.` });
    }
    if (area_origen_id !== undefined) cambios.area_origen_id = area_origen_id;
    if (urgencia !== undefined) cambios.urgencia = urgencia;
    if (referencia !== undefined) cambios.referencia = referencia.trim();
    if (lote !== undefined) cambios.lote = lote.trim();
    if (descripcion !== undefined) cambios.descripcion = descripcion.trim();
    // "El problema" (defecto_id) -- pedido por Julio (07/09), segunda vuelta:
    // poder elegirlo/cambiarlo desde Editar, no solo desde el asistente o al
    // escalar. Enviar '' (cadena vacía) lo deja sin problema asignado
    // (defecto_id = NULL) a propósito -- distinto de no mandar el campo.
    // OJO: esto NO reetiqueta las causas que el reporte ya tenía -- esas
    // se quedan ligadas al defecto con el que se crearon. Solo cambia con
    // qué problema se filtran/asocian las causas que se agreguen de aquí en
    // adelante (ver POST /reportes/:id/causas, que usa reporteActual.defecto_id).
    if (defecto_id !== undefined) cambios.defecto_id = defecto_id || null;
  }

  const resultado = await reportesData.actualizarReporte(req.params.id, cambios);
  if (resultado.error === 'no_encontrado') return res.status(404).json({ error: 'Reporte no encontrado' });
  if (resultado.error === 'nada_que_actualizar') return res.status(400).json({ error: 'No se mandó ningún campo para actualizar.' });
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes', entidadId: resultado.reporte.id, accion: 'Edición',
    detalle: `Reporte editado — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.reporte);
}));

// Compartir (reenviar) la tarjeta-imagen con el resumen de un reporte por
// WhatsApp -- pedido por Julio (07/09): antes solo se mandaba una vez, al
// crear un Reporte Rápido; ahora se puede reenviar en cualquier momento, a
// quien sea, desde el detalle de cualquier Reporte Rápido o Completo (los
// Informativos ya avisan solos al publicarse, ver POST /reportes/informativo
// más arriba). Reusa la misma tarjeta y el mismo mecanismo de envío.
router.post('/reportes/:id/compartir', validarToken, puedeVerModulo, asyncHandler(async (req, res) => {
  const { destinatarios } = req.body;
  const idsDestinatarios = Array.isArray(destinatarios) ? destinatarios.map((d) => parseInt(d, 10)).filter((d) => !isNaN(d)) : [];
  if (idsDestinatarios.length === 0) return res.status(400).json({ error: 'Elige al menos un destinatario.' });

  const reporte = await reportesData.obtenerReporteCompleto(req.params.id);
  if (!reporte) return res.status(404).json({ error: 'Reporte no encontrado' });
  if (reporte.tipo === 'informativo') return res.status(400).json({ error: 'Los Reportes Informativos todavía no se pueden compartir así.' });

  const usuariosConTelefono = await usuariosData.listarUsuariosConTelefono();
  const elegidos = usuariosConTelefono.filter((u) => idsDestinatarios.includes(u.id));
  if (elegidos.length === 0) return res.status(400).json({ error: 'Ninguno de los destinatarios elegidos tiene un teléfono registrado.' });

  const envio = await whatsappService.enviarResumenReporteRapido(reporte, elegidos);
  res.json({ envio });
}));

// ======================== CREAR ========================
// Reporte Rápido: incidencia inmediata, sin causa raíz todavía. Al terminar
// de llenarlo, el frontend pregunta a qué usuarios avisar (checkbox sobre la
// lista de /reportes/destinatarios, usuarios con teléfono registrado en
// Gestión → Usuarios) y se les manda una tarjeta-imagen con el resumen por
// WhatsApp (ver utils/imagenResumenReporte.js). Si no se elige a nadie
// (`destinatarios` vacío o ausente), no se manda nada -- el reporte queda
// igual de creado.
router.post('/reportes/rapido', validarToken, puedeCrear, asyncHandler(async (req, res) => {
  const { area_origen_id, referencia, lote, urgencia, descripcion, destinatarios } = req.body;
  if (!area_origen_id) return res.status(400).json({ error: 'El área de origen es obligatoria.' });
  if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: 'Escribe una descripción del problema.' });
  if (urgencia && !reportesData.URGENCIAS.includes(urgencia)) {
    return res.status(400).json({ error: `Urgencia inválida. Debe ser: ${reportesData.URGENCIAS.join(', ')}.` });
  }
  const reporte = await reportesData.crearReporteRapido({
    area_origen_id, referencia, lote, urgencia, descripcion: descripcion.trim(),
    autorId: req.usuario.id, autorNombre: req.usuario.nombre,
  });
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes', entidadId: reporte.id, accion: 'Creación',
    detalle: `Reporte Rápido creado (${reporte.area_origen_nombre || 'sin área'}${reporte.referencia ? `, referencia ${reporte.referencia}` : ''}), urgencia ${reporte.urgencia} — registrado por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });

  // Aviso por WhatsApp: tarjeta-imagen con el resumen, solo a los usuarios
  // elegidos y solo a los que tengan teléfono registrado. enviarResumenReporteRapido
  // nunca lanza una excepción -- si el bot no está conectado o falla el
  // envío, el reporte ya quedó guardado de todas formas.
  let envioWhatsapp = null;
  const idsDestinatarios = Array.isArray(destinatarios)
    ? destinatarios.map((d) => parseInt(d, 10)).filter((d) => !isNaN(d)) : [];
  if (idsDestinatarios.length > 0) {
    const usuariosConTelefono = await usuariosData.listarUsuariosConTelefono();
    const elegidos = usuariosConTelefono.filter((u) => idsDestinatarios.includes(u.id));
    if (elegidos.length > 0) {
      envioWhatsapp = await whatsappService.enviarResumenReporteRapido(reporte, elegidos);
    }
  }

  res.status(201).json({ ...reporte, envio_whatsapp: envioWhatsapp });
}));

// Reporte Informativo: boletín entre áreas. Siempre avisa por WhatsApp a los
// números configurados al publicarse (a diferencia del Rápido, este no pide
// confirmación -- es un aviso que la persona ya decidió mandar al llenar el
// formulario, no un juicio sobre la urgencia de un problema).
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

// ======================== CICLO DE VIDA DEL RÁPIDO ========================
router.post('/reportes/:id/revisar', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const resultado = await reportesData.marcarComoRevisado(req.params.id);
  if (resultado.error === 'no_encontrado') return res.status(404).json({ error: 'Reporte no encontrado' });
  if (resultado.error === 'no_es_rapido') return res.status(400).json({ error: 'Solo un Reporte Rápido se puede marcar como Revisado.' });
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes', entidadId: resultado.reporte.id, accion: 'Edición',
    detalle: `Reporte Rápido marcado como Revisado (sin escalar) — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.reporte);
}));

router.post('/reportes/:id/escalar', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const { causa_raiz, causa_catalogo_id, defecto_id, descripcion } = req.body;
  const resCausa = await resolverCausaConCatalogo(
    { causa_catalogo_id, texto: causa_raiz, defectoId: defecto_id || null },
    'Escribe al menos una causa raíz para poder escalar a Reporte Completo, o elige una del catálogo.'
  );
  if (resCausa.error) return res.status(400).json({ error: resCausa.error });
  const resultado = await reportesData.escalarAReporteCompleto(req.params.id, {
    causaInicial: resCausa.texto, causaCatalogoId: resCausa.causaCatalogoId, defectoId: defecto_id || null,
    descripcion: (descripcion || '').trim() || null, autorId: req.usuario.id, autorNombre: req.usuario.nombre,
  });
  if (resultado.error === 'no_encontrado') return res.status(404).json({ error: 'Reporte no encontrado' });
  if (resultado.error === 'no_es_rapido') return res.status(400).json({ error: 'Este reporte ya no es un Reporte Rápido.' });
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes', entidadId: resultado.reporte.id, accion: 'Edición',
    detalle: `Reporte Rápido escalado a Reporte Completo. Causa raíz: ${resCausa.texto} — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.reporte);
}));

// ======================== CAUSAS Y MEDIDAS (Reporte Completo) ========================
router.post('/reportes/:id/causas', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const { texto, causa_catalogo_id } = req.body;
  const reporteActual = await reportesData.obtenerReporteCompleto(req.params.id);
  if (!reporteActual) return res.status(404).json({ error: 'Reporte no encontrado' });
  const resCausa = await resolverCausaConCatalogo(
    { causa_catalogo_id, texto, defectoId: reporteActual.defecto_id || null },
    'La causa raíz no puede estar vacía -- escríbela o elige una del catálogo.'
  );
  if (resCausa.error) return res.status(400).json({ error: resCausa.error });
  const resultado = await reportesData.agregarCausa({
    reporte_id: req.params.id, texto: resCausa.texto, causa_catalogo_id: resCausa.causaCatalogoId,
    autor_id: req.usuario.id, autor_nombre: req.usuario.nombre,
  });
  if (resultado.error === 'no_encontrado') return res.status(404).json({ error: 'Reporte no encontrado' });
  if (resultado.error === 'no_es_completo') return res.status(400).json({ error: 'Solo un Reporte Completo puede tener causas raíz.' });
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes_causas', entidadId: resultado.reporte.id, accion: 'Edición',
    detalle: `Causa raíz agregada: ${resCausa.texto} — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.reporte);
}));

// ======================== VINCULAR CAUSA DE OTRO CASO/MÓDULO ========================
// MIGRACIÓN #37 (07/09, pedido por Julio): mismo mecanismo que ya tiene
// Trazabilidad de Producción (ver routes/produccion.js) -- buscar una causa
// ya registrada (en este módulo o en el otro) y vincularla a este reporte en
// vez de duplicarla, para compartir medidas y progreso entre los dos. Nunca
// automático (ver data/causasRaiz.js).
router.get('/reportes/causas/buscar', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  res.json(await causasRaizData.buscarCausasExistentes({ q: req.query.q, limit: req.query.limite }));
}));

router.post('/reportes/:id/causas/vincular', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const { causa_id } = req.body;
  if (!causa_id) return res.status(400).json({ error: 'Elige la causa que quieres vincular.' });
  const resultado = await reportesData.vincularCausa({
    reporte_id: req.params.id, causa_id, usuario_id: req.usuario.id, usuario_nombre: req.usuario.nombre,
  });
  if (resultado.error === 'no_encontrado') return res.status(404).json({ error: 'Reporte no encontrado' });
  if (resultado.error === 'no_es_completo') return res.status(400).json({ error: 'Solo un Reporte Completo puede tener causas raíz.' });
  if (resultado.error === 'causa_no_encontrada') return res.status(404).json({ error: 'La causa elegida no existe.' });
  if (resultado.error === 'ya_vinculada') return res.status(400).json({ error: 'Esa causa ya está vinculada a este reporte.' });
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes_causas', entidadId: resultado.reporte.id, accion: 'Edición',
    detalle: `Causa raíz existente vinculada a este reporte — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.reporte);
}));

router.post('/reportes/:id/medidas', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const { texto, estado, causa_id } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'La medida no puede estar vacía.' });
  if (!causa_id) return res.status(400).json({ error: 'Elige a qué causa raíz corresponde esta medida.' });
  if (estado && !reportesData.ESTADOS_MEDIDA.includes(estado)) {
    return res.status(400).json({ error: `Estado de medida inválido. Debe ser: ${reportesData.ESTADOS_MEDIDA.join(', ')}.` });
  }
  const resultado = await reportesData.agregarMedida({
    reporte_id: req.params.id, texto: texto.trim(), estado, causa_id,
    autor_id: req.usuario.id, autor_nombre: req.usuario.nombre,
  });
  if (resultado.error === 'no_encontrado') return res.status(404).json({ error: 'Reporte no encontrado' });
  if (resultado.error === 'no_es_completo') return res.status(400).json({ error: 'Solo un Reporte Completo puede tener medidas.' });
  if (resultado.error === 'causa_no_encontrada') return res.status(400).json({ error: 'Esa causa raíz no existe o no pertenece a este reporte.' });
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes_medidas', entidadId: resultado.reporte.id, accion: 'Edición',
    detalle: `Medida agregada: ${texto.trim()} — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.reporte);
}));

router.put('/reportes/:id/medidas/:medidaId', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const { estado } = req.body;
  if (!estado || !reportesData.ESTADOS_MEDIDA.includes(estado)) {
    return res.status(400).json({ error: `Estado de medida inválido. Debe ser: ${reportesData.ESTADOS_MEDIDA.join(', ')}.` });
  }
  const resultado = await reportesData.actualizarEstadoMedida(req.params.id, req.params.medidaId, estado);
  if (resultado.error === 'no_encontrada') return res.status(404).json({ error: 'Medida no encontrada' });
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes_medidas', entidadId: req.params.medidaId, accion: 'Edición',
    detalle: `Medida #${req.params.medidaId} cambió a estado ${estado} — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.reporte);
}));

router.delete('/reportes/:id/causas/:causaId', validarToken, puedeEliminar, asyncHandler(async (req, res) => {
  const resultado = await reportesData.eliminarCausa(req.params.id, req.params.causaId);
  if (resultado.error === 'no_encontrada') return res.status(404).json({ error: 'Causa no encontrada en este reporte.' });
  if (resultado.error === 'ultima_causa') return res.status(400).json({ error: 'No se puede eliminar la única causa raíz de este reporte. Agrega otra causa antes de eliminar esta.' });
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes_causas', entidadId: req.params.causaId, accion: 'Eliminación',
    detalle: `Causa raíz "${resultado.causaEliminada.texto}" eliminada -- sus medidas también se eliminaron. Por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.reporte);
}));

router.delete('/reportes/:id/medidas/:medidaId', validarToken, puedeEliminar, asyncHandler(async (req, res) => {
  const resultado = await reportesData.eliminarMedida(req.params.id, req.params.medidaId);
  if (resultado.error === 'no_encontrada') return res.status(404).json({ error: 'Medida no encontrada en este reporte.' });
  await registrarCambio({
    modulo: 'Reportes por Áreas', entidad: 'reportes_medidas', entidadId: req.params.medidaId, accion: 'Eliminación',
    detalle: `Medida "${resultado.medidaEliminada.texto}" eliminada — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.reporte);
}));

// ======================== ADJUNTOS (evidencia / fichas técnicas) ========================
// Mismo mecanismo que ya usa el resto del sistema: multer guarda primero en
// una carpeta temporal (utils/upload.js), se valida que el CONTENIDO real
// del archivo sea una imagen o PDF (utils/validarArchivo.js, no solo la
// extensión), y recién entonces se mueve a su carpeta final -- acá,
// uploads/evidencias/reportes/ (ya preparada en settings/paths.js, hasta
// ahora sin ningún módulo usándola).
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
