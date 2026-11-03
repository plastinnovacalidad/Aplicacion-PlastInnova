// ============ REVISIÓN DE FOTOS DE FORMA DE CABLEADO (y limpieza de links de Drive) ============
// Las formas de cableado (tabla elec_fotos_cableado) todavía guardan el link
// de Google Drive de la app anterior (columna url_foto). Hoy la app muestra la
// foto desde el ARCHIVO con el nombre de la forma (ej. "1037.jpg") que está en
// CARPETA_FOTOS_CABLEADO (.env); el link de Drive solo se usa si no hay
// archivo.
//
// Paso 1 (sin opciones): solo REVISA y arma el Excel
//   "Claude outputs/Revision_fotos_cableado_AAAA-MM-DD.xlsx" con cada forma y
//   si tiene su archivo. No cambia nada.
// Paso 2 (--vaciar-links): además, a las formas que SÍ tienen su archivo en
//   CARPETA_FOTOS_CABLEADO les deja vacío el link de Drive (url_foto = '').
//   Las que no tienen archivo conservan su link. Antes hace una copia de
//   respaldo completa de la base en db/respaldos/. No borra ninguna fila.
//
// Uso (desde la carpeta de la app):
//   node scripts/revisar_fotos_cableado.js
//   node scripts/revisar_fotos_cableado.js --vaciar-links
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const ExcelJS = require('exceljs');
const { DB_PATH, CARPETAS_FOTOS, CARPETA_FOTOS_CABLEADO, RAIZ_PROYECTO } = require('../settings/paths');
const { escanearRecursivo } = require('../utils/archivos');

const VACIAR = process.argv.includes('--vaciar-links');

function nombresEn(carpetas) {
  const nombres = new Set();
  for (const carpeta of carpetas) {
    if (!fs.existsSync(carpeta)) {
      console.log(`   ⚠️  No se encontró la carpeta ${carpeta} (se omite)`);
      continue;
    }
    const rutas = escanearRecursivo(carpeta);
    rutas.forEach(r => nombres.add(path.win32.basename(r).toLowerCase()));
    console.log(`   ${carpeta}: ${rutas.length} imágenes`);
  }
  return nombres;
}

async function main() {
  console.log(`\nRevisando fotos de forma de cableado${VACIAR ? ' y vaciando links de Drive' : ' (solo revisión)'}...`);
  console.log('\nCarpeta de fotos de cableado:');
  const enCableado = nombresEn([CARPETA_FOTOS_CABLEADO]);
  console.log('Otras carpetas de fotos (la app también busca ahí):');
  const enOtras = nombresEn(CARPETAS_FOTOS);

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database, mode: VACIAR ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY });
  await db.exec('PRAGMA busy_timeout = 10000');
  // Desde la MIGRACIÓN #52 la columna url_foto ya no existe: en ese caso
  // solo se revisan los archivos (no hay links que vaciar).
  const tieneColumnaLink = (await db.all('PRAGMA table_info(elec_fotos_cableado)')).some(c => c.name === 'url_foto');
  if (VACIAR && !tieneColumnaLink) console.log('\nLa columna de links de Drive (url_foto) ya no existe: no hay nada que vaciar.');
  const formas = await db.all(`
    SELECT f.forma_cableado, ${tieneColumnaLink ? 'f.url_foto' : "'' AS url_foto"},
      (SELECT COUNT(*) FROM elec_config_cableado c JOIN versiones v ON v.id = c.version_id
        WHERE c.forma_cableado = f.forma_cableado AND v.estado = 'activa') AS versiones_activas
    FROM elec_fotos_cableado f
    ORDER BY f.forma_cableado`);

  const filas = formas.map(f => {
    const clave = String(f.forma_cableado || '').toLowerCase();
    const tieneLink = !!String(f.url_foto || '').trim();
    let estado;
    if (enCableado.has(clave)) estado = 'OK: archivo en la carpeta de cableado';
    else if (enOtras.has(clave)) estado = 'Archivo en otra carpeta de fotos (copiarlo a la de cableado)';
    else if (tieneLink) estado = 'FALTA el archivo: solo tiene el link de Drive';
    else estado = 'FALTA el archivo y no tiene link (no tiene foto)';
    return { forma: f.forma_cableado, versiones: f.versiones_activas, estado, link: tieneLink ? 'Sí' : 'No', url: f.url_foto || '', vaciar: enCableado.has(clave) && tieneLink };
  });

  // ---------- Paso 2: vaciar links de las que ya tienen archivo ----------
  let vaciados = 0;
  if (VACIAR && tieneColumnaLink) {
    const aVaciar = filas.filter(f => f.vaciar).map(f => f.forma);
    if (aVaciar.length) {
      const carpetaRespaldo = path.join(path.dirname(DB_PATH), 'respaldos');
      fs.mkdirSync(carpetaRespaldo, { recursive: true });
      const marca = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
      const respaldo = path.join(carpetaRespaldo, `base_datos_antes_vaciar_links_cableado_${marca}.db`);
      await db.exec(`VACUUM INTO '${respaldo.replace(/'/g, "''")}'`);
      console.log(`\n💾 Copia de respaldo: ${respaldo}`);
      await db.exec('BEGIN IMMEDIATE');
      try {
        for (const forma of aVaciar) {
          const r = await db.run("UPDATE elec_fotos_cableado SET url_foto = '' WHERE forma_cableado = ?", [forma]);
          vaciados += r.changes || 0;
        }
        await db.exec('COMMIT');
      } catch (e) {
        await db.exec('ROLLBACK').catch(() => {});
        throw e;
      }
      filas.forEach(f => { if (f.vaciar) { f.link = 'No (vaciado)'; f.url = ''; } });
    }
  }
  await db.close();

  // ---------- Excel ----------
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Formas de cableado', { views: [{ state: 'frozen', ySplit: 3 }] });
  ws.getCell('A1').value = 'Fotos de forma de cableado';
  ws.getCell('A1').font = { name: 'Arial', bold: true, size: 13, color: { argb: 'FF1A2A4E' } };
  ws.getCell('A2').value = `Carpeta: ${CARPETA_FOTOS_CABLEADO} · ${new Date().toLocaleString('es-CO')}${VACIAR ? ` · links de Drive vaciados: ${vaciados}` : ''}`;
  ws.getCell('A2').font = { name: 'Arial', size: 10, color: { argb: 'FF5B6475' } };
  const cols = [
    { key: 'forma', titulo: 'Forma de cableado', ancho: 22 },
    { key: 'versiones', titulo: 'Versiones activas que la usan', ancho: 14 },
    { key: 'estado', titulo: 'Estado', ancho: 52 },
    { key: 'link', titulo: 'Link de Drive', ancho: 14 },
    { key: 'url', titulo: 'Link', ancho: 60 },
  ];
  ws.columns = cols.map(c => ({ key: c.key, width: c.ancho }));
  const enc = ws.getRow(3);
  cols.forEach((c, i) => {
    const celda = enc.getCell(i + 1);
    celda.value = c.titulo;
    celda.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2A4E' } };
    celda.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  enc.height = 30;
  // Primero las que tienen problema, después las que están bien.
  const orden = (e) => (e.startsWith('FALTA') ? 0 : e.startsWith('Archivo') ? 1 : 2);
  filas.sort((a, b) => orden(a.estado) - orden(b.estado) || String(a.forma).localeCompare(String(b.forma)));
  filas.forEach(f => {
    const fila = ws.addRow(cols.map(c => f[c.key]));
    fila.font = { name: 'Arial', size: 10 };
    if (f.estado.startsWith('FALTA')) fila.getCell(3).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFC00000' } };
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + filas.length, column: cols.length } };

  const carpeta = path.join(RAIZ_PROYECTO, 'Claude outputs');
  fs.mkdirSync(carpeta, { recursive: true });
  const destino = path.join(carpeta, `Revision_fotos_cableado_${new Date().toLocaleDateString('sv-SE')}.xlsx`);
  await wb.xlsx.writeFile(destino);

  const resumen = filas.reduce((o, f) => { o[f.estado] = (o[f.estado] || 0) + 1; return o; }, {});
  console.log(`\nFormas revisadas: ${filas.length}`);
  Object.entries(resumen).forEach(([k, v]) => console.log(`   ${String(v).padStart(4)}  ${k}`));
  if (VACIAR) console.log(`\n🧹 Links de Drive vaciados: ${vaciados}`);
  else console.log(`\nSolo revisión: no se cambió nada. Se podrían vaciar ${filas.filter(f => f.vaciar).length} link(s) con --vaciar-links.`);
  console.log(`✅ Excel: ${destino}\n`);
}

main().catch((e) => { console.error('❌ Error:', e.message); process.exit(1); });
