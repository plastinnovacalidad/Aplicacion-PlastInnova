const { getDb } = require('../db/connection');

function buscarClientes(q) {
  return getDb().all(
    'SELECT nit, razon_social, codigo_vendedor, nombre_vendedor, ciudad FROM clientes WHERE nit LIKE ? OR razon_social LIKE ? LIMIT 15',
    [`%${q}%`, `%${q}%`]
  );
}

function buscarReferenciasPt(q) {
  return getDb().all(
    'SELECT referencia, linea_base, tipo_circuito FROM referencias_pt WHERE referencia LIKE ? LIMIT 15',
    [`%${q}%`]
  );
}

async function obtenerSiguienteNumeroGarantia() {
  const db = getDb();
  const ultima = await db.get('SELECT no_garantia FROM garantias ORDER BY id DESC LIMIT 1');
  let siguienteNum = 1250;
  if (ultima && ultima.no_garantia) {
    const match = ultima.no_garantia.match(/\d+/);
    if (match) {
      const num = parseInt(match[0], 10);
      siguienteNum = Math.max(1250, num + 1);
    }
  }
  return `G${siguienteNum}`;
}

function listarGarantias() {
  return getDb().all('SELECT * FROM garantias ORDER BY id DESC');
}

function crearGarantia(numGarantia, fechaRep, responsable, vendedorDistribuidor, cliente, nitCliente, ciudad, remision, item, tipoSolicitud, observacionesGeneral, fechaRev, estado, quienApruebaRechazo) {
  return getDb().run(`
    INSERT INTO garantias (
      no_garantia, fecha_reporte, responsable, vendedor_distribuidor, memorando,
      op_pedido, cliente, nit_cliente, ciudad, remision, referencia, cantidad,
      tipo_solicitud, observaciones, fecha_revision, estado, lote_fecha,
      problema, quien_aprobo_rechazo, observacion_calidad, tipo_circuito, fecha_creacion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    numGarantia, fechaRep,
    responsable || '', vendedorDistribuidor || '', '', '',
    cliente || '', nitCliente, ciudad || '', remision || '',
    item.referencia, item.cantidad || 1,
    item.tipo_solicitud || tipoSolicitud || 'GARANTIA', item.observaciones || observacionesGeneral || '',
    fechaRev, estado || 'Pendiente', item.lote_fecha || '',
    item.problema || '', quienApruebaRechazo, '', ''
  ]);
}

function actualizarGarantia(id, estado, tipoSolicitud, cantidad, referencia, loteFecha, problema, observaciones, remision, quienApruebaRechazo) {
  return getDb().run(`
    UPDATE garantias SET
      estado = ?, tipo_solicitud = ?, cantidad = ?, referencia = ?,
      lote_fecha = ?, problema = ?, observaciones = ?, remision = ?,
      quien_aprobo_rechazo = ?
    WHERE id = ?
  `, [
    estado || 'Pendiente', tipoSolicitud || 'GARANTIA', cantidad || 1, referencia || '',
    loteFecha || '', problema || '', observaciones || '', remision || '',
    quienApruebaRechazo || '', id
  ]);
}

function eliminarGarantia(id) {
  return getDb().run('DELETE FROM garantias WHERE id = ?', [id]);
}

// Para el registro de cambios: describir "se editó/eliminó la garantía
// G1300 de Fulano" en vez de solo un ID interno.
function buscarGarantiaPorId(id) {
  return getDb().get('SELECT id, no_garantia, cliente, referencia FROM garantias WHERE id = ?', [id]);
}

// ======================== CATÁLOGO DE CAUSALES (TIPIFICACIÓN) ========================
// Ver migración #7 en db/init.js. Solo se muestran los códigos "Activo" al
// autocompletar (los "Inactivo" quedan guardados, para no romper el
// historial de garantías viejas que ya los usan, pero dejan de ofrecerse
// como opción nueva).
function buscarProblemasCatalogo(q) {
  const db = getDb();
  if (q) {
    return db.all(
      `SELECT id, codigo, descripcion, estado FROM garantias_tipificacion_problemas
       WHERE estado = 'Activo' AND (codigo LIKE ? OR descripcion LIKE ?) ORDER BY codigo LIMIT 20`,
      [`%${q}%`, `%${q}%`]
    );
  }
  return db.all(
    `SELECT id, codigo, descripcion, estado FROM garantias_tipificacion_problemas WHERE estado = 'Activo' ORDER BY codigo LIMIT 50`
  );
}

function listarProblemasCatalogo() {
  return getDb().all('SELECT id, codigo, descripcion, estado FROM garantias_tipificacion_problemas ORDER BY codigo');
}

function crearProblemaCatalogo(codigo, descripcion) {
  return getDb().run(
    'INSERT INTO garantias_tipificacion_problemas (codigo, descripcion) VALUES (?, ?)',
    [codigo, descripcion]
  );
}

function actualizarProblemaCatalogo(id, codigo, descripcion, estado) {
  return getDb().run(
    'UPDATE garantias_tipificacion_problemas SET codigo = ?, descripcion = ?, estado = ? WHERE id = ?',
    [codigo, descripcion, estado, id]
  );
}

function eliminarProblemaCatalogo(id) {
  return getDb().run('DELETE FROM garantias_tipificacion_problemas WHERE id = ?', [id]);
}

// ======================== MODO CONSULTA — CONSULTAS DE GARANTÍAS ========================
// Roadmap Bot WhatsApp, puntos 10 y 11. Reciben la referencia (y, en la
// primera, la cantidad N) ya interpretadas de la frase que escribió la
// persona — extraer esos datos de la frase es su propio punto del roadmap
// (9), todavía pendiente. Estas dos funciones son la mitad "consulta a la
// base de datos": dado un input ya limpio, devuelven el resultado listo
// para formatear la respuesta del bot. La comparación de referencia es sin
// distinguir mayúsculas/minúsculas (LOWER en ambos lados) porque quien
// escribe por WhatsApp no necesariamente respeta el formato exacto del
// código (ej. "sup/1077/rs/mul" en vez de "SUP/1077/RS/MUL").

// Punto 10: últimos/top N registros de garantías de una referencia, con las
// columnas por defecto que define el punto 15 (Fecha Reporte, Referencia,
// Cantidad, Causal/Problema, Estado, Aprobó/Rechazó), del más reciente al
// más antiguo. "n" ya viene con el default de 10 aplicado si la persona no
// pidió una cantidad (ver punto 1 de la planeación).
// "orden" (Roadmap Bot WhatsApp, punto 8 — hallazgo real con Julio, 28/08):
// por defecto trae los N registros MÁS RECIENTES (id DESC). orden='antiguo'
// invierte a ASC, para cuando piden "el primero"/"los más antiguos" en vez
// de "los últimos" — antes no existía esa opción y el bot siempre devolvía
// el más reciente aunque preguntaran por el primero.
function consultarUltimosGarantiasPorReferencia(referencia, n, orden) {
  const direccion = orden === 'antiguo' ? 'ASC' : 'DESC';
  return getDb().all(
    `SELECT fecha_reporte, referencia, cantidad, problema, estado, quien_aprobo_rechazo
     FROM garantias WHERE LOWER(referencia) = LOWER(?) ORDER BY id ${direccion} LIMIT ?`,
    [referencia, n]
  );
}

// Punto 11: porcentaje que representa cada causal (columna "problema",
// guardada como "código - descripción" — ver punto 12) sobre el total de
// garantías de esa referencia, de mayor a menor. Los registros sin causal
// registrado ('' o NULL — pasa con garantías que todavía no se han
// revisado) se agrupan aparte como "Sin causal registrado" en vez de
// descartarse del conteo, para que los porcentajes sigan sumando el 100%
// del total real de esa referencia.
async function consultarPorcentajeCausalPorReferencia(referencia) {
  const filas = await getDb().all(
    `SELECT COALESCE(NULLIF(TRIM(problema), ''), 'Sin causal registrado') AS causal, COUNT(*) AS cantidad
     FROM garantias WHERE LOWER(referencia) = LOWER(?) GROUP BY causal ORDER BY cantidad DESC`,
    [referencia]
  );
  const total = filas.reduce((suma, f) => suma + f.cantidad, 0);
  if (total === 0) return [];
  return filas.map(f => ({
    causal: f.causal,
    cantidad: f.cantidad,
    // Un decimal (ej. 33.3), no más — con conteos chicos por referencia,
    // más decimales solo agregan ruido sin aportar precisión real.
    porcentaje: Math.round((f.cantidad / total) * 1000) / 10,
  }));
}

// Julio pidió un comando fijo, sin tener que escribir una referencia:
// "últimas garantías ingresadas" — las N más recientes de TODAS las
// referencias, no de una sola. Como abarca varias referencias a la vez, se
// incluye la columna Referencia (y Cliente, para ubicar de qué caso se
// trata) además de las columnas por defecto del punto 15.
function consultarUltimasGarantiasIngresadas(n, orden) {
  const direccion = orden === 'antiguo' ? 'ASC' : 'DESC';
  return getDb().all(
    `SELECT fecha_reporte, referencia, cliente, cantidad, problema, estado
     FROM garantias ORDER BY id ${direccion} LIMIT ?`,
    [n]
  );
}

// Confirmado con Julio (28/08, tras el hallazgo de "top 5 de garantías con
// más porcentaje" — resultó ser una pregunta que no existía todavía):
// cuenta cuántas garantías tiene cada referencia, agrupando TODAS las
// garantías (sin filtrar a una referencia puntual), y devuelve las N con
// más casos, de mayor a menor. Sirve para ver qué productos concentran más
// reclamos de garantía en total — distinto del punto 11
// (consultarPorcentajeCausalPorReferencia), que es el % de causales DENTRO
// de una sola referencia ya elegida.
function consultarTopReferenciasConMasGarantias(n) {
  return getDb().all(
    `SELECT referencia, COUNT(*) AS cantidad_garantias
     FROM garantias
     WHERE referencia IS NOT NULL AND TRIM(referencia) != ''
     GROUP BY referencia
     ORDER BY cantidad_garantias DESC
     LIMIT ?`,
    [n]
  );
}

module.exports = {
  buscarClientes,
  buscarReferenciasPt,
  obtenerSiguienteNumeroGarantia,
  listarGarantias,
  crearGarantia,
  actualizarGarantia,
  eliminarGarantia,
  buscarGarantiaPorId,
  buscarProblemasCatalogo,
  listarProblemasCatalogo,
  crearProblemaCatalogo,
  actualizarProblemaCatalogo,
  eliminarProblemaCatalogo,
  consultarUltimosGarantiasPorReferencia,
  consultarPorcentajeCausalPorReferencia,
  consultarUltimasGarantiasIngresadas,
  consultarTopReferenciasConMasGarantias,
};
