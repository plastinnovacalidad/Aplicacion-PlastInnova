// Capa de datos del módulo de Muestreos ISO 2859-1 (Recepción y Producción).
// Toda la lógica SQL vive aquí, siguiendo el mismo patrón que data/garantias.js
// y data/metrologia.js: funciones async/await sobre getDb() (el wrapper
// promise-based de este proyecto), para que routes/iso2859.js solo tenga que
// llamar a estas funciones dentro de asyncHandler — cualquier error de SQL
// se propaga solo y termina respondiendo por el manejador de errores
// centralizado, en vez de quedar silenciado como pasaba en la app original
// (sus callbacks de sqlite3 no siempre revisaban `err`).
const { getDb, enTransaccion } = require('../db/connection');

// ======================== ÁREAS ========================
function listarAreas(modulo) {
  const db = getDb();
  if (modulo) {
    return db.all(`SELECT * FROM iso_areas WHERE (modulo = ? OR modulo = 'Ambos') ORDER BY nombre`, [modulo]);
  }
  return db.all(`SELECT * FROM iso_areas ORDER BY nombre`);
}

// ======================== CATÁLOGOS ========================
// Sin `q`, antes se devolvía el catálogo completo (más de 17.000
// referencias) de una sola vez al cargar el formulario — se limita a un
// primer lote razonable para que la página no tenga que traer y renderizar
// todo de entrada; el buscador (`q`) sigue trayendo resultados exactos
// mientras la persona escribe.
function buscarReferencias(q) {
  const db = getDb();
  if (q) {
    return db.all(`SELECT nombre, tipo_producto FROM iso_referencias WHERE nombre LIKE ? ORDER BY nombre LIMIT 20`, [`%${q}%`]);
  }
  return db.all(`SELECT nombre, tipo_producto FROM iso_referencias ORDER BY nombre LIMIT 50`);
}

// Se excluyen los códigos marcados "Inactivo" desde la pestaña de
// Catálogos (ver más abajo): la mayoría de códigos históricos tiene
// estado NULL (nunca se tocó ese campo antes de que existiera esa
// pestaña), así que se tratan igual que 'Activo' — solo 'Inactivo' oculta.
function buscarDefectos(q) {
  const db = getDb();
  if (q) {
    return db.all(
      `SELECT codigo, area, descripcion, severidad FROM iso_tipificacion_defectos
       WHERE (estado IS NULL OR estado != 'Inactivo') AND (codigo LIKE ? OR descripcion LIKE ?) ORDER BY codigo LIMIT 20`,
      [`%${q}%`, `%${q}%`]
    );
  }
  return db.all(`SELECT codigo, area, descripcion, severidad FROM iso_tipificacion_defectos WHERE (estado IS NULL OR estado != 'Inactivo') ORDER BY codigo LIMIT 50`);
}

function obtenerPlanPorProducto(producto) {
  return getDb().get(`SELECT * FROM iso_planes_muestreo WHERE producto = ?`, [producto]);
}

// ======================== CATÁLOGOS — administración (pestaña "Catálogos") ========================
// A diferencia de buscarDefectos/listarAreas/obtenerPlanPorProducto (que
// alimentan las pantallas operativas de todos los días), estas funciones
// son para la pestaña de administración: siempre traen todo, incluidos los
// registros "Inactivo", para que se puedan reactivar si hace falta.

function listarDefectosCatalogo() {
  return getDb().all(`SELECT id, codigo, area, descripcion, severidad, estado FROM iso_tipificacion_defectos ORDER BY codigo`);
}

function crearDefectoCatalogo(codigo, area, descripcion, severidad) {
  return getDb().run(
    `INSERT INTO iso_tipificacion_defectos (codigo, area, descripcion, severidad, estado) VALUES (?, ?, ?, ?, 'Activo')`,
    [codigo, area, descripcion, severidad]
  );
}

function actualizarDefectoCatalogo(id, codigo, area, descripcion, severidad, estado) {
  return getDb().run(
    `UPDATE iso_tipificacion_defectos SET codigo = ?, area = ?, descripcion = ?, severidad = ?, estado = ? WHERE id = ?`,
    [codigo, area, descripcion, severidad, estado, id]
  );
}

function eliminarDefectoCatalogo(id) {
  return getDb().run(`DELETE FROM iso_tipificacion_defectos WHERE id = ?`, [id]);
}

function listarAreasCatalogo() {
  return getDb().all(`SELECT id, nombre, modulo, estado FROM iso_areas ORDER BY nombre`);
}

function crearAreaCatalogo(nombre, modulo) {
  return getDb().run(`INSERT INTO iso_areas (nombre, modulo, estado) VALUES (?, ?, 'Activo')`, [nombre, modulo]);
}

function actualizarAreaCatalogo(id, nombre, modulo, estado) {
  return getDb().run(`UPDATE iso_areas SET nombre = ?, modulo = ?, estado = ? WHERE id = ?`, [nombre, modulo, estado, id]);
}

function eliminarAreaCatalogo(id) {
  return getDb().run(`DELETE FROM iso_areas WHERE id = ?`, [id]);
}

function listarPlanesCatalogo() {
  return getDb().all(`SELECT producto, nivel_inspeccion, nca_mayores, nca_menores, nca_criticos FROM iso_planes_muestreo ORDER BY producto`);
}

function crearPlanCatalogo(producto, nivelInspeccion, ncaMayores, ncaMenores, ncaCriticos) {
  return getDb().run(
    `INSERT INTO iso_planes_muestreo (producto, nivel_inspeccion, nca_mayores, nca_menores, nca_criticos) VALUES (?, ?, ?, ?, ?)`,
    [producto, nivelInspeccion, ncaMayores, ncaMenores, ncaCriticos]
  );
}

function actualizarPlanCatalogo(producto, nivelInspeccion, ncaMayores, ncaMenores, ncaCriticos) {
  return getDb().run(
    `UPDATE iso_planes_muestreo SET nivel_inspeccion = ?, nca_mayores = ?, nca_menores = ?, nca_criticos = ? WHERE producto = ?`,
    [nivelInspeccion, ncaMayores, ncaMenores, ncaCriticos, producto]
  );
}

function eliminarPlanCatalogo(producto) {
  return getDb().run(`DELETE FROM iso_planes_muestreo WHERE producto = ?`, [producto]);
}

// ======================== LOTES ========================
function obtenerPlanActualPorReferencia(referencia) {
  return getDb().get(`SELECT plan_actual FROM iso_lotes WHERE referencia = ? ORDER BY fecha_creacion DESC LIMIT 1`, [referencia]);
}

// Crea el lote si no existe, o actualiza sus datos si ya existía (por
// ejemplo, al agregar un segundo muestreo a un lote de Producción creado
// unos minutos antes). A propósito NO toca `estado_final` en la
// actualización: la app original sí lo hacía (lo forzaba de vuelta a
// 'Pendiente' en cada upsert), lo que resetaba en silencio la decisión de
// un lote que ya se había Aceptado o Rechazado. Ahora, un lote nuevo nace
// 'Pendiente' (por el DEFAULT de la tabla) y uno existente conserva el
// estado que ya tenía.
async function upsertLote({ id_lote, referencia, modulo, cantidad_total, metodo_en_proceso, id_revision, proveedor, oc_factura, maquina }) {
  const db = getDb();
  const planRow = await obtenerPlanActualPorReferencia(referencia);
  const plan = planRow ? planRow.plan_actual : 'Normal';
  await db.run(
    `INSERT INTO iso_lotes (id_lote, referencia, modulo, cantidad_total, metodo_en_proceso, plan_actual, id_revision, proveedor, oc_factura, maquina)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id_lote) DO UPDATE SET
        referencia=excluded.referencia,
        modulo=excluded.modulo,
        cantidad_total=excluded.cantidad_total,
        metodo_en_proceso=excluded.metodo_en_proceso,
        plan_actual=excluded.plan_actual,
        id_revision=excluded.id_revision,
        proveedor=excluded.proveedor,
        oc_factura=excluded.oc_factura,
        maquina=excluded.maquina`,
    [id_lote, referencia, modulo, cantidad_total, metodo_en_proceso || null, plan, id_revision || null, proveedor || null, oc_factura || null, maquina || null]
  );
  return { id_lote, plan_actual: plan };
}

function buscarLotes(q, modulo) {
  if (!q) return Promise.resolve([]);
  let sql = `SELECT id_lote, referencia, cantidad_total, maquina FROM iso_lotes WHERE id_lote LIKE ?`;
  const params = [`%${q}%`];
  if (modulo) { sql += ` AND modulo = ?`; params.push(modulo); }
  sql += ` ORDER BY fecha_creacion DESC LIMIT 10`;
  return getDb().all(sql, params);
}

async function obtenerLotePorId(id) {
  const db = getDb();
  const lote = await db.get(`SELECT * FROM iso_lotes WHERE id_lote = ?`, [id]);
  if (!lote) return null;
  const muestreos = await db.all(`SELECT * FROM iso_muestreos WHERE id_lote = ? ORDER BY fecha_hora`, [id]);
  return { ...lote, muestreos };
}

function listarLotes({ estado, modulo, q, limit, desde, hasta, id_revision } = {}) {
  let sql = `SELECT * FROM iso_lotes WHERE 1=1`;
  const params = [];
  if (estado && estado !== 'Todos') { sql += ` AND estado_final = ?`; params.push(estado); }
  if (modulo) { sql += ` AND modulo = ?`; params.push(modulo); }
  if (id_revision) { sql += ` AND id_revision = ?`; params.push(id_revision); }
  if (q) { sql += ` AND (id_lote LIKE ? OR referencia LIKE ?)`; params.push(`%${q}%`, `%${q}%`); }
  if (desde) { sql += ` AND date(fecha_creacion) >= ?`; params.push(desde); }
  if (hasta) { sql += ` AND date(fecha_creacion) <= ?`; params.push(hasta); }
  sql += ` ORDER BY fecha_creacion DESC`;
  const lim = limit ? parseInt(limit, 10) : 200;
  sql += ` LIMIT ?`; params.push(Number.isFinite(lim) ? lim : 200);
  return getDb().all(sql, params);
}

// ======================== DASHBOARD ========================
async function dashboardResumen(modulo) {
  const db = getDb();
  if (modulo === 'Produccion') {
    const resumen = await db.get(
      `SELECT COUNT(*) as total_activos,
              SUM(CASE WHEN estado_final = 'Pendiente' THEN 1 ELSE 0 END) as pendientes
       FROM iso_lotes WHERE modulo = 'Produccion'`
    );
    const alertas = await db.all(
      `SELECT l.referencia, COUNT(*) as alertas
       FROM iso_muestreos m JOIN iso_lotes l ON m.id_lote = l.id_lote
       WHERE m.decision = 'Alerta' AND m.fecha_hora >= date('now', '-7 days') AND l.modulo = 'Produccion'
       GROUP BY l.referencia`
    );
    return { ...resumen, alertas_hoy: alertas };
  }
  const hoy = new Date().toISOString().split('T')[0];
  const resumen = await db.get(
    `SELECT COUNT(*) as total_hoy,
            SUM(CASE WHEN estado_final = 'Rechazado' THEN 1 ELSE 0 END) as rechazados,
            SUM(CASE WHEN estado_final = 'Aceptado_con_obs' THEN 1 ELSE 0 END) as con_obs,
            SUM(CASE WHEN estado_final = 'Pendiente' THEN 1 ELSE 0 END) as pendientes
     FROM iso_lotes WHERE modulo = 'Recepcion' AND date(fecha_creacion) = ?`,
    [hoy]
  );
  return { ...resumen, alertas_hoy: [] };
}

function dashboardTendencias(dias) {
  const d = Number.isFinite(dias) ? dias : 7;
  return getDb().all(
    `SELECT date(fecha_creacion) as fecha, COUNT(*) as total,
            SUM(CASE WHEN estado_final = 'Rechazado' THEN 1 ELSE 0 END) as rechazados,
            SUM(CASE WHEN estado_final = 'Aceptado' THEN 1 ELSE 0 END) as aceptados
     FROM iso_lotes WHERE fecha_creacion >= date('now', ?) AND modulo = 'Recepcion'
     GROUP BY date(fecha_creacion) ORDER BY fecha`,
    [`-${d} days`]
  );
}

function dashboardDefectosArea(dias) {
  const d = Number.isFinite(dias) ? dias : 30;
  return getDb().all(
    `SELECT m.area, COUNT(*) as cantidad, td.severidad
     FROM iso_defectos_encontrados de
     JOIN iso_tipificacion_defectos td ON de.codigo_defecto = td.codigo
     JOIN iso_muestreos m ON de.id_muestreo = m.id_muestreo
     WHERE m.fecha_hora >= date('now', ?) AND m.area IS NOT NULL
     GROUP BY m.area, td.severidad ORDER BY cantidad DESC`,
    [`-${d} days`]
  );
}

function dashboardBitacora() {
  return getDb().all(
    `SELECT m.*, l.id_lote, l.referencia, l.modulo
     FROM iso_muestreos m
     JOIN iso_lotes l ON m.id_lote = l.id_lote
     WHERE l.modulo = 'Produccion'
     ORDER BY m.fecha_hora DESC LIMIT 50`
  );
}

function dashboardLotesActivos() {
  return getDb().all(
    `SELECT l.id_lote, l.referencia, l.cantidad_total, l.maquina, l.estado_final,
            COUNT(m.id_muestreo) as total_muestreos,
            SUM(CASE WHEN m.decision = 'Alerta' THEN 1 ELSE 0 END) as alertas,
            MAX(m.fecha_hora) as ultima_actividad
     FROM iso_lotes l
     LEFT JOIN iso_muestreos m ON l.id_lote = m.id_lote
     WHERE l.modulo = 'Produccion'
     GROUP BY l.id_lote
     ORDER BY COALESCE(ultima_actividad, l.fecha_creacion) DESC LIMIT 20`
  );
}

// ======================== MUESTREOS ========================
function obtenerSeveridadesDefectos(codigos) {
  if (!codigos || codigos.length === 0) return Promise.resolve([]);
  const placeholders = codigos.map(() => '?').join(',');
  return getDb().all(`SELECT codigo, severidad FROM iso_tipificacion_defectos WHERE codigo IN (${placeholders})`, codigos);
}

// Inserta el muestreo + sus defectos encontrados (si los hay) en una sola
// transacción, para que un muestreo nunca quede guardado sin sus defectos
// (o viceversa) si algo falla a la mitad.
async function crearMuestreo({ id_lote, tipo, analista, cantidad_muestreada, decision, observaciones, turno, area, operario, defectos, piezas_reclasificadas, piezas_reparadas }) {
  return enTransaccion(async (db) => {
    const result = await db.run(
      `INSERT INTO iso_muestreos (id_lote, tipo, analista, cantidad_muestreada, decision, observaciones, turno, area, operario, piezas_reclasificadas, piezas_reparadas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id_lote, tipo, analista, cantidad_muestreada, decision, observaciones || null, turno || null, area || null, operario || null, piezas_reclasificadas || 0, piezas_reparadas || 0]
    );
    const idMuestreo = result.lastID;
    if (defectos && defectos.length > 0) {
      for (const d of defectos) {
        await db.run(`INSERT INTO iso_defectos_encontrados (id_muestreo, codigo_defecto, cantidad) VALUES (?, ?, ?)`, [idMuestreo, d.codigo, d.cantidad || 1]);
      }
    }
    return idMuestreo;
  });
}

function contarAlertasEnProceso(idLote) {
  return getDb().get(`SELECT COUNT(*) as alertas FROM iso_muestreos WHERE id_lote = ? AND tipo = 'En_Proceso' AND decision = 'Alerta'`, [idLote]);
}

function actualizarEstadoFinalLote(idLote, estado) {
  return getDb().run(`UPDATE iso_lotes SET estado_final = ? WHERE id_lote = ?`, [estado, idLote]);
}

// ======================== CIERRE DE LOTES SIN AUDITORÍA FINAL ========================
// Un lote puede terminar su recorrido real (se despachó, se cambió de
// referencia en la máquina, etc.) sin que nunca se le haga la Auditoría
// Final — sobre todo en Producción, donde puede recibir varias pasadas "En
// Proceso" sin que quede claro cuándo terminó esa corrida. Sin esto, ese
// lote se queda en "Pendiente" para siempre. 'Cerrado_sin_auditoria' es un
// estado aparte de Aceptado/Rechazado a propósito: no certifica ninguna
// decisión de calidad, solo dice que se dejó de trabajar en él.
function cerrarLoteManual({ id_lote, analista, motivo }) {
  return getDb().run(
    `UPDATE iso_lotes
     SET estado_final = 'Cerrado_sin_auditoria', cierre_tipo = 'manual', cerrado_por = ?, cierre_motivo = ?, fecha_cierre = datetime('now','localtime')
     WHERE id_lote = ? AND estado_final = 'Pendiente'`,
    [analista, motivo || null, id_lote]
  );
}

// Disposición manual para un lote que salió Rechazado en la Auditoría
// Final: en vez de desecharlo, Calidad decide reclasificarlo (usarlo en
// otra referencia o con otro fin) o mandarlo a reparación. Reutiliza las
// mismas columnas de cierre_tipo/cerrado_por/cierre_motivo/fecha_cierre
// que el cierre manual de arriba (son genéricas: quién hizo la
// disposición, cuándo y por qué) para no tener que agregar columnas
// nuevas solo para esto. No toca el veredicto Aceptado/Rechazado
// calculado por la fórmula de AQL — ese ya quedó guardado en el muestreo
// "Final" correspondiente y no se pierde.
function cambiarTratamientoLote({ id_lote, analista, motivo, tratamiento }) {
  return getDb().run(
    `UPDATE iso_lotes
     SET estado_final = ?, cierre_tipo = 'manual', cerrado_por = ?, cierre_motivo = ?, fecha_cierre = datetime('now','localtime')
     WHERE id_lote = ? AND estado_final = 'Rechazado'`,
    [tratamiento, analista, motivo || null, id_lote]
  );
}

// Cierra en bloque todo lote (de cualquier módulo) que siga "Pendiente" y no
// haya tenido ningún muestreo en los últimos `dias` días (usando la fecha
// del muestreo más reciente, o la fecha de creación del lote si nunca tuvo
// ninguno). Se corre sola, periódicamente, desde app_circuitos.js — nadie
// tiene que acordarse de cerrar nada a mano para que la lista de pendientes
// no crezca indefinidamente.
async function cerrarLotesInactivos(dias) {
  const db = getDb();
  const inactivos = await db.all(
    `SELECT l.id_lote
     FROM iso_lotes l
     LEFT JOIN iso_muestreos m ON m.id_lote = l.id_lote
     WHERE l.estado_final = 'Pendiente'
     GROUP BY l.id_lote
     HAVING COALESCE(MAX(m.fecha_hora), l.fecha_creacion) <= datetime('now', 'localtime', ?)`,
    [`-${parseInt(dias, 10)} days`]
  );
  for (const { id_lote } of inactivos) {
    await db.run(
      `UPDATE iso_lotes
       SET estado_final = 'Cerrado_sin_auditoria', cierre_tipo = 'automatico',
           cierre_motivo = ?, fecha_cierre = datetime('now','localtime')
       WHERE id_lote = ?`,
      [`Sin actividad de muestreo por más de ${dias} día(s).`, id_lote]
    );
  }
  return inactivos.length;
}

// El cambio de plan queda registrado en registro_cambios (lo hace la ruta
// que llama a esta función, routes/iso2859.js, que es quien tiene a la
// mano el usuario logueado) — antes también se guardaba aparte en
// iso_historial_planes, tabla que ya no existe (ver migración #9 en
// db/init.js), para no tener el mismo dato en dos lugares.
async function cambiarPlan({ referencia, plan_nuevo, justificacion, analista }) {
  const db = getDb();
  const planRow = await obtenerPlanActualPorReferencia(referencia);
  const planAnterior = planRow ? planRow.plan_actual : 'Normal';
  await db.run(`UPDATE iso_lotes SET plan_actual = ? WHERE referencia = ? AND modulo = 'Recepcion' AND estado_final = 'Pendiente'`, [plan_nuevo, referencia]);
  return { plan_anterior: planAnterior, plan_nuevo };
}

// ======================== REVISIONES ========================
// Consecutivo con formato INS-MMYY-NNN. Igual que en la app original: se
// calcula leyendo el máximo existente del mes, sin un contador dedicado —
// aceptable aquí porque las revisiones se crean una a la vez desde el
// formulario, nunca en paralelo por la misma persona.
async function generarConsecutivoRevision() {
  const db = getDb();
  const mes = new Date().getMonth() + 1;
  const anio = new Date().getFullYear().toString().slice(-2);
  const prefijo = `INS-${String(mes).padStart(2, '0')}${anio}`;
  const row = await db.get(
    `SELECT numero_revision FROM iso_revisiones WHERE numero_revision LIKE ? ORDER BY id_revision DESC LIMIT 1`,
    [`${prefijo}-%`]
  );
  let num = 1;
  if (row) {
    const partes = row.numero_revision.split('-');
    num = parseInt(partes[2], 10) + 1;
  }
  return `${prefijo}-${String(num).padStart(3, '0')}`;
}

async function crearRevision({ referencia, cantidad_programada, maquina }) {
  const db = getDb();
  const numero = await generarConsecutivoRevision();
  const result = await db.run(
    `INSERT INTO iso_revisiones (numero_revision, referencia, cantidad_programada, maquina) VALUES (?, ?, ?, ?)`,
    [numero, referencia, cantidad_programada, maquina || null]
  );
  return { id_revision: result.lastID, numero_revision: numero };
}

function listarRevisiones() {
  return getDb().all(`SELECT * FROM iso_revisiones ORDER BY fecha_inicio DESC LIMIT 50`);
}

async function obtenerRevisionPorId(id) {
  const db = getDb();
  const rev = await db.get(`SELECT * FROM iso_revisiones WHERE id_revision = ?`, [id]);
  if (!rev) return null;
  const lotes = await db.all(`SELECT * FROM iso_lotes WHERE id_revision = ?`, [id]);
  const muestreos = await db.all(
    `SELECT m.*, l.id_lote FROM iso_muestreos m JOIN iso_lotes l ON m.id_lote = l.id_lote WHERE l.id_revision = ? ORDER BY m.fecha_hora`,
    [id]
  );
  return { ...rev, lotes, muestreos };
}

// ======================== REPORTES ========================
function obtenerMuestreoConLote(id) {
  return getDb().get(
    `SELECT m.*, l.referencia, l.cantidad_total, l.modulo, l.proveedor, l.maquina
     FROM iso_muestreos m JOIN iso_lotes l ON m.id_lote = l.id_lote
     WHERE m.id_muestreo = ?`,
    [id]
  );
}

function obtenerDefectosDeMuestreo(id) {
  return getDb().all(
    `SELECT de.*, td.descripcion, td.severidad
     FROM iso_defectos_encontrados de JOIN iso_tipificacion_defectos td ON de.codigo_defecto = td.codigo
     WHERE de.id_muestreo = ?`,
    [id]
  );
}

function obtenerLotesPorReferencia(referencia) {
  return getDb().all(`SELECT * FROM iso_lotes WHERE referencia = ? ORDER BY fecha_creacion DESC`, [referencia]);
}

module.exports = {
  listarAreas,
  buscarReferencias,
  buscarDefectos,
  obtenerPlanPorProducto,
  obtenerPlanActualPorReferencia,
  upsertLote,
  buscarLotes,
  obtenerLotePorId,
  listarLotes,
  dashboardResumen,
  dashboardTendencias,
  dashboardDefectosArea,
  dashboardBitacora,
  dashboardLotesActivos,
  obtenerSeveridadesDefectos,
  crearMuestreo,
  contarAlertasEnProceso,
  actualizarEstadoFinalLote,
  cerrarLoteManual,
  cambiarTratamientoLote,
  cerrarLotesInactivos,
  cambiarPlan,
  crearRevision,
  listarRevisiones,
  obtenerRevisionPorId,
  obtenerMuestreoConLote,
  obtenerDefectosDeMuestreo,
  obtenerLotesPorReferencia,
  listarDefectosCatalogo,
  crearDefectoCatalogo,
  actualizarDefectoCatalogo,
  eliminarDefectoCatalogo,
  listarAreasCatalogo,
  crearAreaCatalogo,
  actualizarAreaCatalogo,
  eliminarAreaCatalogo,
  listarPlanesCatalogo,
  crearPlanCatalogo,
  actualizarPlanCatalogo,
  eliminarPlanCatalogo,
};
