const { getDb, enTransaccion } = require('../db/connection');

// ======================== LIBERACIÓN DE PRODUCTO ========================
// Formato de liberación (MIGRACIÓN #56, 23/11/2026, pedido por Julio): un
// encabezado (responsable, turno, área, fecha y consecutivo LIB-AAAA-NNNN)
// con varios productos, cada uno con su foto original, referencia, lote,
// cantidad, estado y una descripción corta. Ver routes/liberaciones.js para
// las reglas de cada endpoint y el PDF.
//
// Las consultas son simples (sin GROUP_CONCAT ni funciones propias de
// SQLite) para que funcionen igual con SQL Server (db/sqlserver/adaptador.js).

const TURNOS = ['Mañana', 'Tarde', 'Noche'];
// 23/11/2026 (pedido por Julio): el módulo queda solo para liberación y
// rechazo (se quitaron Reparación y Reclasificado), y cada documento es de
// un solo tipo: o es una liberación o es un rechazo, nunca mezclados. El
// tipo se elige en el encabezado y todos sus productos toman ese estado.
// Cada tipo lleva su propio consecutivo: LIB-AAAA-NNNN y REC-AAAA-NNNN.
const TIPOS = ['Liberación', 'Rechazo'];
const ESTADOS = ['Liberado', 'Rechazado'];
const PREFIJO_TIPO = { 'Liberación': 'LIB', 'Rechazo': 'REC' };
const ESTADO_DE_TIPO = { 'Liberación': 'Liberado', 'Rechazo': 'Rechazado' };

function ahoraISO() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------- catálogos
// Mismo catálogo de áreas que usan Reportes e ISO 2859 (iso_areas).
function listarAreasActivas() {
  return getDb().all("SELECT id, nombre FROM iso_areas WHERE estado = 'Activo' ORDER BY nombre");
}

function buscarArea(id) {
  return getDb().get("SELECT id, nombre FROM iso_areas WHERE id = ? AND estado = 'Activo'", [id]);
}

// ---------------------------------------------------------------- consecutivo
// LIB-2026-0001: número por año. Se calcula dentro de la misma transacción
// que guarda la liberación (BEGIN IMMEDIATE en SQLite), así dos tablets que
// guardan al mismo tiempo nunca reciben el mismo número; además, el índice
// único (anio, numero) lo impide a nivel de base de datos.
async function siguienteNumero(db, tipo, anio) {
  const fila = await db.get('SELECT MAX(numero) AS maximo FROM liberaciones WHERE tipo = ? AND anio = ?', [tipo, anio]);
  return (Number(fila && fila.maximo) || 0) + 1;
}

function formatoConsecutivo(tipo, anio, numero) {
  return `${PREFIJO_TIPO[tipo]}-${anio}-${String(numero).padStart(4, '0')}`;
}

// ---------------------------------------------------------------- crear
async function crearLiberacion({ encabezado, productos, usuario }) {
  return enTransaccion(async (db) => {
    const tipo = encabezado.tipo;
    const anio = new Date().getFullYear();
    const numero = await siguienteNumero(db, tipo, anio);
    const consecutivo = formatoConsecutivo(tipo, anio, numero);
    const ahora = ahoraISO();
    const res = await db.run(
      `INSERT INTO liberaciones
         (consecutivo, tipo, anio, numero, fecha, turno, area_id, area_nombre, responsable_id, responsable_nombre,
          revision, creado_en, actualizado_en, eliminado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0)`,
      [consecutivo, tipo, anio, numero, encabezado.fecha, encabezado.turno, encabezado.area_id, encabezado.area_nombre,
       usuario.id, usuario.nombre, ahora, ahora]
    );
    const id = res.lastID;
    const estado = ESTADO_DE_TIPO[tipo];
    const ids = [];
    for (let i = 0; i < productos.length; i++) {
      ids.push(await insertarProducto(db, id, i + 1, { ...productos[i], estado }));
    }
    return { id, consecutivo, tipo, productos: ids };
  });
}

async function insertarProducto(db, liberacionId, orden, p) {
  const res = await db.run(
    `INSERT INTO liberaciones_productos
       (liberacion_id, orden, referencia, descripcion_referencia, lote, cantidad, estado, descripcion)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [liberacionId, orden, p.referencia, p.descripcion_referencia, p.lote, p.cantidad, p.estado, p.descripcion]
  );
  return res.lastID;
}

// ---------------------------------------------------------------- editar
// Reemplaza el encabezado y la lista de productos: los que traen `id` (y
// pertenecen a esta liberación) se actualizan, los que no traen `id` se
// crean y los que ya no vienen se borran. Sube la revisión en 1.
// Devuelve los ids en el mismo orden de `productos` y los archivos de foto
// de los productos borrados (para que la ruta los mueva a obsoletas).
async function actualizarLiberacion(id, { encabezado, productos, usuario }) {
  return enTransaccion(async (db) => {
    const actual = await db.get('SELECT id, revision, tipo FROM liberaciones WHERE id = ? AND eliminado = 0', [id]);
    if (!actual) return { error: 'no_encontrado' };
    // El tipo no cambia al editar (el consecutivo LIB/REC depende de él).
    const estado = ESTADO_DE_TIPO[actual.tipo] || ESTADO_DE_TIPO['Liberación'];
    const existentes = await db.all('SELECT id, foto_archivo FROM liberaciones_productos WHERE liberacion_id = ?', [id]);
    const porId = new Map(existentes.map(p => [Number(p.id), p]));

    const conservados = new Set();
    const ids = [];
    for (let i = 0; i < productos.length; i++) {
      const p = { ...productos[i], estado };
      const pid = Number(p.id);
      if (pid && porId.has(pid) && !conservados.has(pid)) {
        await db.run(
          `UPDATE liberaciones_productos
             SET orden = ?, referencia = ?, descripcion_referencia = ?, lote = ?, cantidad = ?, estado = ?, descripcion = ?
           WHERE id = ? AND liberacion_id = ?`,
          [i + 1, p.referencia, p.descripcion_referencia, p.lote, p.cantidad, p.estado, p.descripcion, pid, id]
        );
        conservados.add(pid);
        ids.push(pid);
      } else {
        ids.push(await insertarProducto(db, id, i + 1, p));
      }
    }

    const fotosBorradas = [];
    for (const p of existentes) {
      if (conservados.has(Number(p.id))) continue;
      await db.run('DELETE FROM liberaciones_productos WHERE id = ? AND liberacion_id = ?', [p.id, id]);
      if (p.foto_archivo) fotosBorradas.push(p.foto_archivo);
    }

    const revision = (Number(actual.revision) || 0) + 1;
    await db.run(
      `UPDATE liberaciones
         SET fecha = ?, turno = ?, area_id = ?, area_nombre = ?, revision = ?, actualizado_en = ?,
             actualizado_por = ?, actualizado_por_nombre = ?
       WHERE id = ?`,
      [encabezado.fecha, encabezado.turno, encabezado.area_id, encabezado.area_nombre, revision, ahoraISO(),
       usuario.id, usuario.nombre, id]
    );
    return { productos: ids, fotosBorradas, revision };
  });
}

// ---------------------------------------------------------------- fotos
// Guarda el nombre del archivo nuevo y devuelve el anterior (si había), para
// que la ruta lo mueva a uploads/obsoletas.
async function guardarFotoProducto(liberacionId, productoId, archivo, nombreOriginal) {
  const db = getDb();
  const prod = await db.get(
    'SELECT id, foto_archivo FROM liberaciones_productos WHERE id = ? AND liberacion_id = ?',
    [productoId, liberacionId]
  );
  if (!prod) return { error: 'no_encontrado' };
  await db.run(
    'UPDATE liberaciones_productos SET foto_archivo = ?, foto_nombre_original = ? WHERE id = ?',
    [archivo, nombreOriginal || null, productoId]
  );
  return { anterior: prod.foto_archivo || null };
}

function buscarProducto(liberacionId, productoId) {
  return getDb().get(
    'SELECT * FROM liberaciones_productos WHERE id = ? AND liberacion_id = ?',
    [productoId, liberacionId]
  );
}

// ---------------------------------------------------------------- consultar
function buscarLiberacion(id) {
  return getDb().get('SELECT * FROM liberaciones WHERE id = ? AND eliminado = 0', [id]);
}

async function obtenerLiberacionCompleta(id) {
  const lib = await buscarLiberacion(id);
  if (!lib) return null;
  lib.productos = await getDb().all(
    'SELECT * FROM liberaciones_productos WHERE liberacion_id = ? ORDER BY orden, id',
    [id]
  );
  return lib;
}

async function listarLiberaciones(filtros = {}) {
  const db = getDb();
  const condiciones = ['l.eliminado = 0'];
  const params = [];
  if (filtros.desde) { condiciones.push('l.fecha >= ?'); params.push(filtros.desde); }
  if (filtros.hasta) { condiciones.push('l.fecha <= ?'); params.push(filtros.hasta); }
  if (filtros.turno) { condiciones.push('l.turno = ?'); params.push(filtros.turno); }
  if (filtros.areaId) { condiciones.push('l.area_id = ?'); params.push(filtros.areaId); }
  if (filtros.responsableId) { condiciones.push('l.responsable_id = ?'); params.push(filtros.responsableId); }
  if (filtros.tipo) { condiciones.push('l.tipo = ?'); params.push(filtros.tipo); }
  if (filtros.q) {
    const t = `%${filtros.q}%`;
    condiciones.push(`(l.consecutivo LIKE ? OR l.responsable_nombre LIKE ? OR EXISTS (
      SELECT 1 FROM liberaciones_productos p WHERE p.liberacion_id = l.id AND (p.referencia LIKE ? OR p.lote LIKE ? OR p.descripcion LIKE ?)))`);
    params.push(t, t, t, t, t);
  }
  const lista = await db.all(
    `SELECT l.id, l.consecutivo, l.tipo, l.fecha, l.turno, l.area_id, l.area_nombre, l.responsable_id, l.responsable_nombre,
            l.revision, l.creado_en, l.actualizado_en
     FROM liberaciones l
     WHERE ${condiciones.join(' AND ')}
     ORDER BY l.fecha DESC, l.id DESC
     LIMIT 500`,
    params
  );
  if (!lista.length) return [];

  // Resumen de productos de cada liberación (cuántos, por estado, piezas y
  // referencias), armado aquí en vez de con GROUP_CONCAT.
  const ids = lista.map(l => l.id);
  const marcas = ids.map(() => '?').join(',');
  const productos = await db.all(
    `SELECT liberacion_id, referencia, lote, cantidad, estado, foto_archivo
     FROM liberaciones_productos WHERE liberacion_id IN (${marcas}) ORDER BY orden, id`,
    ids
  );
  const resumen = new Map(ids.map(id => [id, { total: 0, piezas: 0, sinFoto: 0, estados: {}, referencias: [], lotes: [] }]));
  for (const p of productos) {
    const r = resumen.get(p.liberacion_id);
    if (!r) continue;
    r.total++;
    r.piezas += Number(p.cantidad) || 0;
    if (!p.foto_archivo) r.sinFoto++;
    r.estados[p.estado] = (r.estados[p.estado] || 0) + 1;
    if (!r.referencias.includes(p.referencia)) r.referencias.push(p.referencia);
    if (!r.lotes.includes(p.lote)) r.lotes.push(p.lote);
  }
  return lista.map(l => ({ ...l, ...resumen.get(l.id) }));
}

// Vista "Por referencia": un renglón por producto (de liberaciones no
// eliminadas), con los datos de su liberación. Mismos filtros que la lista
// por documento, pero el estado y el texto se aplican a cada producto.
function listarProductos(filtros = {}) {
  const condiciones = ['l.eliminado = 0'];
  const params = [];
  if (filtros.desde) { condiciones.push('l.fecha >= ?'); params.push(filtros.desde); }
  if (filtros.hasta) { condiciones.push('l.fecha <= ?'); params.push(filtros.hasta); }
  if (filtros.turno) { condiciones.push('l.turno = ?'); params.push(filtros.turno); }
  if (filtros.areaId) { condiciones.push('l.area_id = ?'); params.push(filtros.areaId); }
  if (filtros.responsableId) { condiciones.push('l.responsable_id = ?'); params.push(filtros.responsableId); }
  if (filtros.tipo) { condiciones.push('l.tipo = ?'); params.push(filtros.tipo); }
  if (filtros.q) {
    const t = `%${filtros.q}%`;
    condiciones.push('(p.referencia LIKE ? OR p.lote LIKE ? OR p.descripcion LIKE ? OR p.descripcion_referencia LIKE ? OR l.consecutivo LIKE ?)');
    params.push(t, t, t, t, t);
  }
  return getDb().all(
    `SELECT p.id, p.liberacion_id, p.orden, p.referencia, p.descripcion_referencia, p.lote, p.cantidad, p.estado,
            p.descripcion, p.foto_archivo,
            l.consecutivo, l.tipo, l.fecha, l.turno, l.area_nombre, l.responsable_id, l.responsable_nombre, l.revision
     FROM liberaciones_productos p
     JOIN liberaciones l ON l.id = p.liberacion_id
     WHERE ${condiciones.join(' AND ')}
     ORDER BY l.fecha DESC, l.id DESC, p.orden, p.id
     LIMIT 1000`,
    params
  );
}

// ---------------------------------------------------------------- eliminar
// Borrado suave (eliminado = 1), igual que Caja roja: el consecutivo no se
// vuelve a usar y las fotos se quedan donde están.
async function eliminarLiberacion(id, usuario) {
  const res = await getDb().run(
    'UPDATE liberaciones SET eliminado = 1, eliminado_por = ?, eliminado_por_nombre = ?, eliminado_en = ? WHERE id = ? AND eliminado = 0',
    [usuario.id || null, usuario.nombre || null, ahoraISO(), id]
  );
  return res && res.changes > 0;
}

module.exports = {
  TURNOS,
  TIPOS,
  ESTADOS,
  PREFIJO_TIPO,
  ESTADO_DE_TIPO,
  listarAreasActivas,
  buscarArea,
  crearLiberacion,
  actualizarLiberacion,
  guardarFotoProducto,
  buscarProducto,
  buscarLiberacion,
  obtenerLiberacionCompleta,
  listarLiberaciones,
  listarProductos,
  eliminarLiberacion,
};
