const { getDb } = require('../db/connection');

// ======================== CAUSAS RAÍZ Y MEDIDAS (COMPARTIDO) ========================
// MIGRACIÓN #37 (07/09, pedido por Julio): antes, Trazabilidad de Producción
// (trazabilidad_causas/trazabilidad_medidas) y Reportes por Áreas
// (reportes_causas/reportes_medidas) tenían cada uno su propia copia de este
// patrón, sin relación entre sí. Julio pidió que una misma causa real (ej. un
// defecto que se ve tanto en un caso de Producción como en un Reporte de un
// área) se pudiera vincular a los dos casos a la vez y compartir el mismo
// historial de medidas -- así se trabaja desde cualquiera de los dos
// módulos sin duplicar nada.
//
// Modelo: una causa (causas_raiz) ya no cuelga de un solo caso -- puede estar
// vinculada a uno o varios (causas_raiz_casos, tabla puente con tipo_caso
// 'problema'|'reporte' + caso_id). Las medidas (medidas) cuelgan de la causa,
// no del caso -- si una causa está vinculada a dos casos, toda medida que se
// le agregue (y si funcionó o no) se ve igual desde los dos.
//
// La vinculación SIEMPRE es una acción explícita del analista
// (vincularCausaExistente) -- nunca automática solo por coincidir el texto
// del catálogo: el mismo defecto puede tener causas distintas según la
// fábrica/área (ejemplo real de Julio: "I1 Incompleto" es falta de
// verificación en el área Fábrica, pero parámetros de máquina en Inyección),
// así que fusionar solo por catálogo arriesgaría mezclar el seguimiento de
// dos problemas que en realidad no son el mismo.
//
// Este archivo lo usan tanto data/trazabilidadProduccion.js (tipo_caso
// 'problema') como data/reportes.js (tipo_caso 'reporte') -- cada uno sigue
// dueño de SU tabla de casos (trazabilidad_problemas / reportes) y de
// recalcular el estado general de sus propios casos; este archivo solo sabe
// de causas/medidas y de qué casos las tienen vinculadas.

const ESTADOS_MEDIDA = ['En_Proceso', 'Funciono', 'No_Funciono'];
const TIPOS_CASO = ['problema', 'reporte'];

function nowSql() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ======================== LECTURA ========================
async function obtenerCausaPorId(causaId) {
  return getDb().get('SELECT * FROM causas_raiz WHERE id = ?', [causaId]);
}

// Todos los vínculos (caso a caso) de una causa -- para saber si está
// compartida y con quién.
async function obtenerCasosDeCausa(causaId) {
  return getDb().all('SELECT * FROM causas_raiz_casos WHERE causa_id = ? ORDER BY fecha ASC, id ASC', [causaId]);
}

// El vínculo puntual entre una causa y UN caso en concreto, o null si esa
// causa no está (o ya no está) vinculada a ese caso.
async function obtenerVinculo(tipoCaso, casoId, causaId) {
  return getDb().get(
    'SELECT * FROM causas_raiz_casos WHERE causa_id = ? AND tipo_caso = ? AND caso_id = ?',
    [causaId, tipoCaso, casoId]
  );
}

async function contarCausasDeCaso(tipoCaso, casoId) {
  const row = await getDb().get(
    'SELECT COUNT(*) AS total FROM causas_raiz_casos WHERE tipo_caso = ? AND caso_id = ?',
    [tipoCaso, casoId]
  );
  return row.total;
}

// Causas vinculadas a un caso, en el mismo orden en que se fueron agregando.
// Cada causa trae `compartida_con`: los OTROS vínculos que tenga (vacío si
// es exclusiva de este caso) -- el frontend lo usa para mostrar un aviso
// tipo "también vinculada al caso de Producción #12".
async function listarCausasDeCaso(tipoCaso, casoId) {
  const db = getDb();
  const causas = await db.all(
    `SELECT cr.* FROM causas_raiz cr
     JOIN causas_raiz_casos crc ON crc.causa_id = cr.id
     WHERE crc.tipo_caso = ? AND crc.caso_id = ?
     ORDER BY crc.fecha ASC, cr.id ASC`,
    [tipoCaso, casoId]
  );
  for (const causa of causas) {
    const vinculos = await db.all(
      `SELECT tipo_caso, caso_id FROM causas_raiz_casos
       WHERE causa_id = ? AND NOT (tipo_caso = ? AND caso_id = ?)`,
      [causa.id, tipoCaso, casoId]
    );
    causa.compartida_con = vinculos;
  }
  return causas;
}

// Medidas de TODAS las causas vinculadas a un caso -- una causa vinculada a
// más de un caso solo tiene UN vínculo por (tipo_caso, caso_id) gracias al
// UNIQUE de causas_raiz_casos, así que esto nunca duplica medidas dentro de
// un mismo caso.
async function listarMedidasDeCaso(tipoCaso, casoId) {
  return getDb().all(
    `SELECT m.* FROM medidas m
     JOIN causas_raiz_casos crc ON crc.causa_id = m.causa_id
     WHERE crc.tipo_caso = ? AND crc.caso_id = ?
     ORDER BY m.creado_en ASC, m.id ASC`,
    [tipoCaso, casoId]
  );
}

// Buscador para el selector de "vincular causa existente" -- por texto
// (LIKE, sin importar mayúsculas de más ya que SQLite pliega ASCII; para
// tildes no hace falta acá porque es una búsqueda amplia, no una comparación
// exacta como la del catálogo). Cada resultado trae en qué caso(s) ya está,
// para que el analista decida con esa información antes de vincular --
// nunca se sugiere sola, ver el porqué en el comentario de arriba del
// archivo.
async function buscarCausasExistentes({ q, limit } = {}) {
  const db = getDb();
  const tope = Math.max(1, Math.min(50, parseInt(limit, 10) || 20));
  const condiciones = [];
  const params = [];
  if (q && q.trim()) {
    condiciones.push('cr.texto LIKE ?');
    params.push(`%${q.trim()}%`);
  }
  const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';
  params.push(tope);
  const causas = await db.all(
    `SELECT cr.* FROM causas_raiz cr ${where} ORDER BY cr.fecha DESC, cr.id DESC LIMIT ?`,
    params
  );
  for (const causa of causas) {
    causa.casos_vinculados = await obtenerCasosDeCausa(causa.id);
  }
  return causas;
}

// ======================== ESCRITURA ========================
// Crea una causa NUEVA y la deja vinculada de una vez al caso que la
// registró -- el responsable arranca siendo el mismo autor (igual criterio
// que ya tenía cada módulo por separado: no se elige de una lista).
async function crearCausaParaCaso({ tipoCaso, casoId, texto, causaCatalogoId, autorId, autorNombre }) {
  const db = getDb();
  const result = await db.run(
    `INSERT INTO causas_raiz (texto, causa_catalogo_id, autor_id, autor_nombre, responsable_id, responsable_nombre)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [texto, causaCatalogoId || null, autorId || null, autorNombre || null, autorId || null, autorNombre || null]
  );
  const causaId = result.lastID;
  await db.run(
    `INSERT INTO causas_raiz_casos (causa_id, tipo_caso, caso_id, vinculado_por_id, vinculado_por_nombre)
     VALUES (?, ?, ?, ?, ?)`,
    [causaId, tipoCaso, casoId, autorId || null, autorNombre || null]
  );
  return obtenerCausaPorId(causaId);
}

// Vincula una causa YA EXISTENTE (de este mismo módulo o del otro) a un
// caso -- acción explícita del analista, nunca automática (ver comentario de
// arriba del archivo). A partir de aquí ese caso comparte medidas con
// cualquier otro caso que ya tuviera esta misma causa vinculada.
async function vincularCausaExistente({ tipoCaso, casoId, causaId, usuarioId, usuarioNombre }) {
  const db = getDb();
  const causa = await obtenerCausaPorId(causaId);
  if (!causa) return { error: 'causa_no_encontrada' };
  const yaVinculada = await obtenerVinculo(tipoCaso, casoId, causaId);
  if (yaVinculada) return { error: 'ya_vinculada' };
  await db.run(
    `INSERT INTO causas_raiz_casos (causa_id, tipo_caso, caso_id, vinculado_por_id, vinculado_por_nombre)
     VALUES (?, ?, ?, ?, ?)`,
    [causaId, tipoCaso, casoId, usuarioId || null, usuarioNombre || null]
  );
  await recalcularEstadoDeCaso(tipoCaso, casoId);
  return { causa };
}

// Quita el vínculo de una causa con ESTE caso puntual (no borra la causa en
// sí mientras siga vinculada a algún otro caso -- ahí sigue viva para ese
// otro). Si al quitar este vínculo la causa se queda sin ningún caso, recién
// ahí se borra por completo junto con sus medidas -- mismo criterio de "no
// dejar nada suelto" que ya tenía cada módulo por separado. No se puede
// dejar un caso sin ninguna causa raíz (se rechaza quitar la última).
async function eliminarCausaDeCaso(tipoCaso, casoId, causaId) {
  const db = getDb();
  const vinculo = await obtenerVinculo(tipoCaso, casoId, causaId);
  if (!vinculo) return { error: 'no_encontrada' };
  const total = await contarCausasDeCaso(tipoCaso, casoId);
  if (total <= 1) return { error: 'ultima_causa' };
  const causa = await obtenerCausaPorId(causaId);
  await db.run('DELETE FROM causas_raiz_casos WHERE id = ?', [vinculo.id]);
  const otros = await db.get('SELECT COUNT(*) AS total FROM causas_raiz_casos WHERE causa_id = ?', [causaId]);
  if (otros.total === 0) {
    await db.run('DELETE FROM medidas WHERE causa_id = ?', [causaId]);
    await db.run('DELETE FROM causas_raiz WHERE id = ?', [causaId]);
  }
  await recalcularEstadoDeCaso(tipoCaso, casoId);
  return { causaEliminada: causa };
}

async function agregarMedida({ causaId, texto, estado, autorId, autorNombre }) {
  const db = getDb();
  const causa = await obtenerCausaPorId(causaId);
  if (!causa) return { error: 'causa_no_encontrada' };
  const estadoFinal = estado && ESTADOS_MEDIDA.includes(estado) ? estado : 'En_Proceso';
  const result = await db.run(
    `INSERT INTO medidas (causa_id, texto, estado, autor_id, autor_nombre, responsable_id, responsable_nombre)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [causaId, texto, estadoFinal, autorId || null, autorNombre || null, autorId || null, autorNombre || null]
  );
  await recalcularEstadoDeCasosDeCausa(causaId);
  return { medidaId: result.lastID };
}

async function actualizarEstadoMedida(medidaId, estado) {
  const db = getDb();
  const medida = await db.get('SELECT * FROM medidas WHERE id = ?', [medidaId]);
  if (!medida) return { error: 'no_encontrada' };
  await db.run('UPDATE medidas SET estado = ?, actualizado_en = ? WHERE id = ?', [estado, nowSql(), medidaId]);
  await recalcularEstadoDeCasosDeCausa(medida.causa_id);
  return { medida };
}

async function eliminarMedida(causaId, medidaId) {
  const db = getDb();
  const medida = await db.get('SELECT * FROM medidas WHERE id = ? AND causa_id = ?', [medidaId, causaId]);
  if (!medida) return { error: 'no_encontrada' };
  await db.run('DELETE FROM medidas WHERE id = ?', [medidaId]);
  await recalcularEstadoDeCasosDeCausa(causaId);
  return { medidaEliminada: medida };
}

// ======================== RECÁLCULO DE ESTADO ========================
// El estado general (Pendiente/En_Proceso/Implementado) es un concepto DE
// CADA CASO, no de la causa -- y cada módulo (Producción/Reportes) sabe
// actualizar SU propia tabla de casos. Por eso el recálculo real vive en
// data/trazabilidadProduccion.js (recalcularEstadoProblema) y en
// data/reportes.js (recalcularEstadoReporte); aquí solo se les avisa cuál
// caso recalcular.
//
// El require() es a propósito DENTRO de la función (no arriba del archivo):
// trazabilidadProduccion.js y reportes.js ya requieren este archivo arriba
// del suyo -- si este archivo los requiriera también arriba, se formaría un
// ciclo y alguno de los dos quedaría a medio cargar (sus exports llegarían
// vacíos). Pidiéndolo solo cuando la función se ejecuta, los dos módulos ya
// están completamente cargados y no hay problema.
async function recalcularEstadoDeCaso(tipoCaso, casoId) {
  if (tipoCaso === 'problema') {
    await require('./trazabilidadProduccion').recalcularEstadoProblema(casoId);
  } else if (tipoCaso === 'reporte') {
    await require('./reportes').recalcularEstadoReporte(casoId);
  }
}

// Recalcula TODOS los casos que tengan esta causa vinculada -- se usa cada
// vez que cambian las medidas de la causa (agregar/editar/borrar), porque
// eso puede afectar el estado de más de un caso a la vez si la causa está
// compartida.
async function recalcularEstadoDeCasosDeCausa(causaId) {
  const casos = await obtenerCasosDeCausa(causaId);
  for (const { tipo_caso, caso_id } of casos) {
    await recalcularEstadoDeCaso(tipo_caso, caso_id);
  }
}

module.exports = {
  ESTADOS_MEDIDA,
  TIPOS_CASO,
  nowSql,
  obtenerCausaPorId,
  obtenerCasosDeCausa,
  obtenerVinculo,
  contarCausasDeCaso,
  listarCausasDeCaso,
  listarMedidasDeCaso,
  buscarCausasExistentes,
  crearCausaParaCaso,
  vincularCausaExistente,
  eliminarCausaDeCaso,
  agregarMedida,
  actualizarEstadoMedida,
  eliminarMedida,
  recalcularEstadoDeCaso,
  recalcularEstadoDeCasosDeCausa,
};
