const express = require('express');
const { validarToken, requerirPermiso, requerirPermisoAlternativo } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const { enTransaccion } = require('../db/connection');
const garData = require('../data/garantias');
const { registrarCambio } = require('../data/auditoria');

const router = express.Router();

// ======================== MÓDULO DE GARANTÍAS ========================
router.get('/clientes/buscar', validarToken, requerirPermisoAlternativo(['garantias.ver', 'garantias.crear', 'garantias.editar']), asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const clientes = await garData.buscarClientes(q);
  res.json(clientes);
}));

router.get('/referencias-pt/buscar', validarToken, requerirPermisoAlternativo(['garantias.ver', 'garantias.crear', 'garantias.editar']), asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const refs = await garData.buscarReferenciasPt(q);
  res.json(refs);
}));

router.get('/siguiente-garantia', validarToken, requerirPermisoAlternativo(['garantias.ver', 'garantias.crear']), asyncHandler(async (req, res) => {
  const siguiente = await garData.obtenerSiguienteNumeroGarantia();
  res.json({ siguiente });
}));

// ======================== CATÁLOGO DE CAUSALES (TIPIFICACIÓN) ========================
router.get('/garantias/problemas/buscar', validarToken, requerirPermisoAlternativo(['garantias.ver', 'garantias.crear', 'garantias.editar']), asyncHandler(async (req, res) => {
  const q = (req.query.q || '').trim();
  res.json(await garData.buscarProblemasCatalogo(q));
}));

// Listado completo (incluye inactivos) y edición: para la pestaña de
// administración de catálogos, no para el autocompletar al registrar una
// garantía (ese usa /garantias/problemas/buscar, que solo trae 'Activo').
router.get('/garantias/problemas', validarToken, requerirPermiso('catalogos.gestionar'), asyncHandler(async (req, res) => {
  res.json(await garData.listarProblemasCatalogo());
}));

router.post('/garantias/problemas', validarToken, requerirPermiso('catalogos.gestionar'), asyncHandler(async (req, res) => {
  const codigo = (req.body.codigo || '').trim();
  const descripcion = (req.body.descripcion || '').trim();
  if (!codigo || !descripcion) return res.status(400).json({ error: 'Código y descripción son obligatorios' });
  try {
    const result = await garData.crearProblemaCatalogo(codigo, descripcion);
    await registrarCambio({
      modulo: 'Catálogos', entidad: 'causales_garantias', entidadId: result.lastID, accion: 'Creación',
      detalle: `Causal "${codigo}" (${descripcion}) creada.`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
    });
    res.json({ success: true, id: result.lastID });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: `El código "${codigo}" ya existe en el catálogo` });
    throw e;
  }
}));

router.put('/garantias/problemas/:id', validarToken, requerirPermiso('catalogos.gestionar'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const codigo = (req.body.codigo || '').trim();
  const descripcion = (req.body.descripcion || '').trim();
  const estado = req.body.estado === 'Inactivo' ? 'Inactivo' : 'Activo';
  if (!codigo || !descripcion) return res.status(400).json({ error: 'Código y descripción son obligatorios' });
  try {
    await garData.actualizarProblemaCatalogo(id, codigo, descripcion, estado);
    await registrarCambio({
      modulo: 'Catálogos', entidad: 'causales_garantias', entidadId: id, accion: 'Edición',
      detalle: `Causal "${codigo}" (${descripcion}) editada. Estado: ${estado}.`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
    });
    res.json({ success: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(400).json({ error: `El código "${codigo}" ya existe en el catálogo` });
    throw e;
  }
}));

router.delete('/garantias/problemas/:id', validarToken, requerirPermiso('catalogos.gestionar'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const problema = await garData.listarProblemasCatalogo().then(lista => lista.find(p => p.id === id));
  await garData.eliminarProblemaCatalogo(id);
  await registrarCambio({
    modulo: 'Catálogos', entidad: 'causales_garantias', entidadId: id, accion: 'Eliminación',
    detalle: `Causal "${problema ? problema.codigo : id}" eliminada.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ success: true });
}));

// 'garantias.dashboard' también da acceso a esta lista: sin esto, alguien
// con permiso solo para ver el tablero analítico (sin 'garantias.ver')
// vería la pantalla del dashboard pero la carga de datos le fallaría con
// "sin permiso", porque es este mismo endpoint el que la alimenta.
router.get('/garantias', validarToken, requerirPermisoAlternativo(['garantias.ver', 'garantias.dashboard']), asyncHandler(async (req, res) => {
  const garantias = await garData.listarGarantias();
  res.json(garantias);
}));

router.post('/garantias', validarToken, requerirPermiso('garantias.crear'), asyncHandler(async (req, res) => {
  const {
    fecha_reporte, nit_cliente, cliente, ciudad,
    responsable, vendedor_distribuidor, remision,
    tipo_solicitud, estado, fecha_revision,
    quien_aprobo_rechazo, observaciones_general, items,
    referencia, cantidad, lote_fecha, problema, observaciones
  } = req.body;

  if (!nit_cliente) {
    return res.status(400).json({ error: 'NIT del cliente es obligatorio' });
  }

  const listaItems = items && Array.isArray(items) && items.length > 0
    ? items
    : [{ referencia, cantidad, lote_fecha, problema, observaciones }];

  if (listaItems.length === 0 || !listaItems[0].referencia) {
    return res.status(400).json({ error: 'Debe agregar al menos una referencia de producto' });
  }

  const usuarioLogeado = req.usuario.nombre || req.usuario.usuario || 'Sistema';
  const fechaRep = fecha_reporte || new Date().toISOString().split('T')[0];
  const fechaRev = fecha_revision || new Date().toISOString().split('T')[0];

  // Todo en una sola transacción: si al crear el registro 3 de 5 algo
  // falla, se deshacen también los 2 que ya se habían guardado, en vez de
  // dejar la remisión a medias con un número de garantía incompleto. Además,
  // al calcular "el siguiente número" dentro de la misma transacción, dos
  // personas guardando garantías al mismo tiempo ya no pueden terminar con
  // el mismo número.
  const { numGarantia, insertedIds } = await enTransaccion(async () => {
    const numGarantia = await garData.obtenerSiguienteNumeroGarantia();
    const insertedIds = [];

    for (const item of listaItems) {
      if (!item.referencia) continue;

      const result = await garData.crearGarantia(
        numGarantia, fechaRep, responsable, vendedor_distribuidor, cliente, nit_cliente,
        ciudad, remision, item, tipo_solicitud, observaciones_general, fechaRev, estado,
        quien_aprobo_rechazo || usuarioLogeado
      );
      insertedIds.push({ id: result.lastID, no_garantia: numGarantia });
    }
    return { numGarantia, insertedIds };
  });

  await registrarCambio({
    modulo: 'Garantías', entidad: 'garantias', entidadId: numGarantia, accion: 'Creación',
    detalle: `Garantía ${numGarantia} creada para "${cliente || nit_cliente}" (${insertedIds.length} ítem(s)).`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ success: true, count: insertedIds.length, registros: insertedIds });
}));

router.put('/garantias/:id', validarToken, requerirPermiso('garantias.editar'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const {
    estado, tipo_solicitud, cantidad, referencia, lote_fecha,
    problema, observaciones, remision, quien_aprobo_rechazo
  } = req.body;
  await garData.actualizarGarantia(id, estado, tipo_solicitud, cantidad, referencia, lote_fecha, problema, observaciones, remision, quien_aprobo_rechazo);
  const garantia = await garData.buscarGarantiaPorId(id);
  await registrarCambio({
    modulo: 'Garantías', entidad: 'garantias', entidadId: id, accion: 'Edición',
    detalle: `Garantía ${garantia ? garantia.no_garantia : id} editada. Estado: ${estado || 'sin cambio'}.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ success: true });
}));

router.delete('/garantias/:id', validarToken, requerirPermiso('garantias.eliminar'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const garantia = await garData.buscarGarantiaPorId(id);
  await garData.eliminarGarantia(id);
  await registrarCambio({
    modulo: 'Garantías', entidad: 'garantias', entidadId: id, accion: 'Eliminación',
    detalle: `Garantía ${garantia ? garantia.no_garantia : id} (${garantia ? garantia.cliente : ''}) eliminada.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ success: true });
}));

module.exports = router;
