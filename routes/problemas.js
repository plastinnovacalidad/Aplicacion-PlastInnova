const express = require('express');
const { validarToken, requerirPermiso, requerirPermisoAlternativo } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const problemasData = require('../data/problemas');
const catalogoData = require('../data/trazabilidadCatalogo');
const { registrarCambio } = require('../data/auditoria');
// "Generar reporte" de un problema (08/09, pedido por Julio: "con cada
// problema de esos me gustaria generar un reporte") -- reusa el mismo
// diseño compartido (encabezado azul con logo, panel de datos, píldoras de
// color) que ya usan los reportes PDF de Muestreos ISO 2859-1, para que se
// sienta como parte del mismo sistema en vez de un documento suelto.
const pdf = require('../utils/pdfIso2859');

const router = express.Router();

// ======================== MÓDULO "PROBLEMAS" (UNIFICADO) ========================
// MIGRACIÓN #38 (07-08/09, pedido por Julio): reemplaza a Trazabilidad de
// Producción (routes/produccion.js, sección "TRAZABILIDAD DE SOLUCIONES") y
// a la parte de causa raíz/medidas de Reportes por Áreas (routes/reportes.js,
// reportes tipo 'rapido'/'completo') -- un solo lugar para registrar y
// hacerle seguimiento a cualquier problema, sin depender de la memoria de
// nadie. Ver data/problemas.js para el modelo de datos completo.
//
// Permisos: mismo criterio de 4 permisos separados que ya usaban esos dos
// módulos por separado (ver/crear/gestionar/eliminar) -- 'problemas.ver' se
// puede dar aparte, a alguien que solo necesite ver la lista y las alertas
// de críticos (p.ej. un encargado de área), sin darle además la capacidad de
// crear o editar (ver settings/permisos.js).
const puedeVer = requerirPermisoAlternativo(['problemas.ver', 'problemas.crear', 'problemas.gestionar', 'problemas.eliminar']);
const puedeCrear = requerirPermiso('problemas.crear');
const puedeGestionar = requerirPermiso('problemas.gestionar');
const puedeEliminar = requerirPermiso('problemas.eliminar');
const puedeGestionarCatalogos = requerirPermiso('catalogos.gestionar');
// El catálogo de causas/medidas también lo necesita cualquiera que pueda ver
// o gestionar el módulo, para poblar sus selectores -- no tendría sentido
// poder registrar una causa pero no poder leer de qué lista elegir (mismo
// criterio que ya usaba Trazabilidad de Producción).
const puedeVerCatalogo = requerirPermisoAlternativo(['problemas.ver', 'problemas.crear', 'problemas.gestionar', 'problemas.eliminar', 'catalogos.gestionar']);

const ESTADOS_MEDIDA_VALIDOS = problemasData.ESTADOS_MEDIDA;

// Resuelve la causa raíz contra el catálogo compartido (elegida del catálogo,
// o "Otra" -- se agrega sola para que la próxima vez ya aparezca en la
// lista). Mismo criterio que ya usaban Producción y Reportes por separado.
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

// Mismo criterio para la medida, validando además que pertenezca a la MISMA
// causa del catálogo que la causa del problema a la que se está agregando.
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

// ======================== CATÁLOGOS DE APOYO ========================
router.get('/problemas/areas', validarToken, puedeVer, asyncHandler(async (req, res) => {
  res.json(await problemasData.listarAreasActivas());
}));
router.get('/problemas/defectos', validarToken, puedeVerCatalogo, asyncHandler(async (req, res) => {
  res.json(await problemasData.listarDefectosActivos());
}));
router.get('/problemas/catalogo', validarToken, puedeVerCatalogo, asyncHandler(async (req, res) => {
  res.json(await catalogoData.listarCatalogoCompleto());
}));
// `motivo` (pedido por Julio, 08/09): para un problema de Producción,
// "motivo de rechazo" y "defecto" son lo mismo -- ya no se pide elegir un
// Defecto del catálogo ISO 2859 aparte para filtrar la causa raíz (ver
// Public/produccion.html). En vez de eso se manda `motivo` (el valor_contexto
// del caso) y solo se traen las causas ya usadas en algún problema de
// Producción con ese mismo motivo. Independiente de `defecto_id` (Producción
// nunca manda los dos a la vez; Reportes/General siguen usando defecto_id).
router.get('/problemas/catalogo-causas', validarToken, puedeVerCatalogo, asyncHandler(async (req, res) => {
  const defectoId = (req.query.defecto_id !== undefined && req.query.defecto_id !== '')
    ? parseInt(req.query.defecto_id, 10) : undefined;
  const motivo = (req.query.motivo !== undefined && req.query.motivo !== '') ? req.query.motivo : undefined;
  res.json(await catalogoData.listarCausasCatalogo({ soloActivas: true, defectoId, motivo }));
}));

// ======================== LISTADO, ALERTAS Y DETALLE ========================
router.get('/problemas', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const { origen, fabrica, area_id, estado, criticidad, defecto_id, q, limite } = req.query;
  const problemas = await problemasData.listarProblemas({ origen, fabrica, area_id, estado, criticidad, defecto_id, q, limit: limite });
  res.json(problemas);
}));

// Pedido por Julio: poder ver la lista de abiertos y que le avise cuáles son
// críticos -- este endpoint es la base de esa alerta (el frontend lo
// consulta al entrar al módulo, y puede volver a sondearlo cada tanto).
router.get('/problemas/alertas/criticos', validarToken, puedeVer, asyncHandler(async (req, res) => {
  res.json(await problemasData.listarAlertasCriticas({ limit: req.query.limite }));
}));

// Antes de abrir el modal de una fila del ranking/motivos en Producción: ¿ya
// hay un problema abierto (Pendiente/En_Proceso) para esta fábrica+
// referencia/motivo? Si lo hay, el frontend lo reabre en vez de mostrar el
// formulario de "problema nuevo".
router.get('/problemas/activo', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const { fabrica, tipo_contexto, valor_contexto } = req.query;
  if (!fabrica || !tipo_contexto || !valor_contexto) {
    return res.status(400).json({ error: 'Faltan datos: fabrica, tipo_contexto y valor_contexto son obligatorios.' });
  }
  const activo = await problemasData.buscarActivo({ fabrica, tipo_contexto, valor_contexto });
  if (!activo) return res.json(null);
  res.json(await problemasData.obtenerProblemaCompleto(activo.id));
}));

// El último problema para este contexto sin importar su estado -- el
// frontend lo usa solo cuando /activo ya dio null, para saber si el último
// quedó Implementado y así preguntar si esa solución falló antes de crear
// uno nuevo.
router.get('/problemas/ultimo', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const { fabrica, tipo_contexto, valor_contexto } = req.query;
  if (!fabrica || !tipo_contexto || !valor_contexto) {
    return res.status(400).json({ error: 'Faltan datos: fabrica, tipo_contexto y valor_contexto son obligatorios.' });
  }
  const ultimo = await problemasData.buscarUltimo({ fabrica, tipo_contexto, valor_contexto });
  if (!ultimo) return res.json(null);
  res.json(await problemasData.obtenerProblemaCompleto(ultimo.id));
}));

router.get('/problemas/:id', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const problema = await problemasData.obtenerProblemaCompleto(req.params.id);
  if (!problema) return res.status(404).json({ error: 'Problema no encontrado' });
  res.json(problema);
}));

// ======================== REPORTE (PDF) ========================
// Dibuja la causa raíz y sus medidas como una tarjeta con una barra de
// acento a la izquierda (mismo criterio visual que .trz-causa-card en
// pantalla) -- no usa dibujarPanelInfo/dibujarTablaFila del diseño
// compartido porque el texto de cada causa/medida es de largo variable, así
// que la altura de cada bloque se calcula con heightOfString (mismo truco
// que ya usa el Reporte de Muestreo para su campo "Observación").
function dibujarCausaConMedidas(doc, y, causa, medidasDeCausa, subtitulo, redibujarEncabezado) {
  const ancho = pdf.anchoUtil(doc);
  const anchoTexto = ancho - 24;

  // OJO: heightOfString mide con la fuente/tamaño ACTIVOS del doc en ese
  // momento -- pasarle `font`/`fontSize` en options no los cambia (es una
  // trampa de pdfkit que también tiene, sin que nadie se diera cuenta, el
  // campo "Observación" del Reporte de Muestreo ISO 2859-1). Por eso acá se
  // fijan primero explícitamente, para medir con la MISMA fuente/tamaño con
  // la que se va a dibujar el texto real un poco más abajo.
  doc.font('Helvetica').fontSize(9.5);
  const alturaCausaTexto = doc.heightOfString(causa.texto || '', { width: anchoTexto });
  y = pdf.saltoPaginaSiNecesario(doc, y, alturaCausaTexto + 46, redibujarEncabezado);

  doc.rect(pdf.MARGEN, y, 3, alturaCausaTexto + 34).fill(pdf.COLORES.azul);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(pdf.COLORES.gris)
    .text('CAUSA RAÍZ', pdf.MARGEN + 12, y + 4, { width: anchoTexto - 100 });
  doc.font('Helvetica').fontSize(7.5).fillColor(pdf.COLORES.gris)
    .text(causa.fecha || '', pdf.MARGEN + 12, y + 4, { width: anchoTexto, align: 'right' });
  doc.font('Helvetica').fontSize(9.5).fillColor(pdf.COLORES.texto)
    .text(causa.texto || '', pdf.MARGEN + 12, y + 16, { width: anchoTexto });
  doc.font('Helvetica-Oblique').fontSize(8).fillColor(pdf.COLORES.gris)
    .text(`Registrada por ${causa.autor_nombre || causa.responsable_nombre || 'Usuario'}`, pdf.MARGEN + 12, y + 20 + alturaCausaTexto);
  y += alturaCausaTexto + 40;

  if (!medidasDeCausa.length) {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(pdf.COLORES.gris)
      .text('Todavía no hay medidas para esta causa.', pdf.MARGEN + 20, y);
    return y + 18;
  }

  medidasDeCausa.forEach((m) => {
    const anchoMedidaTexto = ancho - 36;
    doc.font('Helvetica').fontSize(9);
    const alturaMedidaTexto = doc.heightOfString(m.texto || '', { width: anchoMedidaTexto });
    y = pdf.saltoPaginaSiNecesario(doc, y, alturaMedidaTexto + 42, redibujarEncabezado);

    doc.roundedRect(pdf.MARGEN + 16, y, ancho - 16, alturaMedidaTexto + 32, 4).fillAndStroke(pdf.COLORES.grisFilaAlterna, pdf.COLORES.grisBorde);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(pdf.COLORES.gris)
      .text('MEDIDA', pdf.MARGEN + 28, y + 8, { width: 100 });
    pdf.dibujarInsignia(doc, pdf.MARGEN + ancho - 16 - 100, y + 6, m.estado);
    doc.font('Helvetica').fontSize(9).fillColor(pdf.COLORES.texto)
      .text(m.texto || '', pdf.MARGEN + 28, y + 20, { width: anchoMedidaTexto - 8 });
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(pdf.COLORES.gris)
      .text(`Registrada por ${m.autor_nombre || m.responsable_nombre || 'Usuario'} el ${m.creado_en || ''}`, pdf.MARGEN + 28, y + 24 + alturaMedidaTexto);
    y += alturaMedidaTexto + 40;
  });

  return y + 6;
}

router.get('/problemas/:id/reporte-pdf', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const problema = await problemasData.obtenerProblemaCompleto(req.params.id);
  if (!problema) return res.status(404).json({ error: 'Problema no encontrado' });

  const subtitulo = `Reporte de Problema #${problema.id}`;
  const doc = pdf.crearDocumento(res, `problema-${problema.id}.pdf`);
  const redibujarEncabezado = (doc2) => pdf.dibujarEncabezado(doc2, `${subtitulo} (continuación)`);
  pdf.dibujarPie(doc);
  doc.on('pageAdded', () => pdf.dibujarPie(doc));

  let y = pdf.dibujarEncabezado(doc, subtitulo);

  const ORIGEN_LABEL = { produccion: 'Producción', reporte: 'Reporte de área', general: 'General' };
  const filas = [{ label: 'Origen', value: ORIGEN_LABEL[problema.origen] || problema.origen }];
  if (problema.origen === 'produccion') {
    const etiquetaContexto = problema.tipo_contexto === 'referencia' ? 'Referencia' : 'Motivo';
    filas.push({ label: 'Fábrica', value: problema.fabrica });
    filas.push({ label: etiquetaContexto, value: problema.valor_contexto });
    if (problema.semana) filas.push({ label: 'Semana', value: problema.semana });
  } else {
    if (problema.area_origen_nombre) filas.push({ label: 'Área', value: problema.area_origen_nombre });
    if (problema.referencia) filas.push({ label: 'Referencia', value: problema.referencia });
    if (problema.lote) filas.push({ label: 'Lote', value: problema.lote });
  }
  if (problema.defecto_codigo) {
    filas.push({ label: 'Problema / Defecto', value: `${problema.defecto_codigo} — ${problema.defecto_descripcion || ''}` });
  }
  filas.push({ label: 'Criticidad', value: problema.criticidad, badge: true });
  filas.push({ label: 'Estado', value: problema.estado, badge: true });
  filas.push({ label: 'Registrado por', value: problema.autor_nombre || '—' });
  filas.push({ label: 'Creado', value: problema.creado_en });
  filas.push({ label: 'Actualizado', value: problema.actualizado_en });
  if (problema.cerrado_en) filas.push({ label: 'Cerrado', value: problema.cerrado_en });
  const descripcionTexto = problema.descripcion || 'Sin descripción';
  // Mismo cuidado que en dibujarCausaConMedidas: fijar la fuente/tamaño
  // ANTES de medir, porque heightOfString ignora el font/fontSize que se le
  // pase por options y mide con lo que esté activo en el doc en ese momento.
  doc.font('Helvetica').fontSize(9);
  filas.push({
    label: 'Descripción', value: descripcionTexto,
    alturaExtra: Math.max(22, doc.heightOfString(descripcionTexto, { width: pdf.anchoUtil(doc) - 170 }) + 14),
  });

  y = pdf.dibujarPanelInfo(doc, y, filas);

  y = pdf.saltoPaginaSiNecesario(doc, y, 60, redibujarEncabezado);
  y = pdf.dibujarTituloSeccion(doc, y, 'Causas raíz y medidas');
  const causas = problema.causas || [];
  const medidas = problema.medidas || [];
  if (causas.length === 0) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(pdf.COLORES.gris).text('Todavía no hay ninguna causa raíz registrada.', pdf.MARGEN, y);
  } else {
    causas.forEach((c) => {
      y = dibujarCausaConMedidas(doc, y, c, medidas.filter((m) => m.causa_id === c.id), subtitulo, redibujarEncabezado);
    });
  }

  await registrarCambio({
    modulo: 'Problemas', entidad: 'problemas', entidadId: problema.id, accion: 'Reporte PDF',
    detalle: `Reporte PDF generado — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });

  doc.end();
}));

// ======================== CREAR ========================
// Crea el problema junto con su primera causa raíz -- no tiene sentido abrir
// uno sin decir al menos qué se cree que lo originó. `origen` decide qué
// contexto es obligatorio: 'produccion' exige fabrica/tipo_contexto/
// valor_contexto (viene del tablero de Producción); 'reporte' y 'general'
// solo exigen la descripción (el área/referencia/lote son opcionales).
router.post('/problemas', validarToken, puedeCrear, asyncHandler(async (req, res) => {
  const {
    origen, fabrica, tipo_contexto, valor_contexto, pct_desperdicio_inicial,
    area_origen_id, referencia, lote, defecto_id, descripcion, criticidad,
    causa_raiz, causa_catalogo_id,
  } = req.body;

  if (!origen || !problemasData.ORIGENES.includes(origen)) {
    return res.status(400).json({ error: `origen inválido. Debe ser: ${problemasData.ORIGENES.join(', ')}.` });
  }
  if (origen === 'produccion') {
    if (!fabrica || !tipo_contexto || !valor_contexto) {
      return res.status(400).json({ error: 'Faltan datos: fabrica, tipo_contexto y valor_contexto son obligatorios para un problema de Producción.' });
    }
    if (!problemasData.TIPOS_CONTEXTO.includes(tipo_contexto)) {
      return res.status(400).json({ error: `tipo_contexto inválido. Debe ser: ${problemasData.TIPOS_CONTEXTO.join(' o ')}.` });
    }
  }
  // La descripción es obligatoria solo para origen 'general' (un problema
  // detectado directo en este módulo, sin más contexto que la explique) --
  // 'produccion' y 'reporte' ya traen su propio contexto (referencia/motivo,
  // o área+referencia/lote) y, si no se manda, data/problemas.js arma una
  // por defecto a partir de ese contexto. Así el flujo mínimo que ya tenía
  // Producción por Fábrica (crear el caso solo con la causa raíz) sigue
  // funcionando sin pedir un campo nuevo que antes no existía.
  if (origen === 'general' && (!descripcion || !descripcion.trim())) {
    return res.status(400).json({ error: 'Escribe una descripción del problema.' });
  }
  if (criticidad && !problemasData.CRITICIDADES.includes(criticidad)) {
    return res.status(400).json({ error: `Criticidad inválida. Debe ser: ${problemasData.CRITICIDADES.join(', ')}.` });
  }

  const resCausa = await resolverCausaConCatalogo(
    { causa_catalogo_id, texto: causa_raiz, defectoId: defecto_id || null },
    'Escribe al menos una causa raíz para poder crear el problema, o elige una del catálogo.'
  );
  if (resCausa.error) return res.status(400).json({ error: resCausa.error });

  const problema = await problemasData.crearProblema({
    origen, fabrica: fabrica || null, tipo_contexto: tipo_contexto || null, valor_contexto: valor_contexto || null,
    pct_desperdicio_inicial: pct_desperdicio_inicial != null && pct_desperdicio_inicial !== '' ? parseFloat(pct_desperdicio_inicial) : null,
    area_origen_id: area_origen_id || null, referencia: referencia || null, lote: lote || null,
    defecto_id: defecto_id || null, descripcion: descripcion && descripcion.trim() ? descripcion.trim() : null, criticidad,
    causaInicial: resCausa.texto, causaCatalogoId: resCausa.causaCatalogoId,
    autorId: req.usuario.id, autorNombre: req.usuario.nombre,
  });
  await registrarCambio({
    modulo: 'Problemas', entidad: 'problemas', entidadId: problema.id, accion: 'Creación',
    detalle: `Nuevo problema (${origen}${valor_contexto ? `, ${tipo_contexto}: ${valor_contexto}` : ''}${fabrica ? `, ${fabrica}` : ''}), criticidad ${problema.criticidad}. Causa raíz: ${resCausa.texto} — registrado por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.status(201).json(problema);
}));

router.put('/problemas/:id', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const cambios = {};
  const campos = ['fabrica', 'tipo_contexto', 'valor_contexto', 'area_origen_id', 'referencia', 'lote', 'defecto_id', 'descripcion', 'criticidad', 'pct_desperdicio_inicial'];
  for (const campo of campos) if (req.body[campo] !== undefined) cambios[campo] = req.body[campo];
  const resultado = await problemasData.actualizarProblema(req.params.id, cambios);
  if (resultado.error === 'no_encontrado') return res.status(404).json({ error: 'Problema no encontrado' });
  if (resultado.error === 'criticidad_invalida') return res.status(400).json({ error: `Criticidad inválida. Debe ser: ${problemasData.CRITICIDADES.join(', ')}.` });
  if (resultado.error === 'nada_que_actualizar') return res.status(400).json({ error: 'No se mandó ningún campo para actualizar.' });
  await registrarCambio({
    modulo: 'Problemas', entidad: 'problemas', entidadId: resultado.problema.id, accion: 'Edición',
    detalle: `Problema editado — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.problema);
}));

// ======================== CAUSAS Y MEDIDAS ========================
router.post('/problemas/:id/causas', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const problemaActual = await problemasData.obtenerProblemaCompleto(req.params.id);
  if (!problemaActual) return res.status(404).json({ error: 'Problema no encontrado' });
  const { texto, causa_catalogo_id } = req.body;
  const resCausa = await resolverCausaConCatalogo(
    { causa_catalogo_id, texto, defectoId: problemaActual.defecto_id || null },
    'La causa raíz no puede estar vacía -- escríbela o elige una del catálogo.'
  );
  if (resCausa.error) return res.status(400).json({ error: resCausa.error });
  const problema = await problemasData.agregarCausa({
    problema_id: req.params.id, texto: resCausa.texto, causa_catalogo_id: resCausa.causaCatalogoId,
    autor_id: req.usuario.id, autor_nombre: req.usuario.nombre,
  });
  await registrarCambio({
    modulo: 'Problemas', entidad: 'causas_raiz', entidadId: problema.id, accion: 'Edición',
    detalle: `Causa raíz agregada: ${resCausa.texto} — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(problema);
}));

router.delete('/problemas/:id/causas/:causaId', validarToken, puedeEliminar, asyncHandler(async (req, res) => {
  const resultado = await problemasData.eliminarCausa(req.params.id, req.params.causaId);
  if (resultado.error === 'no_encontrada') return res.status(404).json({ error: 'Causa no encontrada en este problema.' });
  if (resultado.error === 'ultima_causa') return res.status(400).json({ error: 'No se puede eliminar la única causa raíz de este problema. Agrega otra causa antes de eliminar esta.' });
  await registrarCambio({
    modulo: 'Problemas', entidad: 'causas_raiz', entidadId: req.params.causaId, accion: 'Eliminación',
    detalle: `Causa raíz "${resultado.causaEliminada.texto}" eliminada -- sus medidas también se eliminaron. Por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.problema);
}));

router.post('/problemas/:id/medidas', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const { texto, estado, causa_id, medida_catalogo_id } = req.body;
  if (estado && !ESTADOS_MEDIDA_VALIDOS.includes(estado)) {
    return res.status(400).json({ error: `Estado de medida inválido. Debe ser: ${ESTADOS_MEDIDA_VALIDOS.join(', ')}.` });
  }
  if (!causa_id) return res.status(400).json({ error: 'Elige a qué causa raíz corresponde esta medida.' });
  const problemaActual = await problemasData.obtenerProblemaCompleto(req.params.id);
  if (!problemaActual) return res.status(404).json({ error: 'Problema no encontrado' });
  const causaDelCaso = (problemaActual.causas || []).find((c) => String(c.id) === String(causa_id));
  if (!causaDelCaso) return res.status(400).json({ error: 'Esa causa raíz no existe o no pertenece a este problema.' });
  const resMedida = await resolverMedidaConCatalogo({ medida_catalogo_id, texto }, causaDelCaso.causa_catalogo_id);
  if (resMedida.error) return res.status(400).json({ error: resMedida.error });
  const resultado = await problemasData.agregarMedida({
    problema_id: req.params.id, causa_id, texto: resMedida.texto, estado,
    autor_id: req.usuario.id, autor_nombre: req.usuario.nombre,
  });
  if (resultado.error === 'causa_no_encontrada') return res.status(400).json({ error: 'Esa causa raíz no existe o no pertenece a este problema.' });
  await registrarCambio({
    modulo: 'Problemas', entidad: 'medidas', entidadId: resultado.problema.id, accion: 'Edición',
    detalle: `Medida agregada: ${resMedida.texto} — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.problema);
}));

router.put('/problemas/:id/medidas/:medidaId', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const { estado } = req.body;
  if (!estado || !ESTADOS_MEDIDA_VALIDOS.includes(estado)) {
    return res.status(400).json({ error: `Estado de medida inválido. Debe ser: ${ESTADOS_MEDIDA_VALIDOS.join(', ')}.` });
  }
  const resultado = await problemasData.actualizarEstadoMedida(req.params.id, req.params.medidaId, estado);
  if (resultado.error) return res.status(404).json({ error: 'Medida no encontrada en este problema.' });
  await registrarCambio({
    modulo: 'Problemas', entidad: 'medidas', entidadId: req.params.medidaId, accion: 'Edición',
    detalle: `Medida #${req.params.medidaId} cambió a estado ${estado} — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.problema);
}));

router.delete('/problemas/:id/medidas/:medidaId', validarToken, puedeEliminar, asyncHandler(async (req, res) => {
  const resultado = await problemasData.eliminarMedida(req.params.id, req.params.medidaId);
  if (resultado.error === 'no_encontrada') return res.status(404).json({ error: 'Medida no encontrada en este problema.' });
  await registrarCambio({
    modulo: 'Problemas', entidad: 'medidas', entidadId: req.params.medidaId, accion: 'Eliminación',
    detalle: `Medida "${resultado.medidaEliminada.texto}" eliminada — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.problema);
}));

// ======================== CICLO DE VIDA ========================
router.post('/problemas/:id/marcar-fallo', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const problema = await problemasData.marcarSolucionAnteriorComoFallida(req.params.id);
  if (!problema) return res.status(404).json({ error: 'Problema no encontrado' });
  await registrarCambio({
    modulo: 'Problemas', entidad: 'problemas', entidadId: problema.id, accion: 'Edición',
    detalle: `Se marcó que la solución anterior no funcionó -- problema reabierto — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(problema);
}));

// Nuevo (no existía antes): descartar un problema que, al revisarlo, no
// amerita seguimiento -- en vez de dejarlo forzado en Pendiente para siempre.
router.post('/problemas/:id/descartar', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const problema = await problemasData.descartarProblema(req.params.id);
  if (!problema) return res.status(404).json({ error: 'Problema no encontrado' });
  await registrarCambio({
    modulo: 'Problemas', entidad: 'problemas', entidadId: problema.id, accion: 'Edición',
    detalle: `Problema descartado (no ameritaba seguimiento) — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(problema);
}));

router.post('/problemas/:id/reabrir', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const problema = await problemasData.reabrirProblema(req.params.id);
  if (!problema) return res.status(404).json({ error: 'Problema no encontrado' });
  await registrarCambio({
    modulo: 'Problemas', entidad: 'problemas', entidadId: problema.id, accion: 'Edición',
    detalle: `Problema reabierto — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(problema);
}));

// ======================== CATÁLOGO DE CAUSAS RAÍZ Y MEDIDAS (admin) ========================
// Mudado desde routes/produccion.js (MIGRACIÓN #38) -- ahora vive junto con
// el resto del módulo Problemas, que es quien de verdad lo usa. El permiso
// de escritura sigue siendo 'catalogos.gestionar' (sin importar desde qué
// módulo se use), igual que siempre.
router.post('/problemas/catalogo/causas', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Escribe el texto de la causa raíz.' });
  try {
    const causa = await catalogoData.crearCausaCatalogo(texto);
    await registrarCambio({
      modulo: 'Catálogos', entidad: 'trazabilidad_catalogo_causas', entidadId: causa.id, accion: 'Creación',
      detalle: `Causa raíz "${causa.texto}" agregada al catálogo de Problemas.`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
    });
    res.status(201).json(causa);
  } catch (e) {
    if (e.esConflicto) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

router.put('/problemas/catalogo/causas/:id', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
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

router.delete('/problemas/catalogo/causas/:id', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const causa = await catalogoData.obtenerCausaCatalogoPorId(req.params.id);
  if (!causa) return res.status(404).json({ error: 'Causa no encontrada' });
  try {
    await catalogoData.eliminarCausaCatalogo(req.params.id);
    await registrarCambio({
      modulo: 'Catálogos', entidad: 'trazabilidad_catalogo_causas', entidadId: causa.id, accion: 'Eliminación',
      detalle: `Causa raíz "${causa.texto}" eliminada del catálogo de Problemas.`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
    });
    res.json({ success: true });
  } catch (e) {
    if (e.esConflicto) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

router.delete('/problemas/catalogo/causas-sin-defecto', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const resultado = await catalogoData.eliminarCausasSinDefecto();
  await registrarCambio({
    modulo: 'Catálogos', entidad: 'trazabilidad_catalogo_causas', entidadId: 0, accion: 'Eliminación',
    detalle: `Limpieza del catálogo: ${resultado.causasEliminadas} causa(s) sin problema asignado eliminada(s) (${resultado.medidasEliminadas} medida(s) propia(s), ${resultado.referenciasDesvinculadas} referencia(s) en casos reales desvinculada(s)) — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado);
}));

router.post('/problemas/catalogo/causas/:id/medidas', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const { texto } = req.body;
  if (!texto || !texto.trim()) return res.status(400).json({ error: 'Escribe el texto de la medida.' });
  const causa = await catalogoData.obtenerCausaCatalogoPorId(req.params.id);
  if (!causa) return res.status(404).json({ error: 'Causa no encontrada' });
  try {
    const medida = await catalogoData.crearMedidaCatalogo(req.params.id, texto);
    await registrarCambio({
      modulo: 'Catálogos', entidad: 'trazabilidad_catalogo_medidas', entidadId: medida.id, accion: 'Creación',
      detalle: `Medida "${medida.texto}" agregada a la causa "${causa.texto}" del catálogo de Problemas.`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
    });
    res.status(201).json(medida);
  } catch (e) {
    if (e.esConflicto) return res.status(400).json({ error: e.message });
    throw e;
  }
}));

router.put('/problemas/catalogo/medidas/:id', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
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

router.delete('/problemas/catalogo/medidas/:id', validarToken, puedeGestionarCatalogos, asyncHandler(async (req, res) => {
  const medida = await catalogoData.obtenerMedidaCatalogoPorId(req.params.id);
  if (!medida) return res.status(404).json({ error: 'Medida no encontrada' });
  await catalogoData.eliminarMedidaCatalogo(req.params.id);
  await registrarCambio({
    modulo: 'Catálogos', entidad: 'trazabilidad_catalogo_medidas', entidadId: medida.id, accion: 'Eliminación',
    detalle: `Medida "${medida.texto}" eliminada del catálogo de Problemas.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json({ success: true });
}));

module.exports = router;
