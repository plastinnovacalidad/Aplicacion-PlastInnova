// ======================== MIGRACIÓN DE DATOS: iso2859-app → este proyecto ========================
// Copia, UNA SOLA VEZ, los datos reales que ya existían en la app
// independiente "iso2859-app" (referencias, tipificación de defectos,
// planes de muestreo, áreas, revisiones, lotes, muestreos, defectos
// encontrados e historial de planes) hacia las tablas iso_* de esta base de
// datos. No es algo que el servidor deba correr solo en cada arranque —es
// un paso manual, deliberado, como el "npm run seed" que ya tenía la app
// original— así que se ejecuta a mano, una vez, así:
//
//   node scripts/migrar_iso2859.js
//
// Por defecto busca la base de datos vieja en la carpeta hermana
// "iso2859-app" (donde vivía antes de integrarla a este proyecto):
//   <raíz de este proyecto>/../iso2859-app/database/iso2859.db
// Si esa carpeta ya no existe ahí, se le puede indicar la ruta completa al
// archivo .db como argumento:
//   node scripts/migrar_iso2859.js "C:\ruta\a\iso2859.db"
//
// Es seguro correrlo más de una vez: usa INSERT OR IGNORE por llave
// primaria, así que las filas que ya se hayan migrado antes simplemente se
// saltan la segunda vez, sin duplicar nada.
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const { RAIZ_PROYECTO } = require('../settings/paths');
const { inicializarBaseDatos } = require('../db/init');
const { getDb } = require('../db/connection');

const RUTA_BD_VIEJA = process.argv[2]
  || path.join(RAIZ_PROYECTO, '..', 'iso2859-app', 'database', 'iso2859.db');

// Cada entrada: tabla vieja -> tabla nueva, y qué columnas copiar (en el
// mismo orden en ambas tablas — los nombres de columna no cambiaron, solo
// el nombre de la tabla, que ahora lleva el prefijo "iso_").
const TABLAS = [
  { vieja: 'referencias', nueva: 'iso_referencias', columnas: ['nombre', 'tipo_producto', 'estado'] },
  { vieja: 'planes_muestreo', nueva: 'iso_planes_muestreo', columnas: ['producto', 'nivel_inspeccion', 'nca_mayores', 'nca_menores', 'nca_criticos'] },
  { vieja: 'tipificacion_defectos', nueva: 'iso_tipificacion_defectos', columnas: ['id', 'codigo', 'area', 'descripcion', 'estado', 'severidad'] },
  { vieja: 'areas', nueva: 'iso_areas', columnas: ['id', 'nombre', 'modulo', 'estado'] },
  { vieja: 'revisiones', nueva: 'iso_revisiones', columnas: ['id_revision', 'numero_revision', 'referencia', 'cantidad_programada', 'maquina', 'fecha_inicio'] },
  // Lotes y muestreos van después de sus referencias/revisiones, para
  // respetar el orden de las llaves foráneas (aunque SQLite no las valida
  // por defecto en este proyecto, mantener el orden es la práctica correcta).
  { vieja: 'lotes', nueva: 'iso_lotes', columnas: ['id_lote', 'referencia', 'modulo', 'cantidad_total', 'metodo_en_proceso', 'fecha_creacion', 'estado_final', 'plan_actual', 'id_revision', 'proveedor', 'oc_factura', 'maquina'] },
  { vieja: 'muestreos', nueva: 'iso_muestreos', columnas: ['id_muestreo', 'id_lote', 'tipo', 'fecha_hora', 'analista', 'cantidad_muestreada', 'decision', 'observaciones', 'turno', 'area', 'operario'] },
  { vieja: 'defectos_encontrados', nueva: 'iso_defectos_encontrados', columnas: ['id', 'id_muestreo', 'codigo_defecto', 'cantidad'] },
  // 'historial_planes' -> 'iso_historial_planes' se quitó de esta lista:
  // esa tabla destino ya no existe (se unificó en registro_cambios, ver
  // migración #9 en db/init.js), así que ya no hay a dónde copiarla.
];

async function migrarTabla(dbVieja, dbNueva, { vieja, nueva, columnas }) {
  const filas = await dbVieja.all(`SELECT ${columnas.join(', ')} FROM ${vieja}`);
  let insertadas = 0;
  const placeholders = columnas.map(() => '?').join(', ');
  for (const fila of filas) {
    const valores = columnas.map(c => fila[c]);
    const resultado = await dbNueva.run(
      `INSERT OR IGNORE INTO ${nueva} (${columnas.join(', ')}) VALUES (${placeholders})`,
      valores
    );
    if (resultado.changes > 0) insertadas++;
  }
  return { total: filas.length, insertadas };
}

async function main() {
  console.log('======================== Migración iso2859-app → este proyecto ========================\n');

  if (!fs.existsSync(RUTA_BD_VIEJA)) {
    console.error(`❌ No se encontró la base de datos vieja en:\n   ${RUTA_BD_VIEJA}\n`);
    console.error('   Si la carpeta "iso2859-app" ya no está en esa ubicación, vuelve a correr este');
    console.error('   comando indicando la ruta completa al archivo iso2859.db, por ejemplo:');
    console.error('   node scripts/migrar_iso2859.js "C:\\ruta\\completa\\a\\iso2859.db"\n');
    process.exit(1);
  }
  console.log(`📂 Base de datos vieja: ${RUTA_BD_VIEJA}`);

  // Asegura que las tablas iso_* (y todo lo demás: permisos, roles, etc.)
  // ya existan en la base de datos principal, exactamente igual que si el
  // servidor acabara de arrancar. Es seguro llamarlo aquí aunque el
  // servidor ya se haya iniciado antes: todo el proceso es idempotente.
  await inicializarBaseDatos();
  const dbNueva = getDb();
  console.log('📦 Base de datos principal lista (tablas iso_* creadas si hacía falta).\n');

  const dbVieja = await open({ filename: RUTA_BD_VIEJA, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });

  let totalGeneral = 0, insertadasGeneral = 0;
  for (const tabla of TABLAS) {
    try {
      const { total, insertadas } = await migrarTabla(dbVieja, dbNueva, tabla);
      totalGeneral += total;
      insertadasGeneral += insertadas;
      const saltadas = total - insertadas;
      console.log(`  ${tabla.nueva.padEnd(28)} ${String(insertadas).padStart(6)} nuevas` + (saltadas > 0 ? `  (${saltadas} ya existían, sin duplicar)` : ''));
    } catch (e) {
      console.error(`  ⚠️ Error migrando ${tabla.vieja} → ${tabla.nueva}: ${e.message}`);
    }
  }

  await dbVieja.close();

  console.log(`\n✅ Migración terminada: ${insertadasGeneral} fila(s) nueva(s) de ${totalGeneral} revisada(s).`);
  console.log('   Puedes correr este script otra vez sin riesgo (no duplica nada).\n');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error inesperado durante la migración:', err);
  process.exit(1);
});
