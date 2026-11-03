// ============ REPORTE: REFERENCIAS SIN FOTO DE CIRCUITO O DE FORMA DE CABLEADO ============
// Revisa, en este momento, qué versiones activas no tienen foto y arma un
// Excel con dos hojas en "Claude outputs/Fotos_faltantes_AAAA-MM-DD.xlsx":
//
//   1. Foto de circuito (Circuitos SMD): versión activa sin imagen asignada,
//      o con una ruta cuyo archivo ya no está (ni en esa ruta ni, por nombre,
//      en ninguna de las CARPETAS_FOTOS del .env — igual que busca la app).
//   2. Forma de cableado (Valores y Cableado): versión sin forma asignada, o
//      con forma pero sin archivo en CARPETA_FOTOS_CABLEADO ni en las demás
//      carpetas de fotos (igual que busca la app).
//
// Solo LEE: no cambia nada en la base ni en las carpetas. Se puede correr con
// la app encendida.
//
// Uso (desde la carpeta de la app):
//   node scripts/reporte_fotos_faltantes.js
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const ExcelJS = require('exceljs');
const { DB_PATH, CARPETAS_FOTOS, CARPETA_FOTOS_CABLEADO, RAIZ_PROYECTO } = require('../settings/paths');
const { escanearRecursivo } = require('../utils/archivos');

// Nombres de archivo (en minúscula, como compara la app) que hay en cada
// carpeta, recorriéndola una sola vez en vez de buscar archivo por archivo.
function indexarCarpetas(carpetas) {
  const nombres = new Set();
  for (const carpeta of carpetas) {
    const inicio = Date.now();
    if (!fs.existsSync(carpeta)) {
      console.log(`   ⚠️  No se encontró la carpeta ${carpeta} (se omite)`);
      continue;
    }
    const rutas = escanearRecursivo(carpeta);
    rutas.forEach(r => nombres.add(path.win32.basename(r).toLowerCase()));
    console.log(`   ${carpeta}: ${rutas.length} imágenes (${((Date.now() - inicio) / 1000).toFixed(0)} s)`);
  }
  return nombres;
}

function partesCodigo(codigo) {
  const p = String(codigo || '').split('/');
  return { base: p.length > 2 ? p[1] : codigo, color: p.length > 3 ? p.slice(2, -1).join('/') : '' };
}

function hoja(wb, nombre, titulo, columnas, filas) {
  const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.getCell('A1').value = titulo;
  ws.getCell('A1').font = { name: 'Arial', bold: true, size: 13, color: { argb: 'FF1A2A4E' } };
  ws.getCell('A2').value = `${filas.length} versión(es) · revisado el ${new Date().toLocaleString('es-CO')}`;
  ws.getCell('A2').font = { name: 'Arial', size: 10, color: { argb: 'FF5B6475' } };
  ws.columns = columnas.map(c => ({ key: c.key, width: c.ancho }));
  const encabezado = ws.getRow(3);
  columnas.forEach((c, i) => {
    const celda = encabezado.getCell(i + 1);
    celda.value = c.titulo;
    celda.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2A4E' } };
    celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  encabezado.height = 28;
  filas.forEach(f => {
    const fila = ws.addRow(columnas.map(c => f[c.key] ?? ''));
    fila.font = { name: 'Arial', size: 10 };
  });
  if (filas.length) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + filas.length, column: columnas.length } };
}

async function main() {
  console.log('\nRevisando fotos de circuito y de forma de cableado...');
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });

  console.log('\nCarpetas de fotos de circuito (CARPETAS_FOTOS):');
  const nombresCircuito = indexarCarpetas(CARPETAS_FOTOS);
  console.log('\nCarpeta de fotos de forma de cableado (CARPETA_FOTOS_CABLEADO):');
  const nombresCableado = indexarCarpetas([CARPETA_FOTOS_CABLEADO]);

  // ---------- 1. Foto de circuito ----------
  const versiones = await db.all(`
    SELECT r.codigo_base, v.version, v.imagen_ruta, substr(v.created_at, 1, 10) AS creada
    FROM versiones v JOIN referencias r ON r.id = v.referencia_id
    WHERE v.estado = 'activa' AND r.activa = 1
    ORDER BY r.codigo_base`);
  const sinCircuito = [];
  for (const v of versiones) {
    const ruta = (v.imagen_ruta || '').trim();
    let motivo = null;
    if (!ruta) motivo = 'Sin foto asignada';
    else if (!fs.existsSync(ruta) && !nombresCircuito.has(path.win32.basename(ruta).toLowerCase())) motivo = 'El archivo no está en ninguna carpeta de fotos';
    if (motivo) sinCircuito.push({ ...partesCodigo(v.codigo_base), referencia: v.codigo_base, version: v.version, creada: v.creada, motivo, ruta });
  }

  // ---------- 2. Forma de cableado (referencias que usan Valores y Cableado) ----------
  const fichas = await db.all(`
    SELECT r.codigo_base, v.version, cc.forma_cableado
    FROM versiones v
    JOIN referencias r ON r.id = v.referencia_id
    LEFT JOIN elec_config_cableado cc ON cc.version_id = v.id
    WHERE v.estado = 'activa' AND r.activa = 1
      AND r.id IN (SELECT DISTINCT v2.referencia_id FROM versiones v2 JOIN elec_mediciones m ON m.version_id = v2.id)
    ORDER BY r.codigo_base`);
  const sinCableado = [];
  for (const f of fichas) {
    const forma = (f.forma_cableado || '').trim();
    let motivo = null;
    if (!forma) motivo = 'Sin forma de cableado asignada';
    else {
      const clave = forma.toLowerCase();
      const hayArchivo = nombresCableado.has(clave) || nombresCircuito.has(clave);
      if (!hayArchivo) motivo = 'La forma no tiene foto';
    }
    if (motivo) sinCableado.push({ ...partesCodigo(f.codigo_base), referencia: f.codigo_base, version: f.version, forma, motivo });
  }
  await db.close();

  // ---------- Excel ----------
  const wb = new ExcelJS.Workbook();
  hoja(wb, 'Foto de circuito', 'Referencias sin foto de circuito (Circuitos SMD)', [
    { key: 'referencia', titulo: 'Referencia', ancho: 26 },
    { key: 'base', titulo: 'Base', ancho: 10 },
    { key: 'color', titulo: 'Color', ancho: 10 },
    { key: 'version', titulo: 'Versión', ancho: 9 },
    { key: 'creada', titulo: 'Creada', ancho: 12 },
    { key: 'motivo', titulo: 'Motivo', ancho: 40 },
    { key: 'ruta', titulo: 'Ruta guardada', ancho: 60 },
  ], sinCircuito);
  hoja(wb, 'Forma de cableado', 'Referencias sin foto de forma de cableado (Valores y Cableado)', [
    { key: 'referencia', titulo: 'Referencia', ancho: 26 },
    { key: 'base', titulo: 'Base', ancho: 10 },
    { key: 'color', titulo: 'Color', ancho: 10 },
    { key: 'version', titulo: 'Versión', ancho: 9 },
    { key: 'forma', titulo: 'Forma de cableado', ancho: 22 },
    { key: 'motivo', titulo: 'Motivo', ancho: 40 },
  ], sinCableado);

  const carpeta = path.join(RAIZ_PROYECTO, 'Claude outputs');
  fs.mkdirSync(carpeta, { recursive: true });
  const destino = path.join(carpeta, `Fotos_faltantes_${new Date().toLocaleDateString('sv-SE')}.xlsx`);
  await wb.xlsx.writeFile(destino);

  const contar = (lista) => lista.reduce((o, f) => { o[f.motivo] = (o[f.motivo] || 0) + 1; return o; }, {});
  console.log(`\nFoto de circuito: ${sinCircuito.length} versión(es) sin foto`, contar(sinCircuito));
  console.log(`Forma de cableado: ${sinCableado.length} versión(es) sin foto`, contar(sinCableado));
  console.log(`\n✅ Excel creado: ${destino}\n`);
}

main().catch((e) => { console.error('❌ Error:', e.message); process.exit(1); });
