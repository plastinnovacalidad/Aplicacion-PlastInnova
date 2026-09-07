const express = require('express');
const { validarToken, requerirPermiso, requerirPermisoAlternativo } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const produccionData = require('../data/produccion');
const trazabilidadData = require('../data/trazabilidadProduccion');
const catalogoData = require('../data/trazabilidadCatalogo');
const causasRaizData = require('../data/causasRaiz');
// Reusa listarDefectosActivos() de Reportes por Áreas -- pedido por Julio
// (07/09, tercera vuelta): Producción por Fábrica también necesita poder
// elegir "el problema" (Defecto) al registrar una causa, para que quede en
// la misma tabla Defecto -> Causa -> Medida y se pueda filtrar/reusar desde
// los dos lados. No se duplica el catálogo -- sigue siendo el mismo
// iso_tipificacion_defectos de Muestreos ISO 2859.
const reportesData = require('../data/reportes');
const { registrarCambio } = require('../data/auditoria');
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
// pasar a trabajar la causa raíz del motivo elegido.
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

// ======================== TRAZABILIDAD DE SOLUCIONES ========================
// Consultar un caso puntual (activo/último, para el flujo dentro del propio
// tablero de Producción) usa el mismo permiso de siempre del módulo
// ('calidad.ver'). Ver la bitácora completa y un caso por id -- que ahora
// respaldan al módulo aparte "Seguimiento de Producción" -- aceptan además
// el permiso propio y más restringido de ese módulo (o el de gestión, que
// implica poder ver). Crear/editar sigue pidiendo el permiso de gestión --
// ver settings/permisos.js.
//
// Rediseño 03/09: la causa raíz y la solución dejaron de ser un campo único
// -- ahora son listas (varias causas raíz, varias medidas con su propio
// estado). El estado GENERAL del caso ya no llega en el body: se recalcula
// solo en el backend según las medidas (ver recalcularEstadoProblema en
// data/trazabilidadProduccion.js).
//
// Tercer ajuste, mismo día: si el problema reaparece y el último caso para
// ese contexto ya está Implementado, el frontend pregunta primero si esa
// solución falló (GET .../ultimo le da con qué mostrar la pregunta) -- si
// el usuario confirma que falló, POST .../marcar-fallo reabre ese mismo
// caso en vez de crear uno nuevo.
//
// Cuarto ajuste, mismo día: el responsable de una causa/medida ya no se
// elige de una lista de usuarios -- siempre es quien esté conectado al
// agregarla (ver data/trazabilidadProduccion.js), así que este archivo ya
// no valida ni recibe ningún `responsable_id`. En su lugar, cada medida
// ahora debe decir a cuál causa raíz de este mismo caso pertenece
// (`causa_id`), validado aquí antes de guardarla.
//
// Quinto ajuste, mismo día: catálogo de causas raíz y medidas posibles (ver
// data/trazabilidadCatalogo.js y la sección "CATÁLOGO" más abajo). Al crear
// una causa (nueva o dentro de un caso ya existente) se manda
// `causa_catalogo_id` si se eligió de la lista, o `causa_raiz`/`texto` si
// se escribió "Otra" -- en ese caso se agrega sola al catálogo
// (resolverCausaConCatalogo). Igual para medidas con `medida_catalogo_id`
// (resolverMedidaConCatalogo), validando además que la medida del catálogo
// elegida corresponda a la causa raíz del caso a la que se está agregando.
// Sexto ajuste, mismo día: borrar una causa raíz o una medida ya
// registrada pide su propio permiso, 'produccion.trazabilidad.eliminar' --
// separado del de agregar. Alguien puede tener permiso para agregar pero no
// para borrar, o al revés.
const puedeGestionarTrazabilidad = requerirPermiso('produccion.trazabilidad.gestionar');
const puedeEliminarTrazabilidad = requerirPermiso('produccion.trazabilidad.eliminar');
const puedeVerBitacora = requerirPermisoAlternativo(['calidad.ver', 'produccion.trazabilidad.ver', 'produccion.trazabilidad.gestionar']);
const puedeGestionarCatalogos = requerirPermiso('catalogos.gestionar');
// Ampliado (04/09, ver mudanza del catálogo de Gestión a Seguimiento de
// Producción): también puede LEER el catálogo alguien con SOLO
// produccion.trazabilidad.ver (sin gestionar ni catalogos.gestionar) -- ya
// que ahora este catálogo se ve también dentro de Seguimiento de
// Producción, que es justamente el módulo pensado para ese permiso.
// Agregar/editar/eliminar sigue pidiendo 'catalogos.gestionar' (ver más
// abajo, puedeGestionarCatalogos) sin importar desde qué módulo se use.
const puedeVerCatalogoTrazabilidad = requerirPermisoAlternativo(['produccion.trazabilidad.ver', 'produccion.trazabilidad.gestionar', 'catalogos.gestionar']);

const TIPOS_CONTEXTO_VALIDOS = ['referencia', 'motivo'];
const ESTADOS_MEDIDA_VALIDOS = trazabilidadData.ESTADOS_MEDIDA;

function validarContexto(req, res) {
  const { fabrica, tipo_contexto, valor_contexto } = req.body;
  if (!fabrica || !tipo_contexto || !valor_contexto) {
    res.status(400).json({ error: 'Faltan datos: fabrica, tipo_contexto y valor_contexto son obligatorios.' });
    return null;
  }
  if (!TIPOS_CONTEXTO_VALIDOS.includes(tipo_contexto)) {
    res.status(400).json({ error: `tipo_contexto inválido. Debe ser: ${TIPOS_CONTEXTO_VALIDOS.join(' o ')}.` });
    return null;
  }
  return { fabrica, tipo_contexto, valor_contexto };
}

// Resuelve la causa raíz de un caso real contra el catálogo: si viene
// `causa_catalogo_id`, usa el texto tal como está guardado en el catálogo
// (no se confía en lo que mande el frontend); si no, `texto` es una causa
// "Otra" -- se agrega sola al catálogo (o se reusa si ya existía con otras
// mayúsculas/espacios) para que la próxima vez ya aparezca en la lista.
// `defectoId` (pedido por Julio, 07/09, tercera vuelta): igual criterio que
// ya usa routes/reportes.js -- si se pasa "el problema" elegido, se valida
// que una causa del catálogo reusada de verdad pertenezca a ese defecto (si
// ambos lo tienen definido), y una causa nueva ("Otra") se agrega al
// catálogo ya ligada a él, para que de ahí en adelante aparezca al filtrar
// por ese mismo defecto -- sin importar si se busca desde Producción o
// desde Reportes por Áreas (mismo catálogo compartido). Sigue siendo
// opcional: si no se elige defecto, se comporta exactamente igual que
// siempre (sin filtrar).
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

// Mismo criterio para la medida, pero además valida que la medida elegida
// del catálogo pertenezca a la MISMA causa del catálogo que la causa del
// caso a la que se está agregando (causaCatalogoIdDelCaso) -- si la causa
// del caso no tiene causa_catalogo_id (dato de antes de esta migración), no
// hay a qué catálogo ligar la medida "Otra", así que se guarda como texto
// suelto, sin agregarse al catálogo.
async function resolverMedidaConCatalogo({ medida_catalogo_id, texto }, causaCatalogoIdDelCaso) {
  if (medida_catalogo_id) {
    const cat = await catalogoData.obtenerMedidaCatalogoPorId(medida_catalogo_id);
    if (!cat) return { error: 'La medida del catálogo elegida no existe.' };
    if (causaCatalogoIdDelCaso && String(cat.causa_catalogo_id) !== String(causaCatalogoIdDelCaso)) {
      return { error: 'Esa medida del catálogo no corresponde a la causa raíz elegida.' };
    }
    return { texto: cat.texto };
  }
  if (!texto || !texto.trim()) return { error: 'Escribe la medida o elige una del catálogo.' };
  if (!causaCatalogoIdDelCaso) return { texto: texto.trim() };
  const cat = await catalogoData.obtenerOCrearMedidaCatalogo(causaCatalogoIdDelCaso, texto);
  return { texto: cat.texto };
}

// Bitácora completa (módulo "Seguimiento de Producción") -- filtrable por
// fábrica y/o estado.
router.get('/produccion/trazabilidad/problemas', validarToken, puedeVerBitacora, asyncHandler(async (req, res) => {
  const problemas = await trazabilidadData.listarProblemas({ fabrica: req.query.fabrica, estado: req.query.estado, limit: req.query.limite });
  res.json(problemas);
}));

// Antes de abrir el modal de una fila del ranking/motivos: ¿ya hay un caso
// abierto (Pendiente/En_Proceso) para esta fábrica+referencia/motivo? Si lo
// hay, el frontend lo reabre en vez de mostrar el formulario de "caso nuevo".
router.get('/produccion/trazabilidad/problemas/activo', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const { fabrica, tipo_contexto, valor_contexto } = req.query;
  if (!fabrica || !tipo_contexto || !valor_contexto) {
    return res.status(400).json({ error: 'Faltan datos: fabrica, tipo_contexto y valor_contexto son obligatorios.' });
  }
  const activo = await trazabilidadData.buscarProblemaActivo({ fabrica, tipo_contexto, valor_contexto });
  if (!activo) return res.json(null);
  const completo = await trazabilidadData.obtenerProblemaCompleto(activo.id);
  res.json(completo);
}));

// El último caso para este contexto sin importar su estado -- el frontend lo
// usa solo cuando /activo ya dio null, para saber si el último quedó
// Implementado y así preguntar si esa solución falló antes de crear uno nuevo.
router.get('/produccion/trazabilidad/problemas/ultimo', validarToken, puedeVerProduccion, asyncHandler(async (req, res) => {
  const { fabrica, tipo_contexto, valor_contexto } = req.query;
  if (!fabrica || !tipo_contexto || !valor_contexto) {
    return res.status(400).json({ error: 'Faltan datos: fabrica, tipo_contexto y valor_contexto son obligatorios.' });
  }
  const ultimo = await trazabilidadData.buscarUltimoProblema({ fabrica, tipo_contexto, valor_contexto });
  if (!ultimo) return res.json(null);
  const completo = await trazabilidadData.obtenerProblemaCompleto(ultimo.id);
  res.json(completo);
}));

router.get('/produccion/trazabilidad/problemas/:id', validarToken, puedeVerBitacora, asyncHandler(async (req, res) => {
  const problema = await trazabilidadData.obtenerProblemaCompleto(req.params.id);
  if (!problema) return res.status(404).json({ error: 'Caso no encontrado' });
  res.json(problema);
}));

// Crea el caso junto con su primera causa raíz -- no tiene sentido abrir un
// caso sin decir al menos qué se cree que lo originó. El responsable de esa
// causa es automáticamente quien la está registrando (req.usuario). La
// causa raíz se resuelve contra el catálogo (elegida o "Otra", ver
// resolverCausaConCatalogo más arriba).
router.post('/produccion/trazabilidad/problemas', validarToken, puedeGestionarTrazabilidad, asyncHandler(async (req, res) => {
  const contexto = validarContexto(req, res);
  if (!contexto) return;
  const { causa_raiz, causa_catalogo_id, pct_desperdicio_inicial, defecto_id } = req.body;
  const resCausa = await resolverCausaConCatalogo(
    { causa_catalogo_id, texto: causa_raiz, defectoId: defecto_id || null },
    'Escribe al menos una causa raíz para poder crear el caso, o elige una del catálogo.'
  );
  if (resCausa.error) return res.status(400).json({ error: resCausa.error });
  const problema = await trazabilidadData.crearProblema({
    ...contexto,
    pct_desperdicio_inicial: pct_desperdicio_inicial != null ? parseFloat(pct_desperdicio_inicial) : null,
    causaInicial: resCausa.texto,
    causaCatalogoId: resCausa.causaCatalogoId,
    autorId: req.usuario.id, autorNombre: req.usuario.nombre,
  });
  await registrarCambio({
    modulo: 'Producción', entidad: 'trazabilidad_problemas', entidadId: problema.id,
    accion: 'Creación',
    detalle: `Nuevo caso (${contexto.tipo_contexto}: ${contexto.valor_contexto}, ${contexto.fabrica}). Causa raíz: ${resCausa.texto} — registrado por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.status(201).json(problema);
}));

router.post('/produccion/trazabilidad/problemas/:id/causas', validarToken, puedeGestionarTrazabilidad, asyncHandler(async (req, res) => {
  const { texto, causa_catalogo_id, defecto_id } = req.body;
  const resCausa = await resolverCausaConCatalogo(
    { causa_catalogo_id, texto, defectoId: defecto_id || null },
    'La causa raíz no puede estar vacía -- escríbela o elige una del catálogo.'
  );
  if (resCausa.error) return res.status(400).json({ error: resCausa.error });
  const problema = await trazabilidadData.agregarCausa({
    problema_id: req.params.id, texto: resCausa.texto, causa_catalogo_id: resCausa.causaCatalogoId,
    autor_id: req.usuario.id, autor_nombre: req.usuario.nombre,
  });
  if (!problema) return res.status(404).json({ error: 'Caso no encontrado' });
  await registrarCambio({
    modulo: 'Producción', entidad: 'trazabilidad_problemas', entidadId: problema.id,
    accion: 'Edición',
    detalle: `Causa raíz agregada (${problema.tipo_contexto}: ${problema.valor_contexto}, ${problema.fabrica}): ${resCausa.texto} — registrada por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(problema);
}));

// Cada medida debe decir a cuál causa raíz de este mismo caso pertenece
// (causa_id) -- se valida que exista y sea de este caso antes de guardarla,
// para que el frontend pueda mostrar "para esta causa raíz, estas son las
// medidas" sin relaciones inventadas. La medida en sí se resuelve contra el
// catálogo de ESA causa (elegida o "Otra", ver resolverMedidaConCatalogo).
router.post('/produccion/trazabilidad/problemas/:id/medidas', validarToken, puedeGestionarTrazabilidad, asyncHandler(async (req, res) => {
  const { texto, estado, causa_id, medida_catalogo_id } = req.body;
  if (estado && !ESTADOS_MEDIDA_VALIDOS.includes(estado)) {
    return res.status(400).json({ error: `Estado de medida inválido. Debe ser: ${ESTADOS_MEDIDA_VALIDOS.join(', ')}.` });
  }
  if (!causa_id) {
    return res.status(400).json({ error: 'Elige a qué causa raíz corresponde esta medida.' });
  }
  const problemaActual = await trazabilidadData.obtenerProblemaCompleto(req.params.id);
  if (!problemaActual) return res.status(404).json({ error: 'Caso no encontrado' });
  const causaDelCaso = (problemaActual.causas || []).find((c) => String(c.id) === String(causa_id));
  if (!causaDelCaso) {
    return res.status(400).json({ error: 'Esa causa raíz no existe o no pertenece a este caso.' });
  }
  const resMedida = await resolverMedidaConCatalogo({ medida_catalogo_id, texto }, causaDelCaso.causa_catalogo_id);
  if (resMedida.error) return res.status(400).json({ error: resMedida.error });
  const problema = await trazabilidadData.agregarMedida({
    problema_id: req.params.id, texto: resMedida.texto, estado, causa_id,
    autor_id: req.usuario.id, autor_nombre: req.usuario.nombre,
  });
  await registrarCambio({
    modulo: 'Producción', entidad: 'trazabilidad_problemas', entidadId: problema.id,
    accion: 'Edición',
    detalle: `Medida agregada (${problema.tipo_contexto}: ${problema.valor_contexto}, ${problema.fabrica}): ${resMedida.texto} — registrada por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(problema);
}));

// AJUSTE 03/09: el usuario confirmó que la solución del caso anterior (que
// ya estaba Implementado) no funcionó -- se corrige esa medida a "No
// funcionó" y el caso se reabre solo (mismo id, mismo historial).
router.post('/produccion/trazabilidad/problemas/:id/marcar-fallo', validarToken, puedeGestionarTrazabilidad, asyncHandler(async (req, res) => {
  const problema = await trazabilidadData.marcarSolucionAnteriorComoFallida(req.params.id);
  if (!problema) return res.status(404).json({ error: 'Caso no encontrado' });
  await registrarCambio({
    modulo: 'Producción', entidad: 'trazabilidad_problemas', entidadId: problema.id,
    accion: 'Edición',
    detalle: `Se marcó que la solución anterior no funcionó -- caso reabierto (${problema.tipo_contexto}: ${problema.valor_contexto}, ${problema.fabrica})`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(problema);
}));

router.put('/produccion/trazabilidad/problemas/:id/medidas/:medidaId', validarToken, puedeGestionarTrazabilidad, asyncHandler(async (req, res) => {
  const { estado } = req.body;
  if (!estado || !ESTADOS_MEDIDA_VALIDOS.includes(estado)) {
    return res.status(400).json({ error: `Estado de medida inválido. Debe ser: ${ESTADOS_MEDIDA_VALIDOS.join(', ')}.` });
  }
  const problema = await trazabilidadData.actualizarEstadoMedida(req.params.id, req.params.medidaId, estado);
  if (!problema) return res.status(404).json({ error: 'Medida no encontrada' });
  await registrarCambio({
    modulo: 'Producción', entidad: 'trazabilidad_problemas', entidadId: problema.id,
    accion: 'Edición',
    detalle: `Medida #${req.params.medidaId} cambió a estado ${estado} (${problema.tipo_contexto}: ${problema.valor_contexto}, ${problema.fabrica})`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(problema);
}));

// Pedido por Julio (04/09): poder borrar una causa raíz o una medida ya
// registrada -- pide su propio permiso ('produccion.trazabilidad.eliminar'),
// separado del de agregar. Borrar una causa raíz borra también sus medidas
// (ver eliminarCausa en data/trazabilidadProduccion.js); no se puede dejar
// un caso sin ninguna causa raíz, así que se rechaza borrar la última.
router.delete('/produccion/trazabilidad/problemas/:id/causas/:causaId', validarToken, puedeEliminarTrazabilidad, asyncHandler(async (req, res) => {
  const resultado = await trazabilidadData.eliminarCausa(req.params.id, req.params.causaId);
  if (resultado.error === 'no_encontrada') return res.status(404).json({ error: 'Causa no encontrada en este caso.' });
  if (resultado.error === 'ultima_causa') return res.status(400).json({ error: 'No se puede eliminar la única causa raíz de este caso. Agrega otra causa antes de eliminar esta, o elimina el caso completo desde la base de datos si ya no aplica.' });
  await registrarCambio({
    modulo: 'Producción', entidad: 'trazabilidad_causas', entidadId: req.params.causaId,
    accion: 'Eliminación',
    detalle: `Causa raíz "${resultado.causaEliminada.texto}" eliminada (${resultado.problema.tipo_contexto}: ${resultado.problema.valor_contexto}, ${resultado.problema.fabrica}) -- sus medidas también se eliminaron.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.problema);
}));

router.delete('/produccion/trazabilidad/problemas/:id/medidas/:medidaId', validarToken, puedeEliminarTrazabilidad, asyncHandler(async (req, res) => {
  const resultado = await trazabilidadData.eliminarMedida(req.params.id, req.params.medidaId);
  if (resultado.error === 'no_encontrada') return res.status(404).json({ error: 'Medida no encontrada en este caso.' });
  await registrarCambio({
    modulo: 'Producción', entidad: 'trazabilidad_medidas', entidadId: req.params.medidaId,
    accion: 'Eliminación',
    detalle: `Medida "${resultado.medidaEliminada.texto}" eliminada (${resultado.problema.tipo_contexto}: ${resultado.problema.valor_contexto}, ${resultado.problema.fabrica})`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.problema);
}));

// ======================== VINCULAR CAUSA DE OTRO CASO/MÓDULO ========================
// MIGRACIÓN #37 (07/09, pedido por Julio): cuando la misma causa real ya
// está registrada en otro caso (de Producción o de un Reporte por Áreas),
// en vez de escribirla de nuevo se busca y se vincula -- así comparten
// medidas y progreso desde los dos lados. Nunca automático: el mismo
// defecto puede tener causas distintas según la fábrica (ver comentario en
// data/causasRaiz.js), así que siempre es el analista quien decide y busca
// a propósito.
router.get('/produccion/trazabilidad/causas/buscar', validarToken, puedeGestionarTrazabilidad, asyncHandler(async (req, res) => {
  res.json(await causasRaizData.buscarCausasExistentes({ q: req.query.q, limit: req.query.limite }));
}));

router.post('/produccion/trazabilidad/problemas/:id/causas/vincular', validarToken, puedeGestionarTrazabilidad, asyncHandler(async (req, res) => {
  const { causa_id } = req.body;
  if (!causa_id) return res.status(400).json({ error: 'Elige la causa que quieres vincular.' });
  const resultado = await trazabilidadData.vincularCausa({
    problema_id: req.params.id, causa_id, usuario_id: req.usuario.id, usuario_nombre: req.usuario.nombre,
  });
  if (resultado.error === 'no_encontrado') return res.status(404).json({ error: 'Caso no encontrado' });
  if (resultado.error === 'causa_no_encontrada') return res.status(404).json({ error: 'La causa elegida no existe.' });
  if (resultado.error === 'ya_vinculada') return res.status(400).json({ error: 'Esa causa ya está vinculada a este caso.' });
  await registrarCambio({
    modulo: 'Producción', entidad: 'trazabilidad_problemas', entidadId: resultado.problema.id,
    accion: 'Edición',
    detalle: `Causa raíz existente vinculada a este caso (${resultado.problema.tipo_contexto}: ${resultado.problema.valor_contexto}, ${resultado.problema.fabrica}) — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.problema);
}));

// Pedido por Julio (04/09): al entrar a un caso de tipo Motivo (tanto desde
// Producción como desde Seguimiento de Producción), se ven dos gráficas de
// contexto -- cuánto salió ese motivo por mes, y en qué referencias se
// presenta más. Van con el mismo permiso de "poder ver este caso"
// (puedeVerBitacora), no con 'calidad.ver', porque alguien con SOLO
// produccion.trazabilidad.ver (sin calidad.ver, como en Seguimiento de
// Producción) también debe poder verlas -- son parte del caso, no del
// tablero general de Producción.
router.get('/produccion/trazabilidad/graficas/por-mes', validarToken, puedeVerBitacora, asyncHandler(async (req, res) => {
  const datos = await produccionData.obtenerRechazosPorMesFiltrado(req.query.fabrica, req.query.meses, undefined, undefined, req.query.motivo);
  res.json(datos);
}));

router.get('/produccion/trazabilidad/graficas/referencias-por-motivo', validarToken, puedeVerBitacora, asyncHandler(async (req, res) => {
  const datos = await produccionData.obtenerReferenciasPorMotivo(req.query.fabrica, req.query.meses, req.query.limite, undefined, undefined, req.query.motivo);
  res.json(datos);
}));

// ======================== CATÁLOGO DE CAUSAS RAÍZ Y MEDIDAS ========================
// Mudanza (04/09, pedido por Julio): la administración (crear/editar/
// eliminar) de este catálogo vivía en la pestaña "Catálogos" de Gestión --
// ahora vive en Seguimiento de Producción (pestaña "Catálogo"), para que
// todo lo de Trazabilidad quede junto en un solo módulo en vez de repartido
// entre Gestión (roles/usuarios) y Producción. El permiso para escribir
// sigue siendo 'catalogos.gestionar' (sin importar desde qué módulo se
// use). La lectura (GET) también la usa el propio formulario de
// trazabilidad para poblar sus selectores, así que además acepta el
// permiso de ver/gestionar trazabilidad (no tendría sentido poder registrar
// causas/medidas pero no poder leer de qué lista elegir). Ver
// data/trazabilidadCatalogo.js para el porqué de "desactivar en vez de
// eliminar" en causas ya usadas.
//
// En Gestión → Catálogos, en el lugar de esta administración, ahora solo
// queda una lista de solo lectura de los MOTIVOS de rechazo (ver
// /produccion/rechazos/motivos-catalogo más abajo) -- Julio pidió "en
// catálogos solo dejemos la lista de problemas".
router.get('/produccion/trazabilidad/catalogo', validarToken, puedeVerCatalogoTrazabilidad, asyncHandler(async (req, res) => {
  const catalogo = await catalogoData.listarCatalogoCompleto();
  res.json(catalogo);
}));

// "El problema" (catálogo de defectos de Muestreos ISO 2859) y las causas ya
// ligadas a uno en concreto -- pedido por Julio (07/09, tercera vuelta) para
// que, al registrar una causa en Producción por Fábrica, se pueda elegir el
// mismo Defecto que ya se usa en Reportes por Áreas y reusar sus causas.
// Mismo permiso que el resto del catálogo de trazabilidad (puedeVerCatalogoTrazabilidad)
// -- no el de Reportes, que un usuario de Producción podría no tener.
router.get('/produccion/trazabilidad/defectos', validarToken, puedeVerCatalogoTrazabilidad, asyncHandler(async (req, res) => {
  res.json(await reportesData.listarDefectosActivos());
}));
router.get('/produccion/trazabilidad/catalogo-causas', validarToken, puedeVerCatalogoTrazabilidad, asyncHandler(async (req, res) => {
  const defectoId = (req.query.defecto_id !== undefined && req.query.defecto_id !== '')
    ? parseInt(req.query.defecto_id, 10) : undefined;
  res.json(await catalogoData.listarCausasCatalogo({ soloActivas: true, defectoId }));
}));

// Lista de solo lectura de motivos de rechazo para Gestión → Catálogos (ver
// comentario arriba) -- mismo permiso que los demás catálogos de Gestión.
router.get('/produccion/rechazos/motivos-catalogo', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const motivos = await produccionData.obtenerMotivosCatalogo(req.query.fabrica);
  res.json(motivos);
}));

router.post('/produccion/trazabilidad/catalogo/causas', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Escribe el texto de la causa raíz.' });
  try {
    const causa = await catalogoData.crearCausaCatalogo(texto);
    await registrarCambio({
      modulo: 'Catálogos', entidad: 'trazabilidad_catalogo_causas', entidadId: causa.id, accion: 'Creación',
      detalle: `Causa raíz "${causa.texto}" agregada al catálogo de Producción.`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
    });
    res.status(201).json(causa);
  } catch (e) {
    if (e.esConflicto) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

router.put('/produccion/trazabilidad/catalogo/causas/:id', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const { texto, activo } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Escribe el texto de la causa raíz.' });
  const existente = await catalogoData.obtenerCausaCatalogoPorId(req.params.id);
  if (!existente) return res.status(404).json({ error: 'Causa no encontrada' });
  try {
    const causa = await catalogoData.actualizarCausaCatalogo(req.params.id, texto, activo);
    await registrarCambio({
      modulo: 'Catálogos', entidad: 'trazabilidad_catalogo_causas', entidadId: causa.id, accion: 'Edición',
      detalle: `Causa raíz editada: "${causa.texto}" (${causa.activo}).`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
    });
    res.json(causa);
  } catch (e) {
    if (e.esConflicto) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

router.delete('/produccion/trazabilidad/catalogo/causas/:id', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const causa = await catalogoData.obtenerCausaCatalogoPorId(req.params.id);
  if (!causa) return res.status(404).json({ error: 'Causa no encontrada' });
  try {
    await catalogoData.eliminarCausaCatalogo(req.params.id);
    await registrarCambio({
      modulo: 'Catálogos', entidad: 'trazabilidad_catalogo_causas', entidadId: causa.id, accion: 'Eliminación',
      detalle: `Causa raíz "${causa.texto}" eliminada del catálogo de Producción.`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
    });
    res.json({ success: true });
  } catch (e) {
    if (e.esConflicto) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

// Limpieza puntual pedida por Julio (07/09): borrar de una sola vez TODAS
// las causas del catálogo que quedaron sin "problema" (defecto) asignado --
// el backlog de antes de que Reportes por Áreas trajera ese concepto. A
// diferencia del DELETE de una causa puntual, esta SÍ borra aunque ya se
// hayan usado en casos reales (ver eliminarCausasSinDefecto en
// data/trazabilidadCatalogo.js para el porqué es seguro). Es una acción de
// una sola vez, no algo que deba repetirse: Producción sigue creando causas
// sin defecto todos los días como parte normal de su flujo.
router.delete('/produccion/trazabilidad/catalogo/causas-sin-defecto', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const resultado = await catalogoData.eliminarCausasSinDefecto();
  await registrarCambio({
    modulo: 'Catálogos', entidad: 'trazabilidad_catalogo_causas', entidadId: 0, accion: 'Eliminación',
    detalle: `Limpieza del catálogo: ${resultado.causasEliminadas} causa(s) sin problema asignado eliminada(s) (${resultado.medidasEliminadas} medida(s) propia(s), ${resultado.referenciasDesvinculadas} referencia(s) en casos reales desvinculada(s)) — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado);
}));

router.post('/produccion/trazabilidad/catalogo/causas/:id/medidas', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Escribe el texto de la medida.' });
  const causa = await catalogoData.obtenerCausaCatalogoPorId(req.params.id);
  if (!causa) return res.status(404).json({ error: 'Causa no encontrada' });
  try {
    const medida = await catalogoData.crearMedidaCatalogo(req.params.id, texto);
    await registrarCambio({
      modulo: 'Catálogos', entidad: 'trazabilidad_catalogo_medidas', entidadId: medida.id, accion: 'Creación',
      detalle: `Medida "${medida.texto}" agregada a la causa "${causa.texto}" del catálogo de Producción.`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
    });
    res.status(201).json(medida);
  } catch (e) {
    if (e.esConflicto) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

router.put('/produccion/trazabilidad/catalogo/medidas/:id', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const { texto, activo } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Escribe el texto de la medida.' });
  try {
    const medida = await catalogoData.actualizarMedidaCatalogo(req.params.id, texto, activo);
    if (!medida) return res.status(404).json({ error: 'Medida no encontrada' });
    await registrarCambio({
      modulo: 'Catálogos', entidad: 'trazabilidad_catalogo_medidas', entidadId: medida.id, accion: 'Edición',
      detalle: `Medida editada: "${medida.texto}" (${medida.activo}).`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
    });
    res.json(medida);
  } catch (e) {
    if (e.esConflicto) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

router.delete('/produccion/trazabilidad/catalogo/medidas/:id', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const medida = await catalogoData.obtenerMedidaCatalogoPorId(req.params.id);
  if (!medida) return res.status(404).json({ error: 'Medida no encontrada' });
  await catalogoData.eliminarMedidaCatalogo(req.params.id);
  await registrarCambio({
    modulo: 'Catálogos', entidad: 'trazabilidad_catalogo_medidas', entidadId: medida.id, accion: 'Eliminación',
    detalle: `Medida "${medida.texto}" eliminada del catálogo de Producción.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json({ success: true });
}));

module.exports = router;
