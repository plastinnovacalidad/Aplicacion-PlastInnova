const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');
const { RAIZ_PROYECTO } = require('../settings/paths');

// ======================== CAJA ROJA ========================
// Registro de piezas que van a la caja roja (MIGRACIÓN #53). Ver
// routes/cajaRoja.js para las reglas de cada endpoint.

// ---------------------------------------------------------------- maestro
// El maestro de referencias (ítems del ERP) vive en un archivo JSON y no en
// una tabla: se reemplaza completo cada vez que se carga un CSV nuevo del
// ERP, la tablet lo descarga entero para poder buscar sin conexión, y así
// funciona igual con SQLite o con SQL Server sin una tabla más que migrar.
const ARCHIVO_MAESTRO = path.join(RAIZ_PROYECTO, 'db', 'caja_roja_maestro.json');

// Por ahora solo estos tipos de referencia (pedido por Julio). Los demás se
// incluirán más adelante: basta con agregarlos aquí y volver a cargar el CSV.
const PREFIJOS_MAESTRO = ['LAM', 'CIR', 'SUP', 'INY'];

let maestroCache = null;

function leerMaestro() {
  if (maestroCache) return maestroCache;
  try {
    if (fs.existsSync(ARCHIVO_MAESTRO)) {
      maestroCache = JSON.parse(fs.readFileSync(ARCHIVO_MAESTRO, 'utf-8'));
      return maestroCache;
    }
  } catch (e) {
    console.error('⚠️ Error leyendo el maestro de Caja roja:', e.message);
  }
  return { actualizado: null, total: 0, items: [] };
}

function guardarMaestro(items, usuarioNombre) {
  const datos = {
    actualizado: new Date().toISOString(),
    actualizado_por: usuarioNombre || null,
    total: items.length,
    items,
  };
  // Se escribe primero a un archivo temporal y luego se renombra, para que
  // un corte de luz a mitad de la escritura no deje el maestro dañado.
  const temporal = ARCHIVO_MAESTRO + '.tmp';
  fs.writeFileSync(temporal, JSON.stringify(datos));
  fs.renameSync(temporal, ARCHIVO_MAESTRO);
  maestroCache = datos;
  return datos;
}

// Separa una línea de CSV respetando comillas ("a;b" queda como un solo campo).
function partirLineaCsv(linea, sep) {
  const campos = [];
  let actual = '';
  let enComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (enComillas) {
      if (c === '"' && linea[i + 1] === '"') { actual += '"'; i++; }
      else if (c === '"') enComillas = false;
      else actual += c;
    } else if (c === '"') enComillas = true;
    else if (c === sep) { campos.push(actual); actual = ''; }
    else actual += c;
  }
  campos.push(actual);
  return campos;
}

// Convierte el CSV del ERP (columnas f120_id, f120_referencia,
// f120_descripcion; separado por coma o punto y coma) en [[id, ref, desc]].
// Devuelve { items, error }.
function interpretarCsvMaestro(texto) {
  const lineas = String(texto || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');
  if (lineas.length < 2) return { error: 'El archivo está vacío o no tiene filas.' };
  const sep = (lineas[0].split(';').length > lineas[0].split(',').length) ? ';' : ',';
  const encabezado = partirLineaCsv(lineas[0], sep).map(h => h.trim().toLowerCase());
  const iId = encabezado.indexOf('f120_id');
  const iRef = encabezado.indexOf('f120_referencia');
  const iDesc = encabezado.indexOf('f120_descripcion');
  if (iId === -1 || iRef === -1 || iDesc === -1) {
    return { error: 'El CSV debe tener las columnas f120_id, f120_referencia y f120_descripcion.' };
  }
  const vistos = new Set();
  const items = [];
  for (let n = 1; n < lineas.length; n++) {
    const c = partirLineaCsv(lineas[n], sep);
    const ref = (c[iRef] || '').trim().toUpperCase();
    if (!ref || vistos.has(ref)) continue;
    if (!PREFIJOS_MAESTRO.includes(ref.split('/')[0])) continue;
    vistos.add(ref);
    items.push([(c[iId] || '').trim(), ref, (c[iDesc] || '').trim().replace(/\s+/g, ' ')]);
  }
  items.sort((a, b) => a[1].localeCompare(b[1]));
  if (!items.length) return { error: `No se encontró ninguna referencia que empiece por ${PREFIJOS_MAESTRO.join(', ')}.` };
  return { items };
}

// ---------------------------------------------------------------- registros
const AREAS_CAJA_ROJA = ['Fábrica 1', 'Fábrica 2', 'Fábrica 3', 'Fábrica 4'];

// INSERT OR IGNORE por `uid`: si la tablet reenvía un registro que ya llegó
// (la red se cayó antes de recibir la respuesta), no se duplica.
async function insertarRegistro(r) {
  const res = await getDb().run(
    `INSERT OR IGNORE INTO caja_roja_registros
       (uid, fecha, hora_registro, area, usuario_id, usuario_nombre, f120_id, referencia, descripcion, lote, cantidad, sin_conexion, recibido_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [r.uid, r.fecha, r.hora_registro, r.area, r.usuario_id, r.usuario_nombre, r.f120_id, r.referencia, r.descripcion,
     r.lote, r.cantidad, r.sin_conexion ? 1 : 0, new Date().toISOString()]
  );
  return res && res.changes > 0;
}

function listarRegistros(filtros = {}) {
  const condiciones = ['eliminado = 0'];
  const params = [];
  if (filtros.desde) { condiciones.push('fecha >= ?'); params.push(filtros.desde); }
  if (filtros.hasta) { condiciones.push('fecha <= ?'); params.push(filtros.hasta); }
  if (filtros.area) { condiciones.push('area = ?'); params.push(filtros.area); }
  if (filtros.usuarioId) { condiciones.push('usuario_id = ?'); params.push(filtros.usuarioId); }
  return getDb().all(
    `SELECT id, uid, fecha, hora_registro, area, usuario_id, usuario_nombre, f120_id, referencia, descripcion, lote, cantidad, sin_conexion
     FROM caja_roja_registros
     WHERE ${condiciones.join(' AND ')}
     ORDER BY fecha DESC, hora_registro DESC, id DESC
     LIMIT 3000`,
    params
  );
}

function buscarRegistro(id) {
  return getDb().get('SELECT * FROM caja_roja_registros WHERE id = ? AND eliminado = 0', [id]);
}

async function eliminarRegistro(id, usuarioId, usuarioNombre) {
  const res = await getDb().run(
    'UPDATE caja_roja_registros SET eliminado = 1, eliminado_por = ?, eliminado_por_nombre = ?, eliminado_en = ? WHERE id = ? AND eliminado = 0',
    [usuarioId || null, usuarioNombre || null, new Date().toISOString(), id]
  );
  return res && res.changes > 0;
}

// Resumen para la pestaña "Reporte semanal": totales del rango, piezas por
// referencia, por fábrica y por día (y fábrica). Solo cuenta registros no
// eliminados. Consultas simples (GROUP BY) que sirven igual en SQLite y en
// SQL Server.
async function resumenRegistros({ desde, hasta, area }) {
  const db = getDb();
  const condiciones = ['eliminado = 0', 'fecha >= ?', 'fecha <= ?'];
  const params = [desde, hasta];
  if (area) { condiciones.push('area = ?'); params.push(area); }
  const where = 'WHERE ' + condiciones.join(' AND ');

  const totales = await db.get(
    `SELECT COUNT(*) AS registros, COALESCE(SUM(cantidad), 0) AS piezas, COUNT(DISTINCT referencia) AS referencias, COUNT(DISTINCT lote) AS lotes
     FROM caja_roja_registros ${where}`, params);
  const porReferencia = await db.all(
    `SELECT referencia, MAX(descripcion) AS descripcion, SUM(cantidad) AS piezas, COUNT(*) AS registros, COUNT(DISTINCT lote) AS lotes
     FROM caja_roja_registros ${where}
     GROUP BY referencia
     ORDER BY piezas DESC, referencia`, params);
  const porArea = await db.all(
    `SELECT area, SUM(cantidad) AS piezas, COUNT(*) AS registros
     FROM caja_roja_registros ${where}
     GROUP BY area
     ORDER BY area`, params);
  const porFechaArea = await db.all(
    `SELECT fecha, area, SUM(cantidad) AS piezas, COUNT(*) AS registros
     FROM caja_roja_registros ${where}
     GROUP BY fecha, area
     ORDER BY fecha, area`, params);
  return {
    totales: {
      registros: Number(totales.registros) || 0,
      piezas: Number(totales.piezas) || 0,
      referencias: Number(totales.referencias) || 0,
      lotes: Number(totales.lotes) || 0,
    },
    porReferencia: porReferencia.map(r => ({ ...r, piezas: Number(r.piezas), registros: Number(r.registros), lotes: Number(r.lotes) })),
    porArea: porArea.map(r => ({ ...r, piezas: Number(r.piezas), registros: Number(r.registros) })),
    porFechaArea: porFechaArea.map(r => ({ ...r, piezas: Number(r.piezas), registros: Number(r.registros) })),
  };
}

module.exports = {
  resumenRegistros,
  PREFIJOS_MAESTRO,
  AREAS_CAJA_ROJA,
  leerMaestro,
  guardarMaestro,
  interpretarCsvMaestro,
  insertarRegistro,
  listarRegistros,
  buscarRegistro,
  eliminarRegistro,
};
