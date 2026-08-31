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
async function obtenerMotivosFrecuentes(fabrica, meses, limite) {
  const cantidadMeses = clampMeses(meses);
  const claves = ultimosMeses(cantidadMeses);
  const tope = Math.max(1, Math.min(50, parseInt(limite, 10) || 10));
  const db = getDb();

  const params = [claves[0]];
  let filtroFabrica = '';
  if (fabrica) { filtroFabrica = 'AND fabrica = ?'; params.push(fabrica); }

  const filas = await db.all(`
    SELECT motivo, cantidad
    FROM rechazos_produccion
    WHERE fecha_rechazo >= ? || '-01' ${filtroFabrica}
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

// Líneas/procesos de ORIGEN con más rechazos (de dónde salió la pieza
// rechazada, no a dónde se reportó) — para ubicar dónde se están generando
// los problemas.
async function obtenerLineasConMasRechazos(fabrica, meses, limite) {
  const cantidadMeses = clampMeses(meses);
  const claves = ultimosMeses(cantidadMeses);
  const tope = Math.max(1, Math.min(50, parseInt(limite, 10) || 10));
  const db = getDb();

  const params = [claves[0]];
  let filtroFabrica = '';
  if (fabrica) { filtroFabrica = 'AND fabrica = ?'; params.push(fabrica); }
  params.push(tope);

  return db.all(`
    SELECT COALESCE(NULLIF(TRIM(linea_org), ''), 'Sin línea registrada') AS linea,
           COALESCE(NULLIF(TRIM(proceso_org), ''), 'Sin proceso registrado') AS proceso,
           COUNT(*) AS cantidad, COALESCE(SUM(cantidad), 0) AS unidades
    FROM rechazos_produccion
    WHERE fecha_rechazo >= ? || '-01' ${filtroFabrica}
    GROUP BY linea, proceso
    ORDER BY cantidad DESC
    LIMIT ?
  `, params);
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

// Tabla buscable: producido/rechazado/% desperdicio por lote, enriquecido
// con Referencia/Color/Voltaje/Código desde la tabla `lotes`. Igual que
// antes, sin una búsqueda puntual se limita por meses (si no, recorrería
// los ~14 mil lotes con producción terminada en cada carga) y se muestran
// primero los que más unidades rechazadas tienen.
function obtenerLotesConDetalle(busqueda, meses, fabrica, limite) {
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
    const claves = ultimosMeses(clampMeses(meses));
    condiciones.push("pl.fecha_produccion >= ? || '-01'");
    params.push(claves[0]);
  }
  if (fabrica) {
    condiciones.push('pl.fabrica = ?');
    params.push(fabrica);
  }
  const whereSql = `WHERE ${condiciones.join(' AND ')}`;
  params.push(tope);

  return db.all(`
    WITH ${CTE_PRODUCCION_LOTE}, ${CTE_RECHAZOS_AGG}
    SELECT pl.lote_entrega AS no_lote,
           pl.fabrica AS fabrica,
           pl.fecha_produccion AS fecha_produccion,
           pl.producido AS producido,
           l.referencia AS referencia,
           l.color AS color,
           l.voltaje AS voltaje,
           l.codigo AS codigo,
           COALESCE(ra.rechazado, 0) AS rechazado,
           CASE WHEN pl.producido > 0 THEN ROUND(COALESCE(ra.rechazado, 0) * 100.0 / pl.producido, 2) ELSE NULL END AS pct_desperdicio
    FROM produccion_lote pl
    LEFT JOIN lotes l ON l.no_lote = pl.lote_entrega
    LEFT JOIN rechazos_agg ra ON ra.lote_produccion = pl.lote_entrega AND ra.fabrica = pl.fabrica
    ${whereSql}
    ORDER BY ${conQuery ? 'pl.fecha_produccion DESC' : 'COALESCE(ra.rechazado, 0) DESC'}
    LIMIT ?
  `, params);
}

// % de desperdicio por referencia (las que más desperdician primero) — para
// el ranking pedido por Julio. `fabrica` opcional.
async function obtenerDesperdicioPorReferencia(fabrica, meses, limite) {
  const cantidadMeses = clampMeses(meses);
  const claves = ultimosMeses(cantidadMeses);
  const tope = Math.max(1, Math.min(50, parseInt(limite, 10) || 10));
  const db = getDb();

  const params = [claves[0]];
  let filtroFabrica = '';
  if (fabrica) { filtroFabrica = 'AND pl.fabrica = ?'; params.push(fabrica); }
  params.push(tope);

  return db.all(`
    WITH ${CTE_PRODUCCION_LOTE}, ${CTE_RECHAZOS_AGG}
    SELECT l.referencia AS referencia,
           SUM(pl.producido) AS producido,
           SUM(COALESCE(ra.rechazado, 0)) AS rechazado,
           ROUND(SUM(COALESCE(ra.rechazado, 0)) * 100.0 / SUM(pl.producido), 2) AS pct_desperdicio
    FROM produccion_lote pl
    LEFT JOIN lotes l ON l.no_lote = pl.lote_entrega
    LEFT JOIN rechazos_agg ra ON ra.lote_produccion = pl.lote_entrega AND ra.fabrica = pl.fabrica
    WHERE pl.fecha_produccion >= ? || '-01' ${filtroFabrica}
      AND l.referencia IS NOT NULL AND TRIM(l.referencia) != ''
    GROUP BY l.referencia
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
async function obtenerBuenoVsMaloPorMes(meses, fabrica) {
  const cantidadMeses = clampMeses(meses);
  const claves = ultimosMeses(cantidadMeses);
  const db = getDb();

  const params = [claves[0]];
  let filtroFabrica = '';
  if (fabrica) { filtroFabrica = 'AND pl.fabrica = ?'; params.push(fabrica); }

  const filas = await db.all(`
    WITH ${CTE_PRODUCCION_LOTE}, ${CTE_RECHAZOS_AGG}
    SELECT substr(pl.fecha_produccion, 1, 7) AS mes,
           SUM(pl.producido) AS producido,
           SUM(COALESCE(ra.rechazado, 0)) AS rechazado
    FROM produccion_lote pl
    LEFT JOIN rechazos_agg ra ON ra.lote_produccion = pl.lote_entrega AND ra.fabrica = pl.fabrica
    WHERE pl.fecha_produccion >= ? || '-01' ${filtroFabrica}
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
async function obtenerDesperdicio(fabrica, meses) {
  const cantidadMeses = clampMeses(meses);
  const claves = ultimosMeses(cantidadMeses);
  const db = getDb();

  const paramsProd = [claves[0]];
  let filtroProd = '';
  if (fabrica) { filtroProd = 'AND fabrica = ?'; paramsProd.push(fabrica); }

  const paramsRech = [claves[0]];
  let filtroRech = '';
  if (fabrica) { filtroRech = 'AND fabrica = ?'; paramsRech.push(fabrica); }

  const [produccion, rechazos] = await Promise.all([
    db.get(`
      SELECT COALESCE(SUM(cantidad_buenas), 0) AS unidades
      FROM entregas_produccion
      WHERE ${condicionProduccionFinal()} AND fecha_entrega >= ? || '-01' ${filtroProd}
    `, paramsProd),
    db.get(`SELECT COALESCE(SUM(cantidad), 0) AS unidades FROM rechazos_produccion WHERE fecha_rechazo >= ? || '-01' ${filtroRech}`, paramsRech),
  ]);

  const unidadesProducidas = produccion.unidades || 0;
  const unidadesRechazadas = rechazos.unidades || 0;
  return {
    fabrica: fabrica || null,
    meses: cantidadMeses,
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
  obtenerLineasConMasRechazos,
  obtenerTendenciaProduccion,
  obtenerProduccionPorReferencia,
  obtenerLotesConDetalle,
  obtenerDesperdicioPorReferencia,
  obtenerBuenoVsMaloPorMes,
  obtenerDesperdicio,
};
