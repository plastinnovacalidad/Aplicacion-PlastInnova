const { getDb } = require('../db/connection');

function buscarClientes(q) {
  return getDb().all(
    'SELECT nit, razon_social, codigo_vendedor, nombre_vendedor, ciudad FROM clientes WHERE nit LIKE ? OR razon_social LIKE ? LIMIT 15',
    [`%${q}%`, `%${q}%`]
  );
}

// ======================== TIPO DE CIRCUITO DE UNA GARANTÍA ========================
// Pedido por Julio (17/11/2026). Las garantías cargadas desde el Excel
// anterior (hasta el 06/08/2026) traían el tipo de circuito; las creadas en
// la app desde el 11/08 quedaban vacías y el Tablero de Garantías mostraba
// la referencia completa en su lugar. Regla, en este orden:
//   1. El tipo que ya tienen otras garantías con la misma referencia (así se
//      respeta lo que se usaba en el Excel: 1075C/... -> "1075").
//   2. El tipo de referencias_pt (sin los "#¡VALOR!" que vinieron de Excel).
//      Si es un número con letra (1075C, 1059H) y en las garantías nunca se
//      usó así pero sí el número solo (1075, 1059), se usa el número solo.
//      Los que sí se usan con letra (1075B, 1036H) se dejan con letra.
//   3. Si no está en ninguna: el número de 4 dígitos con que empieza la
//      referencia (1053V/AMAM/MULTI -> 1053), o si no empieza por número, el
//      código completo de la primera parte, como en el Excel para accesorios
//      (AP1060, V1055, INT02).
// resolverTipoCircuito trabaja sobre datos ya cargados (lo usan la
// MIGRACIÓN #55 y scripts/importar_garantias_app.js para muchas filas a la
// vez); tipoCircuitoDeReferencia consulta la base para una sola referencia
// (al crear o editar una garantía).
// Las garantías del Excel anterior se cargaron todas el 06/08/2026 a las
// 12:00; las de después se crearon en la app. Para "el tipo que ya usan otras
// garantías" solo se mira ese historial, así un tipo mal puesto en la app no
// se copia a las siguientes.
const FIN_HISTORIAL_EXCEL = '2026-08-06 12:00:03';

const tipoValido = (t) => { const s = String(t || '').trim(); return s && !s.startsWith('#') ? s : ''; };

function resolverTipoCircuito(referencia, { tipoEnGarantias, tipoEnReferenciasPt, tipoUsado }) {
  const ref = String(referencia || '').trim().toUpperCase();
  if (!ref) return '';
  const deGarantias = tipoValido(tipoEnGarantias(ref));
  if (deGarantias) return deGarantias;
  const dePt = tipoValido(tipoEnReferenciasPt(ref));
  if (dePt) {
    const m = dePt.toUpperCase().match(/^(\d{4})[A-Z]+$/);
    if (m && !tipoUsado(dePt) && tipoUsado(m[1])) return m[1];
    return dePt;
  }
  // Primera parte que tenga un número (REP/4003S/CR -> 4003S -> 4003).
  const partes = ref.split('/');
  const parte = partes.find(p => /\d/.test(p)) || partes[0];
  const num = parte.match(/^\d{4}/);
  return num ? num[0] : parte;
}

// Carga en memoria lo necesario para resolver muchas referencias de una vez.
async function cargarDatosTipoCircuito(db) {
  const enGarantias = new Map();
  for (const r of await db.all(`SELECT UPPER(TRIM(referencia)) AS ref, tipo_circuito AS tipo, COUNT(*) AS n
       FROM garantias WHERE tipo_circuito IS NOT NULL AND tipo_circuito <> '' AND tipo_circuito NOT LIKE '#%'
         AND fecha_creacion <= ?
       GROUP BY UPPER(TRIM(referencia)), tipo_circuito`, [FIN_HISTORIAL_EXCEL])) {
    const previo = enGarantias.get(r.ref);
    if (!previo || r.n > previo.n) enGarantias.set(r.ref, { tipo: r.tipo, n: r.n });
  }
  const usados = new Set((await db.all("SELECT DISTINCT UPPER(tipo_circuito) AS t FROM garantias WHERE tipo_circuito IS NOT NULL AND tipo_circuito <> '' AND fecha_creacion <= ?", [FIN_HISTORIAL_EXCEL])).map(r => r.t));
  const enPt = new Map();
  for (const r of await db.all("SELECT referencia, tipo_circuito FROM referencias_pt WHERE tipo_circuito IS NOT NULL AND tipo_circuito <> '' AND tipo_circuito NOT LIKE '#%'")) {
    const k = String(r.referencia || '').trim().toUpperCase();
    if (k && !enPt.has(k)) enPt.set(k, String(r.tipo_circuito).trim());
  }
  return {
    tipoEnGarantias: (ref) => (enGarantias.get(ref) || {}).tipo,
    tipoEnReferenciasPt: (ref) => enPt.get(ref),
    tipoUsado: (t) => usados.has(String(t).toUpperCase()),
  };
}

async function tipoCircuitoDeReferencia(referencia) {
  const ref = String(referencia || '').trim().toUpperCase();
  if (!ref) return '';
  const db = getDb();
  const hist = await db.get(`SELECT tipo_circuito AS tipo, COUNT(*) AS n FROM garantias
       WHERE UPPER(TRIM(referencia)) = ? AND tipo_circuito IS NOT NULL AND tipo_circuito <> '' AND tipo_circuito NOT LIKE '#%'
         AND fecha_creacion <= ?
       GROUP BY tipo_circuito ORDER BY n DESC LIMIT 1`, [ref, FIN_HISTORIAL_EXCEL]);
  const pt = hist ? null : await db.get("SELECT tipo_circuito FROM referencias_pt WHERE UPPER(referencia) = ? AND tipo_circuito IS NOT NULL AND tipo_circuito <> '' AND tipo_circuito NOT LIKE '#%' LIMIT 1", [ref]);
  const usados = new Map();
  const tipoUsadoAsync = async (t) => {
    if (!usados.has(t)) usados.set(t, !!(await db.get('SELECT 1 AS si FROM garantias WHERE UPPER(tipo_circuito) = UPPER(?) AND fecha_creacion <= ? LIMIT 1', [t, FIN_HISTORIAL_EXCEL])));
    return usados.get(t);
  };
  // Se precalcula lo que la regla 2 pueda preguntar (tipo con letra y sin letra).
  if (pt && pt.tipo_circuito) {
    const t = String(pt.tipo_circuito).trim();
    await tipoUsadoAsync(t.toUpperCase());
    const m = t.toUpperCase().match(/^(\d{4})[A-Z]+$/);
    if (m) await tipoUsadoAsync(m[1]);
  }
  return resolverTipoCircuito(ref, {
    tipoEnGarantias: () => (hist ? hist.tipo : ''),
    tipoEnReferenciasPt: () => (pt ? pt.tipo_circuito : ''),
    tipoUsado: (t) => !!usados.get(String(t).toUpperCase()),
  });
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

async function crearGarantia(numGarantia, fechaRep, responsable, vendedorDistribuidor, cliente, nitCliente, ciudad, remision, item, tipoSolicitud, observacionesGeneral, fechaRev, estado, quienApruebaRechazo) {
  const tipoCircuito = await tipoCircuitoDeReferencia(item.referencia);
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
    item.problema || '', quienApruebaRechazo, '', tipoCircuito
  ]);
}

async function actualizarGarantia(id, estado, tipoSolicitud, cantidad, referencia, loteFecha, problema, observaciones, remision, quienApruebaRechazo) {
  // El tipo de circuito se vuelve a buscar solo si cambió la referencia o si
  // estaba vacío; así no se borra el tipo de las garantías viejas cuya
  // referencia no está en referencias_pt.
  const tipoCircuito = await tipoCircuitoDeReferencia(referencia);
  return getDb().run(`
    UPDATE garantias SET
      tipo_circuito = CASE WHEN COALESCE(referencia, '') <> ? OR COALESCE(tipo_circuito, '') = '' THEN ? ELSE tipo_circuito END,
      estado = ?, tipo_solicitud = ?, cantidad = ?, referencia = ?,
      lote_fecha = ?, problema = ?, observaciones = ?, remision = ?,
      quien_aprobo_rechazo = ?
    WHERE id = ?
  `, [
    referencia || '', tipoCircuito,
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

// FASE 6 (09/09, pedido por Julio): con la FK real de garantias.problema_id
// (Fase 3) y PRAGMA foreign_keys activado, borrar una causal ya usada en
// alguna garantía haría fallar el DELETE con un error de SQLite. Se cuenta
// antes de intentar borrar, para avisar en vez de tirar un error crudo.
function contarGarantiasDeProblema(problemaId) {
  return getDb().get('SELECT COUNT(*) AS total FROM garantias WHERE problema_id = ?', [problemaId]);
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
  FIN_HISTORIAL_EXCEL,
  tipoCircuitoDeReferencia,
  resolverTipoCircuito,
  cargarDatosTipoCircuito,
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
  contarGarantiasDeProblema,
  consultarUltimosGarantiasPorReferencia,
  consultarPorcentajeCausalPorReferencia,
  consultarUltimasGarantiasIngresadas,
  consultarTopReferenciasConMasGarantias,
};
