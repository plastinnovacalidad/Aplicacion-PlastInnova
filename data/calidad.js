const { getDb } = require('../db/connection');

// ======================== TABLERO DE CALIDAD GENERAL ========================
// Cruza Garantías y Muestreos ISO 2859-1 por referencia de producto
// terminado (confirmado con el usuario: el 79% de las referencias de
// Garantías coincide exactamente con el catálogo iso_referencias — es el
// mismo producto). Circuitos SMD queda fuera a propósito: maneja su propio
// código de tarjeta/componente, a otro nivel, y no es el mismo catálogo.

// fecha_reporte en garantias es texto libre tipo "D/M/AAAA" (sin ceros a la
// izquierda, formato heredado de cuando esto era una hoja de Excel) — se
// reutiliza exactamente la misma lógica de extractYear/extractMonth que ya
// usa Public/dashboard_garantias.html, para que el mes de un mismo registro
// se calcule igual en los dos tableros.
function extractYear(fechaStr) {
  if (!fechaStr) return '2026';
  fechaStr = String(fechaStr).trim();
  const sep = fechaStr.includes('/') ? '/' : (fechaStr.includes('-') ? '-' : '');
  if (sep) {
    const parts = fechaStr.split(sep);
    const yearPart = parts.find(p => p.length === 4 && !isNaN(p));
    if (yearPart) return yearPart;
    if (parts[0] && parts[0].length === 4) return parts[0];
    if (parts[parts.length - 1] && parts[parts.length - 1].length === 4) return parts[parts.length - 1];
    const lastPart = parts[parts.length - 1];
    if (lastPart && lastPart.length === 2 && !isNaN(lastPart)) return '20' + lastPart;
  }
  if (fechaStr.length >= 4 && !isNaN(fechaStr.substring(0, 4))) return fechaStr.substring(0, 4);
  return '2026';
}

function extractMonth(fechaStr) {
  if (!fechaStr) return '01';
  fechaStr = String(fechaStr).trim();
  const sep = fechaStr.includes('/') ? '/' : (fechaStr.includes('-') ? '-' : '');
  if (sep) {
    const parts = fechaStr.split(sep);
    if (parts.length >= 3) {
      if (parts[0].length === 4) return parts[1].padStart(2, '0');
      return parts[1].padStart(2, '0');
    } else if (parts.length === 2) {
      if (parts[0].length === 4) return parts[1].padStart(2, '0');
      return parts[0].padStart(2, '0');
    }
  }
  return '01';
}

// Devuelve los últimos `meses` como claves 'AAAA-MM', más viejo primero.
function ultimosMeses(cantidad) {
  const hoy = new Date();
  const claves = [];
  for (let i = cantidad - 1; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    claves.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return claves;
}

async function obtenerTendencias(meses) {
  const cantidadMeses = Math.max(1, Math.min(24, parseInt(meses, 10) || 12));
  const claves = ultimosMeses(cantidadMeses);
  const db = getDb();

  const garantiasRows = await db.all('SELECT fecha_reporte FROM garantias');
  const conteoGarantias = {};
  for (const g of garantiasRows) {
    const clave = `${extractYear(g.fecha_reporte)}-${extractMonth(g.fecha_reporte)}`;
    conteoGarantias[clave] = (conteoGarantias[clave] || 0) + 1;
  }

  // fecha_creacion en iso_lotes sí es ISO real (AAAA-MM-DD HH:MM:SS), así
  // que aquí no hace falta el mismo parseo manual.
  const lotesRows = await db.all("SELECT substr(fecha_creacion, 1, 7) as clave, estado_final FROM iso_lotes");
  const conteoLotes = {};
  for (const l of lotesRows) {
    if (!l.clave) continue;
    if (!conteoLotes[l.clave]) conteoLotes[l.clave] = { total: 0, rechazados: 0 };
    conteoLotes[l.clave].total++;
    // Un lote "Reclasificado" o en "Reparacion" salió Rechazado en su
    // Auditoría Final —darle ese tratamiento es solo qué se hizo con el
    // lote después, no cambia el veredicto de calidad—, así que para las
    // tendencias sigue contando como rechazo.
    if (['Rechazado', 'Reclasificado', 'Reparacion'].includes(l.estado_final)) conteoLotes[l.clave].rechazados++;
  }

  return {
    garantias_por_mes: claves.map(clave => ({ mes: clave, cantidad: conteoGarantias[clave] || 0 })),
    lotes_por_mes: claves.map(clave => ({
      mes: clave,
      total: (conteoLotes[clave] && conteoLotes[clave].total) || 0,
      rechazados: (conteoLotes[clave] && conteoLotes[clave].rechazados) || 0
    }))
  };
}

async function obtenerResumenPorProducto() {
  const db = getDb();

  const garantiasPorRef = await db.all(
    `SELECT referencia, COUNT(*) as total,
            (SELECT problema FROM garantias g2 WHERE g2.referencia = g1.referencia AND problema IS NOT NULL AND problema != ''
             GROUP BY problema ORDER BY COUNT(*) DESC LIMIT 1) as causal_frecuente
     FROM garantias g1
     WHERE referencia IS NOT NULL AND referencia != ''
     GROUP BY referencia`
  );

  const lotesPorRef = await db.all(
    `SELECT referencia, COUNT(*) as total,
            SUM(CASE WHEN estado_final IN ('Rechazado', 'Reclasificado', 'Reparacion') THEN 1 ELSE 0 END) as rechazados,
            SUM(CASE WHEN estado_final = 'Aceptado' THEN 1 ELSE 0 END) as aceptados,
            SUM(CASE WHEN estado_final IN ('Pendiente', 'Cerrado_sin_auditoria') THEN 1 ELSE 0 END) as sin_definir
     FROM iso_lotes
     WHERE referencia IS NOT NULL AND referencia != ''
     GROUP BY referencia`
  );

  const porProducto = new Map();
  for (const g of garantiasPorRef) {
    porProducto.set(g.referencia, {
      referencia: g.referencia,
      garantias: g.total,
      causal_frecuente: g.causal_frecuente || null,
      lotes_muestreados: 0, lotes_rechazados: 0, lotes_aceptados: 0, lotes_sin_definir: 0
    });
  }
  for (const l of lotesPorRef) {
    const fila = porProducto.get(l.referencia) || {
      referencia: l.referencia, garantias: 0, causal_frecuente: null,
      lotes_muestreados: 0, lotes_rechazados: 0, lotes_aceptados: 0, lotes_sin_definir: 0
    };
    fila.lotes_muestreados = l.total;
    fila.lotes_rechazados = l.rechazados;
    fila.lotes_aceptados = l.aceptados;
    fila.lotes_sin_definir = l.sin_definir;
    porProducto.set(l.referencia, fila);
  }

  const resultado = Array.from(porProducto.values()).map(fila => ({
    ...fila,
    pct_rechazo: fila.lotes_muestreados > 0 ? Math.round((fila.lotes_rechazados / fila.lotes_muestreados) * 1000) / 10 : null
  }));

  // Los productos con más garantías primero — son los que más urge revisar.
  resultado.sort((a, b) => b.garantias - a.garantias);
  return resultado;
}

// ======================== MEDIDAS (METROLOGÍA) ========================
// Metrología queda aparte del cruce Garantías/ISO2859 de arriba (misma razón
// de siempre: la referencia de un molde en Circuitos SMD es la tarjeta, no
// el producto terminado). Aquí solo se resume lo propio del módulo: cuántas
// mediciones se han tomado y cuáles salieron fuera de tolerancia.
async function obtenerResumenMetrologia() {
  const db = getDb();

  const totales = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM moldes_inspecciones) as total_inspecciones,
      (SELECT COUNT(*) FROM moldes_medidas_detalle) as total_medidas,
      (SELECT COUNT(*) FROM moldes_medidas_detalle WHERE estado = 'FUERA DE TOLERANCIA') as total_fuera_tolerancia
  `);
  const pctFueraTolerancia = totales.total_medidas > 0
    ? Math.round((totales.total_fuera_tolerancia / totales.total_medidas) * 1000) / 10
    : null;

  const topReferenciasProblema = await db.all(`
    SELECT r.codigo_base as referencia, COUNT(*) as medidas_fuera_tolerancia
    FROM moldes_medidas_detalle m
    JOIN moldes_inspecciones i ON m.inspeccion_id = i.id
    JOIN moldes_referencias r ON i.referencia_id = r.id
    WHERE m.estado = 'FUERA DE TOLERANCIA'
    GROUP BY r.codigo_base
    ORDER BY medidas_fuera_tolerancia DESC
    LIMIT 5
  `);

  const ultimasFueraTolerancia = await db.all(`
    SELECT r.codigo_base as referencia, i.fecha, i.responsable, i.lote,
           c.cota, m.medida_real, c.medida_estandar, c.tolerancia_minima, c.tolerancia_maxima
    FROM moldes_medidas_detalle m
    JOIN moldes_cotas c ON m.cota_id = c.id
    JOIN moldes_inspecciones i ON m.inspeccion_id = i.id
    JOIN moldes_referencias r ON i.referencia_id = r.id
    WHERE m.estado = 'FUERA DE TOLERANCIA'
    ORDER BY m.id DESC
    LIMIT 8
  `);

  return {
    total_inspecciones: totales.total_inspecciones,
    total_medidas: totales.total_medidas,
    total_fuera_tolerancia: totales.total_fuera_tolerancia,
    pct_fuera_tolerancia: pctFueraTolerancia,
    top_referencias_problema: topReferenciasProblema,
    ultimas_fuera_tolerancia: ultimasFueraTolerancia,
  };
}

// ======================== ÚLTIMOS COMENTARIOS — CIRCUITOS SMD ========================
// "Comentarios" cubre las dos cosas que existen hoy en Circuitos SMD:
// recomendaciones (bitácora, se van acumulando con fecha) y observaciones
// (un campo de texto por referencia, que se sobrescribe — aquí se muestra
// por su fecha de última actualización). Se mezclan y se ordenan por fecha
// para que se vea como un solo feed reciente.
async function obtenerUltimosComentariosSMD(limite) {
  const lim = Math.max(1, Math.min(50, parseInt(limite, 10) || 8));
  const db = getDb();

  const recomendaciones = await db.all(`
    SELECT 'recomendacion' as tipo, referencia, recomendacion as texto,
           COALESCE(usuario_nombre, 'Sistema') as autor, fecha_creacion as fecha
    FROM recomendaciones
    WHERE (eliminada = 0 OR eliminada IS NULL)
    ORDER BY fecha_creacion DESC
    LIMIT ?
  `, [lim]);

  const observaciones = await db.all(`
    SELECT 'observacion' as tipo, ref.codigo_base as referencia, o.observacion as texto,
           COALESCE(u.nombre, 'Sistema') as autor, o.actualizado_en as fecha
    FROM observaciones o
    JOIN referencias ref ON o.referencia_id = ref.id
    LEFT JOIN usuarios u ON o.actualizado_por = u.id
    WHERE o.observacion IS NOT NULL AND TRIM(o.observacion) != '' AND o.actualizado_en IS NOT NULL
    ORDER BY o.actualizado_en DESC
    LIMIT ?
  `, [lim]);

  return [...recomendaciones, ...observaciones]
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    .slice(0, lim);
}

// ======================== MUESTREOS REALIZADOS (ISO 2859-1) ========================
// Un listado plano de los muestreos en sí (no de los lotes), para poder
// revisar rápido qué se ha inspeccionado últimamente sin tener que entrar
// lote por lote al módulo de Muestreos ISO 2859. Incluye Recepción y
// Producción juntos; el campo "modulo" del lote deja claro de cuál es cada
// fila.
async function obtenerUltimosMuestreos(limite) {
  const lim = Math.max(1, Math.min(500, parseInt(limite, 10) || 15));
  const db = getDb();
  return db.all(`
    SELECT m.id_muestreo, m.tipo, m.fecha_hora, m.analista, m.cantidad_muestreada,
           m.decision, m.turno, m.area, m.operario,
           l.id_lote, l.referencia, l.modulo
    FROM iso_muestreos m
    JOIN iso_lotes l ON m.id_lote = l.id_lote
    ORDER BY m.fecha_hora DESC, m.id_muestreo DESC
    LIMIT ?
  `, [lim]);
}

// ======================== ALERTAS DE WHATSAPP (roadmap #2) ========================

// Referencias con "muchas" garantías nuevas en los últimos `ventanaDias`
// días (por defecto 7). Se usa `fecha_creacion` (momento en que el registro
// entró al sistema, formato `datetime('now')` en UTC) en vez de
// `fecha_reporte` (texto libre tipo "D/M/AAAA" que ya usa el resto del
// tablero de Calidad) porque fecha_reporte no siempre se puede convertir a
// una fecha exacta, y aquí sí hace falta un rango de días preciso. Como
// `umbral`/`ventanaDias` salen de whatsapp_alertas_config (una tabla que
// solo edita quien tiene permiso whatsapp.bot.gestionar, nunca el usuario
// final), se pueden meter directo en el SQL sin riesgo de inyección — pero
// igual se fuerzan a entero por si acaso.
async function obtenerPicoGarantias(umbral, ventanaDias) {
  const db = getDb();
  const dias = parseInt(ventanaDias, 10) || 7;
  const min = parseInt(umbral, 10) || 10;
  return db.all(`
    SELECT referencia, COUNT(*) as total
    FROM garantias
    WHERE referencia IS NOT NULL AND TRIM(referencia) != ''
      AND fecha_creacion >= datetime('now', '-${dias} days')
    GROUP BY referencia
    HAVING COUNT(*) >= ${min}
    ORDER BY total DESC
  `);
}

// Las referencias con más garantías en un periodo — la usan tanto el
// resumen general (obtenerResumenPeriodo, como una tabla dentro del PDF)
// como el reporte aparte de garantías (obtenerGarantiasReportePeriodo, como
// su propia sección) — para no calcular lo mismo dos veces con SQL
// ligeramente distinto en cada lado.
async function topReferenciasGarantias(desdeUTC, hastaUTC, limite = 10) {
  const db = getDb();
  return db.all(`
    SELECT referencia, COUNT(*) as total
    FROM garantias
    WHERE referencia IS NOT NULL AND TRIM(referencia) != '' AND fecha_creacion >= ? AND fecha_creacion < ?
    GROUP BY referencia
    ORDER BY total DESC
    LIMIT ?
  `, [desdeUTC, hastaUTC, limite]);
}

// Medidas fuera de tolerancia de un periodo, con la desviación calculada
// (positiva si se pasó por arriba de la tolerancia máxima, negativa si
// quedó por debajo de la mínima) — antes el resumen solo traía el conteo,
// sin decir cuáles referencias fueron ni por cuánto se salieron. Se ordena
// por el tamaño de la desviación (la peor primero), no por fecha, porque en
// un reporte de calidad lo más útil es ver primero el problema más grave.
async function fueraToleranciaDetallePeriodo(desdeUTC, hastaUTC, limite = 10) {
  const db = getDb();
  return db.all(`
    SELECT r.codigo_base as referencia, c.cota, m.medida_real,
           c.tolerancia_minima, c.tolerancia_maxima, i.fecha, i.lote,
           CASE WHEN m.medida_real > c.tolerancia_maxima THEN m.medida_real - c.tolerancia_maxima
                ELSE m.medida_real - c.tolerancia_minima END as desviacion
    FROM moldes_medidas_detalle m
    JOIN moldes_cotas c ON m.cota_id = c.id
    JOIN moldes_inspecciones i ON m.inspeccion_id = i.id
    JOIN moldes_referencias r ON i.referencia_id = r.id
    WHERE m.estado = 'FUERA DE TOLERANCIA' AND i.created_at >= ? AND i.created_at < ?
    ORDER BY ABS(CASE WHEN m.medida_real > c.tolerancia_maxima THEN m.medida_real - c.tolerancia_maxima
                       ELSE m.medida_real - c.tolerancia_minima END) DESC
    LIMIT ?
  `, [desdeUTC, hastaUTC, limite]);
}

// Resumen de actividad de calidad en un periodo, para los avisos
// periódicos (diario/quincenal/mensual) del bot de WhatsApp. Recibe los
// límites del periodo en dos formatos porque las tablas involucradas
// guardan la fecha en dos bases de tiempo distintas: iso_muestreos/
// iso_lotes usan `datetime('now','localtime')` (hora del servidor), y
// garantias/moldes_inspecciones usan `datetime('now')`/`CURRENT_TIMESTAMP`
// (UTC) — ver whatsapp_bot_service.js, que arma ambos pares de límites a
// partir de la misma fecha antes de llamar aquí.
async function obtenerResumenPeriodo({ desdeLocal, hastaLocal, desdeUTC, hastaUTC }) {
  const db = getDb();

  const primeraPieza = await db.all(`
    SELECT decision, COUNT(*) as total FROM iso_muestreos
    WHERE tipo = 'Primera_Pieza' AND fecha_hora >= ? AND fecha_hora < ?
    GROUP BY decision
  `, [desdeLocal, hastaLocal]);

  const enProceso = await db.get(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN decision = 'Parar' THEN 1 ELSE 0 END) as paradas,
      SUM(CASE WHEN decision = 'Alerta' THEN 1 ELSE 0 END) as alertas,
      SUM(piezas_reclasificadas) as piezas_reclasificadas,
      SUM(piezas_reparadas) as piezas_reparadas
    FROM iso_muestreos
    WHERE tipo = 'En_Proceso' AND fecha_hora >= ? AND fecha_hora < ?
  `, [desdeLocal, hastaLocal]);

  const final = await db.all(`
    SELECT decision, COUNT(*) as total FROM iso_muestreos
    WHERE tipo = 'Final' AND fecha_hora >= ? AND fecha_hora < ?
    GROUP BY decision
  `, [desdeLocal, hastaLocal]);

  const lotesTratamiento = await db.all(`
    SELECT estado_final, COUNT(*) as total FROM iso_lotes
    WHERE fecha_cierre >= ? AND fecha_cierre < ? AND estado_final IN ('Reclasificado', 'Reparacion')
    GROUP BY estado_final
  `, [desdeLocal, hastaLocal]);

  const garantias = await db.get(`
    SELECT COUNT(*) as total FROM garantias WHERE fecha_creacion >= ? AND fecha_creacion < ?
  `, [desdeUTC, hastaUTC]);

  const fueraTolerancia = await db.get(`
    SELECT COUNT(*) as total
    FROM moldes_medidas_detalle m
    JOIN moldes_inspecciones i ON m.inspeccion_id = i.id
    WHERE m.estado = 'FUERA DE TOLERANCIA' AND i.created_at >= ? AND i.created_at < ?
  `, [desdeUTC, hastaUTC]);

  // Top de referencias con más garantías en el periodo (en vez del listado
  // de las garantías más recientes que traía antes) — para la tabla
  // "Garantías Reportadas" del PDF del resumen, que ahora muestra cuáles
  // referencias se repiten más en vez de solo las últimas que entraron.
  const garantiasTop = await topReferenciasGarantias(desdeUTC, hastaUTC, 10);

  // Detalle de las medidas fuera de tolerancia del periodo (cuáles
  // referencias y por cuánto se salieron), para la sección de Metrología
  // del PDF — antes solo se mostraba el conteo total.
  const fueraToleranciaDetalle = await fueraToleranciaDetallePeriodo(desdeUTC, hastaUTC, 10);

  return {
    primeraPieza,
    enProceso: enProceso || { total: 0, paradas: 0, alertas: 0, piezas_reclasificadas: 0, piezas_reparadas: 0 },
    final,
    lotesTratamiento,
    garantias: garantias ? garantias.total : 0,
    garantiasTop,
    fueraTolerancia: fueraTolerancia ? fueraTolerancia.total : 0,
    fueraToleranciaDetalle,
  };
}

// ======================== REPORTE APARTE DE GARANTÍAS (roadmap #2) ========================
// A diferencia de obtenerResumenPeriodo (que trae un resumen de TODO
// calidad, con las garantías como una sección más), esto es un reporte
// dedicado solo a garantías para un periodo — mismo mes/quincena/día que ya
// se puede pedir con "mensual"/"quincenal"/"diario", pero con más detalle
// del que cabría dentro del resumen general: cuántas referencias y
// clientes distintos, el top de motivos de garantía (no solo de
// referencias) y el detalle completo del periodo (hasta 40 registros, con
// aviso de cuántos quedaron afuera si hubo más). El resumen general sigue
// trayendo su propia sección de garantías (conteo + top 10) sin cambios —
// este reporte es un complemento, no un reemplazo.
async function obtenerGarantiasReportePeriodo({ desdeUTC, hastaUTC }) {
  const db = getDb();

  const totales = await db.get(`
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT NULLIF(TRIM(referencia), '')) as referencias_distintas,
      COUNT(DISTINCT NULLIF(TRIM(cliente), '')) as clientes_distintos
    FROM garantias
    WHERE fecha_creacion >= ? AND fecha_creacion < ?
  `, [desdeUTC, hastaUTC]);

  const topReferencias = await topReferenciasGarantias(desdeUTC, hastaUTC, 10);

  const topMotivos = await db.all(`
    SELECT problema, COUNT(*) as total
    FROM garantias
    WHERE problema IS NOT NULL AND TRIM(problema) != '' AND fecha_creacion >= ? AND fecha_creacion < ?
    GROUP BY problema
    ORDER BY total DESC
    LIMIT 8
  `, [desdeUTC, hastaUTC]);

  const detalle = await db.all(`
    SELECT referencia, cliente, problema, fecha_creacion
    FROM garantias
    WHERE fecha_creacion >= ? AND fecha_creacion < ?
    ORDER BY fecha_creacion DESC
    LIMIT 40
  `, [desdeUTC, hastaUTC]);

  return {
    total: totales ? totales.total : 0,
    referenciasDistintas: totales ? totales.referencias_distintas : 0,
    clientesDistintos: totales ? totales.clientes_distintos : 0,
    topReferencias,
    topMotivos,
    detalle,
  };
}

module.exports = {
  obtenerTendencias,
  obtenerResumenPorProducto,
  obtenerUltimosMuestreos,
  obtenerResumenMetrologia,
  obtenerUltimosComentariosSMD,
  obtenerPicoGarantias,
  obtenerResumenPeriodo,
  obtenerGarantiasReportePeriodo,
};
