const { getDb } = require('../db/connection');
const { nowSql } = require('./trazabilidadProduccion');

// ======================== CATÁLOGO DE CAUSAS RAÍZ Y MEDIDAS (TRAZABILIDAD) ========================
// Pedido por Julio (03/09, mismo día que el resto del módulo de
// trazabilidad, antes de haberlo usado en producción): un catálogo de
// "causas raíz posibles" y, dentro de cada una, sus "medidas posibles" ya
// ligadas -- su ejemplo: la causa "Molde desgastado" trae de una vez estas
// medidas: "Llevar molde a mantenimiento al taller", "Realizar control
// periódico de mantenimiento al molde", "Realizar inspección para detectar
// el deterioro del molde".
//
// Se administra a mano en la pestaña Catálogos de Gestión (mismo permiso
// 'catalogos.gestionar' que los demás catálogos del sistema), pero también
// crece solo: al registrar una causa o medida en un caso real, si se
// escribe "Otra" (no estaba en la lista), routes/produccion.js llama a
// obtenerOCrearCausaCatalogo/obtenerOCrearMedidaCatalogo de este archivo
// para agregarla, así la próxima vez ya aparece en el catálogo -- sin
// duplicar si alguien la escribe de nuevo con distintas mayúsculas/espacios
// (se compara normalizado, ver buscarCausaCatalogoPorTexto/
// buscarMedidaCatalogoPorTexto).
//
// "Nunca borrar de verdad": igual que otros catálogos del sistema, una
// causa/medida se desactiva (`activo = 'Inactivo'`) en vez de eliminarse
// cuando ya se usó -- así no desaparece del historial de casos reales que
// ya la tienen, solo deja de ofrecerse para casos nuevos. Eliminar de
// verdad solo se permite si nunca se ha usado (ver eliminarCausaCatalogo).

function normalizarTexto(texto) {
  return String(texto || '').trim();
}

// `defectoId` (pedido por Julio, 07/09, para el módulo "Reportes por
// Áreas"): cuando se pasa (incluso como `null` explícito), solo trae las
// causas ligadas a ESE defecto de Muestreos ISO 2859 -- así, al elegir "el
// problema" en un Reporte Completo, el selector de causa raíz solo ofrece
// las que ya se han usado para ese problema en concreto, no el catálogo
// entero. Cuando se OMITE (undefined, el valor por defecto), no filtra por
// defecto -- así sigue funcionando exactamente igual que antes para
// Seguimiento de Producción, que administra y ve el catálogo completo sin
// importar defectos (ese módulo no tiene ese concepto).
function listarCausasCatalogo({ soloActivas, defectoId } = {}) {
  const condiciones = [];
  const params = [];
  if (soloActivas) condiciones.push("activo = 'Activo'");
  if (defectoId !== undefined) {
    if (defectoId === null) condiciones.push('defecto_id IS NULL');
    else { condiciones.push('defecto_id = ?'); params.push(defectoId); }
  }
  const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';
  return getDb().all(`SELECT * FROM trazabilidad_catalogo_causas ${where} ORDER BY texto ASC`, params);
}

function listarMedidasCatalogo({ soloActivas } = {}) {
  const where = soloActivas ? "WHERE activo = 'Activo'" : '';
  return getDb().all(`SELECT * FROM trazabilidad_catalogo_medidas ${where} ORDER BY texto ASC`);
}

// Catálogo completo, anidado (cada causa con su lista de medidas) -- para
// la pestaña Catálogos de Gestión (que necesita ver todo, activo e
// inactivo) y para poblar de una vez los selectores del modal de
// trazabilidad al abrirlo (evita pedir "medidas de esta causa" cada vez que
// alguien cambia de causa en el formulario). Ver `defectoId` arriba.
async function listarCatalogoCompleto({ soloActivas, defectoId } = {}) {
  const [causas, medidas] = await Promise.all([
    listarCausasCatalogo({ soloActivas, defectoId }),
    listarMedidasCatalogo({ soloActivas }),
  ]);
  return causas.map((c) => ({ ...c, medidas: medidas.filter((m) => m.causa_catalogo_id === c.id) }));
}

function obtenerCausaCatalogoPorId(id) {
  return getDb().get('SELECT * FROM trazabilidad_catalogo_causas WHERE id = ?', [id]);
}

function obtenerMedidaCatalogoPorId(id) {
  return getDb().get('SELECT * FROM trazabilidad_catalogo_medidas WHERE id = ?', [id]);
}

// La comparación NO se hace en SQL (LOWER() de SQLite solo pliega
// mayúsculas ASCII -- "INYECCIÓN" se queda con la Ó tal cual, así que nunca
// haría match contra "inyección" y terminaría duplicando la causa en el
// catálogo). Se compara en JS con toLocaleLowerCase(), que sí pliega bien
// las tildes/ñ del español -- el catálogo es chico, así que traer todas las
// filas y comparar acá no tiene costo real.
function normalizarParaComparar(texto) {
  return String(texto || '').trim().toLocaleLowerCase('es');
}

// `defectoId` (undefined = no importa el defecto, busca en TODO el
// catálogo -- comportamiento de siempre para Producción; null o un id =
// solo busca entre las causas ligadas a ESE defecto en concreto) evita que
// una misma causa "genérica" de Producción se reuse sin querer para un
// defecto de Reportes, y viceversa -- cada defecto arma su propia lista,
// aunque el texto se repita entre uno y otro.
async function buscarCausaCatalogoPorTexto(texto, defectoId) {
  const buscado = normalizarParaComparar(texto);
  const causas = await getDb().all('SELECT * FROM trazabilidad_catalogo_causas');
  return causas.find((c) => {
    if (normalizarParaComparar(c.texto) !== buscado) return false;
    if (defectoId === undefined) return true;
    return (c.defecto_id ?? null) === (defectoId ?? null);
  }) || null;
}

async function buscarMedidaCatalogoPorTexto(causaCatalogoId, texto) {
  const buscado = normalizarParaComparar(texto);
  const medidas = await getDb().all('SELECT * FROM trazabilidad_catalogo_medidas WHERE causa_catalogo_id = ?', [causaCatalogoId]);
  return medidas.find((m) => normalizarParaComparar(m.texto) === buscado) || null;
}

// Usada cada vez que alguien escribe "Otra" al registrar una causa en un
// caso real: si el texto ya existe en el catálogo (sin importar mayúsculas
// o espacios de más) se reusa esa fila -- nunca se crea un duplicado. Si
// estaba Inactiva, NO se reactiva sola (eso es una decisión manual de quien
// administra el catálogo); igual se liga la causa del caso a esa fila para
// no perder la relación con sus medidas.
async function obtenerOCrearCausaCatalogo(texto, defectoId) {
  const limpio = normalizarTexto(texto);
  const existente = await buscarCausaCatalogoPorTexto(limpio, defectoId);
  if (existente) return existente;
  const db = getDb();
  const result = await db.run(
    `INSERT INTO trazabilidad_catalogo_causas (texto, defecto_id, activo, creado_en) VALUES (?, ?, 'Activo', ?)`,
    [limpio, defectoId ?? null, nowSql()]
  );
  return obtenerCausaCatalogoPorId(result.lastID);
}

// Mismo criterio que la anterior, pero la medida queda ligada a UNA causa
// del catálogo puntual (no tendría sentido una medida "suelta" en el
// catálogo, igual que en un caso real).
async function obtenerOCrearMedidaCatalogo(causaCatalogoId, texto) {
  const limpio = normalizarTexto(texto);
  const existente = await buscarMedidaCatalogoPorTexto(causaCatalogoId, limpio);
  if (existente) return existente;
  const db = getDb();
  const result = await db.run(
    `INSERT INTO trazabilidad_catalogo_medidas (causa_catalogo_id, texto, activo, creado_en) VALUES (?, ?, 'Activo', ?)`,
    [causaCatalogoId, limpio, nowSql()]
  );
  return obtenerMedidaCatalogoPorId(result.lastID);
}

// ---- Administración manual (pestaña Catálogos de Gestión) ----

async function crearCausaCatalogo(texto, defectoId) {
  const limpio = normalizarTexto(texto);
  const existente = await buscarCausaCatalogoPorTexto(limpio, defectoId);
  if (existente) {
    const err = new Error('Ya existe una causa con ese texto en el catálogo.');
    err.esConflicto = true;
    throw err;
  }
  const db = getDb();
  const result = await db.run(
    `INSERT INTO trazabilidad_catalogo_causas (texto, defecto_id, activo, creado_en) VALUES (?, ?, 'Activo', ?)`,
    [limpio, defectoId ?? null, nowSql()]
  );
  return obtenerCausaCatalogoPorId(result.lastID);
}

async function actualizarCausaCatalogo(id, texto, activo, defectoId) {
  const limpio = normalizarTexto(texto);
  const estadoFinal = activo === 'Inactivo' ? 'Inactivo' : 'Activo';
  // Si no se manda defectoId (undefined), se deja el que ya tenía la causa
  // -- así el PUT que ya usa Seguimiento de Producción (que nunca manda este
  // campo) no le borra el defecto a una causa que Reportes ya había tejido.
  const actual = await obtenerCausaCatalogoPorId(id);
  const defectoFinal = defectoId !== undefined ? defectoId : (actual ? actual.defecto_id : null);
  const duplicada = await buscarCausaCatalogoPorTexto(limpio, defectoId !== undefined ? defectoId : undefined);
  if (duplicada && String(duplicada.id) !== String(id)) {
    const err = new Error('Ya existe otra causa con ese texto en el catálogo.');
    err.esConflicto = true;
    throw err;
  }
  await getDb().run(
    `UPDATE trazabilidad_catalogo_causas SET texto = ?, activo = ?, defecto_id = ? WHERE id = ?`,
    [limpio, estadoFinal, defectoFinal ?? null, id]
  );
  return obtenerCausaCatalogoPorId(id);
}

// Solo elimina de verdad si nunca se ha usado (ni tiene medidas propias ni
// ningún caso real la referencia) -- si ya se usó, hay que desactivarla en
// vez de borrarla (actualizarCausaCatalogo con activo='Inactivo').
async function eliminarCausaCatalogo(id) {
  const db = getDb();
  const medidas = await db.get('SELECT COUNT(*) AS total FROM trazabilidad_catalogo_medidas WHERE causa_catalogo_id = ?', [id]);
  if (medidas.total > 0) {
    const err = new Error('Esta causa tiene medidas en el catálogo -- elimínalas primero o desactiva la causa en vez de eliminarla.');
    err.esConflicto = true;
    throw err;
  }
  // MIGRACIÓN #37: trazabilidad_causas y reportes_causas quedaron
  // reemplazadas por causas_raiz (compartida entre los dos módulos) -- una
  // sola consulta ahora cubre el uso en casos reales de Producción Y de
  // Reportes.
  const usos = await db.get('SELECT COUNT(*) AS total FROM causas_raiz WHERE causa_catalogo_id = ?', [id]);
  if (usos.total > 0) {
    const err = new Error('Esta causa ya se usó en al menos un caso real -- desactívala en vez de eliminarla, para no perder esa relación en el historial.');
    err.esConflicto = true;
    throw err;
  }
  await db.run('DELETE FROM trazabilidad_catalogo_causas WHERE id = ?', [id]);
}

async function crearMedidaCatalogo(causaCatalogoId, texto) {
  const limpio = normalizarTexto(texto);
  const duplicada = await buscarMedidaCatalogoPorTexto(causaCatalogoId, limpio);
  if (duplicada) {
    const err = new Error('Ya existe esa medida en el catálogo para esta causa.');
    err.esConflicto = true;
    throw err;
  }
  const db = getDb();
  const result = await db.run(
    `INSERT INTO trazabilidad_catalogo_medidas (causa_catalogo_id, texto, activo, creado_en) VALUES (?, ?, 'Activo', ?)`,
    [causaCatalogoId, limpio, nowSql()]
  );
  return obtenerMedidaCatalogoPorId(result.lastID);
}

async function actualizarMedidaCatalogo(id, texto, activo) {
  const medida = await obtenerMedidaCatalogoPorId(id);
  if (!medida) return null;
  const limpio = normalizarTexto(texto);
  const estadoFinal = activo === 'Inactivo' ? 'Inactivo' : 'Activo';
  const duplicada = await buscarMedidaCatalogoPorTexto(medida.causa_catalogo_id, limpio);
  if (duplicada && String(duplicada.id) !== String(id)) {
    const err = new Error('Ya existe otra medida con ese texto en el catálogo para esta causa.');
    err.esConflicto = true;
    throw err;
  }
  await getDb().run(
    `UPDATE trazabilidad_catalogo_medidas SET texto = ?, activo = ? WHERE id = ?`,
    [limpio, estadoFinal, id]
  );
  return obtenerMedidaCatalogoPorId(id);
}

// A diferencia de una causa, una medida del catálogo nunca queda referenciada
// por un caso real (los casos guardan su propio texto de medida, no un id
// del catálogo) -- eliminarla de verdad siempre es seguro, solo quita la
// sugerencia futura.
async function eliminarMedidaCatalogo(id) {
  await getDb().run('DELETE FROM trazabilidad_catalogo_medidas WHERE id = ?', [id]);
}

// Limpieza puntual pedida por Julio (07/09): borra TODAS las causas del
// catálogo que no tienen "problema" (defecto) asignado -- todo el backlog
// que quedó de antes de que existiera ese concepto (MIGRACIÓN #35). A
// diferencia de eliminarCausaCatalogo(), esta SÍ borra aunque la causa ya se
// haya usado en casos reales de Producción o de Reportes: el texto de esas
// causas queda guardado directo en cada caso (trazabilidad_causas.texto /
// reportes_causas.texto), así que no se pierde el historial -- solo se
// desvincula (causa_catalogo_id se pone en NULL) esa relación de "reusar"
// del catálogo a futuro. También borra las medidas propias de esas causas.
//
// OJO: es una limpieza de UNA SOLA VEZ para el backlog -- Producción sigue
// creando causas sin defecto como parte normal de su flujo (ese módulo no
// tiene el concepto de "problema"), así que esto NUNCA debe correr solo
// (como una migración); vive nada más como un botón manual en Seguimiento →
// Catálogo.
async function eliminarCausasSinDefecto() {
  const db = getDb();
  const filas = await db.all('SELECT id FROM trazabilidad_catalogo_causas WHERE defecto_id IS NULL');
  const ids = filas.map((f) => f.id);
  if (ids.length === 0) return { causasEliminadas: 0, medidasEliminadas: 0, referenciasDesvinculadas: 0 };
  const marcadores = ids.map(() => '?').join(',');

  const medidas = await db.get(`SELECT COUNT(*) AS total FROM trazabilidad_catalogo_medidas WHERE causa_catalogo_id IN (${marcadores})`, ids);
  await db.run(`DELETE FROM trazabilidad_catalogo_medidas WHERE causa_catalogo_id IN (${marcadores})`, ids);

  // MIGRACIÓN #37: una sola tabla compartida (causas_raiz) cubre las
  // referencias que antes estaban repartidas en trazabilidad_causas
  // (Producción) y reportes_causas (Reportes).
  const usos = await db.get(`SELECT COUNT(*) AS total FROM causas_raiz WHERE causa_catalogo_id IN (${marcadores})`, ids);
  await db.run(`UPDATE causas_raiz SET causa_catalogo_id = NULL WHERE causa_catalogo_id IN (${marcadores})`, ids);

  await db.run(`DELETE FROM trazabilidad_catalogo_causas WHERE id IN (${marcadores})`, ids);

  return {
    causasEliminadas: ids.length,
    medidasEliminadas: medidas.total || 0,
    referenciasDesvinculadas: usos.total || 0,
  };
}

module.exports = {
  listarCausasCatalogo,
  listarMedidasCatalogo,
  listarCatalogoCompleto,
  obtenerCausaCatalogoPorId,
  obtenerMedidaCatalogoPorId,
  buscarCausaCatalogoPorTexto,
  buscarMedidaCatalogoPorTexto,
  obtenerOCrearCausaCatalogo,
  obtenerOCrearMedidaCatalogo,
  crearCausaCatalogo,
  actualizarCausaCatalogo,
  eliminarCausaCatalogo,
  crearMedidaCatalogo,
  actualizarMedidaCatalogo,
  eliminarMedidaCatalogo,
  eliminarCausasSinDefecto,
};
