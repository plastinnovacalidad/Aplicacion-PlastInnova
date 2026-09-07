const { getDb } = require('../db/connection');
const causasRaiz = require('./causasRaiz');

// ======================== TRAZABILIDAD DE SOLUCIONES (TABLERO DE PRODUCCIÓN) ========================
// Módulo pedido por Julio (03/09): registrar causa raíz y solución de los
// problemas que salen en el ranking de "Referencias con mayor % de
// desperdicio" y en "Motivos de rechazo" del tablero de Producción, y
// hacerles seguimiento con el tiempo.
//
// Rediseño del mismo día (antes de que el módulo llegara a usarse en
// producción): ni la causa raíz ni la solución son un solo campo de texto
// -- se pueden ir agregando VARIAS causas raíz y VARIAS medidas/intentos de
// solución, cada una con su propio estado (En_Proceso / Funciono /
// No_Funciono). El estado GENERAL del caso (el que se usa para filtrar la
// bitácora) ya no se marca a mano: se recalcula solo cada vez que se agrega
// una medida o se le cambia el estado (ver recalcularEstadoProblema) --
// Implementado si alguna medida quedó "Funcionó", En_Proceso si tiene
// medidas pero ninguna funcionó todavía, Pendiente si todavía no tiene
// ninguna medida.
//
// Segundo ajuste, mismo día: el "responsable" deja de ser un campo del
// problema en general -- cada causa raíz y cada medida tiene el suyo. La
// columna `responsable` de trazabilidad_problemas queda sin usarse desde
// este archivo (ver MIGRACIÓN #27 en db/init.js).
//
// Tercer ajuste, mismo día: si el problema reaparece y el ÚLTIMO caso para
// ese contexto ya estaba Implementado, ya no se asume solo que la solución
// no sirvió -- se le pregunta al usuario (ver marcarSolucionAnteriorComoFallida
// más abajo y buscarUltimoProblema). Si confirma que falló, esa medida pasa
// a No_Funciono y el caso se reabre solo (mismo id, mismo historial); si dice
// que es un problema distinto, se crea un caso nuevo y el anterior se
// conserva tal cual, como una solución que sí funcionó.
//
// Cuarto ajuste, mismo día (todavía sin uso real del módulo): dos cambios
// juntos, pedidos por Julio al ver el diseño anterior.
//   1) El responsable de una causa/medida ya NO se elige de una lista --
//      siempre es quien esté conectado cuando la agrega (si el
//      administrador agrega una causa raíz, el responsable es él). Por eso
//      responsable_id/responsable_nombre ahora se llenan aquí con los
//      mismos valores que autor_id/autor_nombre (ver MIGRACIÓN #27 en
//      db/init.js -- las columnas quedan, solo cambia quién las llena).
//   2) Las medidas dejan de ser una lista suelta: cada una debe decir a qué
//      causa raíz pertenece (causa_id, ver MIGRACIÓN #28), para que el
//      frontend las muestre agrupadas debajo de su causa ("para esta causa
//      raíz, estas son las medidas que se han intentado") en vez de una
//      sola línea de tiempo mezclada.
//
// Quinto ajuste, mismo día: catálogo de causas raíz posibles, cada una con
// sus medidas posibles ya ligadas (p.ej. "Molde desgastado" trae de una vez
// sus 3 medidas típicas) -- administrado en la pestaña Catálogos de Gestión
// (ver data/trazabilidadCatalogo.js). Al registrar una causa en un caso
// real, causa_catalogo_id (MIGRACIÓN #30) guarda de cuál causa del catálogo
// vino, para poder sugerir sus medidas al agregar una medida después. Si se
// escribe "Otra" (no estaba en el catálogo), routes/produccion.js la agrega
// sola al catálogo antes de guardar la causa, así la próxima vez ya
// aparece en la lista.
//
// Identidad de un "problema": fabrica + tipo_contexto ('referencia' o
// 'motivo') + valor_contexto (el nombre de esa referencia o de ese motivo).
// Mientras un problema para ese mismo contexto siga Pendiente o En_Proceso,
// se reabre y se le siguen agregando causas/medidas sobre esa misma fila.

const ESTADOS_MEDIDA = ['En_Proceso', 'Funciono', 'No_Funciono'];

// Semana ISO-8601 ('YYYY-Www') de una fecha -- Producción no tiene este
// concepto en sus datos (solo agrupa por mes), así que se calcula sola al
// crear el registro, sin que el usuario tenga que escribirla.
function semanaISO(fecha) {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  const diaNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - diaNum);
  const inicioAño = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const numSemana = Math.ceil((((d - inicioAño) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(numSemana).padStart(2, '0')}`;
}

function nowSql() {
  // Mismo formato que usa el resto del esquema para DATETIME
  // (datetime('now','localtime')) -- se calcula en JS para poder usarlo
  // también como valor de parámetro, no solo como default de columna.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function buscarProblemaActivo({ fabrica, tipo_contexto, valor_contexto }) {
  return getDb().get(
    `SELECT * FROM trazabilidad_problemas
     WHERE fabrica = ? AND tipo_contexto = ? AND valor_contexto = ? AND estado != 'Implementado'
     ORDER BY created_at DESC LIMIT 1`,
    [fabrica, tipo_contexto, valor_contexto]
  );
}

// El último caso para este contexto, sin importar su estado -- a diferencia
// de buscarProblemaActivo(), este SÍ puede devolver uno Implementado. Se usa
// cuando no hay caso activo, para saber si hay que preguntar "¿la solución
// anterior no funcionó?" antes de crear uno nuevo (ver
// marcarSolucionAnteriorComoFallida más abajo).
function buscarUltimoProblema({ fabrica, tipo_contexto, valor_contexto }) {
  return getDb().get(
    `SELECT * FROM trazabilidad_problemas
     WHERE fabrica = ? AND tipo_contexto = ? AND valor_contexto = ?
     ORDER BY created_at DESC LIMIT 1`,
    [fabrica, tipo_contexto, valor_contexto]
  );
}

// MIGRACIÓN #37 (07/09, pedido por Julio): las causas/medidas de un caso ya
// no viven en tablas propias de este módulo -- se leen/escriben a través de
// data/causasRaiz.js (tabla compartida con Reportes por Áreas), pasando
// siempre tipoCaso='problema'. Esto es lo que permite que una misma causa
// real se vincule también a un caso de Reportes y comparta medidas con él
// (ver vincularCausa más abajo). La forma en que este archivo devuelve un
// problema (causas[] y medidas[] planas, con causa_id ligando cada medida a
// su causa) NO cambió, para no romper el frontend que ya existía.
async function obtenerProblemaCompleto(id) {
  const db = getDb();
  const problema = await db.get('SELECT * FROM trazabilidad_problemas WHERE id = ?', [id]);
  if (!problema) return null;
  const causas = await causasRaiz.listarCausasDeCaso('problema', id);
  const medidas = await causasRaiz.listarMedidasDeCaso('problema', id);
  return { ...problema, causas, medidas };
}

// Implementado si alguna medida quedó "Funcionó"; En_Proceso si tiene
// medidas pero ninguna funcionó (todavía); Pendiente si no tiene ninguna
// medida. `cerrado_en` se llena/limpia junto con el paso a/desde
// Implementado.
async function recalcularEstadoProblema(problemaId) {
  const db = getDb();
  const medidas = await causasRaiz.listarMedidasDeCaso('problema', problemaId);
  let estado;
  if (medidas.some((m) => m.estado === 'Funciono')) estado = 'Implementado';
  else if (medidas.length > 0) estado = 'En_Proceso';
  else estado = 'Pendiente';

  const actual = await db.get('SELECT estado, cerrado_en FROM trazabilidad_problemas WHERE id = ?', [problemaId]);
  const cerradoEn = estado === 'Implementado' ? (actual.cerrado_en || nowSql()) : null;
  await db.run(
    'UPDATE trazabilidad_problemas SET estado = ?, cerrado_en = ?, actualizado_en = ? WHERE id = ?',
    [estado, cerradoEn, nowSql(), problemaId]
  );
  return estado;
}

// Crea el caso junto con su primera causa raíz (no tiene sentido abrir un
// caso sin decir al menos qué se cree que lo originó) -- el responsable de
// esa causa es automáticamente quien la está registrando (autorId/autorNombre,
// de la sesión), no se elige de una lista. causaCatalogoId liga esta causa
// con la causa del catálogo de la que vino (routes/produccion.js ya la
// resolvió, o la creó sola si era "Otra" -- ver data/trazabilidadCatalogo.js).
async function crearProblema({ fabrica, tipo_contexto, valor_contexto, pct_desperdicio_inicial, causaInicial, causaCatalogoId, autorId, autorNombre }) {
  const db = getDb();
  const semana = semanaISO(new Date());
  const result = await db.run(
    `INSERT INTO trazabilidad_problemas
       (fabrica, tipo_contexto, valor_contexto, semana, pct_desperdicio_inicial, estado, creado_por, creado_por_nombre)
     VALUES (?, ?, ?, ?, ?, 'Pendiente', ?, ?)`,
    [fabrica, tipo_contexto, valor_contexto, semana, pct_desperdicio_inicial ?? null, autorId || null, autorNombre || null]
  );
  const problemaId = result.lastID;
  await causasRaiz.crearCausaParaCaso({
    tipoCaso: 'problema', casoId: problemaId, texto: causaInicial, causaCatalogoId, autorId, autorNombre,
  });
  return obtenerProblemaCompleto(problemaId);
}

async function agregarCausa({ problema_id, texto, causa_catalogo_id, autor_id, autor_nombre }) {
  const db = getDb();
  const existe = await db.get('SELECT id FROM trazabilidad_problemas WHERE id = ?', [problema_id]);
  if (!existe) return null;
  await causasRaiz.crearCausaParaCaso({
    tipoCaso: 'problema', casoId: problema_id, texto, causaCatalogoId: causa_catalogo_id, autorId: autor_id, autorNombre: autor_nombre,
  });
  await db.run('UPDATE trazabilidad_problemas SET actualizado_en = ? WHERE id = ?', [nowSql(), problema_id]);
  return obtenerProblemaCompleto(problema_id);
}

// Vincula una causa YA EXISTENTE (de este mismo caso, de otro caso de
// Producción, o de un Reporte) a este problema -- pedido por Julio (07/09)
// para no duplicar una causa real que ya se está trabajando en el otro
// módulo. A partir de aquí, cualquier medida que se le agregue a esa causa
// (desde cualquiera de los dos lados) cuenta para el estado de este
// problema también. Siempre es una acción explícita del analista, nunca
// automática (ver data/causasRaiz.js).
async function vincularCausa({ problema_id, causa_id, usuario_id, usuario_nombre }) {
  const db = getDb();
  const existe = await db.get('SELECT id FROM trazabilidad_problemas WHERE id = ?', [problema_id]);
  if (!existe) return { error: 'no_encontrado' };
  const resultado = await causasRaiz.vincularCausaExistente({
    tipoCaso: 'problema', casoId: problema_id, causaId: causa_id, usuarioId: usuario_id, usuarioNombre: usuario_nombre,
  });
  if (resultado.error) return resultado;
  await db.run('UPDATE trazabilidad_problemas SET actualizado_en = ? WHERE id = ?', [nowSql(), problema_id]);
  return { problema: await obtenerProblemaCompleto(problema_id) };
}

// causa_id: a qué causa raíz de este mismo problema pertenece la medida --
// el llamador (routes/produccion.js) ya validó que exista y sea de este
// problema antes de llegar aquí.
async function agregarMedida({ problema_id, texto, estado, causa_id, autor_id, autor_nombre }) {
  const db = getDb();
  const existe = await db.get('SELECT id FROM trazabilidad_problemas WHERE id = ?', [problema_id]);
  if (!existe) return null;
  await causasRaiz.agregarMedida({ causaId: causa_id, texto, estado, autorId: autor_id, autorNombre: autor_nombre });
  return obtenerProblemaCompleto(problema_id);
}

// Firma con problemaId (antes solo tomaba medidaId): ahora que una causa se
// puede compartir con un caso de Reportes, hay que confirmar que la medida
// de verdad sea de una causa vinculada a ESTE problema antes de devolverlo
// -- si no, se trata como no encontrada en este caso (aunque la medida sí
// exista, solo que del otro lado).
async function actualizarEstadoMedida(problemaId, medidaId, estado) {
  const resultado = await causasRaiz.actualizarEstadoMedida(medidaId, estado);
  if (resultado.error) return null;
  const vinculo = await causasRaiz.obtenerVinculo('problema', problemaId, resultado.medida.causa_id);
  if (!vinculo) return null;
  return obtenerProblemaCompleto(problemaId);
}

// Sexto ajuste (04/09): Julio pidió poder borrar una causa raíz o una
// medida ya registrada (por ejemplo, si se agregó por error) -- pide su
// propio permiso, 'produccion.trazabilidad.eliminar' (ver
// routes/produccion.js), separado del de agregar
// ('produccion.trazabilidad.gestionar'). Borrar una causa raíz borra
// también sus medidas -- no tendría sentido dejarlas "colgando" sin causa
// raíz, y ya se decidió no volver a permitir eso (ver MIGRACIÓN #31 en
// db/init.js, que borró las que habían quedado sueltas de antes de la
// MIGRACIÓN #28). No se puede dejar un caso sin ninguna causa raíz, así que
// se rechaza borrar la última -- devuelve {error:'ultima_causa'} para que
// el endpoint responda con un mensaje claro en vez de un 500.
// Quita la causa de ESTE caso -- si la causa está compartida con un Reporte
// (u otro caso de Producción), sigue viva ahí con todas sus medidas; solo se
// borra de verdad si este era su único caso (ver eliminarCausaDeCaso en
// data/causasRaiz.js).
async function eliminarCausa(problemaId, causaId) {
  const resultado = await causasRaiz.eliminarCausaDeCaso('problema', problemaId, causaId);
  if (resultado.error) return resultado;
  await getDb().run('UPDATE trazabilidad_problemas SET actualizado_en = ? WHERE id = ?', [nowSql(), problemaId]);
  return { causaEliminada: resultado.causaEliminada, problema: await obtenerProblemaCompleto(problemaId) };
}

async function eliminarMedida(problemaId, medidaId) {
  const db = getDb();
  const medida = await db.get('SELECT * FROM medidas WHERE id = ?', [medidaId]);
  if (!medida) return { error: 'no_encontrada' };
  const vinculo = await causasRaiz.obtenerVinculo('problema', problemaId, medida.causa_id);
  if (!vinculo) return { error: 'no_encontrada' };
  const resultado = await causasRaiz.eliminarMedida(medida.causa_id, medidaId);
  if (resultado.error) return resultado;
  await db.run('UPDATE trazabilidad_problemas SET actualizado_en = ? WHERE id = ?', [nowSql(), problemaId]);
  return { medidaEliminada: resultado.medidaEliminada, problema: await obtenerProblemaCompleto(problemaId) };
}

// El usuario confirmó que la solución del caso anterior (ya Implementado)
// no funcionó: toda medida que estuviera en "Funciono" pasa a "No_Funciono"
// -- tiene que ser TODAS, no solo la más reciente, porque si queda una sola
// en "Funciono" el caso seguiría recalculándose como Implementado. Con eso
// corregido, recalcularEstadoProblema reabre solo el caso (vuelve a
// Pendiente/En_Proceso), sin perder nada de su historial de causas/medidas.
async function marcarSolucionAnteriorComoFallida(problemaId) {
  const db = getDb();
  const existe = await db.get('SELECT id FROM trazabilidad_problemas WHERE id = ?', [problemaId]);
  if (!existe) return null;
  // Recorre las causas vinculadas a ESTE problema y les corrige las medidas
  // en "Funcionó" -- si alguna de esas causas está compartida con un
  // Reporte, ese reporte también se recalcula (recalcularEstadoDeCasosDeCausa
  // avisa a los dos lados), igual que cualquier otro cambio de medida.
  const causas = await causasRaiz.listarCausasDeCaso('problema', problemaId);
  const causaIds = [...new Set(causas.map((c) => c.id))];
  for (const causaId of causaIds) {
    await db.run(
      `UPDATE medidas SET estado = 'No_Funciono', actualizado_en = ? WHERE causa_id = ? AND estado = 'Funciono'`,
      [nowSql(), causaId]
    );
    await causasRaiz.recalcularEstadoDeCasosDeCausa(causaId);
  }
  return obtenerProblemaCompleto(problemaId);
}

// Bitácora completa (módulo aparte "Seguimiento de Producción", ya no una
// pestaña de Producción): todos los casos, filtrables por fábrica y/o
// estado, más recientes primero -- con la última causa raíz y el total de
// causas/medidas para no tener que abrir cada uno solo para ver de qué se
// trata. estado='en_curso' es un filtro especial (no un valor real de la
// columna) para "los que siguen abiertos" -- Pendiente o En_Proceso, que es
// lo que se ve por defecto en ese módulo.
function listarProblemas({ fabrica, estado, limit } = {}) {
  const condiciones = [];
  const params = [];
  if (fabrica) { condiciones.push('p.fabrica = ?'); params.push(fabrica); }
  if (estado === 'en_curso') {
    condiciones.push("p.estado != 'Implementado'");
  } else if (estado) {
    condiciones.push('p.estado = ?'); params.push(estado);
  }
  const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';
  const tope = Math.max(1, Math.min(500, parseInt(limit, 10) || 200));
  params.push(tope);
  return getDb().all(
    `SELECT p.*,
       (SELECT COUNT(*) FROM causas_raiz_casos crc WHERE crc.tipo_caso = 'problema' AND crc.caso_id = p.id) AS total_causas,
       (SELECT COUNT(*) FROM medidas m JOIN causas_raiz_casos crc ON crc.causa_id = m.causa_id WHERE crc.tipo_caso = 'problema' AND crc.caso_id = p.id) AS total_medidas,
       (SELECT cr.texto FROM causas_raiz cr JOIN causas_raiz_casos crc ON crc.causa_id = cr.id WHERE crc.tipo_caso = 'problema' AND crc.caso_id = p.id ORDER BY crc.fecha DESC, cr.id DESC LIMIT 1) AS ultima_causa
     FROM trazabilidad_problemas p
     ${where}
     ORDER BY p.actualizado_en DESC, p.id DESC
     LIMIT ?`,
    params
  );
}

module.exports = {
  ESTADOS_MEDIDA,
  semanaISO,
  nowSql,
  buscarProblemaActivo,
  buscarUltimoProblema,
  obtenerProblemaCompleto,
  recalcularEstadoProblema,
  crearProblema,
  agregarCausa,
  vincularCausa,
  agregarMedida,
  actualizarEstadoMedida,
  eliminarCausa,
  eliminarMedida,
  marcarSolucionAnteriorComoFallida,
  listarProblemas,
};
