const express = require('express');

const { validarToken, requerirPermiso, requerirPermisoAlternativo } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const iso = require('../data/iso2859');
const { calcularMuestreo, evaluarDecision, sugerirPlan } = require('../utils/iso2859');
const { registrarCambio } = require('../data/auditoria');
const whatsappService = require('../whatsapp_bot_service');

const router = express.Router();

// ======================== PERMISOS ========================
// Cualquier permiso del módulo alcanza para las consultas de solo lectura
// (catálogos, áreas, búsqueda/lista de lotes): son datos de apoyo que
// necesita cualquier pantalla del módulo, sin importar qué parte específica
// pueda usar la persona. Las acciones (crear lote, muestrear, cambiar plan,
// reportes) sí piden su permiso específico, con 'iso2859.gestion' siempre
// como interruptor maestro — mismo patrón que ya usa Metrología.
const CUALQUIER_ISO = ['iso2859.ver', 'iso2859.crear_lote', 'iso2859.muestrear', 'iso2859.cambiar_plan', 'iso2859.reportes', 'iso2859.gestion'];
const puedeLeer = requerirPermisoAlternativo(CUALQUIER_ISO);
const puedeCrearLote = requerirPermisoAlternativo(['iso2859.crear_lote', 'iso2859.gestion']);
const puedeMuestrear = requerirPermisoAlternativo(['iso2859.muestrear', 'iso2859.gestion']);
const puedeCalcular = requerirPermisoAlternativo(['iso2859.crear_lote', 'iso2859.muestrear', 'iso2859.gestion']);
const puedeCambiarPlan = requerirPermisoAlternativo(['iso2859.cambiar_plan', 'iso2859.gestion']);
const puedeSugerirPlan = requerirPermisoAlternativo(['iso2859.muestrear', 'iso2859.cambiar_plan', 'iso2859.gestion']);
const puedeVerReportes = requerirPermisoAlternativo(['iso2859.reportes', 'iso2859.gestion']);
// Administración de catálogos (pestaña "Catálogos" en Gestión): un permiso
// aparte de los de arriba porque no es una función operativa del módulo
// ISO 2859, sino de administración general del sistema (ver
// settings/permisos.js).
const puedeGestionarCatalogos = requerirPermiso('catalogos.gestionar');

// ======================== ÁREAS Y CATÁLOGOS ========================
router.get('/iso2859/areas', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  res.json(await iso.listarAreas(req.query.modulo));
}));

router.get('/iso2859/catalogos/referencias', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  res.json(await iso.buscarReferencias((req.query.q || '').trim()));
}));

router.get('/iso2859/catalogos/defectos', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  res.json(await iso.buscarDefectos((req.query.q || '').trim()));
}));

router.get('/iso2859/catalogos/planes/:producto', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  res.json(await iso.obtenerPlanPorProducto(req.params.producto) || null);
}));

// ======================== ADMINISTRACIÓN DE CATÁLOGOS ========================
// Para la pestaña "📋 Catálogos" en Gestión (Public/gestion.html): a
// diferencia de los endpoints de arriba (que alimentan las pantallas
// operativas del día a día y solo traen los registros "Activo"), estos
// traen todo —incluidos los "Inactivo"— y permiten crear/editar/eliminar,
// para no tener que abrir la base de datos con un programa aparte.
router.get('/iso2859/catalogos/defectos/todos', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  res.json(await iso.listarDefectosCatalogo());
}));

router.post('/iso2859/catalogos/defectos', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const { codigo, area, descripcion, severidad } = req.body;
  if (!codigo || !area || !descripcion || !severidad) {
    return res.status(400).json({ error: 'Código, área, descripción y severidad son obligatorios' });
  }
  try {
    const result = await iso.crearDefectoCatalogo(codigo.trim(), area.trim(), descripcion.trim(), severidad);
    await registrarCambio({
      modulo: 'Catálogos', entidad: 'defectos_iso', entidadId: result.lastID, accion: 'Creación',
      detalle: `Defecto "${codigo}" (${descripcion}) creado. Severidad: ${severidad}.`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
    });
    res.json({ success: true, id: result.lastID });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: `El código "${codigo}" ya existe en el catálogo` });
    throw e;
  }
}));

router.put('/iso2859/catalogos/defectos/:id', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const { codigo, area, descripcion, severidad } = req.body;
  const estado = req.body.estado === 'Inactivo' ? 'Inactivo' : 'Activo';
  if (!codigo || !area || !descripcion || !severidad) {
    return res.status(400).json({ error: 'Código, área, descripción y severidad son obligatorios' });
  }
  try {
    await iso.actualizarDefectoCatalogo(id, codigo.trim(), area.trim(), descripcion.trim(), severidad, estado);
    await registrarCambio({
      modulo: 'Catálogos', entidad: 'defectos_iso', entidadId: id, accion: 'Edición',
      detalle: `Defecto "${codigo}" (${descripcion}) editado. Severidad: ${severidad}. Estado: ${estado}.`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
    });
    res.json({ success: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: `El código "${codigo}" ya existe en el catálogo` });
    throw e;
  }
}));

router.delete('/iso2859/catalogos/defectos/:id', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const defecto = await iso.listarDefectosCatalogo().then(lista => lista.find(d => d.id === id));
  await iso.eliminarDefectoCatalogo(id);
  await registrarCambio({
    modulo: 'Catálogos', entidad: 'defectos_iso', entidadId: id, accion: 'Eliminación',
    detalle: `Defecto "${defecto ? defecto.codigo : id}" eliminado.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ success: true });
}));

router.get('/iso2859/catalogos/areas/todas', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  res.json(await iso.listarAreasCatalogo());
}));

router.post('/iso2859/catalogos/areas', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const { nombre, modulo } = req.body;
  if (!nombre || !modulo) return res.status(400).json({ error: 'Nombre y módulo son obligatorios' });
  const result = await iso.crearAreaCatalogo(nombre.trim(), modulo);
  await registrarCambio({
    modulo: 'Catálogos', entidad: 'areas_iso', entidadId: result.lastID, accion: 'Creación',
    detalle: `Área "${nombre}" (${modulo}) creada.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ success: true, id: result.lastID });
}));

router.put('/iso2859/catalogos/areas/:id', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const { nombre, modulo } = req.body;
  const estado = req.body.estado === 'Inactivo' ? 'Inactivo' : 'Activo';
  if (!nombre || !modulo) return res.status(400).json({ error: 'Nombre y módulo son obligatorios' });
  await iso.actualizarAreaCatalogo(id, nombre.trim(), modulo, estado);
  await registrarCambio({
    modulo: 'Catálogos', entidad: 'areas_iso', entidadId: id, accion: 'Edición',
    detalle: `Área "${nombre}" (${modulo}) editada. Estado: ${estado}.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ success: true });
}));

router.delete('/iso2859/catalogos/areas/:id', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const area = await iso.listarAreasCatalogo().then(lista => lista.find(a => a.id === id));
  await iso.eliminarAreaCatalogo(id);
  await registrarCambio({
    modulo: 'Catálogos', entidad: 'areas_iso', entidadId: id, accion: 'Eliminación',
    detalle: `Área "${area ? area.nombre : id}" eliminada.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ success: true });
}));

router.get('/iso2859/catalogos/planes/admin/todos', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  res.json(await iso.listarPlanesCatalogo());
}));

router.post('/iso2859/catalogos/planes', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const { producto, nivel_inspeccion, nca_mayores, nca_menores, nca_criticos } = req.body;
  if (!producto || !nivel_inspeccion) return res.status(400).json({ error: 'Producto y nivel de inspección son obligatorios' });
  try {
    await iso.crearPlanCatalogo(producto.trim(), nivel_inspeccion, Number(nca_mayores) || 0, Number(nca_menores) || 0, Number(nca_criticos) || 0);
    await registrarCambio({
      modulo: 'Catálogos', entidad: 'planes_muestreo', entidadId: producto, accion: 'Creación',
      detalle: `Plan de muestreo para "${producto}" creado (nivel ${nivel_inspeccion}).`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
    });
    res.json({ success: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: `Ya existe un plan para "${producto}"` });
    throw e;
  }
}));

router.put('/iso2859/catalogos/planes/:producto', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const { nivel_inspeccion, nca_mayores, nca_menores, nca_criticos } = req.body;
  if (!nivel_inspeccion) return res.status(400).json({ error: 'Nivel de inspección es obligatorio' });
  await iso.actualizarPlanCatalogo(req.params.producto, nivel_inspeccion, Number(nca_mayores) || 0, Number(nca_menores) || 0, Number(nca_criticos) || 0);
  await registrarCambio({
    modulo: 'Catálogos', entidad: 'planes_muestreo', entidadId: req.params.producto, accion: 'Edición',
    detalle: `Plan de muestreo para "${req.params.producto}" editado (nivel ${nivel_inspeccion}).`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ success: true });
}));

router.delete('/iso2859/catalogos/planes/:producto', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  await iso.eliminarPlanCatalogo(req.params.producto);
  await registrarCambio({
    modulo: 'Catálogos', entidad: 'planes_muestreo', entidadId: req.params.producto, accion: 'Eliminación',
    detalle: `Plan de muestreo para "${req.params.producto}" eliminado.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ success: true });
}));

// ======================== LOTES ========================
router.post('/iso2859/lotes', validarToken, puedeCrearLote, asyncHandler(async (req, res) => {
  const { id_lote, referencia, modulo, cantidad_total, metodo_en_proceso, id_revision, proveedor, oc_factura, maquina } = req.body;
  if (!id_lote || !referencia || !modulo || !cantidad_total) {
    return res.status(400).json({ error: 'id_lote, referencia, modulo y cantidad_total son obligatorios' });
  }
  const resultado = await iso.upsertLote({ id_lote, referencia, modulo, cantidad_total, metodo_en_proceso, id_revision, proveedor, oc_factura, maquina });
  res.json(resultado);
}));

router.get('/iso2859/lotes/buscar', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  res.json(await iso.buscarLotes((req.query.q || '').trim(), req.query.modulo));
}));

router.get('/iso2859/lotes/dashboard/resumen', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  res.json(await iso.dashboardResumen(req.query.modulo || 'Recepcion'));
}));

router.get('/iso2859/lotes/dashboard/tendencias', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  res.json(await iso.dashboardTendencias(parseInt(req.query.dias, 10) || 7));
}));

router.get('/iso2859/lotes/dashboard/defectos-area', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  res.json(await iso.dashboardDefectosArea(parseInt(req.query.dias, 10) || 30));
}));

router.get('/iso2859/lotes/dashboard/bitacora', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  res.json(await iso.dashboardBitacora());
}));

router.get('/iso2859/lotes/dashboard/lotes-activos', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  res.json(await iso.dashboardLotesActivos());
}));

router.get('/iso2859/lotes/:id', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  const lote = await iso.obtenerLotePorId(req.params.id);
  if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });
  res.json(lote);
}));

// Cierre manual: para cuando la producción/recepción de un lote ya terminó
// en la práctica pero nunca llegó a tener una Auditoría Final. Mismo
// permiso que crear un muestreo (iso2859.muestrear/gestion) — quien puede
// muestrear un lote también puede decidir que ya no se le va a muestrear
// más. Solo se puede cerrar un lote que sigue "Pendiente": uno que ya tiene
// un veredicto real (Aceptado/Rechazado) no se toca por esta vía.
router.post('/iso2859/lotes/:id/cerrar', validarToken, puedeMuestrear, asyncHandler(async (req, res) => {
  const lote = await iso.obtenerLotePorId(req.params.id);
  if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });
  if (lote.estado_final !== 'Pendiente') {
    return res.status(400).json({ error: `Este lote ya tiene un estado final (${lote.estado_final}); no se puede cerrar por esta vía.` });
  }
  const analista = req.usuario.nombre || req.usuario.usuario;
  await iso.cerrarLoteManual({ id_lote: req.params.id, analista, motivo: req.body.motivo });
  await registrarCambio({
    modulo: 'Muestreos ISO 2859', entidad: 'iso_lotes', entidadId: req.params.id, accion: 'Edición',
    detalle: `Lote ${req.params.id} cerrado manualmente sin auditoría final.${req.body.motivo ? ' Motivo: ' + req.body.motivo : ''}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ ok: true, estado_final: 'Cerrado_sin_auditoria' });
}));

// Cambio de tratamiento manual: cuando un lote sale Rechazado en la
// Auditoría Final, Calidad puede decidir no desecharlo sino reclasificarlo
// (usarlo en otra referencia o para otro fin) o mandarlo a reparación. El
// motivo es obligatorio porque, a diferencia del cierre sin auditoría,
// esto cambia el destino real de un lote que ya tiene un veredicto formal
// — conviene que quede claro por qué. El veredicto Aceptado/Rechazado
// calculado por la fórmula de AQL no se toca: sigue existiendo en el
// muestreo "Final" tal cual se calculó, esto solo agrega qué se hizo con
// el lote después.
const TRATAMIENTOS_VALIDOS = ['Reclasificado', 'Reparacion'];
router.post('/iso2859/lotes/:id/tratamiento', validarToken, puedeMuestrear, asyncHandler(async (req, res) => {
  const lote = await iso.obtenerLotePorId(req.params.id);
  if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });
  if (lote.estado_final !== 'Rechazado') {
    return res.status(400).json({ error: `Solo se puede cambiar el tratamiento de un lote Rechazado (este está en estado: ${lote.estado_final}).` });
  }
  const tratamiento = req.body.tratamiento;
  if (!TRATAMIENTOS_VALIDOS.includes(tratamiento)) {
    return res.status(400).json({ error: `Tratamiento inválido. Debe ser uno de: ${TRATAMIENTOS_VALIDOS.join(', ')}.` });
  }
  if (!req.body.motivo || !req.body.motivo.trim()) {
    return res.status(400).json({ error: 'El motivo es obligatorio.' });
  }
  const analista = req.usuario.nombre || req.usuario.usuario;
  await iso.cambiarTratamientoLote({ id_lote: req.params.id, analista, motivo: req.body.motivo.trim(), tratamiento });
  await registrarCambio({
    modulo: 'Muestreos ISO 2859', entidad: 'iso_lotes', entidadId: req.params.id, accion: 'Edición',
    detalle: `Lote ${req.params.id} cambiado a "${tratamiento}" (venía Rechazado). Motivo: ${req.body.motivo.trim()}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ ok: true, estado_final: tratamiento });
}));

router.get('/iso2859/lotes', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  res.json(await iso.listarLotes(req.query));
}));

// ======================== MUESTREOS ========================
router.post('/iso2859/muestreos', validarToken, puedeMuestrear, asyncHandler(async (req, res) => {
  const { id_lote, tipo, cantidad_muestreada, observaciones, defectos, turno, area, operario, piezas_reclasificadas, piezas_reparadas } = req.body;
  if (!id_lote || !tipo || !cantidad_muestreada) {
    return res.status(400).json({ error: 'id_lote, tipo y cantidad_muestreada son obligatorios' });
  }

  const lote = await iso.obtenerLotePorId(id_lote);
  if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });

  // El analista/operario ya NO viene del formulario (antes era un texto
  // libre que cualquiera podía escribir): se toma del usuario que inició
  // sesión, igual que en Garantías y Metrología, para que quede registrado
  // quién hizo realmente el muestreo.
  const analista = req.usuario.nombre || req.usuario.usuario;

  let decisionFinal;
  if (tipo === 'Final') {
    if (defectos && defectos.length > 0) {
      // La severidad que cuenta aquí es la que declaró el formulario de
      // Auditoría Final (en qué columna —Críticos/Mayores/Menores— el
      // inspector anotó el hallazgo), NO la que tenga guardada el catálogo
      // de tipificación de defectos (iso_tipificacion_defectos).
      //
      // Esto es a propósito: el catálogo que se migró de la app anterior
      // tiene 302 de sus 303 códigos marcados como "Menor" —un error del
      // script de importación original (seed.js), que ignoraba la
      // severidad real y guardaba todo como Menor—. Si esta decisión
      // confiara en ese catálogo, un lote con un defecto que el inspector
      // clasificó como Crítico en el momento de la auditoría podía terminar
      // Aceptado, porque el catálogo decía "Menor" para ese código. Se
      // sigue guardando el código tal cual para el reporte (que sí muestra
      // la descripción del catálogo), pero la severidad para decidir
      // Aceptar/Rechazar es siempre la que el inspector marcó en pantalla.
      // Respaldo por si algún hallazgo llega sin severidad declarada (por
      // ejemplo, una llamada directa a la API en vez del formulario): se
      // busca en el catálogo como último recurso, en vez de fallar.
      const sinSeveridad = defectos.filter(d => !d.severidad).map(d => d.codigo);
      const sevCatalogo = {};
      if (sinSeveridad.length > 0) {
        (await iso.obtenerSeveridadesDefectos(sinSeveridad)).forEach((d) => { sevCatalogo[d.codigo] = d.severidad; });
      }

      let crit = 0, may = 0, men = 0;
      defectos.forEach(d => {
        const cant = parseInt(d.cantidad, 10) || 1;
        const sev = d.severidad || sevCatalogo[d.codigo] || 'Menor';
        if (sev === 'Crítico') crit += cant;
        else if (sev === 'Mayor') may += cant;
        else men += cant;
      });

      const planIso = calcularMuestreo(lote.cantidad_total);
      decisionFinal = evaluarDecision(crit, may, men, planIso);
    } else {
      decisionFinal = 'Aceptado';
    }
  } else {
    // Primera_Pieza y En_Proceso: la decisión la manda el frontend
    // (Aprobado/Rechazado, o Seguir/Alerta/Parar).
    decisionFinal = req.body.decision || 'Aceptado';
  }

  // piezas_reclasificadas/piezas_reparadas solo aplican de verdad a
  // "En_Proceso" (qué se hizo con las piezas defectuosas encontradas en
  // ese muestreo), pero se guardan tal cual vengan — si no vienen,
  // crearMuestreo ya las deja en 0 por defecto.
  const idMuestreo = await iso.crearMuestreo({
    id_lote, tipo, analista, cantidad_muestreada, decision: decisionFinal,
    observaciones, turno, area, operario, defectos,
    piezas_reclasificadas: parseInt(piezas_reclasificadas, 10) || 0,
    piezas_reparadas: parseInt(piezas_reparadas, 10) || 0,
  });

  if (tipo === 'Final') {
    let estado = decisionFinal;
    if (lote.modulo === 'Recepcion' && decisionFinal === 'Aceptado') {
      const { alertas } = await iso.contarAlertasEnProceso(id_lote);
      if (alertas > 0) estado = 'Aceptado_con_obs';
    }
    await iso.actualizarEstadoFinalLote(id_lote, estado);

    // Alerta de WhatsApp: lote rechazado en Auditoría Final. Se manda apenas
    // se guarda el veredicto, antes de que alguien elija un tratamiento
    // (Reclasificar/Reparar/Dejarlo Rechazado) — es la señal más "dura" de
    // todo el módulo, porque ya es un resultado estadístico definitivo.
    if (estado === 'Rechazado') {
      whatsappService.enviarAlerta('lote_rechazado_final',
        `❌ *LOTE RECHAZADO — Auditoría Final*\n\nLote: *${id_lote}*\nReferencia: *${lote.referencia}*\nAnalista: ${analista}\n\nQueda pendiente de tratamiento (Reclasificar / Reparar / Dejarlo Rechazado) en el módulo de Muestreos ISO 2859.`
      );
    }
  } else if (tipo === 'Primera_Pieza' && decisionFinal === 'Rechazar') {
    whatsappService.enviarAlerta('primera_pieza_rechazada',
      `⚠️ *PRIMERA PIEZA RECHAZADA*\n\nLote: *${id_lote}*\nReferencia: *${lote.referencia}*\nAnalista: ${analista}\n\nHay que repetir la Primera Pieza de este lote hasta que salga Liberada.`
    );
  } else if (tipo === 'En_Proceso' && decisionFinal === 'Parar') {
    whatsappService.enviarAlerta('muestreo_parar',
      `🛑 *MUESTREO EN PROCESO: PARAR*\n\nLote: *${id_lote}*\nReferencia: *${lote.referencia}*\nAnalista: ${analista}${area ? `\nÁrea: ${area}` : ''}\n\nSe decidió detener la máquina/proceso.`
    );
  }

  res.json({ id_muestreo: idMuestreo, decision: decisionFinal });
}));

router.post('/iso2859/muestreos/calcular-iso', validarToken, puedeCalcular, asyncHandler(async (req, res) => {
  const cantidadLote = parseInt(req.body.cantidad_lote, 10);
  if (!cantidadLote || cantidadLote <= 0) return res.status(400).json({ error: 'cantidad_lote inválida' });
  res.json(calcularMuestreo(cantidadLote));
}));

router.get('/iso2859/muestreos/sugerencia-plan/:referencia', validarToken, puedeSugerirPlan, asyncHandler(async (req, res) => {
  const sugerencia = await sugerirPlan(require('../db/connection').getDb(), req.params.referencia, req.query.plan_actual || 'Normal');
  res.json(sugerencia);
}));

router.post('/iso2859/muestreos/cambiar-plan', validarToken, puedeCambiarPlan, asyncHandler(async (req, res) => {
  const { referencia, plan_nuevo, justificacion } = req.body;
  if (!referencia || !plan_nuevo || !justificacion) {
    return res.status(400).json({ error: 'referencia, plan_nuevo y justificacion son obligatorios' });
  }
  const analista = req.usuario.nombre || req.usuario.usuario;
  const resultado = await iso.cambiarPlan({ referencia, plan_nuevo, justificacion, analista });
  await registrarCambio({
    modulo: 'Muestreos ISO 2859', entidad: 'iso_planes_muestreo (por referencia)', entidadId: referencia, accion: 'Edición',
    detalle: `Plan de "${referencia}" cambiado de "${resultado.plan_anterior}" a "${resultado.plan_nuevo}". Justificación: ${justificacion}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ ok: true, ...resultado });
}));

// ======================== REVISIONES ========================
router.post('/iso2859/revisiones', validarToken, puedeCrearLote, asyncHandler(async (req, res) => {
  const { referencia, cantidad_programada, maquina } = req.body;
  if (!referencia) return res.status(400).json({ error: 'referencia es obligatoria' });
  res.json(await iso.crearRevision({ referencia, cantidad_programada, maquina }));
}));

router.get('/iso2859/revisiones', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  res.json(await iso.listarRevisiones());
}));

router.get('/iso2859/revisiones/:id', validarToken, puedeLeer, asyncHandler(async (req, res) => {
  const rev = await iso.obtenerRevisionPorId(req.params.id);
  if (!rev) return res.status(404).json({ error: 'Revisión no encontrada' });
  res.json(rev);
}));

// ======================== REPORTES (PDF) ========================
// El dibujo (encabezado con logo, panel de datos en tarjeta, insignias de
// color, tarjetas de resumen y tablas) vive en utils/pdfIso2859.js, para que
// los tres reportes de aquí abajo se vean como parte del mismo documento
// institucional en vez de folios de texto plano armados cada uno a su manera.
const pdf = require('../utils/pdfIso2859');

function calcularCriticidad(muestreo, defectos) {
  let criticidad = 'Ninguna', totalDefectos = 0;
  if (defectos && defectos.length > 0) {
    const severidades = defectos.map(d => d.severidad);
    if (severidades.includes('Crítico')) criticidad = 'CRITICO';
    else if (severidades.includes('Mayor')) criticidad = 'MAYOR';
    else criticidad = 'MENOR';
    totalDefectos = defectos.reduce((sum, d) => sum + (d.cantidad || 1), 0);
  } else if (muestreo.decision === 'Rechazado' || muestreo.decision === 'Parar') {
    criticidad = 'RECHAZADO';
  }
  return { criticidad, totalDefectos };
}

router.get('/iso2859/reportes/operativo/:id', validarToken, puedeVerReportes, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const muestreo = await iso.obtenerMuestreoConLote(id);
  if (!muestreo) return res.status(404).json({ error: 'Muestreo no encontrado' });
  const defectos = await iso.obtenerDefectosDeMuestreo(id);
  const { criticidad, totalDefectos } = calcularCriticidad(muestreo, defectos);
  const porcentaje = muestreo.cantidad_muestreada > 0
    ? ((totalDefectos / muestreo.cantidad_muestreada) * 100).toFixed(2) + '%'
    : '0%';

  const doc = pdf.crearDocumento(res, `reporte-muestreo-${id}.pdf`);
  const subtitulo = 'Reporte de Muestreo · ISO 2859-1';
  pdf.dibujarPie(doc);
  doc.on('pageAdded', () => pdf.dibujarPie(doc));

  let y = pdf.dibujarEncabezado(doc, subtitulo);
  const obsTexto = muestreo.observaciones || 'Sin observaciones';

  y = pdf.dibujarPanelInfo(doc, y, [
    { label: 'Criticidad', value: criticidad, badge: true },
    { label: 'Lote', value: muestreo.id_lote },
    { label: 'Referencia', value: muestreo.referencia },
    { label: 'Tipo de Muestreo', value: (muestreo.tipo || '').replace('_', ' ') },
    { label: 'Cantidad Lote', value: muestreo.cantidad_total },
    { label: 'Cantidad Muestra', value: muestreo.cantidad_muestreada },
    { label: 'Cantidad No Conforme', value: totalDefectos },
    { label: '% No Conforme', value: porcentaje },
    { label: 'Proveedor / Máquina', value: muestreo.proveedor || muestreo.maquina || '-' },
    { label: 'Inspector', value: muestreo.analista },
    { label: 'Turno / Área', value: [muestreo.turno, muestreo.area].filter(Boolean).join('  ·  ') || '-' },
    { label: 'Decisión', value: muestreo.decision || 'Pendiente', badge: true },
    {
      label: 'Observación', value: obsTexto,
      alturaExtra: Math.max(22, doc.heightOfString(obsTexto, { width: pdf.anchoUtil(doc) - 170, font: 'Helvetica', fontSize: 9 }) + 14),
    },
  ]);

  if (defectos && defectos.length > 0) {
    y = pdf.saltoPaginaSiNecesario(doc, y, 60, (doc2) => pdf.dibujarEncabezado(doc2, `${subtitulo} (continuación)`));
    y = pdf.dibujarTituloSeccion(doc, y, 'Defectos Encontrados');
    const columnas = [
      { label: 'CÓDIGO', ancho: 70 },
      { label: 'DESCRIPCIÓN', ancho: 235 },
      { label: 'SEVERIDAD', ancho: 105, badge: true },
      { label: 'CANTIDAD', ancho: 65, align: 'right' },
    ];
    y = pdf.dibujarTablaEncabezado(doc, y, columnas);
    defectos.forEach((d, i) => {
      y = pdf.saltoPaginaSiNecesario(doc, y, 20, (doc2) => {
        const yy = pdf.dibujarEncabezado(doc2, `${subtitulo} (continuación)`);
        return pdf.dibujarTablaEncabezado(doc2, yy, columnas);
      });
      y = pdf.dibujarTablaFila(doc, y, columnas, [d.codigo_defecto, d.descripcion || '-', d.severidad, `x${d.cantidad}`], i);
    });
  }

  doc.end();
}));

router.get('/iso2859/reportes/lote/:id', validarToken, puedeVerReportes, asyncHandler(async (req, res) => {
  const lote = await iso.obtenerLotePorId(req.params.id);
  if (!lote) return res.status(404).json({ error: 'Lote no encontrado' });

  const doc = pdf.crearDocumento(res, `lote-${lote.id_lote}.pdf`);
  const subtitulo = 'Informe de Lote · ISO 2859-1';
  pdf.dibujarPie(doc);
  doc.on('pageAdded', () => pdf.dibujarPie(doc));

  let y = pdf.dibujarEncabezado(doc, subtitulo);

  y = pdf.dibujarPanelInfo(doc, y, [
    { label: 'Lote', value: lote.id_lote },
    { label: 'Referencia', value: lote.referencia },
    { label: 'Módulo', value: lote.modulo },
    { label: 'Cantidad Total', value: lote.cantidad_total },
    { label: 'Plan Actual', value: lote.plan_actual || 'Normal' },
    { label: 'Estado', value: lote.estado_final || 'Pendiente', badge: true },
    { label: 'Proveedor / Máquina', value: lote.proveedor || lote.maquina || '-' },
    { label: 'OC / Factura', value: lote.oc_factura || '-' },
    { label: 'Fecha de Creación', value: lote.fecha_creacion },
  ]);

  const muestreos = lote.muestreos || [];
  y = pdf.saltoPaginaSiNecesario(doc, y, 60, (doc2) => pdf.dibujarEncabezado(doc2, `${subtitulo} (continuación)`));
  y = pdf.dibujarTituloSeccion(doc, y, `Muestreos Realizados (${muestreos.length})`);

  if (muestreos.length > 0) {
    const columnas = [
      { label: 'TIPO', ancho: 95 },
      { label: 'FECHA', ancho: 105 },
      { label: 'INSPECTOR', ancho: 130 },
      { label: 'MUESTRA', ancho: 60, align: 'right' },
      { label: 'DECISIÓN', ancho: 85, badge: true },
    ];
    y = pdf.dibujarTablaEncabezado(doc, y, columnas);
    muestreos.forEach((m, i) => {
      y = pdf.saltoPaginaSiNecesario(doc, y, 20, (doc2) => {
        const yy = pdf.dibujarEncabezado(doc2, `${subtitulo} (continuación)`);
        return pdf.dibujarTablaEncabezado(doc2, yy, columnas);
      });
      y = pdf.dibujarTablaFila(doc, y, columnas, [
        (m.tipo || '').replace('_', ' '), m.fecha_hora, m.analista, m.cantidad_muestreada, m.decision || 'Pendiente',
      ], i);
    });
  } else {
    doc.font('Helvetica').fontSize(9.5).fillColor(pdf.COLORES.gris).text('Sin muestreos registrados todavía.', pdf.MARGEN, y);
  }

  doc.end();
}));

router.get('/iso2859/reportes/trazabilidad/:referencia', validarToken, puedeVerReportes, asyncHandler(async (req, res) => {
  const ref = req.params.referencia;
  const lotes = await iso.obtenerLotesPorReferencia(ref);
  if (!lotes || lotes.length === 0) return res.status(404).json({ error: 'Sin datos para esta referencia' });

  const totales = {
    total: lotes.length,
    aceptados: lotes.filter(l => l.estado_final === 'Aceptado' || l.estado_final === 'Aceptado_con_obs').length,
    rechazados: lotes.filter(l => l.estado_final === 'Rechazado').length,
    // "Cerrado sin auditoría" se cuenta aparte de Pendientes: uno sigue
    // esperando su Auditoría Final, el otro ya se dejó de trabajar sin
    // llegar a tenerla — mezclarlos haría parecer más lotes "en cola" de
    // los que realmente hay.
    cerrados: lotes.filter(l => l.estado_final === 'Cerrado_sin_auditoria').length,
    pendientes: lotes.filter(l => !l.estado_final || l.estado_final === 'Pendiente').length,
  };

  const doc = pdf.crearDocumento(res, `trazabilidad-${ref}.pdf`);
  const subtitulo = `Trazabilidad · ${ref}`;
  pdf.dibujarPie(doc);
  doc.on('pageAdded', () => pdf.dibujarPie(doc));

  let y = pdf.dibujarEncabezado(doc, subtitulo);

  y = pdf.dibujarTarjetasResumen(doc, y, [
    { etiqueta: 'TOTALES', valor: totales.total, color: pdf.COLORES.azul },
    { etiqueta: 'ACEPTADOS', valor: totales.aceptados, color: pdf.COLORES.verde },
    { etiqueta: 'RECHAZADOS', valor: totales.rechazados, color: pdf.COLORES.rojo },
    { etiqueta: 'PENDIENTES', valor: totales.pendientes, color: pdf.COLORES.azulOscuro },
    { etiqueta: 'CERRADOS', valor: totales.cerrados, color: pdf.COLORES.grisEstado },
  ]);

  y = pdf.dibujarTituloSeccion(doc, y, 'Historial de Lotes');
  const columnas = [
    { label: 'LOTE', ancho: 135 },
    { label: 'FECHA', ancho: 110 },
    { label: 'CANTIDAD', ancho: 80, align: 'right' },
    { label: 'PLAN', ancho: 75 },
    { label: 'ESTADO', ancho: 75, badge: true },
  ];
  y = pdf.dibujarTablaEncabezado(doc, y, columnas);
  lotes.forEach((l, i) => {
    y = pdf.saltoPaginaSiNecesario(doc, y, 20, (doc2) => {
      const yy = pdf.dibujarEncabezado(doc2, `${subtitulo} (continuación)`);
      return pdf.dibujarTablaEncabezado(doc2, yy, columnas);
    });
    y = pdf.dibujarTablaFila(doc, y, columnas, [
      l.id_lote, l.fecha_creacion, l.cantidad_total, l.plan_actual || 'Normal', l.estado_final || 'Pendiente',
    ], i);
  });

  doc.end();
}));

router.get('/iso2859/reportes/preview/:id', validarToken, puedeVerReportes, asyncHandler(async (req, res) => {
  const id = req.params.id;
  const muestreo = await iso.obtenerMuestreoConLote(id);
  if (!muestreo) return res.status(404).json({ error: 'Muestreo no encontrado' });
  const defectos = await iso.obtenerDefectosDeMuestreo(id);
  const { criticidad, totalDefectos } = calcularCriticidad(muestreo, defectos);
  const porcentaje = muestreo.cantidad_muestreada > 0
    ? ((totalDefectos / muestreo.cantidad_muestreada) * 100).toFixed(2) + '%'
    : '0%';
  res.json({ muestreo, defectos, criticidad, totalDefectos, porcentaje });
}));

module.exports = router;
