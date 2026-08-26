const { getDb } = require('../db/connection');

// Divide un codigo_base de Circuitos SMD (formato PREFIJO/BASE/COLOR/SUFIJO,
// ej. "SUP/1002/AH/MUL") en sus partes. Devuelve null si no tiene el
// formato esperado — algunas referencias viejas de prueba en la base de
// datos no lo cumplen (ej. "123", "Referencia prueba"); esas simplemente no
// van a tener fila en las tablas de este módulo, así que en la práctica
// esto nunca debería devolver null para un producto real.
function parseCodigoBase(codigoBase) {
  if (!codigoBase) return null;
  const partes = codigoBase.split('/');
  if (partes.length !== 4) return null;
  const [prefijo, base, color, sufijo] = partes;
  return { prefijo, base, color, sufijo };
}

// Lista completa de "productos" (una fila por versión de cada referencia
// que en algún momento tuvo valores eléctricos cargados) para armar el panel
// lateral y la ficha en el front-end. Se trae todo de una vez (igual que
// hacía la app original) porque el volumen es modesto — hoy son ~450
// versiones con datos, muy lejos de ser un problema de rendimiento.
//
// OJO: antes esta consulta partía de un JOIN con elec_mediciones, así que
// solo aparecían las versiones que YA tenían sus valores eléctricos
// guardados — si en Circuitos SMD se creaba una versión nueva (ej. al
// cambiar la foto) y todavía nadie le había cargado cotas, esa versión
// nueva simplemente no salía en esta lista, y la ficha se quedaba pegada
// mostrando la versión vieja (con su foto vieja) para siempre, aunque esa
// versión ya estuviera obsoleta en Circuitos SMD. Por eso ahora se parte de
// "versiones" con LEFT JOIN hacia las tablas de valores: siempre aparecen
// TODAS las versiones de una referencia que alguna vez tuvo valores
// cargados (para no llenar la lista de referencias que nunca han usado este
// módulo), incluyendo las más nuevas que todavía no tienen sus propias
// cotas — esas simplemente muestran "—" en los valores hasta que se
// completen desde "Editar Referencia".
async function listarProductos() {
  const db = getDb();
  const rows = await db.all(`
    SELECT
      v.id as version_id,
      v.version,
      v.estado,
      v.imagen_ruta as tiene_imagen_circuito,
      r.codigo_base,
      m.voltaje_revision, m.amperaje_medias, m.amperaje_altas, m.potencia_medias, m.potencia_altas,
      rr.voltaje_min, rr.voltaje_max,
      rr.amperaje_min_bajas, rr.amperaje_min_altas, rr.amperaje_max,
      rr.potencia_min_bajas, rr.potencia_min_altas, rr.potencia_max,
      cc.cortar_puntas, cc.posicion_punto, cc.empujar_cables, cc.forma_cableado, cc.referencia_cable,
      cc.no_aplica_medias
    FROM versiones v
    JOIN referencias r ON r.id = v.referencia_id
    LEFT JOIN elec_mediciones m ON m.version_id = v.id
    LEFT JOIN elec_rangos_revision rr ON rr.version_id = v.id
    LEFT JOIN elec_config_cableado cc ON cc.version_id = v.id
    WHERE r.id IN (
      SELECT DISTINCT v2.referencia_id FROM versiones v2 JOIN elec_mediciones m2 ON m2.version_id = v2.id
    )
    ORDER BY r.codigo_base, v.version
  `);

  return rows.map(row => {
    const partes = parseCodigoBase(row.codigo_base);
    const imagenes = [];
    if (row.tiene_imagen_circuito) imagenes.push({ tipo: 'circuito', version_id: row.version_id });
    // La foto de cableado ya no se resuelve aquí (antes dependía de que
    // existiera un link de Drive en elec_fotos_cableado) — ahora se busca
    // por nombre de archivo en el momento de pedirla (ver
    // GET /valores-cableado/foto-cableado/:forma_cableado), igual que la
    // foto de circuito se busca por version_id. Basta con que la versión
    // tenga un "forma_cableado" asignado para intentar mostrar su foto.
    if (row.forma_cableado) imagenes.push({ tipo: 'cableado', forma_cableado: row.forma_cableado });

    return {
      id: row.version_id,
      codigo_completo: row.codigo_base,
      ref_base: partes ? partes.base : row.codigo_base,
      color: partes ? partes.color : '',
      version: row.version,
      estado: row.estado,
      voltaje_revision: row.voltaje_revision,
      amperaje_medias: row.amperaje_medias,
      amperaje_altas: row.amperaje_altas,
      potencia_medias: row.potencia_medias,
      potencia_altas: row.potencia_altas,
      voltaje_min: row.voltaje_min,
      voltaje_max: row.voltaje_max,
      amperaje_min_medias: row.amperaje_min_bajas,
      amperaje_min_altas: row.amperaje_min_altas,
      amperaje_max: row.amperaje_max,
      potencia_min_medias: row.potencia_min_bajas,
      potencia_min_altas: row.potencia_min_altas,
      potencia_max: row.potencia_max,
      cortar_puntas: row.cortar_puntas,
      posicion_punto: row.posicion_punto,
      empujar_cables: row.empujar_cables,
      forma_cableado: row.forma_cableado,
      referencia_cable: row.referencia_cable,
      no_aplica_medias: row.no_aplica_medias,
      imagenes,
    };
  });
}

// Foto de circuito de una versión puntual (a diferencia de /api/fotos/* de
// Circuitos SMD, que siempre sirve la de la versión "activa" de la
// referencia — acá puede pedirse la de una versión específica, que es la
// que de verdad corresponde a estos valores eléctricos).
async function obtenerImagenRutaPorVersion(versionId) {
  const db = getDb();
  const row = await db.get('SELECT imagen_ruta FROM versiones WHERE id = ?', [versionId]);
  return row ? row.imagen_ruta : null;
}

async function actualizarImagenRutaVersion(versionId, nuevaRuta) {
  const db = getDb();
  await db.run('UPDATE versiones SET imagen_ruta = ? WHERE id = ?', [nuevaRuta, versionId]);
}

// Confirma que la versión existe (y de paso trae su código, útil para
// mensajes de error) antes de dejar guardar valores/cableado sobre ella —
// la crea/edita la pantalla de Referencias de Circuitos SMD, este módulo
// solo la usa.
async function existeVersion(versionId) {
  const db = getDb();
  const row = await db.get(
    `SELECT v.id, v.version, r.codigo_base, r.id as referencia_id FROM versiones v JOIN referencias r ON r.id = v.referencia_id WHERE v.id = ?`,
    [versionId]
  );
  return row || null;
}

// Ficha de valores/cableado de UNA versión puntual (a diferencia de
// listarProductos(), que trae las ~450 de una vez para el panel de Valores y
// Cableado). Se usa desde Crear Referencia para precargar el formulario de
// edición y para saber qué guardar al crear una referencia nueva. Los JOIN
// son LEFT porque una versión recién creada todavía no tiene fila en
// ninguna de las tres tablas — en ese caso simplemente vienen todos null,
// no es un error.
async function obtenerFichaVersion(versionId) {
  const db = getDb();
  const row = await db.get(`
    SELECT
      v.id as version_id, v.version, r.codigo_base,
      m.voltaje_revision, m.amperaje_medias, m.amperaje_altas, m.potencia_medias, m.potencia_altas,
      rr.voltaje_min, rr.voltaje_max,
      rr.amperaje_min_bajas, rr.amperaje_min_altas, rr.amperaje_max,
      rr.potencia_min_bajas, rr.potencia_min_altas, rr.potencia_max,
      cc.cortar_puntas, cc.posicion_punto, cc.empujar_cables, cc.forma_cableado, cc.referencia_cable,
      cc.no_aplica_medias
    FROM versiones v
    JOIN referencias r ON r.id = v.referencia_id
    LEFT JOIN elec_mediciones m ON m.version_id = v.id
    LEFT JOIN elec_rangos_revision rr ON rr.version_id = v.id
    LEFT JOIN elec_config_cableado cc ON cc.version_id = v.id
    WHERE v.id = ?
  `, [versionId]);
  if (!row) return null;

  return {
    version_id: row.version_id,
    version: row.version,
    codigo_base: row.codigo_base,
    voltaje_revision: row.voltaje_revision,
    amperaje_medias: row.amperaje_medias,
    amperaje_altas: row.amperaje_altas,
    potencia_medias: row.potencia_medias,
    potencia_altas: row.potencia_altas,
    voltaje_min: row.voltaje_min,
    voltaje_max: row.voltaje_max,
    amperaje_min_medias: row.amperaje_min_bajas,
    amperaje_min_altas: row.amperaje_min_altas,
    amperaje_max: row.amperaje_max,
    potencia_min_medias: row.potencia_min_bajas,
    potencia_min_altas: row.potencia_min_altas,
    potencia_max: row.potencia_max,
    cortar_puntas: row.cortar_puntas,
    posicion_punto: row.posicion_punto,
    empujar_cables: row.empujar_cables,
    forma_cableado: row.forma_cableado,
    referencia_cable: row.referencia_cable,
    no_aplica_medias: row.no_aplica_medias,
  };
}

// Guarda (crea o actualiza) los valores eléctricos y la configuración de
// cableado de una versión puntual — usada por la pantalla de edición de
// Valores y Cableado (permiso 'valores_cableado.gestion'). Recibe el mismo
// conjunto de campos "planos" que ya devuelve listarProductos(), para que
// el formulario de edición pueda reusar los nombres que ya se muestran en
// la ficha sin tener que traducirlos.
//
// Nota: scripts/migrar_valores_cableado.js hace un upsert equivalente con
// su propio SQL en vez de llamar a esta función — es la única duplicación
// a propósito en este archivo, para no tocar ese script (ya probado a
// fondo con los datos reales) al agregar esta pantalla nueva.
async function guardarFichaVersion(versionId, datos = {}) {
  const db = getDb();

  await db.run(
    `INSERT INTO elec_mediciones (version_id, voltaje_revision, amperaje_medias, amperaje_altas, potencia_medias, potencia_altas)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(version_id) DO UPDATE SET
       voltaje_revision=excluded.voltaje_revision, amperaje_medias=excluded.amperaje_medias,
       amperaje_altas=excluded.amperaje_altas, potencia_medias=excluded.potencia_medias, potencia_altas=excluded.potencia_altas`,
    [versionId, datos.voltaje_revision ?? null, datos.amperaje_medias ?? null, datos.amperaje_altas ?? null, datos.potencia_medias ?? null, datos.potencia_altas ?? null]
  );

  await db.run(
    `INSERT INTO elec_rangos_revision (version_id, voltaje_min, voltaje_max, amperaje_min_bajas, amperaje_min_altas, amperaje_max, potencia_min_bajas, potencia_min_altas, potencia_max)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(version_id) DO UPDATE SET
       voltaje_min=excluded.voltaje_min, voltaje_max=excluded.voltaje_max,
       amperaje_min_bajas=excluded.amperaje_min_bajas, amperaje_min_altas=excluded.amperaje_min_altas, amperaje_max=excluded.amperaje_max,
       potencia_min_bajas=excluded.potencia_min_bajas, potencia_min_altas=excluded.potencia_min_altas, potencia_max=excluded.potencia_max`,
    [versionId, datos.voltaje_min ?? null, datos.voltaje_max ?? null, datos.amperaje_min_medias ?? null, datos.amperaje_min_altas ?? null, datos.amperaje_max ?? null, datos.potencia_min_medias ?? null, datos.potencia_min_altas ?? null, datos.potencia_max ?? null]
  );

  await db.run(
    `INSERT INTO elec_config_cableado (version_id, cortar_puntas, posicion_punto, empujar_cables, forma_cableado, referencia_cable, no_aplica_medias)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(version_id) DO UPDATE SET
       cortar_puntas=excluded.cortar_puntas, posicion_punto=excluded.posicion_punto,
       empujar_cables=excluded.empujar_cables, forma_cableado=excluded.forma_cableado, referencia_cable=excluded.referencia_cable,
       no_aplica_medias=excluded.no_aplica_medias`,
    [versionId, datos.cortar_puntas ? 1 : 0, datos.posicion_punto ?? null, datos.empujar_cables ? 1 : 0, datos.forma_cableado ?? null, datos.referencia_cable ?? null, datos.no_aplica_medias ? 1 : 0]
  );
}

// Link de Google Drive "de siempre" para una forma de cableado — se usa
// solo como respaldo cuando todavía no se ha subido el archivo real (ver
// routes/valoresCableado.js). El día que ya no quede ningún link viejo sin
// reemplazar, esta consulta deja de encontrar nada y no pasa nada raro.
async function obtenerUrlFotoCableadoLegacy(formaCableado) {
  const db = getDb();
  const row = await db.get('SELECT url_foto FROM elec_fotos_cableado WHERE forma_cableado = ?', [formaCableado]);
  return row && row.url_foto ? row.url_foto : null;
}

// Lista de valores de "forma_cableado" que ya existen en la base de datos —
// se usa para llenar el desplegable en Crear/Editar Referencia en vez de
// dejar ese campo como texto libre (así se reusa una forma ya conocida en
// lugar de escribirla de nuevo, con riesgo de un typo). Quien necesite una
// forma nueva la puede seguir escribiendo aparte (ver "+ Nueva forma..." en
// el desplegable del front-end).
async function listarFormasCableadoConocidas() {
  const db = getDb();
  const rows = await db.all(
    `SELECT DISTINCT forma_cableado FROM elec_config_cableado WHERE forma_cableado IS NOT NULL AND forma_cableado <> '' ORDER BY forma_cableado`
  );
  return rows.map(r => r.forma_cableado);
}

module.exports = {
  parseCodigoBase,
  listarProductos,
  listarFormasCableadoConocidas,
  obtenerImagenRutaPorVersion,
  actualizarImagenRutaVersion,
  existeVersion,
  obtenerFichaVersion,
  guardarFichaVersion,
  obtenerUrlFotoCableadoLegacy,
};
