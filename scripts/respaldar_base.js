// ============ COPIA DE RESPALDO DIARIA DE LA BASE DE DATOS (SQLite) ============
// Hace una copia completa y consistente de db/base_datos.db en
// db/respaldos/diario/base_datos_AAAA-MM-DD.db y borra las copias diarias de
// más de DIAS_A_GUARDAR días. Solo toca la carpeta db/respaldos/diario/: las
// demás copias de db/respaldos (por ejemplo las que hace el script de carga
// de circuitos antes de cambiar la base) no se borran nunca.
//
// Usa "VACUUM INTO", que junta en un solo archivo lo que esté en el -wal y
// da una copia coherente aunque la app siguiera encendida. Lo normal es que
// corra con la app ya cerrada, desde apagar_equipo.cmd (cierre programado).
//
// Uso (desde la carpeta de la app):
//   node scripts/respaldar_base.js
//
// Para volver a una copia: apagar la app y reemplazar db/base_datos.db por la
// copia elegida (borrando base_datos.db-wal y base_datos.db-shm).
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { DB_PATH } = require('../settings/paths');

const DIAS_A_GUARDAR = 30;

async function main() {
  const carpeta = path.join(path.dirname(DB_PATH), 'respaldos', 'diario');
  fs.mkdirSync(carpeta, { recursive: true });

  // Fecha local del equipo (Colombia) en formato AAAA-MM-DD.
  const hoy = new Date().toLocaleDateString('sv-SE');
  const destino = path.join(carpeta, `base_datos_${hoy}.db`);
  // VACUUM INTO no sobrescribe: si hoy ya se hizo una copia, se reemplaza.
  if (fs.existsSync(destino)) fs.unlinkSync(destino);

  const inicio = Date.now();
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });
  try {
    await db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
  } finally {
    await db.close();
  }
  const mb = (fs.statSync(destino).size / 1024 / 1024).toFixed(1);
  console.log(`[${new Date().toLocaleString('es-CO')}] Copia creada: ${destino} (${mb} MB, ${((Date.now() - inicio) / 1000).toFixed(0)} s)`);

  // Borrar las copias diarias viejas (solo archivos con el nombre de este script).
  const limite = Date.now() - DIAS_A_GUARDAR * 24 * 60 * 60 * 1000;
  let borradas = 0;
  for (const nombre of fs.readdirSync(carpeta)) {
    if (!/^base_datos_\d{4}-\d{2}-\d{2}\.db$/.test(nombre)) continue;
    const ruta = path.join(carpeta, nombre);
    if (fs.statSync(ruta).mtimeMs < limite) {
      fs.unlinkSync(ruta);
      borradas++;
    }
  }
  if (borradas) console.log(`Se borraron ${borradas} copia(s) de más de ${DIAS_A_GUARDAR} días.`);
}

main().catch((e) => {
  console.error(`[${new Date().toLocaleString('es-CO')}] ERROR en la copia de respaldo: ${e.message}`);
  process.exit(1);
});
