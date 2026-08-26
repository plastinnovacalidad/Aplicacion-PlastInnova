// Antes, la conexión SQLite vivía en una variable `db` a nivel de archivo en
// app_circuitos.js, y cada ruta la usaba directamente por clausura (closure).
// Ahora que las rutas viven en archivos separados, necesitan una forma de
// pedir "la" conexión activa sin importarse entre ellos — por eso este
// módulo actúa como punto único de acceso (patrón singleton).
let dbInstance = null;

function setDb(instance) {
  dbInstance = instance;
}

function getDb() {
  if (!dbInstance) {
    throw new Error('getDb() fue llamado antes de que la base de datos terminara de inicializarse (ver db/init.js).');
  }
  return dbInstance;
}

// Para operaciones que escriben en varias tablas relacionadas (por ejemplo,
// crear una referencia + su primera versión + su registro de seguimiento):
// si algo falla a la mitad, esto deshace todo lo que ya se había guardado
// en esa misma operación, en vez de dejar datos a medias (por ejemplo, una
// referencia creada pero sin ninguna versión asociada).
//
// Uso: await enTransaccion(async (db) => { await db.run(...); await db.run(...); return algo; });
// Si `fn` lanza un error, la transacción se revierte (ROLLBACK) y el error
// sigue propagándose igual que antes, para que la ruta que llamó a esto
// responda el mismo mensaje de error de siempre.
async function enTransaccion(fn) {
  const db = getDb();
  // "BEGIN IMMEDIATE" (en vez de "BEGIN" a secas) toma el bloqueo de
  // escritura desde el inicio de la transacción. Esto evita, por ejemplo,
  // que dos personas guardando una garantía al mismo tiempo lean "el mismo
  // siguiente número" antes de que cualquiera de las dos termine — con WAL
  // + busyTimeout ya configurados, la segunda simplemente espera su turno
  // en vez de fallar.
  await db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = await fn(db);
    await db.exec('COMMIT');
    return resultado;
  } catch (error) {
    try { await db.exec('ROLLBACK'); } catch (e) { /* si el ROLLBACK falla, seguimos propagando el error original */ }
    throw error;
  }
}

module.exports = { setDb, getDb, enTransaccion };
