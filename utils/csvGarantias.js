const fs = require('fs');
const path = require('path');

// ======================== CSV DE GARANTÍAS PARA EXCEL ========================
// Pedido por Julio (17/11/2026): un archivo CSV con todas las garantías en
//   P:\1. Equipo Produccion\15.3 Calidad\15.3.4 Estadisticas\2.Garantias\garantias.csv
// para armar reportes en Excel. Se sobrescribe cada vez (mismo nombre y
// lugar), así un Excel conectado a ese archivo solo tiene que "Actualizar".
// Se genera con el botón "Actualizar archivo CSV" del Tablero de Garantías
// (POST /api/garantias/exportar-csv). La ruta se puede cambiar con
// RUTA_CSV_GARANTIAS en el .env.
//
// Formato pensado para Excel en español: separado por punto y coma, UTF-8
// con BOM (para que las tildes se vean bien) y fechas AAAA-MM-DD. Los datos
// van limpios para poder agrupar: referencia en mayúsculas y sin "Lam/",
// ciudad sin tildes y en mayúsculas (BOGOTA y "Bogotá, D.C." quedan iguales),
// cliente en mayúsculas, y fecha inválida vacía (el texto original queda en
// la última columna).
const RUTA_CSV_GARANTIAS = process.env.RUTA_CSV_GARANTIAS
  || 'P:\\1. Equipo Produccion\\15.3 Calidad\\15.3.4 Estadisticas\\2.Garantias\\garantias.csv';

const COLUMNAS = [
  ['ID', g => g.id],
  ['No garantia', g => g.no_garantia],
  ['Fecha reporte', g => g._fecha],
  ['Anio', g => (g._fecha ? g._fecha.slice(0, 4) : '')],
  ['Mes', g => (g._fecha ? g._fecha.slice(0, 7) : '')],
  ['Cliente', g => limpiarMayus(g.cliente)],
  ['NIT', g => g.nit_cliente],
  ['Ciudad', g => ciudad(g.ciudad)],
  ['Asesora', g => g.vendedor_distribuidor],
  ['Responsable', g => g.responsable],
  ['Remision', g => g.remision],
  ['Pedido', g => g.op_pedido],
  ['Referencia', g => referencia(g.referencia)],
  ['Modelo', g => referencia(g.referencia).split('/')[0]],
  ['Cantidad', g => (Number.isFinite(Number(g.cantidad)) ? Number(g.cantidad) : '')],
  ['Tipo solicitud', g => String(g.tipo_solicitud || '').trim().toUpperCase()],
  ['Estado', g => g.estado],
  ['Causal', g => (/^G\d+\s*-/.test(String(g.problema || '').trim()) ? String(g.problema).trim() : '')],
  ['Lote', g => g.lote_fecha],
  ['Fecha revision', g => fechaIso(g.fecha_revision)],
  ['Aprobo o rechazo', g => g.quien_aprobo_rechazo],
  ['Observaciones', g => g.observaciones],
  ['Observacion calidad', g => g.observacion_calidad],
  ['Tipo circuito', g => g.tipo_circuito],
  ['Origen', g => (g.origen_app_id ? 'App de Garantias' : 'App principal')],
  ['Fecha creacion', g => g.fecha_creacion],
  ['Fecha reporte original', g => g.fecha_reporte],
];

// Acepta AAAA-MM-DD y D/M/AAAA (las dos formas que hay en la tabla).
function fechaIso(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  let a, mes, d;
  if (m) { [, a, mes, d] = m; }
  else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) { [, d, mes, a] = m; }
  else return '';
  const f = new Date(Date.UTC(+a, +mes - 1, +d));
  if (isNaN(f) || f.getUTCFullYear() < 2020 || f.getUTCMonth() !== +mes - 1) return '';
  return f.toISOString().slice(0, 10);
}
const sinTildes = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const limpiarMayus = (s) => String(s || '').trim().replace(/\s+/g, ' ').toUpperCase();
function ciudad(s) {
  return sinTildes(String(s || '').trim().toUpperCase()).replace(/,?\s*D\.?\s*C\.?$/, '').trim();
}
function referencia(s) {
  return String(s || '').trim().toUpperCase().replace(/\s+/g, '').replace(/^LAM\//, '');
}

function campoCsv(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/\r?\n/g, ' ');
  return /[;"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function generarCsv(garantias) {
  const lineas = [COLUMNAS.map(c => c[0]).join(';')];
  for (const g of garantias) {
    g._fecha = fechaIso(g.fecha_reporte);
    lineas.push(COLUMNAS.map(([, f]) => campoCsv(f(g))).join(';'));
  }
  return '\uFEFF' + lineas.join('\r\n') + '\r\n';
}

// Escribe el archivo. Primero en un temporal y luego lo reemplaza, para que
// nunca quede un CSV a medias. Si el archivo está abierto en Excel, Windows
// no deja reemplazarlo: se avisa con un mensaje claro.
function escribirCsvGarantias(garantias) {
  const carpeta = path.dirname(RUTA_CSV_GARANTIAS);
  if (!fs.existsSync(carpeta)) {
    const e = new Error(`No se encontró la carpeta ${carpeta}. Revisa que la unidad P: esté conectada en el equipo de la app.`);
    e.status = 500;
    throw e;
  }
  const temporal = RUTA_CSV_GARANTIAS + '.tmp';
  fs.writeFileSync(temporal, generarCsv(garantias), 'utf-8');
  try {
    fs.renameSync(temporal, RUTA_CSV_GARANTIAS);
  } catch (err) {
    try { fs.unlinkSync(temporal); } catch (e) { /* nada que limpiar */ }
    if (['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) {
      const e = new Error('No se pudo reemplazar garantias.csv: probablemente está abierto en Excel. Ciérralo y vuelve a intentar.');
      e.status = 409;
      throw e;
    }
    throw err;
  }
  return { ruta: RUTA_CSV_GARANTIAS, filas: garantias.length, generado: new Date().toISOString() };
}

module.exports = { RUTA_CSV_GARANTIAS, generarCsv, escribirCsvGarantias };
