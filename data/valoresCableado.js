const { getDb } = require('../db/connection');

// ==================== TIPO DE CIRCUITO Y VARIANTES ====================
// Ver MIGRACIÓN #51 en db/init.js. Cada versión tiene un tipo de circuito:
//   normal  -> solo la variante principal (como siempre)
//   bicolor -> principal (= Color 1) + 'color2' (se le suma el cable amarillo)
//   stop    -> principal + 'stop' (+ negro) + 'direccional' (+ negro + amarillo)
// La variante principal sigue en elec_mediciones/elec_rangos_revision con
// sus nombres de campo de siempre (amperaje_medias, amperaje_max, etc.).
// Las variantes extra viajan como campos planos con este formato:
//   <variante>_<prueba>_<funcion>_<medida>, ej. "stop_rev_altas_amperaje"
// (prueba: rev/min/max; funcion: bajas/altas; medida: amperaje/potencia).
// Prueba Máximo solo se hace en Altas, por eso no existe "..._max_bajas_...".
const TIPOS_CIRCUITO = ['normal', 'bicolor', 'stop'];
const VARIANTES_POR_TIPO = { normal: [], bicolor: ['color2'], stop: ['stop', 'direccional'] };
const PRUEBAS_VARIANTE = { rev: 'revision', min: 'minimo', max: 'maximo' };
const CAMPOS_VARIANTES = [];
for (const variante of ['color2', 'stop', 'direccional']) {
  for (const [corta, prueba] of Object.entries(PRUEBAS_VARIANTE)) {
    for (const funcion of ['bajas', 'altas']) {
      if (corta === 'max' && funcion === 'bajas') continue;
      for (const medida of ['amperaje', 'potencia']) {
        CAMPOS_VARIANTES.push({ clave: `${variante}_${corta}_${funcion}_${medida}`, variante, prueba, corta, funcion, medida });
      }
    }
  }
}
const normalizarTipoCircuito = (t) => (TIPOS_CIRCUITO.includes(t) ? t : null);

// Valores de las variantes extra agrupados por versión, como campos planos
// (ver arriba). Con versionId trae solo esa versión; sin él, todas.
async function leerValoresVariantes(versionId) {
  const db = getDb();
  const filas = versionId == null
    ? await db.all('SELECT version_id, variante, prueba, funcion, amperaje, potencia FROM elec_valores_variante')
    : await db.all('SELECT version_id, variante, prueba, funcion, amperaje, potencia FROM elec_valores_variante WHERE version_id = ?', [versionId]);
  const cortaDe = Object.fromEntries(Object.entries(PRUEBAS_VARIANTE).map(([c, p]) => [p, c]));
  const porVersion = new Map();
  for (const f of filas) {
    if (!porVersion.has(f.version_id)) porVersion.set(f.version_id, {});
    const o = porVersion.get(f.version_id);
    const base = `${f.variante}_${cortaDe[f.prueba]}_${f.funcion}`;
    o[`${base}_amperaje`] = f.amperaje;
    o[`${base}_potencia`] = f.potencia;
  }
  return porVersion;
}

// Todos los campos de variantes en null, para que la ficha siempre traiga
// las mismas llaves aunque la versión no tenga variantes guardadas.
function camposVariantesVacios() {
  return Object.fromEntries(CAMPOS_VARIANTES.map(c => [c.clave, null]));
}

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
      cc.no_aplica_medias, cc.tipo_circuito
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
  const variantesPorVersion = await leerValoresVariantes(null);

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
      tipo_circuito: row.tipo_circuito || 'normal',
      ...camposVariantesVacios(),
      ...(variantesPorVersion.get(row.version_id) || {}),
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
      cc.no_aplica_medias, cc.tipo_circuito
    FROM versiones v
    JOIN referencias r ON r.id = v.referencia_id
    LEFT JOIN elec_mediciones m ON m.version_id = v.id
    LEFT JOIN elec_rangos_revision rr ON rr.version_id = v.id
    LEFT JOIN elec_config_cableado cc ON cc.version_id = v.id
    WHERE v.id = ?
  `, [versionId]);
  if (!row) return null;
  const variantes = (await leerValoresVariantes(versionId)).get(row.version_id) || {};

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
    tipo_circuito: row.tipo_circuito || 'normal',
    ...camposVariantesVacios(),
    ...variantes,
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

  // Forma de cableado: elec_config_cableado.forma_cableado tiene que existir
  // en elec_fotos_cableado (llave foránea). Antes:
  //  - si la versión no tenía forma, la pantalla mandaba "" (texto vacío) y
  //    se intentaba guardar "", que no existe en elec_fotos_cableado ->
  //    "SQLITE_CONSTRAINT: FOREIGN KEY constraint failed" (pasó con 1037);
  //  - una forma nueva escrita con "+ Nueva forma..." fallaba igual, porque
  //    nadie la agregaba a elec_fotos_cableado (la foto se guarda como
  //    archivo en CARPETA_FOTOS_CABLEADO, no en esa tabla).
  // Ahora "" se guarda como "sin forma" (NULL), una forma ya conocida se
  // reconoce aunque cambien mayúsculas/minúsculas, y una forma nueva se
  // registra en elec_fotos_cableado (su foto sale del archivo con ese nombre).
  let formaCableado = typeof datos.forma_cableado === 'string' ? datos.forma_cableado.trim() : (datos.forma_cableado ?? null);
  if (!formaCableado) formaCableado = null;
  // Tipo de circuito: si no viene (o no es uno de los 3 válidos) se deja el
  // que ya tenía la versión, o 'normal' si es nueva.
  const tipoCircuito = normalizarTipoCircuito(datos.tipo_circuito);
  if (formaCableado) {
    const existente = await db.get('SELECT forma_cableado FROM elec_fotos_cableado WHERE LOWER(forma_cableado) = LOWER(?)', [formaCableado]);
    if (existente) formaCableado = existente.forma_cableado;
    else await db.run('INSERT INTO elec_fotos_cableado (forma_cableado) VALUES (?)', [formaCableado]);
  }

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
    `INSERT INTO elec_config_cableado (version_id, cortar_puntas, posicion_punto, empujar_cables, forma_cableado, referencia_cable, no_aplica_medias, tipo_circuito)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'normal'))
     ON CONFLICT(version_id) DO UPDATE SET
       cortar_puntas=excluded.cortar_puntas, posicion_punto=excluded.posicion_punto,
       empujar_cables=excluded.empujar_cables, forma_cableado=excluded.forma_cableado, referencia_cable=excluded.referencia_cable,
       no_aplica_medias=excluded.no_aplica_medias,
       tipo_circuito=COALESCE(?, elec_config_cableado.tipo_circuito)`,
    [versionId, datos.cortar_puntas ? 1 : 0, datos.posicion_punto ?? null, datos.empujar_cables ? 1 : 0, formaCableado, datos.referencia_cable ?? null, datos.no_aplica_medias ? 1 : 0, tipoCircuito, tipoCircuito]
  );

  // Variantes extra (Color 2, Stop, Direccional). Solo se tocan las que
  // vienen en la petición: si el formulario no manda una variante (porque
  // el tipo elegido no la usa), sus valores se conservan tal cual en vez de
  // borrarse — así, si alguien cambia el tipo por error y lo devuelve, no
  // pierde lo que ya estaba escrito. Si una prueba viene con corriente y
  // potencia vacías, su fila se borra.
  const vacioANull = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
  const grupos = new Map();
  for (const c of CAMPOS_VARIANTES) {
    const k = `${c.variante}|${c.prueba}|${c.funcion}`;
    if (!grupos.has(k)) grupos.set(k, { variante: c.variante, prueba: c.prueba, funcion: c.funcion, claves: {} });
    grupos.get(k).claves[c.medida] = c.clave;
  }
  for (const g of grupos.values()) {
    const vieneAmp = Object.prototype.hasOwnProperty.call(datos, g.claves.amperaje);
    const vienePot = Object.prototype.hasOwnProperty.call(datos, g.claves.potencia);
    if (!vieneAmp && !vienePot) continue;
    const amperaje = vacioANull(datos[g.claves.amperaje]);
    const potencia = vacioANull(datos[g.claves.potencia]);
    if (amperaje === null && potencia === null) {
      await db.run('DELETE FROM elec_valores_variante WHERE version_id = ? AND variante = ? AND prueba = ? AND funcion = ?',
        [versionId, g.variante, g.prueba, g.funcion]);
    } else {
      await db.run(
        `INSERT INTO elec_valores_variante (version_id, variante, prueba, funcion, amperaje, potencia)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(version_id, variante, prueba, funcion) DO UPDATE SET
           amperaje=excluded.amperaje, potencia=excluded.potencia`,
        [versionId, g.variante, g.prueba, g.funcion, amperaje, potencia]
      );
    }
  }
}

// Lista de valores de "forma_cableado" que ya existen en la base de datos —
// se usa para llenar el desplegable en Crear/Editar Referencia en vez de
// dejar ese campo como texto libre (así se reusa una forma ya conocida en
// lugar de escribirla de nuevo, con riesgo de un typo). Quien necesite una
// forma nueva la puede seguir escribiendo aparte (ver "+ Nueva forma..." en
// el desplegable del front-end).
async function listarFormasCableadoConocidas() {
  const db = getDb();
  // Incluye también las formas de elec_fotos_cableado aunque ninguna versión
  // las use todavía (por ejemplo después de una recarga de datos), para que
  // se puedan elegir del desplegable en vez de tener que escribirlas.
  const rows = await db.all(
    `SELECT forma_cableado FROM elec_config_cableado WHERE forma_cableado IS NOT NULL AND forma_cableado <> ''
     UNION
     SELECT forma_cableado FROM elec_fotos_cableado WHERE forma_cableado IS NOT NULL AND forma_cableado <> ''
     ORDER BY forma_cableado`
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
  CAMPOS_VARIANTES,
  VARIANTES_POR_TIPO,
};
