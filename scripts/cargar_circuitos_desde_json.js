// ============ CARGA DE CIRCUITOS SMD + VALORES Y CABLEADO DESDE UN ARCHIVO JSON ============
// Reemplaza COMPLETAS estas 7 tablas de la base SQLite con el contenido de un
// archivo JSON preparado a partir del Excel que Julio actualizó a mano
// (Exportacion_versiones_cableado_2026-10-22.xlsx, hoja "Versiones con valores"):
//
//   Referencias, Versiones, elec_fotos_cableado, elec_mediciones,
//   elec_rangos_revision, elec_config_cableado, observaciones
//
// Por qué reemplazar y no actualizar: en el Excel los id se renumeraron
// (una referencia por código, versiones anteriores como historial), así que
// no se pueden mezclar con los registros actuales sin romper las relaciones.
//
// Seguridad:
//   - Sin --aplicar solo REVISA (no escribe nada): valida el archivo y muestra
//     cuántas filas hay hoy y cuántas quedarían.
//   - Con --aplicar: se niega a correr si la app está encendida (puerto del
//     .env ocupado), hace una copia de respaldo completa de la base en
//     db/respaldos/ y hace todo dentro de UNA transacción: si cualquier
//     inserción o la revisión de relaciones falla, se deshace todo.
//
// Uso (desde la carpeta de la app, con la app APAGADA):
//   node scripts/cargar_circuitos_desde_json.js "Claude outputs/carga_circuitos_2026-10-22.json"
//   node scripts/cargar_circuitos_desde_json.js "Claude outputs/carga_circuitos_2026-10-22.json" --aplicar
//
// Para volver atrás: apagar la app y reemplazar db/base_datos.db por la copia
// de db/respaldos/ que indique este script (borrando base_datos.db-wal y -shm).
const fs = require('fs');
const path = require('path');
const net = require('net');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { DB_PATH, PORT } = require('../settings/paths');

// Orden de inserción (padres primero). Para borrar se usa el orden inverso.
const TABLAS = [
  ['Referencias', ['id', 'codigo_base', 'creado_por', 'created_at', 'activa']],
  ['Versiones', ['id', 'referencia_id', 'version', 'imagen_ruta', 'estado', 'creado_por', 'created_at', 'necesita_prueba']],
  ['elec_fotos_cableado', ['id', 'forma_cableado', 'url_foto']],
  ['elec_mediciones', ['id', 'version_id', 'voltaje_revision', 'amperaje_medias', 'amperaje_altas', 'potencia_medias', 'potencia_altas']],
  ['elec_rangos_revision', ['id', 'version_id', 'voltaje_min', 'voltaje_max', 'amperaje_min_bajas', 'amperaje_min_altas', 'amperaje_max', 'potencia_min_bajas', 'potencia_min_altas', 'potencia_max']],
  ['elec_config_cableado', ['id', 'version_id', 'cortar_puntas', 'posicion_punto', 'empujar_cables', 'forma_cableado', 'referencia_cable', 'no_aplica_medias']],
  ['observaciones', ['id', 'referencia_id', 'observacion', 'actualizado_por', 'actualizado_en']],
];

function appEncendida(puerto) {
  return new Promise((resolve) => {
    const s = net.connect({ port: Number(puerto), host: '127.0.0.1' });
    s.setTimeout(1500);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(false));
  });
}

// Revisa el archivo antes de tocar la base: columnas, id repetidos y que
// cada relación apunte a algo que existe en el mismo archivo.
function validar(t) {
  const errores = [];
  for (const [tabla, cols] of TABLAS) {
    const filas = t[tabla];
    if (!Array.isArray(filas)) { errores.push(`Falta la tabla ${tabla} en el archivo.`); continue; }
    const ids = new Set();
    filas.forEach((f, i) => {
      for (const c of cols) if (!(c in f)) errores.push(`${tabla} fila ${i + 1}: falta la columna ${c}.`);
      if (!Number.isInteger(f.id)) errores.push(`${tabla} fila ${i + 1}: id no válido.`);
      if (ids.has(f.id)) errores.push(`${tabla}: id ${f.id} repetido.`);
      ids.add(f.id);
    });
  }
  if (errores.length) return errores;
  const refIds = new Set(t.Referencias.map(r => r.id));
  const verIds = new Set(t.Versiones.map(v => v.id));
  const formas = new Set(t.elec_fotos_cableado.map(f => f.forma_cableado));
  const unico = (tabla, col) => {
    const vistos = new Set();
    for (const f of t[tabla]) {
      const k = String(f[col]).toUpperCase();
      if (vistos.has(k)) errores.push(`${tabla}: ${col} "${f[col]}" repetido.`);
      vistos.add(k);
    }
  };
  unico('Referencias', 'codigo_base');
  unico('elec_fotos_cableado', 'forma_cableado');
  for (const tabla of ['elec_mediciones', 'elec_rangos_revision', 'elec_config_cableado']) unico(tabla, 'version_id');
  unico('observaciones', 'referencia_id');
  for (const v of t.Versiones) {
    if (!refIds.has(v.referencia_id)) errores.push(`Versiones id ${v.id}: referencia_id ${v.referencia_id} no existe.`);
    if (!['activa', 'obsoleta'].includes(v.estado)) errores.push(`Versiones id ${v.id}: estado "${v.estado}" no válido.`);
  }
  const activas = {};
  for (const v of t.Versiones) if (v.estado === 'activa') activas[v.referencia_id] = (activas[v.referencia_id] || 0) + 1;
  for (const r of t.Referencias) if (activas[r.id] !== 1) errores.push(`Referencia ${r.codigo_base}: tiene ${activas[r.id] || 0} versiones activas (debe ser 1).`);
  for (const tabla of ['elec_mediciones', 'elec_rangos_revision', 'elec_config_cableado']) {
    for (const f of t[tabla]) if (!verIds.has(f.version_id)) errores.push(`${tabla} id ${f.id}: version_id ${f.version_id} no existe.`);
  }
  for (const f of t.elec_config_cableado) {
    if (f.forma_cableado && !formas.has(f.forma_cableado)) errores.push(`elec_config_cableado id ${f.id}: forma "${f.forma_cableado}" no tiene foto.`);
  }
  for (const o of t.observaciones) if (!refIds.has(o.referencia_id)) errores.push(`observaciones id ${o.id}: referencia_id ${o.referencia_id} no existe.`);
  return errores;
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const archivo = args.find(a => !a.startsWith('--'));
  if (!archivo) {
    console.error('Uso: node scripts/cargar_circuitos_desde_json.js "<archivo.json>" [--aplicar]');
    process.exit(1);
  }
  const datos = JSON.parse(fs.readFileSync(path.resolve(archivo), 'utf8'));
  const t = datos.tablas || {};

  console.log(`\nArchivo: ${archivo}${datos.origen ? `\nOrigen:  ${datos.origen}` : ''}`);
  const errores = validar(t);
  if (errores.length) {
    console.error(`\n❌ El archivo tiene ${errores.length} problema(s); no se carga nada:`);
    errores.slice(0, 50).forEach(e => console.error('   - ' + e));
    process.exit(1);
  }
  console.log('✅ Archivo revisado: columnas, id y relaciones en orden.');

  if (aplicar && await appEncendida(PORT)) {
    console.error(`\n❌ La app está encendida (puerto ${PORT}). Apágala (Ctrl + C en su ventana) y vuelve a correr este comando.`);
    process.exit(1);
  }

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec('PRAGMA foreign_keys = ON');

  console.log(`\nBase: ${DB_PATH}\n`);
  console.log('Tabla'.padEnd(24) + 'Hoy'.padStart(8) + 'Quedaría'.padStart(10));
  for (const [tabla] of TABLAS) {
    const { n } = await db.get(`SELECT COUNT(*) AS n FROM "${tabla}"`);
    console.log(tabla.padEnd(24) + String(n).padStart(8) + String(t[tabla].length).padStart(10));
  }

  if (!aplicar) {
    console.log('\nSolo revisión: no se cambió nada. Para cargar, apaga la app y agrega --aplicar al final del comando.');
    await db.close();
    return;
  }

  // Copia de respaldo consistente (VACUUM INTO incluye lo que esté en el -wal).
  const carpetaRespaldo = path.join(path.dirname(DB_PATH), 'respaldos');
  fs.mkdirSync(carpetaRespaldo, { recursive: true });
  const marca = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const respaldo = path.join(carpetaRespaldo, `base_datos_antes_carga_circuitos_${marca}.db`);
  await db.exec(`VACUUM INTO '${respaldo.replace(/'/g, "''")}'`);
  console.log(`\n💾 Copia de respaldo: ${respaldo}`);

  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const [tabla] of [...TABLAS].reverse()) await db.run(`DELETE FROM "${tabla}"`);
    for (const [tabla, cols] of TABLAS) {
      const sql = `INSERT INTO "${tabla}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
      const stmt = await db.prepare(sql);
      for (const fila of t[tabla]) await stmt.run(cols.map(c => (fila[c] === undefined ? null : fila[c])));
      await stmt.finalize();
      // Que los próximos registros que cree la app sigan después del último id cargado.
      const { m } = await db.get(`SELECT COALESCE(MAX(id), 0) AS m FROM "${tabla}"`);
      const existe = await db.get('SELECT 1 FROM sqlite_sequence WHERE name = ?', [tabla]);
      if (existe) await db.run('UPDATE sqlite_sequence SET seq = ? WHERE name = ?', [m, tabla]);
      else await db.run('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)', [tabla, m]);
    }
    const rotas = await db.all('PRAGMA foreign_key_check');
    const nuestras = rotas.filter(r => TABLAS.some(([tb]) => tb.toLowerCase() === String(r.table).toLowerCase()));
    if (nuestras.length) throw new Error(`Relaciones rotas después de cargar: ${JSON.stringify(nuestras.slice(0, 5))}`);
    for (const [tabla] of TABLAS) {
      const { n } = await db.get(`SELECT COUNT(*) AS n FROM "${tabla}"`);
      if (n !== t[tabla].length) throw new Error(`${tabla}: quedaron ${n} filas y se esperaban ${t[tabla].length}.`);
    }
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK').catch(() => {});
    await db.close();
    console.error(`\n❌ No se cargó nada (se deshizo todo): ${e.message}`);
    process.exit(1);
  }
  await db.close();
  console.log('\n✅ Carga terminada. Ya puedes encender la app y revisar Circuitos SMD y Valores y Cableado.');
}

main().catch((e) => { console.error('❌ Error:', e.message); process.exit(1); });
