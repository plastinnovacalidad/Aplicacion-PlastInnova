// ======================== NORMALIZACIÓN: mayúsculas/minúsculas en número de lote ========================
// Al revisar qué tablas están y no están conectadas entre sí (08/09), se
// encontró que 149 filas de rechazos_produccion/entregas_produccion tienen
// un lote_produccion/lote_entrega que SÍ existe en `lotes`, pero escrito
// con otra combinación de mayúsculas (ej: "c1048000914" en rechazos vs.
// "C1048000914" en lotes.no_lote). Como SQLite compara texto distinguiendo
// mayúsculas de minúsculas, hoy esas filas no cruzan con su lote real.
//
// Este script corrige el valor guardado en rechazos_produccion/
// entregas_produccion para que quede escrito EXACTAMENTE igual que en
// lotes.no_lote, sin tocar la tabla `lotes` ni ninguna otra cosa. No
// inventa relaciones nuevas: solo arregla la forma en que ya estaban
// escritas para que las que ya eran el mismo lote por fin crucen bien.
//
// Antes de corregir nada, si dos lotes distintos en `lotes` solo se
// diferencian por mayúsculas entre sí (ej. "c100" Y "C100" existieran los
// dos), esa clave se salta por completo y se reporta como advertencia —
// en ese caso no hay forma segura de saber cuál de los dos es el correcto,
// así que se deja para revisión manual en vez de adivinar.
//
// Es seguro correrlo más de una vez: la segunda vez ya no encuentra nada
// que corregir porque los valores ya quedaron normalizados.
//
// Se ejecuta a mano, una vez:
//   node scripts/normalizar_mayusculas_lotes.js

const { inicializarBaseDatos } = require('../db/init');
const { getDb } = require('../db/connection');

async function main() {
  console.log('======================== Normalización de mayúsculas en número de lote ========================\n');

  await inicializarBaseDatos();
  const db = getDb();

  // 1) Mapa UPPER(no_lote) -> lista de no_lote reales tal como están en `lotes`.
  const lotes = await db.all('SELECT no_lote FROM lotes');
  const mapa = new Map();
  for (const { no_lote } of lotes) {
    const clave = no_lote.toUpperCase();
    if (!mapa.has(clave)) mapa.set(clave, new Set());
    mapa.get(clave).add(no_lote);
  }

  const colisiones = [...mapa.entries()].filter(([, valores]) => valores.size > 1);
  if (colisiones.length > 0) {
    console.log(`⚠️  ${colisiones.length} número(s) de lote existen en \`lotes\` en más de una variante de mayúsculas — se dejan sin tocar:`);
    for (const [clave, valores] of colisiones) {
      console.log(`   ${clave}: ${[...valores].join(', ')}`);
    }
    console.log('');
  }

  async function normalizarTabla(tabla, columna, filtroExtra = '') {
    const filas = await db.all(
      `SELECT DISTINCT ${columna} AS valor FROM ${tabla} WHERE ${columna} IS NOT NULL AND ${columna} != '' ${filtroExtra}`
    );

    let corregidas = 0;
    let filasActualizadas = 0;
    for (const { valor } of filas) {
      const clave = valor.toUpperCase();
      const candidatos = mapa.get(clave);
      if (!candidatos || candidatos.size !== 1) continue; // no existe, o hay colisión (ya reportada arriba)
      const [correcto] = candidatos;
      if (correcto === valor) continue; // ya está bien escrito

      const resultado = await db.run(
        `UPDATE ${tabla} SET ${columna} = ? WHERE ${columna} = ?`,
        [correcto, valor]
      );
      corregidas++;
      filasActualizadas += resultado.changes || 0;
      console.log(`   ${tabla}.${columna}: "${valor}" → "${correcto}" (${resultado.changes} fila(s))`);
    }
    return { corregidas, filasActualizadas };
  }

  console.log('Corrigiendo rechazos_produccion.lote_produccion...');
  const r1 = await normalizarTabla('rechazos_produccion', 'lote_produccion');

  console.log('\nCorrigiendo entregas_produccion.lote_entrega...');
  const r2 = await normalizarTabla('entregas_produccion', 'lote_entrega');

  console.log('\n---------------------------------------------------------------');
  console.log(`rechazos_produccion: ${r1.corregidas} valor(es) distinto(s) corregidos, ${r1.filasActualizadas} fila(s) en total.`);
  console.log(`entregas_produccion: ${r2.corregidas} valor(es) distinto(s) corregidos, ${r2.filasActualizadas} fila(s) en total.`);
  console.log('\n✅ Normalización terminada. Puedes correr este script otra vez sin riesgo (la segunda vez no encuentra nada que corregir).\n');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error inesperado durante la normalización:', err);
  process.exit(1);
});
