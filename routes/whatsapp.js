const express = require('express');
const { validarToken, requerirPermiso } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const whatsappData = require('../data/whatsapp');
const whatsappAlertas = require('../data/whatsappAlertas');
const { registrarCambio } = require('../data/auditoria');
const { PERMISOS_BOT_DISPONIBLES } = require('../settings/permisosBot');

// ======================== MÓDULO WHATSAPP BOT ========================
// Node cachea los módulos por ruta resuelta, así que este require y el que
// hace app_circuitos.js para iniciar el bot (iniciarBotWhatsApp) apuntan a
// la misma instancia — se mantiene el comportamiento de singleton de antes.
const whatsappService = require('../whatsapp_bot_service');
const whatsappConfig = require('../settings/config_whatsapp');

const router = express.Router();

router.get('/whatsapp/sesiones', validarToken, requerirPermiso('whatsapp.bot.ver'), asyncHandler(async (req, res) => {
  const sesiones = await whatsappData.listarSesionesActivas();
  const resultado = sesiones.map(s => ({
    ...s,
    nombre: whatsappService.nombreDe(s.telefono)
  }));
  res.json({ sesiones: resultado });
}));

router.get('/whatsapp/registros', validarToken, requerirPermiso('whatsapp.bot.ver'), asyncHandler(async (req, res) => {
  const limite = parseInt(req.query.limite || '100', 10);
  const registros = await whatsappData.listarRegistros(limite);
  const resultado = registros.map(r => ({
    ...r,
    nombre: whatsappService.nombreDe(r.telefono)
  }));
  res.json({ registros: resultado });
}));

router.post('/whatsapp/cerrar-sesion', validarToken, requerirPermiso('whatsapp.bot.gestionar'), asyncHandler(async (req, res) => {
  const { telefono } = req.body;
  if (!telefono) return res.status(400).json({ error: 'Teléfono requerido' });
  const r = await whatsappService.cerrarSesionPorAdmin(telefono);
  res.json(r);
}));

router.post('/whatsapp/resumen', validarToken, requerirPermiso('whatsapp.bot.gestionar'), asyncHandler(async (req, res) => {
  await whatsappService.enviarResumenAdmin();
  res.json({ success: true, message: 'Resumen enviado al administrador por WhatsApp' });
}));

router.get('/whatsapp/areas', validarToken, requerirPermiso('whatsapp.bot.ver'), (req, res) => {
  res.json({
    areas: whatsappConfig.AREAS,
    timezone: whatsappConfig.TIMEZONE
  });
});

// ======================== NÚMEROS AUTORIZADOS (roadmap #2) ========================
// Gestionar quién puede usar el bot y quién recibe los resúmenes/alertas
// como administrador — antes solo se podía cambiar editando el .env y
// reiniciando el servidor. Se deja bajo 'whatsapp.bot.gestionar' (el mismo
// permiso que ya existía para cerrar sesiones y mandar el resumen manual),
// no uno nuevo, porque es la misma idea de "administrar el bot".
router.get('/whatsapp/numeros', validarToken, requerirPermiso('whatsapp.bot.gestionar'), asyncHandler(async (req, res) => {
  const numeros = await whatsappAlertas.listarNumeros();
  res.json({ numeros });
}));

router.post('/whatsapp/numeros', validarToken, requerirPermiso('whatsapp.bot.gestionar'), asyncHandler(async (req, res) => {
  const { telefono, nombre, es_admin } = req.body;
  if (!telefono || !telefono.trim() || !nombre || !nombre.trim()) {
    return res.status(400).json({ error: 'Teléfono y nombre son obligatorios' });
  }
  // El bot identifica a cada persona por el "id" que manda whatsapp-web.js
  // en msg.from (termina en @c.us o @lid, no es un número de celular tal
  // cual) — se guarda tal cual lo escriban, sin intentar validarlo como
  // teléfono, para no rechazar formatos válidos que no se ven como uno.
  try {
    const result = await whatsappAlertas.crearNumero({ telefono: telefono.trim(), nombre: nombre.trim(), es_admin });
    await registrarCambio({
      modulo: 'WhatsApp Bot', entidad: 'whatsapp_numeros', entidadId: result.lastID, accion: 'Creación',
      detalle: `Número "${nombre.trim()}" agregado${es_admin ? ' como administrador' : ''}.`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
    });
    await whatsappService.recargarNumerosWhatsApp();
    res.status(201).json({ success: true, id: result.lastID });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un número con ese identificador' });
    res.status(500).json({ error: e.message });
  }
}));

router.put('/whatsapp/numeros/:id', validarToken, requerirPermiso('whatsapp.bot.gestionar'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const existente = await whatsappAlertas.obtenerNumeroPorId(id);
  if (!existente) return res.status(404).json({ error: 'Número no encontrado' });

  const { nombre, es_admin, activo } = req.body;
  await whatsappAlertas.actualizarNumero(id, { nombre, es_admin, activo });
  await registrarCambio({
    modulo: 'WhatsApp Bot', entidad: 'whatsapp_numeros', entidadId: id, accion: 'Edición',
    detalle: `Número "${existente.nombre}" editado.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  await whatsappService.recargarNumerosWhatsApp();
  res.json({ success: true });
}));

// Catálogo de comandos/funciones que se le pueden dar a un número — lo usa
// la pantalla de edición para dibujar las casillas (mismo patrón que
// GET /api/permisos para los roles de la app).
router.get('/whatsapp/permisos-bot', validarToken, requerirPermiso('whatsapp.bot.gestionar'), (req, res) => {
  res.json({ permisos: PERMISOS_BOT_DISPONIBLES });
});

router.put('/whatsapp/numeros/:id/permisos', validarToken, requerirPermiso('whatsapp.bot.gestionar'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const existente = await whatsappAlertas.obtenerNumeroPorId(id);
  if (!existente) return res.status(404).json({ error: 'Número no encontrado' });

  const permisos = Array.isArray(req.body.permisos) ? req.body.permisos : [];
  await whatsappAlertas.asignarPermisosANumero(id, permisos);
  await registrarCambio({
    modulo: 'WhatsApp Bot', entidad: 'whatsapp_numero_permisos', entidadId: id, accion: 'Edición',
    detalle: `Permisos de "${existente.nombre}" actualizados: ${permisos.length > 0 ? permisos.join(', ') : '(ninguno)'}.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  await whatsappService.recargarNumerosWhatsApp();
  res.json({ success: true });
}));

router.delete('/whatsapp/numeros/:id', validarToken, requerirPermiso('whatsapp.bot.gestionar'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const existente = await whatsappAlertas.obtenerNumeroPorId(id);
  if (!existente) return res.status(404).json({ error: 'Número no encontrado' });

  await whatsappAlertas.eliminarNumero(id);
  await registrarCambio({
    modulo: 'WhatsApp Bot', entidad: 'whatsapp_numeros', entidadId: id, accion: 'Eliminación',
    detalle: `Número "${existente.nombre}" eliminado.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  await whatsappService.recargarNumerosWhatsApp();
  res.json({ success: true });
}));

// ======================== CONFIGURACIÓN DE ALERTAS (roadmap #2) ========================
router.get('/whatsapp/alertas-config', validarToken, requerirPermiso('whatsapp.bot.gestionar'), asyncHandler(async (req, res) => {
  const alertas = await whatsappAlertas.listarConfigAlertas();
  res.json({ alertas });
}));

router.put('/whatsapp/alertas-config/:tipo', validarToken, requerirPermiso('whatsapp.bot.gestionar'), asyncHandler(async (req, res) => {
  const { tipo } = req.params;
  const existente = await whatsappAlertas.obtenerConfigAlerta(tipo);
  if (!existente) return res.status(404).json({ error: 'Tipo de alerta no reconocido' });

  const { activo, umbral, ventana_dias } = req.body;
  await whatsappAlertas.actualizarConfigAlerta(tipo, { activo, umbral, ventana_dias });
  await registrarCambio({
    modulo: 'WhatsApp Bot', entidad: 'whatsapp_alertas_config', entidadId: tipo, accion: 'Edición',
    detalle: `Alerta "${tipo}" ${activo === false ? 'desactivada' : activo === true ? 'activada' : 'editada'}.` + (umbral !== undefined ? ` Umbral: ${umbral}.` : '') + (ventana_dias !== undefined ? ` Ventana: ${ventana_dias} día(s).` : ''),
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ success: true });
}));

module.exports = router;
