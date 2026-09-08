const { getDb } = require('../db/connection');

// ======================== PRODUCCIÓN: RECHAZOS, LOTES Y ENTREGAS POR FÁBRICA ========================
// Datos sincronizados desde Calidad.xlsx / Lotes.xlsx / Produccion.xlsx por
// scripts/sincronizar_produccion.js (cada 6 horas).
//
// Modelo de datos (actualizado 01/09, ver MIGRACIÓN #22 en db/init.js para la
// historia completa de por qué cambió):
//   - rechazos_produccion: una fila por rechazo, con fábrica y el lote de
//     producción del que salió (columna lote_produccion).
//   - lotes: tabla de solo consulta (No_Lote -> Referencia/Color/Voltaje/
//     Código) — NO tiene cantidad ni fábrica.
//   - entregas_produccion: una fila por cada paso del lote por una operación
//     del proceso (Preensamble/Ensamble/Resina/Calidad...), CON fábrica. La
//     cantidad buena final de un lote es la suma de sus filas en la
//     operación "Calidad" (sin importar mayúsculas) — verificado contra los
//     datos reales que un mismo lote reparte la misma cantidad en varias
//     filas según cómo se fue entregando por partes, no que cada operación
//     sea un total independiente.
//
// Por eso ahora SÍ se puede calcular un % de desperdicio real POR FÁBRICA
// (antes solo se podía calcular a nivel de toda la planta, porque la vieja
// lotes_produccion no traía fábrica).

function ultimosMeses(cantidad) {
  const hoy = new Date();
  const claves = [];
  for (let i = cantidad - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    claves.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return claves;
}

function clampMeses(meses, porDefecto = 12, maximo = 24) {
  return Math.max(1, Math.min(maximo, parseInt(meses, 10) || porDefecto));
}

// Lista de claves 'YYYY-MM' de cada mes calendario entre desde y hasta
// (ambos incluidos) -- extraído de obtenerBuenoVsMaloPorMes porque ahora lo
// necesita también obtenerRechazosPorMesFiltrado, para que las dos
// gráficas mensuales (la normal y la de un motivo/línea específicos)
// siempre muestren exactamente los mismos meses en el eje X.
function mesesEntre(desde, hasta) {
  const dInicio = new Date(desde);
  const dFin = new Date(hasta);
  const claves = [];
  let cur = new Date(dInicio.getFullYear(), dInicio.getMonth(), 1);
  while (cur <= dFin) {
    claves.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  if (claves.length === 0) claves.push(desde.substring(0, 7));
  return claves;
}

function construirFiltroFecha(campoFecha, meses, desde, hasta) {
  const params = [];
  let sql = '';
  if (desde && hasta) {
    sql = `${campoFecha} >= ? AND ${campoFecha} <= ?`;
    params.push(desde, hasta);
  } else {
    const cantidadMeses = clampMeses(meses);
    const claves = ultimosMeses(cantidadMeses);
    sql = `${campoFecha} >= ? || '-01'`;
    params.push(claves[0]);
  }
  return { sql, params };
}

// Cada fábrica/área de Produccion.xlsx usa su propio vocabulario de
// operaciones, así que no hay una sola palabra ("Calidad") que sirva para
// saber cuándo un lote quedó terminado en todas partes. Este mapa dice, por
// fábrica, cuál operación es su "checkpoint" final (la que representa las
// unidades buenas de verdad, sin duplicar lo de otras etapas):
//   - Fábrica 1 y Fábrica 2: "Calidad" (como siempre).
//   - Cableado: "Revisar" -- agregada 01/09 junto con Fábrica 3 e Inyección.
//     Verificado contra los datos reales: "Revisar" coincide en cantidad
//     con "Cablear" en 11.510 de 11.520 lotes (99.9%), exactamente el mismo
//     patrón que "Calidad" en Fábrica 1/2 (un paso de control después del
//     paso de producción). Confirmado con Julio (01/09).
// Fábrica 3 e Inyección NO tienen un paso de control separado en su
// proceso: cada fila de producción ya es la cantidad final (confirmado con
// Julio 01/09 -- para Fábrica 3, donde un mismo lote puede tener filas de
// "Ensamblar" y/o "Armar" sin que sean el mismo total repartido, se suman
// ambas). Por eso NO aparecen en este mapa: cualquier fábrica/área que no
// esté aquí (las dos de ahora, o una nueva que aparezca después) cae en el
// caso por defecto de condicionProduccionFinal() -- se cuentan TODAS sus
// filas por lote, sin filtrar por operación. Si una fábrica nueva SÍ tiene
// un paso de control separado, hay que agregarla aquí explícitamente (no
// hay forma de adivinarlo solo con los datos).
const CHECKPOINT_POR_FABRICA = {
  'Fabrica 1': 'CALIDAD',
  'Fabrica 2': 'CALIDAD',
  'Cableado': 'REVISAR',
};

function condicionProduccionFinal() {
  const casos = Object.entries(CHECKPOINT_POR_FABRICA)
    .map(([fabrica, operacion]) => `WHEN '${fabrica}' THEN UPPER(TRIM(operacion_entrega)) = '${operacion}'`)
    .join('\n      ');
  return `CASE fabrica\n      ${casos}\n      ELSE 1\n    END`;
}

// CTEs compartidas por todas las consultas que cruzan producción con
// rechazos por lote — se arman una sola vez aquí para no repetir (y
// arriesgarse a que un día queden inconsistentes entre sí) la misma lógica
// en varias funciones distintas.
//
// produccion_lote: una fila por lote con su fábrica, fecha, referencia (el
// código completo tipo "Lam/1017C/AmAm/Mul") y cuánto salió bueno de él —
// SUM(cantidad_buenas) de sus filas que cuentan como producción final según
// condicionProduccionFinal() (ver CHECKPOINT_POR_FABRICA arriba). fabrica y
// referencia_entrega se toman con MIN() porque son constantes dentro de un
// mismo lote (verificado contra los datos reales, incluyendo las 3 áreas
// nuevas: 0 lotes con más de un valor de fábrica entre sus filas).
//
// rechazos_agg: rechazos totales por lote, agrupados también por fábrica
// (no solo por lote_produccion) para que el cruce nunca mezcle el rechazo
// de una fábrica con la producción de otra en el caso remoto de que el
// mismo número de lote existiera en ambas.
const CTE_PRODUCCION_LOTE = `
  produccion_lote AS (
    SELECT lote_entrega,
           MIN(fabrica) AS fabrica,
           MIN(fecha_entrega) AS fecha_produccion,
           MIN(referencia_entrega) AS referencia_entrega,
           SUM(cantidad_buenas) AS producido
    FROM entregas_produccion
    WHERE ${condicionProduccionFinal()}
    GROUP BY lote_entrega
  )
`;
const CTE_RECHAZOS_AGG = `
  rechazos_agg AS (
    SELECT lote_produccion, fabrica, SUM(cantidad) AS rechazado
    FROM rechazos_produccion
    GROUP BY lote_produccion, fabrica
  )
`;

// Condiciones de filtro por motivo/línea, reutilizadas por el cruce de lotes
// (obtenerLotesConDetalle) y por el resumen agregado (obtenerResumenFiltro).
// IMPORTANTE: tienen que usar exactamente el mismo criterio de "valor para
// mostrar cuando el dato viene vacío" que usan obtenerMotivosFrecuentes() y
// obtenerLineasConMasRechazos() más abajo -- si no, al hacer clic en una
// barra de "Sin línea registrada" o "Sin motivo registrado" (que en la base
// de datos es NULL/vacío, no el texto literal) la comparación nunca
// encontraría nada, porque UPPER(TRIM(NULL)) es NULL. Encontrado 02/09
// probando el filtro de línea con datos reales: 3 de las líneas con más
// rechazos de Fábrica 1 son justamente "Sin línea registrada" (no queda
// registrada en el Excel para esas filas), así que sin este arreglo el
// filtro de línea fallaría casi siempre en la práctica, no solo en un caso
// raro.
function condicionMotivo(alias = 'rp') {
  return `COALESCE(NULLIF(UPPER(TRIM(${alias}.motivo)), ''), 'SIN MOTIVO REGISTRADO') = UPPER(TRIM(?))`;
}
// Igual que condicionMotivo pero por referencia -- pedido por Julio (04/09)
// para el flujo "entro a una Referencia -> veo sus motivos de rechazo -> le
// doy clic a uno" (ver obtenerMotivosFrecuentes con filtroReferencia, más
// abajo).
function condicionReferencia(alias = 'rp') {
  return `COALESCE(NULLIF(UPPER(TRIM(${alias}.referencia)), ''), '--') = UPPER(TRIM(?))`;
}
function condicionLineaProceso(alias = 'rp') {
  return `COALESCE(NULLIF(TRIM(${alias}.linea_org), ''), 'Sin línea registrada') = ?
      AND COALESCE(NULLIF(TRIM(${alias}.proceso_org), ''), 'Sin proceso registrado') = ?`;
}

// ======================== RECHAZOS ========================

// Una fila por fábrica: total histórico, unidades rechazadas, y cuántos
// rechazos hubo en los últimos 30 días (para las tarjetas de resumen). Se
// usa también para descubrir dinámicamente qué fábricas existen y así
// generar las pestañas del tablero sin tener que tocar código si mañana
// aparece una Fábrica 3.
function obtenerResumenPorFabrica() {
  return getDb().all(`
    SELECT fabrica,
           COUNT(*) AS total_rechazos,
           COALESCE(SUM(cantidad), 0) AS unidades_rechazadas,
           SUM(CASE WHEN fecha_rechazo >= date('now', '-30 days') THEN 1 ELSE 0 END) AS rechazos_ultimos_30_dias
    FROM rechazos_produccion
    GROUP BY fabrica
    ORDER BY fabrica
  `);
}

// Tendencia mensual de rechazos. Si se pasa `fabrica`, solo esa; si no,
// desglosa por fábrica dentro de cada mes (para una gráfica apilada o de
// líneas comparando ambas).
async function obtenerTendenciaRechazos(fabrica, meses) {
  const cantidadMeses = clampMeses(meses);
  const claves = ultimosMeses(cantidadMeses);
  const db = getDb();

  const params = [claves[0]];
  let filtroFabrica = '';
  if (fabrica) { filtroFabrica = 'AND fabrica = ?'; params.push(fabrica); }

  const filas = await db.all(`
    SELECT substr(fecha_rechazo, 1, 7) AS mes, fabrica, COUNT(*) AS cantidad, COALESCE(SUM(cantidad), 0) AS unidades
    FROM rechazos_produccion
    WHERE fecha_rechazo >= ? || '-01' ${filtroFabrica}
    GROUP BY mes, fabrica
    ORDER BY mes
  `, params);

  const porMes = {};
  claves.forEach(clave => { porMes[clave] = { mes: clave, cantidad: 0, unidades: 0, por_fabrica: {} }; });
  for (const f of filas) {
    if (!porMes[f.mes]) continue; // por si acaso hay datos fuera del rango pedido
    porMes[f.mes].cantidad += f.cantidad;
    porMes[f.mes].unidades += f.unidades;
    porMes[f.mes].por_fabrica[f.fabrica] = { cantidad: f.cantidad, unidades: f.unidades };
  }
  return claves.map(clave => porMes[clave]);
}

// Motivos más frecuentes. La agrupación en mayúsculas se hace en JavaScript
// (no en SQL): el motivo del Excel quedó escrito con distinta capitalización
// en épocas distintas (ej. "S2 - No Prende" y "S2 - NO PRENDE" son el mismo
// motivo), y el UPPER() de SQLite solo funciona bien con ASCII — con tildes
// (ej. "Dañada" / "DAÑADA") deja la Ñ/ñ sin normalizar y esas filas quedarían
// separadas igual. String.toUpperCase() de JavaScript sí maneja bien los
// acentos. Nota: esto no arregla TODAS las inconsistencias del texto origen
// (ej. "S1 -SERIE..." sin espacio después del guion sigue contando aparte de
// "S1 - SERIE..." con espacio); si hace falta más limpieza de texto, es una
// conversación aparte sobre qué tan agresivo normalizar sin perder motivos
// que sí sean distintos de verdad.
async function obtenerMotivosFrecuentes(fabrica, meses, limite, desde, hasta, filtroLinea, filtroProceso, filtroReferencia) {
  const tope = Math.max(1, Math.min(50, parseInt(limite, 10) || 10));
  const db = getDb();
  const { sql: fechaSql, params } = construirFiltroFecha('fecha_rechazo', meses, desde, hasta);
  let whereSql = `WHERE ${fechaSql}`;
  if (fabrica) {
    whereSql += ' AND fabrica = ?';
    params.push(fabrica);
  }
  // Si ya hay una línea seleccionada (clic en el cruce mes+línea), los
  // motivos que se muestran/cuentan son solo los de esa línea -- para que
  // "motivos" y "líneas" se sigan filtrando entre sí, no solo por mes.
  if (filtroLinea) {
    whereSql += ` AND ${condicionLineaProceso('rechazos_produccion')}`;
    params.push(filtroLinea, filtroProceso || '');
  }
  // Pedido por Julio (04/09): al hacer clic en el 🛠️ de una Referencia,
  // antes de ir directo a causa raíz, se muestra la lista de motivos de
  // rechazo QUE HA TENIDO ESA REFERENCIA (ordenados por más frecuente,
  // igual que la tabla de Motivos general) -- este filtro es lo que acota
  // esa lista a una sola referencia.
  if (filtroReferencia) {
    whereSql += ` AND ${condicionReferencia('rechazos_produccion')}`;
    params.push(filtroReferencia);
  }

  const filas = await db.all(`
    SELECT motivo, cantidad
    FROM rechazos_produccion
    ${whereSql}
  `, params);

  const porMotivo = new Map();
  for (const f of filas) {
    const clave = (f.motivo || '').trim().toUpperCase() || 'SIN MOTIVO REGISTRADO';
    if (!porMotivo.has(clave)) porMotivo.set(clave, { motivo: clave, cantidad: 0, unidades: 0 });
    const acumulado = porMotivo.get(clave);
    acumulado.cantidad += 1;
    acumulado.unidades += f.cantidad || 0;
  }

  return [...porMotivo.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, tope);
}

// Referencias donde más se presenta un motivo puntual -- el espejo de
// obtenerMotivosFrecuentes (agrupa por referencia en vez de por motivo),
// pedido por Julio (04/09) para la gráfica "en qué referencias es la que
// más se presenta" al entrar a un caso de tipo Motivo.
async function obtenerReferenciasPorMotivo(fabrica, meses, limite, desde, hasta, filtroMotivo) {
  const tope = Math.max(1, Math.min(50, parseInt(limite, 10) || 10));
  const db = getDb();
  const { sql: fechaSql, params } = construirFiltroFecha('fecha_rechazo', meses, desde, hasta);
  let whereSql = `WHERE ${fechaSql}`;
  if (fabrica) {
    whereSql += ' AND fabrica = ?';
    params.push(fabrica);
  }
  if (filtroMotivo) {
    whereSql += ` AND ${condicionMotivo('rechazos_produccion')}`;
    params.push(filtroMotivo);
  }

  const filas = await db.all(`
    SELECT referencia, cantidad
    FROM rechazos_produccion
    ${whereSql}
  `, params);

  const porReferencia = new Map();
  for (const f of filas) {
    const clave = (f.referencia || '').trim().toUpperCase() || 'SIN REFERENCIA REGISTRADA';
    if (!porReferencia.has(clave)) porReferencia.set(clave, { referencia: clave, cantidad: 0, unidades: 0 });
    const acumulado = porReferencia.get(clave);
    acumulado.cantidad += 1;
    acumulado.unidades += f.cantidad || 0;
  }

  return [...porReferencia.values()].sort((a, b) => b.cantidad - a.cantidad).slice(0, tope);
}

// Lista simple de TODOS los motivos de rechazo que existen en los datos
// sincronizados, sin ventana de tiempo (a diferencia de
// obtenerMotivosFrecuentes, pensada para el tablero con su filtro de meses)
// -- pedido por Julio (04/09) para el catálogo de solo lectura en Gestión
// ("en catálogos solo dejemos la lista de problemas/motivos"), ahora que la
// administración de causas/medidas del catálogo se movió a Seguimiento de
// Producción.
async function obtenerMotivosCatalogo(fabrica) {
  const db = getDb();
  const params = [];
  let whereSql = '';
  if (fabrica) {
    whereSql = 'WHERE fabrica = ?';
    params.push(fabrica);
  }

  const filas = await db.all(`
    SELECT motivo, cantidad
    FROM rechazos_produccion
    ${whereSql}
  `, params);

  const porMotivo = new Map();
  for (const f of filas) {
    const clave = (f.motivo || '').trim().toUpperCase() || 'SIN MOTIVO REGISTRADO';
    if (!porMotivo.has(clave)) porMotivo.set(clave, { motivo: clave, cantidad: 0, unidades: 0 });
    const acumulado = porMotivo.get(clave);
    acumulado.cantidad += 1;
    acumulado.unidades += f.cantidad || 0;
  }

  return [...porMotivo.values()].sort((a, b) => b.cantidad - a.cantidad);
}

// Líneas/procesos de ORIGEN con más rechazos (de dónde salió la pieza
// rechazada, no a dónde se reportó) — para ubicar dónde se están generando
// los problemas.
async function obtenerLineasConMasRechazos(fabrica, meses, limite, desde, hasta, filtroMotivo) {
  const tope = Math.max(1, Math.min(50, parseInt(limite, 10) || 10));
  const db = getDb();
  const { sql: fechaSql, params } = construirFiltroFecha('fecha_rechazo', meses, desde, hasta);
  let whereSql = `WHERE ${fechaSql}`;
  if (fabrica) {
    whereSql += ' AND fabrica = ?';
    params.push(fabrica);
  }
  // Simétrico al filtro de línea en obtenerMotivosFrecuentes: si ya hay un
  // motivo seleccionado, las líneas que se muestran son solo las de ese
  // motivo (mes+motivo → línea).
  if (filtroMotivo) {
    whereSql += ` AND ${condicionMotivo('rechazos_produccion')}`;
    params.push(filtroMotivo);
  }
  params.push(tope);

  return db.all(`
    SELECT COALESCE(NULLIF(TRIM(linea_org), ''), 'Sin línea registrada') AS linea,
           COALESCE(NULLIF(TRIM(proceso_org), ''), 'Sin proceso registrado') AS proceso,
           COUNT(*) AS cantidad, COALESCE(SUM(cantidad), 0) AS unidades
    FROM rechazos_produccion
    ${whereSql}
    GROUP BY linea, proceso
    ORDER BY cantidad DESC
    LIMIT ?
  `, params);
}

// Resumen de un motivo o línea específicos, para el recuadro que aparece al
// hacer clic en una barra de motivos/líneas (pedido por Julio: "reviso el
// incompleto, le doy clic, y me va a filtrar en el mes de agosto salió X
// cantidad, se repitió X veces y en X referencias"). "veces" y "unidades" ya
// se podían leer de obtenerMotivosFrecuentes/obtenerLineasConMasRechazos,
// pero esas dos funciones cortan al top N (parámetro `limite`) antes de
// mostrarse, así que no alcanzaba para el número de REFERENCIAS distintas
// afectadas -- este sí es un conteo aparte, exacto (sin límite de filas),
// cruzando contra `lotes` por número de lote.
async function obtenerResumenFiltroRechazo(fabrica, meses, desde, hasta, filtroMotivo, filtroLinea, filtroProceso) {
  const db = getDb();
  const { sql: fechaSql, params } = construirFiltroFecha('rp.fecha_rechazo', meses, desde, hasta);
  const condiciones = [fechaSql];
  if (fabrica) { condiciones.push('rp.fabrica = ?'); params.push(fabrica); }
  if (filtroMotivo) { condiciones.push(condicionMotivo()); params.push(filtroMotivo); }
  if (filtroLinea) { condiciones.push(condicionLineaProceso()); params.push(filtroLinea, filtroProceso || ''); }

  const fila = await db.get(`
    SELECT COUNT(*) AS veces,
           COALESCE(SUM(rp.cantidad), 0) AS unidades,
           COUNT(DISTINCT COALESCE(NULLIF(TRIM(l.referencia), ''), l.codigo, rp.lote_produccion)) AS referencias
    FROM rechazos_produccion rp
    LEFT JOIN lotes l ON l.no_lote = rp.lote_produccion
    WHERE ${condiciones.join(' AND ')}
  `, params);

  return {
    veces: fila.veces || 0,
    unidades: fila.unidades || 0,
    referencias: fila.referencias || 0,
  };
}

// Evolución mensual de un motivo o línea ya seleccionados -- pedido por
// Julio: "cuando clic en la barra de un motivo (ej. incompleto), que la
// gráfica del mes [también] me diga en esos meses cuánto salió [de ese
// motivo]". Siempre trae TODOS los meses de la ventana general (nunca se
// recorta a un solo mes, aunque haya uno activo) -- es precisamente el
// punto de esta gráfica: mostrar en qué meses fue más frecuente ese motivo
// o línea, para poder seguir haciendo clic en un mes desde ahí. Reutiliza
// el mismo criterio de fecha (fecha_rechazo) que obtenerMotivosFrecuentes/
// obtenerLineasConMasRechazos -- no cruza por lote porque lo que importa
// aquí es cuándo se registró el rechazo, no cuándo se produjo el lote.
async function obtenerRechazosPorMesFiltrado(fabrica, meses, desde, hasta, filtroMotivo, filtroLinea, filtroProceso) {
  const db = getDb();
  let claves;
  const { sql: fechaSql, params } = construirFiltroFecha('rp.fecha_rechazo', meses, desde, hasta);
  if (desde && hasta) {
    claves = mesesEntre(desde, hasta);
  } else {
    claves = ultimosMeses(clampMeses(meses));
  }
  const condiciones = [fechaSql];
  if (fabrica) { condiciones.push('rp.fabrica = ?'); params.push(fabrica); }
  if (filtroMotivo) { condiciones.push(condicionMotivo()); params.push(filtroMotivo); }
  if (filtroLinea) { condiciones.push(condicionLineaProceso()); params.push(filtroLinea, filtroProceso || ''); }

  const filas = await db.all(`
    SELECT substr(rp.fecha_rechazo, 1, 7) AS mes, COUNT(*) AS cantidad, COALESCE(SUM(rp.cantidad), 0) AS unidades
    FROM rechazos_produccion rp
    WHERE ${condiciones.join(' AND ')}
    GROUP BY mes
    ORDER BY mes
  `, params);

  const porMes = {};
  claves.forEach(clave => { porMes[clave] = { mes: clave, cantidad: 0, unidades: 0 }; });
  for (const f of filas) {
    if (!porMes[f.mes]) continue;
    porMes[f.mes].cantidad = f.cantidad;
    porMes[f.mes].unidades = f.unidades;
  }
  return claves.map(clave => porMes[clave]);
}

// ======================== PRODUCCIÓN (ENTREGAS) — AHORA SÍ POR FÁBRICA ========================

// Tendencia mensual de unidades buenas producidas (operación "Calidad" de
// entregas_produccion, sumada por lote). `fabrica` es opcional: sin ella, es
// el total de toda la planta.
async function obtenerTendenciaProduccion(meses, fabrica) {
  const cantidadMeses = clampMeses(meses);
  const claves = ultimosMeses(cantidadMeses);
  const db = getDb();

  const params = [claves[0]];
  let filtroFabrica = '';
  if (fabrica) { filtroFabrica = 'AND fabrica = ?'; params.push(fabrica); }

  const filas = await db.all(`
    WITH ${CTE_PRODUCCION_LOTE}
    SELECT substr(fecha_produccion, 1, 7) AS mes, COUNT(*) AS lotes, COALESCE(SUM(producido), 0) AS unidades
    FROM produccion_lote
    WHERE fecha_produccion >= ? || '-01' ${filtroFabrica}
    GROUP BY mes
    ORDER BY mes
  `, params);

  const porMes = {};
  claves.forEach(clave => { porMes[clave] = { mes: clave, lotes: 0, unidades: 0 }; });
  for (const f of filas) {
    if (!porMes[f.mes]) continue;
    porMes[f.mes].lotes = f.lotes;
    porMes[f.mes].unidades = f.unidades;
  }
  return claves.map(clave => porMes[clave]);
}

// Referencias más producidas (por unidades buenas), opcionalmente filtrado
// por fábrica.
async function obtenerProduccionPorReferencia(meses, fabrica, limite) {
  const cantidadMeses = clampMeses(meses);
  const claves = ultimosMeses(cantidadMeses);
  const tope = Math.max(1, Math.min(50, parseInt(limite, 10) || 10));
  const db = getDb();

  const params = [claves[0]];
  let filtroFabrica = '';
  if (fabrica) { filtroFabrica = 'AND pl.fabrica = ?'; params.push(fabrica); }
  params.push(tope);

  return db.all(`
    WITH ${CTE_PRODUCCION_LOTE}
    SELECT l.referencia AS referencia, COUNT(*) AS lotes, COALESCE(SUM(pl.producido), 0) AS unidades
    FROM produccion_lote pl
    LEFT JOIN lotes l ON l.no_lote = pl.lote_entrega
    WHERE pl.fecha_produccion >= ? || '-01' ${filtroFabrica}
      AND l.referencia IS NOT NULL AND TRIM(l.referencia) != ''
    GROUP BY l.referencia
    ORDER BY unidades DESC
    LIMIT ?
  `, params);
}

// ======================== CRUCE POR LOTE: BUENO VS. MALO / % DESPERDICIO ========================
// La llave de cruce es rechazos_produccion.lote_produccion = el número de
// lote (lotes.no_lote / entregas_produccion.lote_entrega) — verificado
// 31/08 contra los datos reales: 99.5% de los rechazos encuentran su lote.
//
// Revisión 08/09 (Julio, al mapear qué tablas quedan sin conectar): del
// resto que no cruzaba, 149 filas eran el mismo lote escrito con otra
// combinación de mayúsculas (SQLite compara texto distinguiendo mayúscula
// de minúscula) — corregido con scripts/normalizar_mayusculas_lotes.js,
// que se puede volver a correr sin riesgo si vuelve a pasar. Lo que quedó
// después de eso son excepciones reales, no errores a corregir, y se
// dejan así a propósito (sin FOREIGN KEY formal, el cruce sigue siendo
// por texto):
//   - Lotes de Cableado muy recientes que entran a rechazos/entregas antes
//     de que corra la sincronización que los crea en `lotes` — se
//     resuelven solos en la siguiente corrida de sincronizar_produccion.js.
//   - Números de orden de compra digitados en el campo de lote en vez del
//     número de lote (ej. "PO18948"), y lotes con el formato viejo
//     "SMD2024-00XX" de antes del esquema actual de numeración.
//   - Entregas de maquila/servicio externo, que de entrada no tienen
//     número de lote propio (se identifican por hash_fila, no por lote).

// Tabla buscable: producido/rechazado/% desperdicio por lote, enriquecido
// con Referencia/Color/Voltaje/Código desde la tabla `lotes`. Igual que
// antes, sin una búsqueda puntual se limita por meses (si no, recorrería
// los ~14 mil lotes con producción terminada en cada carga) y se muestran
// primero los que más unidades rechazadas tienen.
function obtenerLotesConDetalle(busqueda, meses, fabrica, limite, desde, hasta, filtroMotivo, filtroLinea, filtroProceso) {
  const db = getDb();
  const tope = Math.max(1, Math.min(200, parseInt(limite, 10) || 50));
  const q = (busqueda || '').trim();
  const conQuery = q.length > 0;

  const condiciones = [];
  const params = [];
  if (conQuery) {
    // Buscando un lote o una referencia puntual: no importa cuándo se
    // produjo, así que no se limita por meses.
    condiciones.push('(pl.lote_entrega LIKE ? OR l.referencia LIKE ? OR l.codigo LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  } else {
    const { sql: fechaSql, params: fechaParams } = construirFiltroFecha('pl.fecha_produccion', meses, desde, hasta);
    condiciones.push(fechaSql);
    params.push(...fechaParams);
  }
  if (fabrica) {
    condiciones.push('pl.fabrica = ?');
    params.push(fabrica);
  }
  if (filtroMotivo) {
    condiciones.push(`EXISTS (SELECT 1 FROM rechazos_produccion rp WHERE rp.lote_produccion = pl.lote_entrega AND rp.fabrica = pl.fabrica AND ${condicionMotivo()})`);
    params.push(filtroMotivo);
  }
  if (filtroLinea) {
    condiciones.push(`EXISTS (SELECT 1 FROM rechazos_produccion rp WHERE rp.lote_produccion = pl.lote_entrega AND rp.fabrica = pl.fabrica AND ${condicionLineaProceso()})`);
    params.push(filtroLinea, filtroProceso || '');
  }
  const whereSql = `WHERE ${condiciones.join(' AND ')}`;
  params.push(tope);

  return db.all(`
    WITH ${CTE_PRODUCCION_LOTE}, ${CTE_RECHAZOS_AGG}
    SELECT pl.lote_entrega AS no_lote,
           pl.fabrica AS fabrica,
           pl.fecha_produccion AS fecha_produccion,
           pl.producido AS producido,
           COALESCE(NULLIF(TRIM(l.referencia), ''), l.codigo, '--') AS referencia,
           l.color AS color,
           l.voltaje AS voltaje,
           l.codigo AS codigo,
           COALESCE(ra.rechazado, 0) AS rechazado,
           CASE WHEN pl.producido > 0 THEN ROUND(COALESCE(ra.rechazado, 0) * 100.0 / pl.producido, 2) ELSE NULL END AS pct_desperdicio
    FROM produccion_lote pl
    LEFT JOIN lotes l ON l.no_lote = pl.lote_entrega
    LEFT JOIN rechazos_agg ra ON ra.lote_produccion = pl.lote_entrega AND ra.fabrica = pl.fabrica
    ${whereSql}
    ORDER BY COALESCE(pct_desperdicio, 0) DESC, pl.fecha_produccion DESC
    LIMIT ?
  `, params);
}

// % de desperdicio por referencia (las que más desperdician primero) — para
// el ranking pedido por Julio. `fabrica` opcional.
async function obtenerDesperdicioPorReferencia(fabrica, meses, limite, desde, hasta, filtroMotivo, filtroLinea, filtroProceso) {
  const tope = Math.max(1, Math.min(50, parseInt(limite, 10) || 10));
  const db = getDb();
  const { sql: fechaSql, params } = construirFiltroFecha('pl.fecha_produccion', meses, desde, hasta);
  let whereSql = `WHERE ${fechaSql}`;
  if (fabrica) {
    whereSql += ' AND pl.fabrica = ?';
    params.push(fabrica);
  }
  if (filtroMotivo) {
    whereSql += ` AND EXISTS (SELECT 1 FROM rechazos_produccion rp WHERE rp.lote_produccion = pl.lote_entrega AND rp.fabrica = pl.fabrica AND ${condicionMotivo()})`;
    params.push(filtroMotivo);
  }
  if (filtroLinea) {
    whereSql += ` AND EXISTS (SELECT 1 FROM rechazos_produccion rp WHERE rp.lote_produccion = pl.lote_entrega AND rp.fabrica = pl.fabrica AND ${condicionLineaProceso()})`;
    params.push(filtroLinea, filtroProceso || '');
  }
  params.push(tope);

  return db.all(`
    WITH ${CTE_PRODUCCION_LOTE}, ${CTE_RECHAZOS_AGG}
    SELECT COALESCE(NULLIF(TRIM(l.referencia), ''), l.codigo, '--') AS referencia,
           SUM(pl.producido) AS producido,
           SUM(COALESCE(ra.rechazado, 0)) AS rechazado,
           ROUND(SUM(COALESCE(ra.rechazado, 0)) * 100.0 / SUM(pl.producido), 2) AS pct_desperdicio
    FROM produccion_lote pl
    LEFT JOIN lotes l ON l.no_lote = pl.lote_entrega
    LEFT JOIN rechazos_agg ra ON ra.lote_produccion = pl.lote_entrega AND ra.fabrica = pl.fabrica
    ${whereSql}
    GROUP BY referencia
    HAVING SUM(pl.producido) > 0
    ORDER BY pct_desperdicio DESC
    LIMIT ?
  `, params);
}

// Para la gráfica principal (% de desperdicio por mes, con buenas/malas de
// fondo): agrupa todos los lotes por su mes de producción y suma, de cada
// uno, cuánto salió bueno (producido menos lo rechazado de ese mismo lote) y
// cuánto salió malo (lo rechazado) — es un cruce real lote por lote, no dos
// totales sueltos comparados por fecha. `fabrica` opcional: con ella, cada
// pestaña de fábrica muestra su propio % de desperdicio real (antes esto no
// se podía calcular por fábrica porque la producción no traía esa columna).
async function obtenerBuenoVsMaloPorMes(meses, fabrica, desde, hasta) {
  let claves;
  const db = getDb();
  const params = [];
  let fechaSql = '';
  if (desde && hasta) {
    claves = mesesEntre(desde, hasta);
    fechaSql = 'pl.fecha_produccion >= ? AND pl.fecha_produccion <= ? || \' 23:59:59\'';
    params.push(desde, hasta);
  } else {
    const cantidadMeses = clampMeses(meses);
    claves = ultimosMeses(cantidadMeses);
    fechaSql = 'pl.fecha_produccion >= ? || \'-01\'';
    params.push(claves[0]);
  }

  let filtroFabrica = '';
  if (fabrica) { filtroFabrica = 'AND pl.fabrica = ?'; params.push(fabrica); }

  const filas = await db.all(`
    WITH ${CTE_PRODUCCION_LOTE}, ${CTE_RECHAZOS_AGG}
    SELECT substr(pl.fecha_produccion, 1, 7) AS mes,
           SUM(pl.producido) AS producido,
           SUM(COALESCE(ra.rechazado, 0)) AS rechazado
    FROM produccion_lote pl
    LEFT JOIN rechazos_agg ra ON ra.lote_produccion = pl.lote_entrega AND ra.fabrica = pl.fabrica
    WHERE ${fechaSql} ${filtroFabrica}
    GROUP BY mes
    ORDER BY mes
  `, params);

  const porMes = {};
  claves.forEach(clave => { porMes[clave] = { mes: clave, producido: 0, rechazado: 0, bueno: 0, pct_desperdicio: null }; });
  for (const f of filas) {
    if (!porMes[f.mes]) continue;
    const producido = f.producido || 0;
    const rechazado = f.rechazado || 0;
    porMes[f.mes].producido = producido;
    porMes[f.mes].rechazado = rechazado;
    // Por si algún lote quedara con más rechazado que producido (dato
    // inconsistente en el origen), "bueno" no baja de 0 — no tendría
    // sentido mostrarlo negativo en la gráfica.
    porMes[f.mes].bueno = Math.max(0, producido - rechazado);
    porMes[f.mes].pct_desperdicio = producido > 0 ? Math.round((rechazado / producido) * 10000) / 100 : null;
  }
  return claves.map(clave => porMes[clave]);
}

// ======================== CRUCE: % DE DESPERDICIO (KPI) ========================
// Reemplaza a la vieja "tasa de rechazo global": ahora sí acepta `fabrica`,
// porque tanto lo producido (entregas_produccion) como lo rechazado
// (rechazos_produccion) se pueden filtrar por fábrica de verdad.
async function obtenerDesperdicio(fabrica, meses, desde, hasta) {
  const db = getDb();
  let filtroProd = '';
  let filtroRech = '';
  const paramsProd = [];
  const paramsRech = [];

  if (desde && hasta) {
    filtroProd = 'AND fecha_entrega >= ? AND fecha_entrega <= ?';
    paramsProd.push(desde, hasta);
    filtroRech = 'AND fecha_rechazo >= ? AND fecha_rechazo <= ?';
    paramsRech.push(desde, hasta);
  } else {
    const cantidadMeses = clampMeses(meses);
    const claves = ultimosMeses(cantidadMeses);
    filtroProd = 'AND fecha_entrega >= ? || \'-01\'';
    paramsProd.push(claves[0]);
    filtroRech = 'AND fecha_rechazo >= ? || \'-01\'';
    paramsRech.push(claves[0]);
  }

  if (fabrica) {
    filtroProd += ' AND fabrica = ?';
    paramsProd.push(fabrica);
    filtroRech += ' AND fabrica = ?';
    paramsRech.push(fabrica);
  }

  const [produccion, rechazos] = await Promise.all([
    db.get(`
      SELECT COALESCE(SUM(cantidad_buenas), 0) AS unidades
      FROM entregas_produccion
      WHERE ${condicionProduccionFinal()} ${filtroProd}
    `, paramsProd),
    db.get(`SELECT COALESCE(SUM(cantidad), 0) AS unidades FROM rechazos_produccion WHERE 1=1 ${filtroRech}`, paramsRech),
  ]);

  const unidadesProducidas = produccion.unidades || 0;
  const unidadesRechazadas = rechazos.unidades || 0;
  return {
    fabrica: fabrica || null,
    meses: desde && hasta ? null : clampMeses(meses),
    desde: desde || null,
    hasta: hasta || null,
    unidades_producidas: unidadesProducidas,
    unidades_rechazadas: unidadesRechazadas,
    pct_desperdicio: unidadesProducidas > 0
      ? Math.round((unidadesRechazadas / unidadesProducidas) * 10000) / 100
      : null,
  };
}

module.exports = {
  obtenerResumenPorFabrica,
  obtenerTendenciaRechazos,
  obtenerMotivosFrecuentes,
  obtenerReferenciasPorMotivo,
  obtenerMotivosCatalogo,
  obtenerLineasConMasRechazos,
  obtenerResumenFiltroRechazo,
  obtenerRechazosPorMesFiltrado,
  obtenerTendenciaProduccion,
  obtenerProduccionPorReferencia,
  obtenerLotesConDetalle,
  obtenerDesperdicioPorReferencia,
  obtenerBuenoVsMaloPorMes,
  obtenerDesperdicio,
};
