const express = require('express');
const { validarToken, requerirPermiso, requerirPermisoAlternativo, tienePermiso } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const { registrarCambio } = require('../data/auditoria');
const cajaRoja = require('../data/cajaRoja');

const router = express.Router();

// ======================== CAJA ROJA (MIGRACIÓN #53) ========================
// Permisos:
//   caja_roja.registrar -> cargar registros y ver los propios
//   caja_roja.ver       -> ver/exportar los registros de todos
//   caja_roja.gestion   -> eliminar registros y reemplazar el maestro
const PERMISOS_MODULO = ['caja_roja.registrar', 'caja_roja.ver', 'caja_roja.gestion'];
const puedeEntrar = requerirPermisoAlternativo(PERMISOS_MODULO);

const MAX_REGISTROS_POR_ENVIO = 100;

// Maestro de referencias. La tablet manda la versión que ya tiene guardada;
// si coincide, no se vuelve a descargar todo (son ~10.000 referencias).
router.get('/caja-roja/maestro', validarToken, puedeEntrar, asyncHandler(async (req, res) => {
  const maestro = cajaRoja.leerMaestro();
  if (req.query.version && maestro.actualizado && req.query.version === maestro.actualizado) {
    return res.json({ sinCambios: true, actualizado: maestro.actualizado, total: maestro.total });
  }
  res.json(maestro);
}));

// Reemplaza el maestro con el CSV del ERP. Se recibe como texto plano (no
// JSON) porque el archivo pesa más que el límite de express.json() (100 kb)
// que usa toda la app, y así no hay que subir ese límite para todas las rutas.
router.post('/caja-roja/maestro', validarToken, requerirPermiso('caja_roja.gestion'),
  express.text({ type: ['text/*', 'application/octet-stream'], limit: '20mb' }),
  asyncHandler(async (req, res) => {
    const { items, error } = cajaRoja.interpretarCsvMaestro(typeof req.body === 'string' ? req.body : '');
    if (error) return res.status(400).json({ error });
    const anterior = cajaRoja.leerMaestro().total;
    const datos = cajaRoja.guardarMaestro(items, req.usuario.nombre);
    await registrarCambio({
      modulo: 'Caja roja', entidad: 'caja_roja_maestro', entidadId: null, accion: 'Edición',
      detalle: `Maestro de referencias actualizado: ${anterior} → ${datos.total} referencias (${cajaRoja.PREFIJOS_MAESTRO.join(', ')})`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
    });
    res.json({ success: true, total: datos.total, actualizado: datos.actualizado });
  })
);

// Valida y normaliza un registro que manda la tablet. Devuelve el registro
// listo para guardar o { error }.
function prepararRegistro(r, usuario, mapaMaestro) {
  if (!r || typeof r !== 'object') return { error: 'Registro vacío' };
  const uid = String(r.uid || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(uid)) return { error: 'Identificador inválido' };
  const fecha = String(r.fecha || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: 'Fecha inválida' };
  const hora = String(r.hora_registro || '');
  if (hora && !/^\d{2}:\d{2}(:\d{2})?$/.test(hora)) return { error: 'Hora inválida' };
  const area = String(r.area || '');
  if (!cajaRoja.AREAS_CAJA_ROJA.includes(area)) return { error: 'Área inválida' };
  const referencia = String(r.referencia || '').trim().toUpperCase();
  if (!referencia || referencia.length > 100) return { error: 'Referencia inválida' };
  const lote = String(r.lote || '').trim().toUpperCase();
  if (!lote) return { error: 'El lote es obligatorio' };
  if (lote.length > 100) return { error: 'Lote demasiado largo' };
  const cantidad = Number(r.cantidad);
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 1000000) return { error: 'Cantidad inválida' };

  // El código del ERP y la descripción se toman del maestro del servidor
  // cuando la referencia existe ahí (no de lo que mande la tablet).
  const delMaestro = mapaMaestro.get(referencia);
  return {
    registro: {
      uid, fecha, hora_registro: hora || null, area,
      // Quien registra es siempre el usuario de la sesión, no un nombre
      // que venga escrito desde la tablet.
      usuario_id: usuario.id, usuario_nombre: usuario.nombre,
      f120_id: delMaestro ? delMaestro[0] : (String(r.f120_id || '').slice(0, 30) || null),
      referencia,
      descripcion: delMaestro ? delMaestro[2] : (String(r.descripcion || '').slice(0, 300) || null),
      lote, cantidad,
      sin_conexion: !!r.sin_conexion,
    },
  };
}

// Recibe uno o varios registros (la tablet envía de a lotes lo que tenga
// pendiente). Cada uno responde por separado: guardado, duplicado (ya había
// llegado antes, no se repite) o rechazado (con el motivo).
router.post('/caja-roja/registros', validarToken, requerirPermiso('caja_roja.registrar'), asyncHandler(async (req, res) => {
  const lista = Array.isArray(req.body && req.body.registros) ? req.body.registros : [];
  if (!lista.length) return res.status(400).json({ error: 'No se recibieron registros' });
  if (lista.length > MAX_REGISTROS_POR_ENVIO) {
    return res.status(400).json({ error: `Máximo ${MAX_REGISTROS_POR_ENVIO} registros por envío` });
  }
  const mapaMaestro = new Map(cajaRoja.leerMaestro().items.map(it => [it[1], it]));
  const resultados = [];
  for (const r of lista) {
    const { registro, error } = prepararRegistro(r, req.usuario, mapaMaestro);
    if (error) { resultados.push({ uid: r && r.uid, estado: 'rechazado', error }); continue; }
    const nuevo = await cajaRoja.insertarRegistro(registro);
    resultados.push({ uid: registro.uid, estado: nuevo ? 'guardado' : 'duplicado' });
  }
  res.json({ resultados });
}));

// Consulta. Quien solo tiene 'caja_roja.registrar' ve únicamente lo que
// registró él mismo; con 'caja_roja.ver' o 'caja_roja.gestion' ve todo.
router.get('/caja-roja/registros', validarToken, puedeEntrar, asyncHandler(async (req, res) => {
  const fechaValida = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
  const veTodo = tienePermiso(req.usuario.rol_id, 'caja_roja.ver') || tienePermiso(req.usuario.rol_id, 'caja_roja.gestion');
  const registros = await cajaRoja.listarRegistros({
    desde: fechaValida(req.query.desde),
    hasta: fechaValida(req.query.hasta),
    area: cajaRoja.AREAS_CAJA_ROJA.includes(req.query.area) ? req.query.area : null,
    usuarioId: veTodo ? null : req.usuario.id,
  });
  res.json({ registros, soloPropios: !veTodo });
}));

// Reporte semanal (o de cualquier rango hasta 92 días): totales, piezas por
// referencia, por fábrica y por día, más los totales del período anterior
// del mismo largo (la semana anterior, si se pide una semana) para comparar.
// Solo para quien ve los registros de todos.
const DIA_MS = 24 * 60 * 60 * 1000;
const fechaUTC = (txt) => new Date(txt + 'T00:00:00Z');
const textoFecha = (d) => d.toISOString().slice(0, 10);

router.get('/caja-roja/resumen', validarToken, requerirPermisoAlternativo(['caja_roja.ver', 'caja_roja.gestion']), asyncHandler(async (req, res) => {
  const { desde, hasta } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(desde || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(hasta || ''))) {
    return res.status(400).json({ error: 'Indica las fechas desde y hasta' });
  }
  const dias = Math.round((fechaUTC(hasta) - fechaUTC(desde)) / DIA_MS) + 1;
  if (!(dias >= 1 && dias <= 92)) return res.status(400).json({ error: 'El rango debe ser de 1 a 92 días' });
  const area = cajaRoja.AREAS_CAJA_ROJA.includes(req.query.area) ? req.query.area : null;

  const actual = await cajaRoja.resumenRegistros({ desde, hasta, area });
  const antDesde = textoFecha(new Date(fechaUTC(desde).getTime() - dias * DIA_MS));
  const antHasta = textoFecha(new Date(fechaUTC(desde).getTime() - DIA_MS));
  const anterior = await cajaRoja.resumenRegistros({ desde: antDesde, hasta: antHasta, area });

  res.json({
    desde, hasta, area,
    ...actual,
    anterior: { desde: antDesde, hasta: antHasta, ...anterior.totales },
  });
}));

router.delete('/caja-roja/registros/:id', validarToken, requerirPermiso('caja_roja.gestion'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido' });
  const registro = await cajaRoja.buscarRegistro(id);
  if (!registro) return res.status(404).json({ error: 'Registro no encontrado' });
  await cajaRoja.eliminarRegistro(id, req.usuario.id, req.usuario.nombre);
  await registrarCambio({
    modulo: 'Caja roja', entidad: 'caja_roja_registros', entidadId: id, accion: 'Eliminación',
    detalle: `${registro.fecha} · ${registro.area} · ${registro.referencia} · Lote ${registro.lote} · Cant. ${registro.cantidad} (registrado por ${registro.usuario_nombre || '—'})`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json({ success: true });
}));

module.exports = router;
