const fs = require('fs');
const path = require('path');
const express = require('express');
const { validarToken, requerirPermiso, requerirPermisoAlternativo } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const { upload } = require('../utils/upload');
const { validarOBorrar } = require('../utils/validarArchivo');
const { moverArchivo } = require('../utils/archivos');
const { EVIDENCIAS_DIR } = require('../settings/paths');
const problemasData = require('../data/problemas');
const catalogoData = require('../data/trazabilidadCatalogo');
const { registrarCambio } = require('../data/auditoria');
// "Generar reporte" de un problema (08/09, pedido por Julio: "con cada
// problema de esos me gustaria generar un reporte") -- reusa el mismo
// diseño compartido (encabezado azul con logo, panel de datos, píldoras de
// color) que ya usan los reportes PDF de Muestreos ISO 2859-1, para que se
// sienta como parte del mismo sistema en vez de un documento suelto.
const pdf = require('../utils/pdfIso2859');
// MIGRACIÓN #43: rediseño del reporte -- todo el layout vive en su propio
// módulo (ver utils/pdfProblema.js), separado de pdfIso2859.js porque Julio
// confirmó que este rediseño es SOLO para el reporte de Problemas por ahora.
const pdfProblema = require('../utils/pdfProblema');
const FileType = require('file-type');

const router = express.Router();

// MIGRACIÓN #42: carpeta de evidencia gráfica de Problemas -- mismo patrón
// que CARPETA_ADJUNTOS en routes/reportes.js (una subcarpeta propia dentro
// de uploads/evidencias, para no mezclar los archivos de los dos módulos).
const CARPETA_ADJUNTOS_PROBLEMAS = path.join(EVIDENCIAS_DIR, 'problemas');

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
// MIGRACIÓN #42: evidencia gráfica -- mismo criterio que puedeAdjuntar en
// routes/reportes.js (quien puede crear o gestionar el módulo puede subir
// fotos; eliminarlas sigue exigiendo el permiso de eliminar, más estricto).
const puedeAdjuntar = requerirPermisoAlternativo(['problemas.crear', 'problemas.gestionar']);

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
// MIGRACIÓN #43: rediseño completo del reporte (ver utils/pdfProblema.js
// para todo el layout -- panel de información en dos columnas, Tratamiento
// grande y centrado, causa raíz dentro del mismo cuadro de la descripción,
// lista de verificación, evidencia gráfica en grilla, acciones propuestas,
// "¿qué se hizo?" y firmas digitales, todo garantizado en una sola hoja).
// Esta ruta ahora solo resuelve las fotos de evidencia a una ruta absoluta
// en disco (filtrando las que ya no existan, igual que antes) y delega todo
// el dibujo al módulo dedicado.
router.get('/problemas/:id/reporte-pdf', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const problema = await problemasData.obtenerProblemaCompleto(req.params.id);
  if (!problema) return res.status(404).json({ error: 'Problema no encontrado' });

  const adjuntosConRuta = (problema.adjuntos || [])
    .map((a) => ({ ...a, ruta: path.join(CARPETA_ADJUNTOS_PROBLEMAS, a.archivo) }))
    .filter((a) => fs.existsSync(a.ruta));

  pdfProblema.generarReportePdfProblema(res, problema, adjuntosConRuta);

  await registrarCambio({
    modulo: 'Problemas', entidad: 'problemas', entidadId: problema.id, accion: 'Reporte PDF',
    detalle: `Reporte PDF generado — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
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
    cantidad_total, cantidad_afectada, tratamiento,
    chk_falla_funcional, chk_problema_visual, chk_retraso_tiempo, chk_fuera_tolerancias,
    prevencion, firma_implicados_nombre,
    causa_raiz, causa_catalogo_id,
    medidas_iniciales,
    es_aviso_rapido,
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
  // MIGRACIÓN #43: lista de verificación -- aplica a los 3 orígenes (Julio:
  // "el checklist es para todo"), a diferencia de cantidades/tratamiento.
  // Los 4 son opcionales al crear (se pueden ir llenando después, igual que
  // la evidencia gráfica); si vienen, cada uno debe ser 'Si' o 'No'.
  for (const { campo, pregunta } of problemasData.CHECKLIST_PREGUNTAS) {
    const valor = req.body[campo];
    if (valor !== undefined && valor !== '' && !problemasData.VALORES_CHECKLIST.includes(valor)) {
      return res.status(400).json({ error: `Valor inválido para "${pregunta}". Debe ser: Si o No.` });
    }
  }

  // MIGRACIÓN #42 (08/09, pedido por Julio): cantidades/tratamiento SOLO
  // aplican a 'reporte'/'general' -- un problema de Producción ya trae su
  // propia foto de cantidad (pct_desperdicio_inicial) y no tiene la decisión
  // de Tratamiento, así que si por error llegan en el body para un problema
  // de Producción, simplemente se ignoran (quedan NULL) en vez de fallar.
  let cantidadTotalFinal = null;
  let cantidadAfectadaFinal = null;
  let tratamientoFinal = null;
  if (origen !== 'produccion') {
    // Julio: "Tratamiento ... cuando haga un reporte de fabrica o general
    // que me deje escoger el tratamiento que se le va a dar" -- confirmó que
    // es obligatorio al crear.
    if (!tratamiento || !problemasData.TRATAMIENTOS.includes(tratamiento)) {
      return res.status(400).json({ error: `Elige el tratamiento que se le va a dar. Debe ser: ${problemasData.TRATAMIENTOS.join(', ')}.` });
    }
    tratamientoFinal = tratamiento;
    // Las cantidades sí son opcionales (Julio las llena "si escojo un
    // problema" -- puede ir agregándolas después desde Editar) -- pero si
    // manda alguna, se valida que sean números válidos y coherentes entre sí.
    if (cantidad_total !== undefined && cantidad_total !== null && cantidad_total !== '') {
      cantidadTotalFinal = parseFloat(cantidad_total);
      if (!Number.isFinite(cantidadTotalFinal) || cantidadTotalFinal < 0) {
        return res.status(400).json({ error: 'La cantidad total debe ser un número mayor o igual a 0.' });
      }
    }
    if (cantidad_afectada !== undefined && cantidad_afectada !== null && cantidad_afectada !== '') {
      cantidadAfectadaFinal = parseFloat(cantidad_afectada);
      if (!Number.isFinite(cantidadAfectadaFinal) || cantidadAfectadaFinal < 0) {
        return res.status(400).json({ error: 'La cantidad afectada debe ser un número mayor o igual a 0.' });
      }
    }
    if (cantidadTotalFinal != null && cantidadAfectadaFinal != null && cantidadAfectadaFinal > cantidadTotalFinal) {
      return res.status(400).json({ error: 'La cantidad afectada no puede ser mayor que la cantidad total.' });
    }
  }

  const resCausa = await resolverCausaConCatalogo(
    { causa_catalogo_id, texto: causa_raiz, defectoId: defecto_id || null },
    'Escribe al menos una causa raíz para poder crear el problema, o elige una del catálogo.'
  );
  if (resCausa.error) return res.status(400).json({ error: resCausa.error });

  // MIGRACIÓN #44 (08/09, pedido por Julio: "medidas no se pueden cargar" y
  // luego "me gustaria poder agregar varias medidas" -- al crear un problema
  // solo se pedía la causa raíz inicial, ninguna medida (había que esperar a
  // que el problema ya existiera para agregar la primera desde el detalle).
  // `medidas_iniciales` es un arreglo opcional de {medida_catalogo_id} o
  // {medida_texto}, una por cada fila que se haya llenado en el formulario
  // (las filas vacías ni se mandan). Cada una se resuelve contra el catálogo
  // de la MISMA causa que se va a crear (resCausa.causaCatalogoId), con el
  // mismo criterio que ya usa POST /problemas/:id/medidas.
  const medidasInicialesTextos = [];
  if (Array.isArray(medidas_iniciales)) {
    for (const entrada of medidas_iniciales) {
      if (!entrada) continue;
      const resMedida = await resolverMedidaConCatalogo(
        { medida_catalogo_id: entrada.medida_catalogo_id, texto: entrada.medida_texto },
        resCausa.causaCatalogoId
      );
      if (resMedida.error) return res.status(400).json({ error: resMedida.error });
      medidasInicialesTextos.push(resMedida.texto);
    }
  }

  const problema = await problemasData.crearProblema({
    origen, fabrica: fabrica || null, tipo_contexto: tipo_contexto || null, valor_contexto: valor_contexto || null,
    pct_desperdicio_inicial: pct_desperdicio_inicial != null && pct_desperdicio_inicial !== '' ? parseFloat(pct_desperdicio_inicial) : null,
    area_origen_id: area_origen_id || null, referencia: referencia || null, lote: lote || null,
    defecto_id: defecto_id || null, descripcion: descripcion && descripcion.trim() ? descripcion.trim() : null, criticidad,
    cantidad_total: cantidadTotalFinal, cantidad_afectada: cantidadAfectadaFinal, tratamiento: tratamientoFinal,
    chk_falla_funcional, chk_problema_visual, chk_retraso_tiempo, chk_fuera_tolerancias,
    prevencion, firma_implicados_nombre,
    causaInicial: resCausa.texto, causaCatalogoId: resCausa.causaCatalogoId,
    medidasIniciales: medidasInicialesTextos,
    autorId: req.usuario.id, autorNombre: req.usuario.nombre,
    // MIGRACIÓN #45 (09/09, Julio: "algo mas sencillo" que el formulario
    // completo, para avisar de inmediato sin saber la causa todavía) --
    // marca el problema para que su detalle ofrezca la tarjeta simple en
    // vez del PDF formal al generar el reporte.
    esAvisoRapido: !!es_aviso_rapido,
  });
  await registrarCambio({
    modulo: 'Problemas', entidad: 'problemas', entidadId: problema.id, accion: 'Creación',
    detalle: `${es_aviso_rapido ? 'Aviso rápido' : 'Nuevo problema'} (${origen}${valor_contexto ? `, ${tipo_contexto}: ${valor_contexto}` : ''}${fabrica ? `, ${fabrica}` : ''}), criticidad ${problema.criticidad}. Causa raíz: ${resCausa.texto}${medidasInicialesTextos.length ? `. Medidas propuestas: ${medidasInicialesTextos.join(' | ')}` : ''} — registrado por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.status(201).json(problema);
}));

router.put('/problemas/:id', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const cambios = {};
  const campos = ['fabrica', 'tipo_contexto', 'valor_contexto', 'area_origen_id', 'referencia', 'lote', 'defecto_id', 'descripcion', 'criticidad', 'pct_desperdicio_inicial', 'cantidad_total', 'cantidad_afectada', 'prevencion', 'firma_implicados_nombre'];
  for (const campo of campos) if (req.body[campo] !== undefined) cambios[campo] = req.body[campo];
  // MIGRACIÓN #42: Tratamiento se puede cambiar después de creado (Julio:
  // "Obligatorio y editable después"), pero nunca a un valor vacío -- si
  // viene, se valida y se pasa; si no viene, ni se toca.
  if (req.body.tratamiento !== undefined) cambios.tratamiento = req.body.tratamiento;
  // MIGRACIÓN #43: lista de verificación -- cada una de las 4 se manda (o
  // no) por separado, mismo criterio que el resto de campos opcionales.
  for (const { campo } of problemasData.CHECKLIST_PREGUNTAS) {
    if (req.body[campo] !== undefined) cambios[campo] = req.body[campo];
  }
  const resultado = await problemasData.actualizarProblema(req.params.id, cambios);
  if (resultado.error === 'no_encontrado') return res.status(404).json({ error: 'Problema no encontrado' });
  if (resultado.error === 'criticidad_invalida') return res.status(400).json({ error: `Criticidad inválida. Debe ser: ${problemasData.CRITICIDADES.join(', ')}.` });
  if (resultado.error === 'tratamiento_invalido') return res.status(400).json({ error: `Tratamiento inválido. Debe ser: ${problemasData.TRATAMIENTOS.join(', ')}.` });
  if (resultado.error === 'checklist_invalido') return res.status(400).json({ error: 'Valor inválido en la lista de verificación. Debe ser: Si o No.' });
  if (resultado.error === 'nada_que_actualizar') return res.status(400).json({ error: 'No se mandó ningún campo para actualizar.' });
  await registrarCambio({
    modulo: 'Problemas', entidad: 'problemas', entidadId: resultado.problema.id, accion: 'Edición',
    detalle: `Problema editado — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json(resultado.problema);
}));

// ======================== EVIDENCIA GRÁFICA (adjuntos) ========================
// MIGRACIÓN #42 (08/09, pedido por Julio: "que me deje agregar una foto"),
// calcado del patrón de /reportes/:id/adjuntos -- con una diferencia: acá
// solo se aceptan IMÁGENES (Julio pidió "foto", no ficha técnica en PDF como
// sí acepta Reportes por Áreas), así que además del filtro de siempre
// (utils/upload.js) se vuelve a comprobar el contenido real del archivo y se
// rechaza si es un PDF. Disponible para 'reporte' y 'general' -- un problema
// de Producción no tiene este campo en el formulario, pero no hace falta
// bloquearlo aquí a propósito (no rompe nada si alguna vez se necesita).
router.post('/problemas/:id/adjuntos', validarToken, puedeAdjuntar, upload.single('archivo'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Debe subir un archivo de imagen.' });
  const problema = await problemasData.obtenerProblemaCompleto(req.params.id);
  if (!problema) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Problema no encontrado' });
  }
  const valido = await validarOBorrar(req, res, req.file.path);
  if (!valido) return; // validarOBorrar ya respondió el error y borró el archivo

  const tipoReal = await FileType.fromFile(req.file.path);
  if (!tipoReal || !tipoReal.mime.startsWith('image/')) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'La evidencia gráfica debe ser una imagen (JPG, PNG, GIF, WEBP o BMP), no un PDF.' });
  }

  if (!fs.existsSync(CARPETA_ADJUNTOS_PROBLEMAS)) fs.mkdirSync(CARPETA_ADJUNTOS_PROBLEMAS, { recursive: true });
  const nombreGuardado = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(req.file.originalname)}`;
  moverArchivo(req.file.path, path.join(CARPETA_ADJUNTOS_PROBLEMAS, nombreGuardado));

  const result = await problemasData.agregarAdjunto({
    problema_id: req.params.id, archivo: nombreGuardado, nombre_original: req.file.originalname,
    autor_id: req.usuario.id, autor_nombre: req.usuario.nombre,
  });
  await registrarCambio({
    modulo: 'Problemas', entidad: 'problemas_adjuntos', entidadId: result.lastID, accion: 'Creación',
    detalle: `Evidencia gráfica "${req.file.originalname}" agregada al problema #${req.params.id} — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.status(201).json(await problemasData.obtenerProblemaCompleto(req.params.id));
}));

router.get('/problemas/:id/adjuntos/:adjId', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const adjunto = await problemasData.obtenerAdjunto(req.params.id, req.params.adjId);
  if (!adjunto) return res.status(404).json({ error: 'Adjunto no encontrado' });
  const ruta = path.join(CARPETA_ADJUNTOS_PROBLEMAS, adjunto.archivo);
  if (!fs.existsSync(ruta)) return res.status(404).json({ error: 'El archivo ya no está disponible en el servidor.' });
  res.sendFile(ruta);
}));

router.delete('/problemas/:id/adjuntos/:adjId', validarToken, puedeEliminar, asyncHandler(async (req, res) => {
  const adjunto = await problemasData.obtenerAdjunto(req.params.id, req.params.adjId);
  if (!adjunto) return res.status(404).json({ error: 'Adjunto no encontrado' });
  await problemasData.eliminarAdjunto(req.params.id, req.params.adjId);
  const ruta = path.join(CARPETA_ADJUNTOS_PROBLEMAS, adjunto.archivo);
  if (fs.existsSync(ruta)) fs.unlinkSync(ruta);
  await registrarCambio({
    modulo: 'Problemas', entidad: 'problemas_adjuntos', entidadId: req.params.adjId, accion: 'Eliminación',
    detalle: `Evidencia gráfica "${adjunto.nombre_original || adjunto.archivo}" eliminada del problema #${req.params.id} — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json({ success: true });
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
