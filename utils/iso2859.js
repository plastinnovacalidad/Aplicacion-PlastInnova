// ======================== ISO 2859-1 (Nivel de Inspección II) ========================
// Lógica de cálculo de planes de muestreo, portada de la app independiente
// "iso2859-app" al integrarla como módulo de este sistema. Es una tabla
// simplificada de una sola combinación de Nivel de Inspección (II, Normal),
// no las tres tablas completas del estándar por cada AQL — exactamente el
// mismo comportamiento que ya se usaba en producción en la app anterior,
// solo que ahora vive aquí.
const TABLA_ISO = {
  'A': { n: 2,    acCrit: 0, reCrit: 1, acMay: 0,  reMay: 1,  acMen: 0,  reMen: 1 },
  'B': { n: 3,    acCrit: 0, reCrit: 1, acMay: 0,  reMay: 1,  acMen: 0,  reMen: 1 },
  'C': { n: 5,    acCrit: 0, reCrit: 1, acMay: 0,  reMay: 1,  acMen: 0,  reMen: 1 },
  'D': { n: 8,    acCrit: 0, reCrit: 1, acMay: 0,  reMay: 1,  acMen: 1,  reMen: 2 },
  'E': { n: 13,   acCrit: 0, reCrit: 1, acMay: 0,  reMay: 1,  acMen: 1,  reMen: 2 },
  'F': { n: 20,   acCrit: 0, reCrit: 1, acMay: 1,  reMay: 2,  acMen: 2,  reMen: 3 },
  'G': { n: 32,   acCrit: 0, reCrit: 1, acMay: 1,  reMay: 2,  acMen: 3,  reMen: 4 },
  'H': { n: 50,   acCrit: 0, reCrit: 1, acMay: 2,  reMay: 3,  acMen: 5,  reMen: 6 },
  'J': { n: 80,   acCrit: 0, reCrit: 1, acMay: 3,  reMay: 4,  acMen: 7,  reMen: 8 },
  'K': { n: 125,  acCrit: 0, reCrit: 1, acMay: 5,  reMay: 6,  acMen: 10, reMen: 11 },
  'L': { n: 200,  acCrit: 0, reCrit: 1, acMay: 7,  reMay: 8,  acMen: 14, reMen: 15 },
  'M': { n: 315,  acCrit: 0, reCrit: 1, acMay: 10, reMay: 11, acMen: 21, reMen: 22 },
  'N': { n: 500,  acCrit: 0, reCrit: 1, acMay: 14, reMay: 15, acMen: 21, reMen: 22 },
  'P': { n: 800,  acCrit: 0, reCrit: 1, acMay: 21, reMay: 22, acMen: 21, reMen: 22 },
  'Q': { n: 1250, acCrit: 0, reCrit: 1, acMay: 21, reMay: 22, acMen: 21, reMen: 22 },
  'R': { n: 2000, acCrit: 0, reCrit: 1, acMay: 21, reMay: 22, acMen: 21, reMen: 22 },
};

function obtenerLetraCodigo(cantidadLote) {
  if (cantidadLote <= 8) return 'A';
  if (cantidadLote <= 15) return 'B';
  if (cantidadLote <= 25) return 'C';
  if (cantidadLote <= 50) return 'D';
  if (cantidadLote <= 90) return 'E';
  if (cantidadLote <= 150) return 'F';
  if (cantidadLote <= 280) return 'G';
  if (cantidadLote <= 500) return 'H';
  if (cantidadLote <= 1200) return 'J';
  if (cantidadLote <= 3200) return 'K';
  if (cantidadLote <= 10000) return 'L';
  if (cantidadLote <= 35000) return 'M';
  if (cantidadLote <= 150000) return 'N';
  if (cantidadLote <= 500000) return 'P';
  return 'Q';
}

function calcularMuestreo(cantidadLote) {
  const letra = obtenerLetraCodigo(cantidadLote);
  const plan = TABLA_ISO[letra];
  return {
    letra,
    n: plan.n,
    ac: { critico: plan.acCrit, mayor: plan.acMay, menor: plan.acMen },
    re: { critico: plan.reCrit, mayor: plan.reMay, menor: plan.reMen },
  };
}

function evaluarDecision(defectosCriticos, defectosMayores, defectosMenores, isoPlan) {
  if (defectosCriticos >= isoPlan.re.critico) return 'Rechazado';
  if (defectosMayores >= isoPlan.re.mayor) return 'Rechazado';
  if (defectosMenores >= isoPlan.re.menor) return 'Rechazado';
  return 'Aceptado';
}

// Heurística de sugerencia de cambio de plan (Normal/Reforzada/Reducida),
// basada en los últimos 10 muestreos "Final" de la referencia. No es el
// esquema de cambio formal del estándar ISO 2859-1 (que exige conteos
// consecutivos exactos); es una aproximación simplificada, igual que en la
// app original. Recibe `db` ya como el wrapper async/await de este
// proyecto (db/connection.js), no el sqlite3 crudo de la app anterior.
async function sugerirPlan(db, referencia, planActual) {
  const rows = await db.all(
    `SELECT m.decision FROM iso_muestreos m
     JOIN iso_lotes l ON m.id_lote = l.id_lote
     WHERE l.referencia = ? AND m.tipo = 'Final'
     ORDER BY m.fecha_hora DESC LIMIT 10`,
    [referencia]
  );
  const total = rows.length;
  if (total === 0) return { sugerencia: 'Normal', motivo: 'Sin historial de auditorías finales' };

  const rechazados = rows.filter(r => r.decision === 'Rechazado').length;
  const aceptados = rows.filter(r => r.decision === 'Aceptado' || r.decision === 'Aceptado_con_obs').length;

  if (planActual === 'Reforzada') {
    if (aceptados >= 5) return { sugerencia: 'Normal', motivo: `${aceptados} lotes aceptados consecutivamente` };
    return { sugerencia: 'Reforzada', motivo: 'Aún en periodo de reforzada' };
  }
  if (planActual === 'Reducida') {
    if (rechazados >= 1) return { sugerencia: 'Normal', motivo: 'Rechazo detectado en plan reducido' };
    if (aceptados >= 10) return { sugerencia: 'Reducida', motivo: 'Continúa estable' };
    return { sugerencia: 'Normal', motivo: 'Volver a normal por precaución' };
  }
  // planActual === 'Normal' (o cualquier valor no reconocido, por seguridad)
  if (rechazados >= 2) return { sugerencia: 'Reforzada', motivo: `${rechazados} rechazos en los últimos ${total} lotes` };
  if (aceptados >= 10) return { sugerencia: 'Reducida', motivo: `${aceptados} lotes aceptados consecutivamente` };
  return { sugerencia: 'Normal', motivo: 'Histórico estable' };
}

module.exports = { calcularMuestreo, evaluarDecision, sugerirPlan, obtenerLetraCodigo };
