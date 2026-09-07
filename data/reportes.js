const { getDb } = require('../db/connection');
const causasRaiz = require('./causasRaiz');

// ======================== REPORTES POR ÁREAS ========================
// Módulo pedido por Julio (04/09): 3 tipos de reporte en UNA sola tabla
// `reportes` con columna `tipo` ('rapido' | 'completo' | 'informativo') --
// mismo criterio que trazabilidad_problemas ya usa con `tipo_contexto` para
// dos formas del mismo concepto (ver MIGRACIÓN #33 en db/init.js para el
// porqué completo).
//
// "Escalar" un Reporte Rápido a Completo es solo UPDATE reportes SET
// tipo='completo' -- mismo id, mismo autor, misma fecha de creación, mismos
// adjuntos. A partir de ahí usa exactamente el mismo patrón de causas raíz +
// medidas (con estado que se recalcula solo) que ya tiene Trazabilidad de
// Producción, pero en tablas propias de este módulo (reportes_causas/
// reportes_medidas) -- Julio prefirió no mezclar problemas de otras áreas
// con los de Producción (fábrica/referencia/motivo son otro dominio).
//
// El responsable de cada causa/medida es automáticamente quien la agrega
// (autor_id/autor_nombre = responsable_id/responsable_nombre) -- mismo
// ajuste que Julio ya pidió para Trazabilidad de Producción: no se elige de
// una lista.
const ESTADOS_MEDIDA = ['En_Proceso', 'Funciono', 'No_Funciono'];
const URGENCIAS = ['Baja', 'Media', 'Alta', 'Critica'];
const TIPOS_REPORTE = ['rapido', 'completo', 'informativo'];

function nowSql() {
  // Mismo formato que usa el resto del esquema para DATETIME
  // (datetime('now','localtime')) -- se calcula en JS para poder usarlo
  // también como valor de parámetro, no solo como default de columna.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ======================== ÁREAS (catálogo reusado de iso_areas) ========================
// Reusa el catálogo "Áreas de Inspección" (Gestión -> Catálogos) tal cual --
// Julio pidió no duplicar un catálogo nuevo. Solo se ofrecen las Activas al
// elegir área en un reporte nuevo; una ya usada en un reporte viejo que
// después se desactivó se sigue mostrando en el detalle de ESE reporte (el
// nombre queda guardado por el JOIN, no se pierde).
function listarAreasActivas() {
  return getDb().all(`SELECT id, nombre, encargado FROM iso_areas WHERE estado = 'Activo' ORDER BY nombre`);
}

// ======================== "EL PROBLEMA" (catálogo de defectos reusado de Muestreos ISO 2859) ========================
// Pedido por Julio (07/09): al hacer un Reporte Completo, "el problema" se
// elige del mismo catálogo de defectos que ya administra Muestreos ISO 2859
// (iso_tipificacion_defectos) -- no se duplica un catálogo de "problemas"
// aparte. Solo se ofrecen los Activos al elegir uno nuevo (igual que con las
// áreas); uno ya usado en un reporte viejo que después se desactivó se sigue
// mostrando en el detalle de ESE reporte (el nombre queda guardado por el
// JOIN, no se pierde).
function listarDefectosActivos() {
  return getDb().all(`SELECT id, codigo, descripcion FROM iso_tipificacion_defectos WHERE estado = 'Activo' ORDER BY codigo`);
}

// ======================== RÁPIDOS RECIENTES (para el asistente de Reporte Completo) ========================
// Pedido por Julio (07/09): al iniciar un Reporte Completo, antes de nada
// pregunta si ya existe un Rápido de esto -- si dice que sí, se le muestra
// esta lista para elegir uno y autocompletar sus datos. Solo los que siguen
// 'Pendiente' tiene sentido ofrecer (uno "Revisado" ya se cerró sin escalar,
// y uno que ya es 'completo' ya dejó de ser un Rápido).
function listarRapidosRecientesPendientes({ limit } = {}) {
  const tope = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
  return getDb().all(
    `SELECT r.id, r.area_origen_id, a.nombre AS area_origen_nombre, r.referencia, r.lote, r.urgencia, r.descripcion, r.created_at
     FROM reportes r LEFT JOIN iso_areas a ON a.id = r.area_origen_id
     WHERE r.tipo = 'rapido' AND r.estado = 'Pendiente'
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ?`,
    [tope]
  );
}

// ======================== LISTADO Y DETALLE ========================
function listarReportes({ tipo, estado, area_id, urgencia, q, limit } = {}) {
  const condiciones = [];
  const params = [];
  if (tipo && TIPOS_REPORTE.includes(tipo)) { condiciones.push('r.tipo = ?'); params.push(tipo); }
  if (estado) { condiciones.push('r.estado = ?'); params.push(estado); }
  if (area_id) { condiciones.push('r.area_origen_id = ?'); params.push(area_id); }
  if (urgencia) { condiciones.push('r.urgencia = ?'); params.push(urgencia); }
  if (q) {
    condiciones.push('(r.referencia LIKE ? OR r.lote LIKE ? OR r.titulo LIKE ? OR r.descripcion LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';
  const tope = Math.max(1, Math.min(500, parseInt(limit, 10) || 200));
  params.push(tope);
  return getDb().all(
    `SELECT r.*, a.nombre AS area_origen_nombre, a.encargado AS area_origen_encargado,
       d.codigo AS defecto_codigo, d.descripcion AS defecto_descripcion,
       (SELECT COUNT(*) FROM causas_raiz_casos crc WHERE crc.tipo_caso = 'reporte' AND crc.caso_id = r.id) AS total_causas,
       (SELECT COUNT(*) FROM medidas m JOIN causas_raiz_casos crc ON crc.causa_id = m.causa_id WHERE crc.tipo_caso = 'reporte' AND crc.caso_id = r.id) AS total_medidas,
       (SELECT COUNT(*) FROM reportes_adjuntos ad WHERE ad.reporte_id = r.id) AS total_adjuntos,
       (SELECT GROUP_CONCAT(ai.nombre, ', ') FROM reportes_destinos rd JOIN iso_areas ai ON ai.id = rd.area_id WHERE rd.reporte_id = r.id) AS areas_destino_nombres
     FROM reportes r
     LEFT JOIN iso_areas a ON a.id = r.area_origen_id
     LEFT JOIN iso_tipificacion_defectos d ON d.id = r.defecto_id
     ${where}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ?`,
    params
  );
}

async function obtenerReporteCompleto(id) {
  const db = getDb();
  const reporte = await db.get(
    `SELECT r.*, a.nombre AS area_origen_nombre, a.encargado AS area_origen_encargado,
       d.codigo AS defecto_codigo, d.descripcion AS defecto_descripcion
     FROM reportes r
     LEFT JOIN iso_areas a ON a.id = r.area_origen_id
     LEFT JOIN iso_tipificacion_defectos d ON d.id = r.defecto_id
     WHERE r.id = ?`,
    [id]
  );
  if (!reporte) return null;
  // MIGRACIÓN #37 (07/09, pedido por Julio): causas/medidas ya no viven en
  // tablas propias de este módulo -- se leen a través de data/causasRaiz.js
  // (tabla compartida con Trazabilidad de Producción), con tipoCaso='reporte'.
  // Esto es lo que permite que una misma causa real se vincule también a un
  // caso de Producción y comparta medidas con él (ver vincularCausa más
  // abajo). La forma en que un reporte devuelve causas[]/medidas[] no
  // cambió, para no romper el frontend que ya existía.
  const causas = await causasRaiz.listarCausasDeCaso('reporte', id);
  const medidas = await causasRaiz.listarMedidasDeCaso('reporte', id);
  const adjuntos = await db.all('SELECT * FROM reportes_adjuntos WHERE reporte_id = ? ORDER BY fecha ASC, id ASC', [id]);
  const destinos = await db.all(
    `SELECT ai.id, ai.nombre FROM reportes_destinos rd JOIN iso_areas ai ON ai.id = rd.area_id WHERE rd.reporte_id = ? ORDER BY ai.nombre`,
    [id]
  );
  return { ...reporte, causas, medidas, adjuntos, destinos };
}

// ======================== CREAR ========================
// Reporte Rápido: incidencia inmediata, sin causa raíz todavía -- solo
// registra el hecho. `estado` arranca en 'Pendiente' (ver comentario de
// arriba de este archivo sobre los 2 estados posibles de un rápido).
async function crearReporteRapido({ area_origen_id, referencia, lote, urgencia, descripcion, autorId, autorNombre }) {
  const db = getDb();
  const urgenciaFinal = URGENCIAS.includes(urgencia) ? urgencia : 'Media';
  const result = await db.run(
    `INSERT INTO reportes (tipo, area_origen_id, referencia, lote, urgencia, descripcion, estado, autor_id, autor_nombre)
     VALUES ('rapido', ?, ?, ?, ?, ?, 'Pendiente', ?, ?)`,
    [area_origen_id || null, referencia || null, lote || null, urgenciaFinal, descripcion, autorId || null, autorNombre || null]
  );
  return obtenerReporteCompleto(result.lastID);
}

// Reporte Informativo: boletín entre áreas, sin causa raíz ni urgencia --
// `areasDestino` es un arreglo de ids de iso_areas (multi-selección).
async function crearReporteInformativo({ area_origen_id, titulo, contenido, fecha_vigencia, areasDestino, autorId, autorNombre }) {
  const db = getDb();
  const result = await db.run(
    `INSERT INTO reportes (tipo, area_origen_id, titulo, descripcion, fecha_vigencia, autor_id, autor_nombre)
     VALUES ('informativo', ?, ?, ?, ?, ?, ?)`,
    [area_origen_id || null, titulo, contenido, fecha_vigencia || null, autorId || null, autorNombre || null]
  );
  const reporteId = result.lastID;
  for (const areaId of areasDestino || []) {
    await db.run('INSERT OR IGNORE INTO reportes_destinos (reporte_id, area_id) VALUES (?, ?)', [reporteId, areaId]);
  }
  return obtenerReporteCompleto(reporteId);
}

// ======================== EDITAR (pedido por Julio, 07/09) ========================
// "Poder editarlos después de que los creemos" -- sin importar el estado
// (Pendiente/Revisado/En_Proceso/Implementado) ni cuándo se hizo. `cambios`
// solo trae las claves que de verdad se quieren cambiar (mismo criterio que
// el PUT de usuarios/áreas: comparar con undefined, no con falsy, para poder
// borrar un campo opcional a propósito). `areasDestino`, si viene, reemplaza
// la lista completa de destinos de un Informativo.
async function actualizarReporte(id, cambios) {
  const db = getDb();
  const reporte = await db.get('SELECT * FROM reportes WHERE id = ?', [id]);
  if (!reporte) return { error: 'no_encontrado' };

  const sets = [];
  const vals = [];
  if (cambios.area_origen_id !== undefined) { sets.push('area_origen_id = ?'); vals.push(cambios.area_origen_id || null); }
  if (reporte.tipo === 'informativo') {
    if (cambios.titulo !== undefined) { sets.push('titulo = ?'); vals.push(cambios.titulo); }
    if (cambios.contenido !== undefined) { sets.push('descripcion = ?'); vals.push(cambios.contenido); }
    if (cambios.fecha_vigencia !== undefined) { sets.push('fecha_vigencia = ?'); vals.push(cambios.fecha_vigencia || null); }
  } else {
    if (cambios.urgencia !== undefined) { sets.push('urgencia = ?'); vals.push(cambios.urgencia || null); }
    if (cambios.referencia !== undefined) { sets.push('referencia = ?'); vals.push(cambios.referencia || null); }
    if (cambios.lote !== undefined) { sets.push('lote = ?'); vals.push(cambios.lote || null); }
    if (cambios.descripcion !== undefined) { sets.push('descripcion = ?'); vals.push(cambios.descripcion); }
    // "El problema" (defecto_id) -- pedido por Julio (07/09, segunda vuelta):
    // antes solo se podía elegir al escalar desde el asistente nuevo; ahora
    // también se puede poner/cambiar/quitar desde Editar, para los reportes
    // que se escalaron por el botón rápido del detalle (ese todavía no lo
    // pedía) o que se quieran corregir después. Cambiar esto NO reetiqueta
    // las causas que el reporte ya tenía -- solo afecta con qué problema se
    // ligan las causas que se agreguen de aquí en adelante.
    if (cambios.defecto_id !== undefined) { sets.push('defecto_id = ?'); vals.push(cambios.defecto_id || null); }
  }
  if (sets.length === 0 && !Array.isArray(cambios.areasDestino)) return { error: 'nada_que_actualizar' };

  if (sets.length > 0) {
    sets.push('actualizado_en = ?');
    vals.push(nowSql());
    vals.push(id);
    await db.run(`UPDATE reportes SET ${sets.join(', ')} WHERE id = ?`, vals);
  }

  if (reporte.tipo === 'informativo' && Array.isArray(cambios.areasDestino)) {
    await db.run('DELETE FROM reportes_destinos WHERE reporte_id = ?', [id]);
    for (const areaId of cambios.areasDestino) {
      await db.run('INSERT OR IGNORE INTO reportes_destinos (reporte_id, area_id) VALUES (?, ?)', [id, areaId]);
    }
  }

  return { reporte: await obtenerReporteCompleto(id) };
}

// ======================== ESTADO (Rápido/Completo) ========================
// Implementado si alguna medida quedó "Funcionó"; En_Proceso si tiene
// medidas pero ninguna funcionó (todavía); Pendiente si no tiene ninguna
// medida -- mismo criterio exacto que trazabilidad_problemas. Solo aplica a
// reportes tipo='completo' (a un 'rapido' nunca se le llama esto, porque
// todavía no tiene causas/medidas).
async function recalcularEstadoReporte(reporteId) {
  const db = getDb();
  const medidas = await causasRaiz.listarMedidasDeCaso('reporte', reporteId);
  let estado;
  if (medidas.some((m) => m.estado === 'Funciono')) estado = 'Implementado';
  else if (medidas.length > 0) estado = 'En_Proceso';
  else estado = 'Pendiente';
  await db.run('UPDATE reportes SET estado = ?, actualizado_en = ? WHERE id = ?', [estado, nowSql(), reporteId]);
  return estado;
}

// Cierra un Reporte Rápido SIN escalarlo (se revisó y no ameritaba causa
// raíz). Solo tiene sentido si sigue 'Pendiente' -- uno ya escalado (tipo ya
// es 'completo') no pasa por aquí.
async function marcarComoRevisado(reporteId) {
  const db = getDb();
  const reporte = await db.get(`SELECT * FROM reportes WHERE id = ?`, [reporteId]);
  if (!reporte) return { error: 'no_encontrado' };
  if (reporte.tipo !== 'rapido') return { error: 'no_es_rapido' };
  await db.run(`UPDATE reportes SET estado = 'Revisado', actualizado_en = ? WHERE id = ?`, [nowSql(), reporteId]);
  return { reporte: await obtenerReporteCompleto(reporteId) };
}

// Escala un Reporte Rápido a Completo: cambia el tipo y crea su primera
// causa raíz (no tiene sentido escalar sin decir al menos qué se cree que
// lo originó) -- mismo criterio que crearProblema() en Trazabilidad de
// Producción. El estado pasa a recalcularse con el criterio de
// causas/medidas (arranca en 'Pendiente', que es lo que da una causa recién
// creada sin medidas todavía).
// `defectoId` es "el problema" elegido (catálogo de defectos de Muestreos
// ISO 2859, ver listarDefectosActivos) -- opcional porque escalar desde el
// detalle de un Rápido (botón directo, sin pasar por el asistente nuevo)
// sigue funcionando sin elegir uno. `causaCatalogoId` liga la primera causa
// al catálogo compartido con Seguimiento de Producción si se eligió de la
// lista (ver resolverCausaConCatalogo en routes/reportes.js); si es null,
// queda como texto suelto (o el propio backend ya la agregó al catálogo
// antes de llamar aquí).
async function escalarAReporteCompleto(reporteId, { causaInicial, causaCatalogoId, defectoId, descripcion, autorId, autorNombre }) {
  const db = getDb();
  const reporte = await db.get(`SELECT * FROM reportes WHERE id = ?`, [reporteId]);
  if (!reporte) return { error: 'no_encontrado' };
  if (reporte.tipo !== 'rapido') return { error: 'no_es_rapido' };
  // `descripcion` es opcional -- pedido por Julio (07/09): al escalar
  // reusando un Rápido ya existente, el wizard deja seguir editando la
  // observación antes de guardar. Si no se manda (o llega vacía), se deja
  // la que ya tenía (COALESCE(NULLIF(?, ''), descripcion)).
  await db.run(
    `UPDATE reportes SET tipo = 'completo', defecto_id = COALESCE(?, defecto_id), descripcion = COALESCE(NULLIF(?, ''), descripcion), actualizado_en = ? WHERE id = ?`,
    [defectoId || null, descripcion || '', nowSql(), reporteId]
  );
  await causasRaiz.crearCausaParaCaso({
    tipoCaso: 'reporte', casoId: reporteId, texto: causaInicial, causaCatalogoId, autorId, autorNombre,
  });
  await recalcularEstadoReporte(reporteId);
  return { reporte: await obtenerReporteCompleto(reporteId) };
}

async function agregarCausa({ reporte_id, texto, causa_catalogo_id, autor_id, autor_nombre }) {
  const db = getDb();
  const reporte = await db.get('SELECT id, tipo FROM reportes WHERE id = ?', [reporte_id]);
  if (!reporte) return { error: 'no_encontrado' };
  if (reporte.tipo !== 'completo') return { error: 'no_es_completo' };
  await causasRaiz.crearCausaParaCaso({
    tipoCaso: 'reporte', casoId: reporte_id, texto, causaCatalogoId: causa_catalogo_id, autorId: autor_id, autorNombre: autor_nombre,
  });
  await db.run('UPDATE reportes SET actualizado_en = ? WHERE id = ?', [nowSql(), reporte_id]);
  return { reporte: await obtenerReporteCompleto(reporte_id) };
}

// Vincula una causa YA EXISTENTE (de este mismo reporte, de otro reporte, o
// de un caso de Trazabilidad de Producción) a este reporte -- pedido por
// Julio (07/09) para no duplicar una causa real que ya se está trabajando
// en el otro módulo. Siempre explícito, nunca automático (ver
// data/causasRaiz.js).
async function vincularCausa({ reporte_id, causa_id, usuario_id, usuario_nombre }) {
  const db = getDb();
  const reporte = await db.get('SELECT id, tipo FROM reportes WHERE id = ?', [reporte_id]);
  if (!reporte) return { error: 'no_encontrado' };
  if (reporte.tipo !== 'completo') return { error: 'no_es_completo' };
  const resultado = await causasRaiz.vincularCausaExistente({
    tipoCaso: 'reporte', casoId: reporte_id, causaId: causa_id, usuarioId: usuario_id, usuarioNombre: usuario_nombre,
  });
  if (resultado.error) return resultado;
  await db.run('UPDATE reportes SET actualizado_en = ? WHERE id = ?', [nowSql(), reporte_id]);
  return { reporte: await obtenerReporteCompleto(reporte_id) };
}

async function agregarMedida({ reporte_id, texto, estado, causa_id, autor_id, autor_nombre }) {
  const db = getDb();
  const reporte = await db.get('SELECT id, tipo FROM reportes WHERE id = ?', [reporte_id]);
  if (!reporte) return { error: 'no_encontrado' };
  if (reporte.tipo !== 'completo') return { error: 'no_es_completo' };
  const vinculo = await causasRaiz.obtenerVinculo('reporte', reporte_id, causa_id);
  if (!vinculo) return { error: 'causa_no_encontrada' };
  const resultado = await causasRaiz.agregarMedida({ causaId: causa_id, texto, estado, autorId: autor_id, autorNombre: autor_nombre });
  if (resultado.error) return resultado;
  return { reporte: await obtenerReporteCompleto(reporte_id) };
}

// Firma con reporteId (antes solo tomaba medidaId): ahora que una causa se
// puede compartir con un caso de Producción, hay que confirmar que la
// medida de verdad sea de una causa vinculada a ESTE reporte antes de
// devolverlo -- si no, se trata como no encontrada en este reporte.
async function actualizarEstadoMedida(reporteId, medidaId, estado) {
  const resultado = await causasRaiz.actualizarEstadoMedida(medidaId, estado);
  if (resultado.error) return { error: 'no_encontrada' };
  const vinculo = await causasRaiz.obtenerVinculo('reporte', reporteId, resultado.medida.causa_id);
  if (!vinculo) return { error: 'no_encontrada' };
  return { reporte: await obtenerReporteCompleto(reporteId) };
}

// No se puede dejar un Reporte Completo sin ninguna causa raíz -- mismo
// criterio y mismo mensaje de error que Trazabilidad de Producción. Si la
// causa está compartida con un caso de Producción, sigue viva ahí (ver
// eliminarCausaDeCaso en data/causasRaiz.js); solo se borra de verdad si
// este reporte era su único caso.
async function eliminarCausa(reporteId, causaId) {
  const resultado = await causasRaiz.eliminarCausaDeCaso('reporte', reporteId, causaId);
  if (resultado.error) return resultado;
  await getDb().run('UPDATE reportes SET actualizado_en = ? WHERE id = ?', [nowSql(), reporteId]);
  return { causaEliminada: resultado.causaEliminada, reporte: await obtenerReporteCompleto(reporteId) };
}

async function eliminarMedida(reporteId, medidaId) {
  const db = getDb();
  const medida = await db.get('SELECT * FROM medidas WHERE id = ?', [medidaId]);
  if (!medida) return { error: 'no_encontrada' };
  const vinculo = await causasRaiz.obtenerVinculo('reporte', reporteId, medida.causa_id);
  if (!vinculo) return { error: 'no_encontrada' };
  const resultado = await causasRaiz.eliminarMedida(medida.causa_id, medidaId);
  if (resultado.error) return resultado;
  await db.run('UPDATE reportes SET actualizado_en = ? WHERE id = ?', [nowSql(), reporteId]);
  return { medidaEliminada: resultado.medidaEliminada, reporte: await obtenerReporteCompleto(reporteId) };
}

// ======================== ADJUNTOS ========================
function agregarAdjunto({ reporte_id, archivo, nombre_original, autor_id, autor_nombre }) {
  return getDb().run(
    `INSERT INTO reportes_adjuntos (reporte_id, archivo, nombre_original, autor_id, autor_nombre) VALUES (?, ?, ?, ?, ?)`,
    [reporte_id, archivo, nombre_original || null, autor_id || null, autor_nombre || null]
  );
}

function obtenerAdjunto(reporteId, adjuntoId) {
  return getDb().get('SELECT * FROM reportes_adjuntos WHERE id = ? AND reporte_id = ?', [adjuntoId, reporteId]);
}

function eliminarAdjunto(reporteId, adjuntoId) {
  return getDb().run('DELETE FROM reportes_adjuntos WHERE id = ? AND reporte_id = ?', [adjuntoId, reporteId]);
}

module.exports = {
  ESTADOS_MEDIDA,
  URGENCIAS,
  TIPOS_REPORTE,
  listarAreasActivas,
  listarDefectosActivos,
  listarRapidosRecientesPendientes,
  listarReportes,
  obtenerReporteCompleto,
  crearReporteRapido,
  crearReporteInformativo,
  actualizarReporte,
  marcarComoRevisado,
  escalarAReporteCompleto,
  recalcularEstadoReporte,
  agregarCausa,
  vincularCausa,
  agregarMedida,
  actualizarEstadoMedida,
  eliminarCausa,
  eliminarMedida,
  agregarAdjunto,
  obtenerAdjunto,
  eliminarAdjunto,
};
