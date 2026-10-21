const { getDb } = require('../db/connection');

// ======================== MÓDULO "PROBLEMAS" (UNIFICADO) ========================
// MIGRACIÓN #38 (07-08/09, pedido por Julio): reemplaza a Trazabilidad de
// Producción (data/trazabilidadProduccion.js, tabla trazabilidad_problemas) y
// a la parte de causa raíz/medidas de Reportes por Áreas (data/reportes.js,
// reportes tipo 'rapido'/'completo'). Julio rechazó el primer rediseño (el
// puente causas_raiz_casos de la MIGRACIÓN #37 entre esos dos módulos
// separados) porque no resolvía el problema real: necesita UN solo lugar
// donde quede registrado y bajo seguimiento cualquier problema, de cualquier
// proceso, sin depender de la memoria de nadie.
//
// Un problema tiene un `origen` (de dónde salió: 'produccion', 'reporte' o
// 'general' -- ver MIGRACIÓN #38 en db/init.js) y trae los campos de
// contexto de ese origen (nullable los que no aplican). Cada uno tiene una o
// varias causas raíz (causas_raiz.problema_id, ya sin la tabla puente
// causas_raiz_casos de la MIGRACIÓN #37 -- con un solo tipo de caso no hace
// falta puentear nada), y cada causa una o varias medidas de solución
// (medidas.causa_id). El estado general (Pendiente/En_Proceso/Implementado)
// se sigue recalculando solo según las medidas -- Descartado es la única
// salida manual (ver descartarProblema).
//
// obtenerProblemaCompleto() devuelve causas[] y medidas[] EN LAS MISMAS
// FORMAS PLANAS que ya devolvía trazabilidad_problemas (cada medida trae su
// causa_id) -- a propósito, para que el frontend que ya sabía renderizar eso
// seguisiera funcionando casi sin cambios.
const ORIGENES = ['produccion', 'reporte', 'general'];
const TIPOS_CONTEXTO = ['referencia', 'motivo'];
const CRITICIDADES = ['Baja', 'Media', 'Alta'];
const ESTADOS = ['Pendiente', 'En_Proceso', 'Implementado', 'Descartado'];
const ESTADOS_MEDIDA = ['En_Proceso', 'Funciono', 'No_Funciono'];
// MIGRACIÓN #42 (08/09, pedido por Julio): disposición única de un problema
// de Reporte de área o General -- no aplica a Producción (esa no es una
// decisión que exista en ese origen). Solo 4 valores, Julio fue explícito:
// "Tratamiento: Liberar, Rechazar, Reclasificar, Reparar".
const TRATAMIENTOS = ['Liberar', 'Rechazar', 'Reclasificar', 'Reparar'];
// MIGRACIÓN #43 (08/09, rediseño del Reporte de Problema): 4 preguntas FIJAS
// de la "Lista de verificación" -- Julio: "el checklist es para todo" (a
// diferencia de cantidades/tratamiento, aplica a los 3 orígenes). `campo` es
// la columna real en `problemas`; cada una guarda 'Si'/'No'/null (sin CHECK,
// mismo criterio que tratamiento -- se valida acá, ver VALORES_CHECKLIST).
const CHECKLIST_PREGUNTAS = [
  { campo: 'chk_falla_funcional', pregunta: '¿Falla funcional?' },
  { campo: 'chk_problema_visual', pregunta: '¿Problema visual?' },
  { campo: 'chk_retraso_tiempo', pregunta: '¿Retraso de tiempo?' },
  { campo: 'chk_fuera_tolerancias', pregunta: '¿Fuera de tolerancias?' },
];
const VALORES_CHECKLIST = ['Si', 'No'];

function nowSql() {
  // Mismo formato que usa el resto del esquema para DATETIME
  // (datetime('now','localtime')) -- se calcula en JS para poder usarlo
  // también como valor de parámetro, no solo como default de columna.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Semana ISO-8601 ('YYYY-Www') -- Producción no tiene este concepto en sus
// datos (solo agrupa por mes), así que se calcula sola al crear un problema
// de origen 'produccion'. Mismo cálculo que ya usaba
// data/trazabilidadProduccion.js.
function semanaISO(fecha) {
  const d = new Date(Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()));
  const diaNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - diaNum);
  const inicioAño = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const numSemana = Math.ceil((((d - inicioAño) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(numSemana).padStart(2, '0')}`;
}

// MIGRACIÓN #42: % de desperdicio de un problema de Reporte de área o
// General, calculado siempre sobre la marcha a partir de cantidad_total y
// cantidad_afectada -- nunca se guarda el % ya calculado (mismo criterio que
// ya usa data/garantias.js: "porcentaje: Math.round((f.cantidad/total)*1000)/10").
// Devuelve null si falta cualquiera de las dos cantidades, o si el total es 0
// (no se puede dividir).
function calcularPctDesperdicio(cantidadTotal, cantidadAfectada) {
  const total = Number(cantidadTotal);
  const afectada = Number(cantidadAfectada);
  if (!Number.isFinite(total) || !Number.isFinite(afectada) || total <= 0) return null;
  return Math.round((afectada / total) * 1000) / 10;
}

// ======================== CATÁLOGOS DE APOYO ========================
// Mismos catálogos reusados que ya usaban Producción y Reportes por Áreas por
// separado -- no se duplican.
function listarAreasActivas() {
  return getDb().all(`SELECT id, nombre, encargado FROM iso_areas WHERE estado = 'Activo' ORDER BY nombre`);
}
function listarDefectosActivos() {
  return getDb().all(`SELECT id, codigo, descripcion FROM iso_tipificacion_defectos WHERE estado = 'Activo' ORDER BY codigo`);
}

// MIGRACIÓN #39 (08/09, pedido por Julio): "motivo de rechazo" (texto libre
// que llega del ERP de Producción, columna rechazos_produccion.motivo) y
// "Problema/Defecto" (catálogo ISO 2859, iso_tipificacion_defectos) usan el
// MISMO formato "CÓDIGO - DESCRIPCIÓN" -- comprobado con los datos reales:
// de 314 motivos distintos que ya usa Producción, 257 (82%) coinciden con un
// Defecto del catálogo. Julio: "motivo de rechazo y defecto para mi serian
// lo mismo" -- por eso, en vez de dejarlo sin ligar como antes, un problema
// de Producción liga su Defecto SOLO, sin que nadie tenga que elegirlo:
//   1) primero por el texto completo, exacto (mismo formato en ambos lados);
//   2) si no hay coincidencia exacta, por el código antes del " - " (cubre
//      los casos donde el texto tiene alguna diferencia menor de redacción
//      pero el código es el mismo).
// Si el motivo usa un código que todavía no existe en el catálogo de
// Defectos (pasa con algunos códigos D/K/PT que Producción ya usa pero
// nadie ha dado de alta en Gestión → Catálogos → Defectos), no encuentra
// nada y devuelve null -- el problema se crea igual, solo que sin Defecto
// ligado (el comportamiento de siempre), hasta que se agregue ese código al
// catálogo -- y entonces sí queda ligado, sin tener que tocar nada más (ver
// MIGRACIÓN #39 en db/init.js, que además vuelve a intentarlo en cada
// arranque del servidor para los problemas ya creados que se quedaron sin
// Defecto).
async function resolverDefectoIdPorMotivo(motivo) {
  if (!motivo) return null;
  const texto = String(motivo).trim();
  if (!texto) return null;
  const db = getDb();
  const porTexto = await db.get(
    `SELECT id FROM iso_tipificacion_defectos WHERE UPPER(TRIM(descripcion)) = UPPER(?) LIMIT 1`,
    [texto]
  );
  if (porTexto) return porTexto.id;
  // El separador real casi siempre es " - " (espacio-guion-espacio), pero
  // Producción a veces lo escribe sin uno de los espacios (ej. "S1
  // -SERIE...") -- esta expresión agarra el código igual, sin importar
  // cuáles de los dos espacios falten.
  const match = texto.match(/^([^\s-]+)\s*-\s*/);
  const codigo = match ? match[1].trim() : '';
  if (codigo) {
    const porCodigo = await db.get(
      `SELECT id FROM iso_tipificacion_defectos WHERE UPPER(codigo) = UPPER(?) LIMIT 1`,
      [codigo]
    );
    if (porCodigo) return porCodigo.id;
  }
  return null;
}

// ======================== LECTURA ========================
async function obtenerProblemaCompleto(id) {
  const db = getDb();
  const problema = await db.get(
    `SELECT p.*, a.nombre AS area_origen_nombre, a.encargado AS area_origen_encargado,
       d.codigo AS defecto_codigo, d.descripcion AS defecto_descripcion
     FROM problemas p
     LEFT JOIN iso_areas a ON a.id = p.area_origen_id
     LEFT JOIN iso_tipificacion_defectos d ON d.id = p.defecto_id
     WHERE p.id = ?`,
    [id]
  );
  if (!problema) return null;
  const causas = await db.all('SELECT * FROM causas_raiz WHERE problema_id = ? ORDER BY fecha ASC, id ASC', [id]);
  const medidas = causas.length
    ? await db.all(
        `SELECT m.* FROM medidas m WHERE m.causa_id IN (${causas.map(() => '?').join(',')}) ORDER BY m.creado_en ASC, m.id ASC`,
        causas.map((c) => c.id)
      )
    : [];
  // MIGRACIÓN #42: adjuntos (evidencia gráfica) -- mismo criterio de
  // "siempre vienen incluidos en el objeto completo" que ya usa
  // obtenerReporteCompleto() en data/reportes.js.
  const adjuntos = await db.all('SELECT * FROM problemas_adjuntos WHERE problema_id = ? ORDER BY fecha ASC, id ASC', [id]);
  return {
    ...problema, causas, medidas, adjuntos,
    pct_desperdicio: calcularPctDesperdicio(problema.cantidad_total, problema.cantidad_afectada),
  };
}

// Identidad de un problema de origen 'produccion': fabrica + tipo_contexto +
// valor_contexto (mismo criterio que ya usaba trazabilidad_problemas).
// Mientras siga Pendiente o En_Proceso, se reabre y se le siguen agregando
// causas/medidas sobre el mismo registro.
function buscarActivo({ fabrica, tipo_contexto, valor_contexto }) {
  return getDb().get(
    `SELECT * FROM problemas
     WHERE fabrica = ? AND tipo_contexto = ? AND valor_contexto = ? AND estado NOT IN ('Implementado','Descartado')
     ORDER BY creado_en DESC LIMIT 1`,
    [fabrica, tipo_contexto, valor_contexto]
  );
}

// El último problema para este contexto, sin importar su estado -- se usa
// cuando no hay uno activo, para preguntar "¿la solución anterior no
// funcionó?" antes de crear uno nuevo (ver marcarSolucionAnteriorComoFallida).
function buscarUltimo({ fabrica, tipo_contexto, valor_contexto }) {
  return getDb().get(
    `SELECT * FROM problemas
     WHERE fabrica = ? AND tipo_contexto = ? AND valor_contexto = ?
     ORDER BY creado_en DESC LIMIT 1`,
    [fabrica, tipo_contexto, valor_contexto]
  );
}

// Lista principal del módulo -- filtrable por origen/fábrica/área/estado/
// criticidad/defecto/texto libre, con la última causa raíz y el total de
// causas/medidas para no tener que abrir cada uno solo para ver de qué se
// trata. estado='en_curso' es un filtro especial (no un valor real de la
// columna) para "los que siguen abiertos" -- ni Implementado ni Descartado.
function listarProblemas({ origen, fabrica, area_id, estado, criticidad, defecto_id, q, limit } = {}) {
  const condiciones = [];
  const params = [];
  // MIGRACIÓN #46 (09/09, pedido por Julio): "Aviso rápido" no es un origen
  // real en la columna `origen` (por dentro sigue siendo 'reporte') -- es un
  // filtro aparte sobre `es_aviso_rapido`, para poder diferenciarlo en la
  // lista de un Reporte de área ya completo (ver reevaluarAvisoRapido: deja
  // de contar como aviso rápido en cuanto tiene Defecto + causa raíz real).
  if (origen === 'aviso_rapido') {
    condiciones.push('p.es_aviso_rapido = 1');
  } else if (origen && ORIGENES.includes(origen)) {
    condiciones.push('p.origen = ?'); params.push(origen);
    // "Reporte de área" ya no incluye los que todavía se muestran como
    // Aviso rápido -- esos solo aparecen bajo su propio filtro.
    if (origen === 'reporte') condiciones.push('(p.es_aviso_rapido IS NULL OR p.es_aviso_rapido = 0)');
  }
  if (fabrica) { condiciones.push('p.fabrica = ?'); params.push(fabrica); }
  if (area_id) { condiciones.push('p.area_origen_id = ?'); params.push(area_id); }
  if (criticidad && CRITICIDADES.includes(criticidad)) { condiciones.push('p.criticidad = ?'); params.push(criticidad); }
  if (defecto_id) { condiciones.push('p.defecto_id = ?'); params.push(defecto_id); }
  if (estado === 'en_curso') {
    condiciones.push("p.estado NOT IN ('Implementado','Descartado')");
  } else if (estado && ESTADOS.includes(estado)) {
    condiciones.push('p.estado = ?'); params.push(estado);
  }
  if (q) {
    condiciones.push('(p.valor_contexto LIKE ? OR p.referencia LIKE ? OR p.lote LIKE ? OR p.descripcion LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = condiciones.length ? 'WHERE ' + condiciones.join(' AND ') : '';
  const tope = Math.max(1, Math.min(500, parseInt(limit, 10) || 200));
  params.push(tope);
  return getDb().all(
    `SELECT p.*, a.nombre AS area_origen_nombre, d.codigo AS defecto_codigo, d.descripcion AS defecto_descripcion,
       (SELECT COUNT(*) FROM causas_raiz cr WHERE cr.problema_id = p.id) AS total_causas,
       (SELECT COUNT(*) FROM medidas m JOIN causas_raiz cr ON cr.id = m.causa_id WHERE cr.problema_id = p.id) AS total_medidas,
       (SELECT cr.texto FROM causas_raiz cr WHERE cr.problema_id = p.id ORDER BY cr.fecha DESC, cr.id DESC LIMIT 1) AS ultima_causa
     FROM problemas p
     LEFT JOIN iso_areas a ON a.id = p.area_origen_id
     LEFT JOIN iso_tipificacion_defectos d ON d.id = p.defecto_id
     ${where}
     ORDER BY p.actualizado_en DESC, p.id DESC
     LIMIT ?`,
    params
  );
}

// Pedido por Julio: poder ver la lista de abiertos y que le avise cuáles son
// críticos -- esta es la consulta base de esa alerta (abiertos = ni
// Implementado ni Descartado, criticidad Alta), ordenados del más viejo al
// más nuevo (los que más tiempo llevan esperando, primero).
function listarAlertasCriticas({ limit } = {}) {
  const tope = Math.max(1, Math.min(200, parseInt(limit, 10) || 50));
  return getDb().all(
    `SELECT p.*, a.nombre AS area_origen_nombre
     FROM problemas p LEFT JOIN iso_areas a ON a.id = p.area_origen_id
     WHERE p.criticidad = 'Alta' AND p.estado NOT IN ('Implementado','Descartado')
     ORDER BY p.creado_en ASC LIMIT ?`,
    [tope]
  );
}

// ======================== ESCRITURA ========================
async function crearCausa({ problemaId, texto, causaCatalogoId, autorId, autorNombre }) {
  const db = getDb();
  // El responsable arranca siendo el mismo autor (igual criterio que ya
  // tenían Trazabilidad de Producción y Reportes por separado: no se elige
  // de una lista, es automáticamente quien la registra).
  const result = await db.run(
    `INSERT INTO causas_raiz (problema_id, texto, causa_catalogo_id, autor_id, autor_nombre, responsable_id, responsable_nombre)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [problemaId, texto, causaCatalogoId || null, autorId || null, autorNombre || null, autorId || null, autorNombre || null]
  );
  return result.lastID;
}

// Crea el problema junto con su primera causa raíz (no tiene sentido abrir
// uno sin decir al menos qué se cree que lo originó) -- mismo criterio que
// ya tenían crearProblema() en Trazabilidad de Producción y
// escalarAReporteCompleto() en Reportes.
async function crearProblema({
  origen, fabrica, tipo_contexto, valor_contexto, pct_desperdicio_inicial,
  area_origen_id, referencia, lote, defecto_id, descripcion, criticidad,
  cantidad_total, cantidad_afectada, tratamiento,
  chk_falla_funcional, chk_problema_visual, chk_retraso_tiempo, chk_fuera_tolerancias,
  prevencion, firma_implicados_nombre,
  causaInicial, causaCatalogoId, medidasIniciales, autorId, autorNombre,
  esAvisoRapido,
}) {
  const db = getDb();
  const semana = origen === 'produccion' ? semanaISO(new Date()) : null;
  const criticidadFinal = CRITICIDADES.includes(criticidad) ? criticidad : 'Media';
  // MIGRACIÓN #39: si no se mandó un Defecto explícito y este problema viene
  // de un Motivo de Producción, se intenta ligar solo (ver
  // resolverDefectoIdPorMotivo más arriba) -- ya no se le pregunta a nadie.
  let defectoIdFinal = defecto_id || null;
  if (!defectoIdFinal && origen === 'produccion' && tipo_contexto === 'motivo' && valor_contexto) {
    defectoIdFinal = await resolverDefectoIdPorMotivo(valor_contexto);
  }
  // La descripción es obligatoria solo para origen 'general' (ver
  // routes/problemas.js) -- 'produccion' y 'reporte' ya traen su propio
  // contexto, así que si no se manda una se arma una por defecto a partir de
  // ese contexto, en vez de dejar el campo en blanco.
  let descripcionFinal = descripcion && String(descripcion).trim() ? String(descripcion).trim() : null;
  if (!descripcionFinal) {
    if (origen === 'produccion' && valor_contexto) {
      descripcionFinal = `${tipo_contexto === 'referencia' ? 'Referencia' : 'Motivo'}: ${valor_contexto}`;
    } else if (origen === 'reporte') {
      descripcionFinal = referencia ? `Referencia ${referencia}` : 'Reporte de área';
    }
  }
  const result = await db.run(
    `INSERT INTO problemas
       (origen, fabrica, tipo_contexto, valor_contexto, semana, pct_desperdicio_inicial,
        area_origen_id, referencia, lote, defecto_id, descripcion, criticidad, estado, autor_id, autor_nombre,
        cantidad_total, cantidad_afectada, tratamiento,
        chk_falla_funcional, chk_problema_visual, chk_retraso_tiempo, chk_fuera_tolerancias,
        prevencion, firma_implicados_nombre, firma_implicados_fecha, es_aviso_rapido, aviso_rapido_origen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      origen, fabrica || null, tipo_contexto || null, valor_contexto || null, semana,
      pct_desperdicio_inicial != null ? pct_desperdicio_inicial : null,
      area_origen_id || null, referencia || null, lote || null, defectoIdFinal, descripcionFinal,
      criticidadFinal, autorId || null, autorNombre || null,
      // MIGRACIÓN #42: cantidad_total/cantidad_afectada/tratamiento solo
      // tienen sentido para 'reporte'/'general' -- en 'produccion' quedan
      // NULL sin importar qué se haya mandado (esa validación ya la hizo
      // routes/problemas.js antes de llamar aquí).
      cantidad_total != null ? cantidad_total : null,
      cantidad_afectada != null ? cantidad_afectada : null,
      tratamiento || null,
      // MIGRACIÓN #43: los 4 de la lista de verificación SÍ aplican a los 3
      // orígenes (Julio: "el checklist es para todo") -- se validan en
      // routes/problemas.js antes de llegar acá (VALORES_CHECKLIST o null).
      chk_falla_funcional || null, chk_problema_visual || null, chk_retraso_tiempo || null, chk_fuera_tolerancias || null,
      prevencion && String(prevencion).trim() ? String(prevencion).trim() : null,
      firma_implicados_nombre && String(firma_implicados_nombre).trim() ? String(firma_implicados_nombre).trim() : null,
      firma_implicados_nombre && String(firma_implicados_nombre).trim() ? nowSql() : null,
      // MIGRACIÓN #45: marca los problemas creados desde "Aviso rápido" --
      // el detalle usa esto para saber si "Generar reporte" debe mostrar la
      // tarjeta simple o el PDF formal completo. Puede bajar a 0 (y volver a
      // subir) según reevaluarAvisoRapido más abajo.
      esAvisoRapido ? 1 : 0,
      // MIGRACIÓN #48: a diferencia de la anterior, esta nunca cambia -- deja
      // constancia de que el problema nació como Aviso rápido, para poder
      // revertir es_aviso_rapido más adelante si hace falta.
      esAvisoRapido ? 1 : 0,
    ]
  );
  const problemaId = result.lastID;
  if (causaInicial) {
    const causaId = await crearCausa({ problemaId, texto: causaInicial, causaCatalogoId, autorId, autorNombre });
    // MIGRACIÓN #44 (Julio: "medidas no se pueden cargar" y luego "me
    // gustaria poder agregar varias medidas" -- al crear el problema solo se
    // pedía la causa raíz, ninguna medida había que esperar a que el
    // problema ya existiera para agregarla desde el detalle). Opcional, y
    // ahora son varias (mismo criterio de agregarMedida para cada una:
    // estado por defecto 'En_Proceso').
    if (Array.isArray(medidasIniciales)) {
      for (const texto of medidasIniciales) {
        if (!texto) continue;
        await db.run(
          `INSERT INTO medidas (causa_id, texto, estado, autor_id, autor_nombre, responsable_id, responsable_nombre)
           VALUES (?, ?, 'En_Proceso', ?, ?, ?, ?)`,
          [causaId, texto, autorId || null, autorNombre || null, autorId || null, autorNombre || null]
        );
      }
    }
  }
  return obtenerProblemaCompleto(problemaId);
}

// Editar un problema ya creado -- mismo criterio que ya tenía Reportes
// ("poder editarlos después de que los creemos"): cada campo es opcional,
// solo se cambia lo que venga (comparar con undefined, no con falsy, para
// poder borrar un campo opcional a propósito mandando '').
// MIGRACIÓN #46 (09/09, pedido por Julio: "que cuando hagamos uno rapido
// quede como origen aviso rapido... a menos que se agregue mas informacion
// se volveria de area" -- confirmó que "más información" es, específicamente,
// que le pongan un Problema/Defecto Y una causa raíz real -- no el texto
// "Por determinar" con el que se crea). Se revisa cada vez que se edita el
// problema (ahí se asigna o se quita el Defecto, ver actualizarProblema) o
// cambia alguna causa raíz (se agrega la causa real o se borra, ver
// agregarCausa/eliminarCausa) -- cualquiera de las dos dispara el cambio, sin
// importar el orden.
//
// MIGRACIÓN #48 (09/09, pedido por Julio: "si hagamos que si se revierte
// quede como reporte rapido" -- es decir, si después de subir de categoría
// le quitan el Defecto o le borran la causa real, que vuelva a Aviso rápido).
// Solo aplica a problemas que nacieron como Aviso rápido (aviso_rapido_origen
// -- un Reporte de área normal jamás se convierte en Aviso rápido, aunque se
// quede sin causa real). Para los que sí, es_aviso_rapido queda como un
// espejo del estado actual: 0 si tiene Defecto + causa real, 1 si no.
async function reevaluarAvisoRapido(problemaId) {
  const db = getDb();
  const problema = await db.get('SELECT defecto_id, es_aviso_rapido, aviso_rapido_origen FROM problemas WHERE id = ?', [problemaId]);
  if (!problema || !problema.aviso_rapido_origen) return;
  const causaReal = await db.get(
    `SELECT id FROM causas_raiz WHERE problema_id = ? AND TRIM(texto) <> 'Por determinar' LIMIT 1`,
    [problemaId]
  );
  const promovido = !!(problema.defecto_id && causaReal);
  const nuevoValor = promovido ? 0 : 1;
  if (nuevoValor !== problema.es_aviso_rapido) {
    await db.run('UPDATE problemas SET es_aviso_rapido = ? WHERE id = ?', [nuevoValor, problemaId]);
  }
}

async function actualizarProblema(id, cambios) {
  const db = getDb();
  const problema = await db.get('SELECT * FROM problemas WHERE id = ?', [id]);
  if (!problema) return { error: 'no_encontrado' };

  const sets = [];
  const vals = [];
  const camposTexto = ['fabrica', 'tipo_contexto', 'valor_contexto', 'area_origen_id', 'referencia', 'lote', 'defecto_id', 'descripcion', 'pct_desperdicio_inicial', 'cantidad_total', 'cantidad_afectada', 'prevencion'];
  for (const campo of camposTexto) {
    if (cambios[campo] !== undefined) { sets.push(`${campo} = ?`); vals.push(cambios[campo] === '' ? null : cambios[campo]); }
  }
  if (cambios.criticidad !== undefined) {
    if (!CRITICIDADES.includes(cambios.criticidad)) return { error: 'criticidad_invalida' };
    sets.push('criticidad = ?'); vals.push(cambios.criticidad);
  }
  // MIGRACIÓN #42: Julio confirmó que Tratamiento se puede cambiar después
  // de creado ("Obligatorio y editable después") -- pero solo hacia uno de
  // los 4 valores válidos, nunca en blanco (eso lo exige routes/problemas.js
  // según el origen antes de llamar aquí; aquí solo se valida el valor).
  if (cambios.tratamiento !== undefined) {
    if (!TRATAMIENTOS.includes(cambios.tratamiento)) return { error: 'tratamiento_invalido' };
    sets.push('tratamiento = ?'); vals.push(cambios.tratamiento);
  }
  // MIGRACIÓN #43: lista de verificación -- cada una de las 4 se puede
  // cambiar por separado ('Si'/'No'), o volver a "sin responder" mandando ''
  // (igual que el resto de camposTexto, comparado con undefined y no con
  // falsy para poder borrarla a propósito).
  for (const { campo } of CHECKLIST_PREGUNTAS) {
    if (cambios[campo] !== undefined) {
      if (cambios[campo] !== '' && !VALORES_CHECKLIST.includes(cambios[campo])) return { error: 'checklist_invalido' };
      sets.push(`${campo} = ?`); vals.push(cambios[campo] === '' ? null : cambios[campo]);
    }
  }
  // MIGRACIÓN #43: firma de Implicados -- digital (solo el nombre escrito,
  // sin CHECK ni catálogo detrás, mismo criterio que pidió Julio: "la firma
  // que sea digital"). Se guarda su fecha junto con el nombre; si se borra el
  // nombre (manda ''), se borra también la fecha.
  if (cambios.firma_implicados_nombre !== undefined) {
    const nombre = cambios.firma_implicados_nombre && String(cambios.firma_implicados_nombre).trim()
      ? String(cambios.firma_implicados_nombre).trim() : null;
    sets.push('firma_implicados_nombre = ?'); vals.push(nombre);
    sets.push('firma_implicados_fecha = ?'); vals.push(nombre ? nowSql() : null);
  }
  if (sets.length === 0) return { error: 'nada_que_actualizar' };
  sets.push('actualizado_en = ?'); vals.push(nowSql());
  vals.push(id);
  await db.run(`UPDATE problemas SET ${sets.join(', ')} WHERE id = ?`, vals);
  await reevaluarAvisoRapido(id);
  return { problema: await obtenerProblemaCompleto(id) };
}

async function agregarCausa({ problema_id, texto, causa_catalogo_id, autor_id, autor_nombre }) {
  const db = getDb();
  const existe = await db.get('SELECT id FROM problemas WHERE id = ?', [problema_id]);
  if (!existe) return null;
  await crearCausa({ problemaId: problema_id, texto, causaCatalogoId: causa_catalogo_id, autorId: autor_id, autorNombre: autor_nombre });
  await db.run('UPDATE problemas SET actualizado_en = ? WHERE id = ?', [nowSql(), problema_id]);
  await reevaluarAvisoRapido(problema_id);
  return obtenerProblemaCompleto(problema_id);
}

// No se puede dejar un problema sin ninguna causa raíz -- mismo criterio y
// mismo mensaje de error que ya tenían Trazabilidad de Producción y
// Reportes. Borrar una causa raíz borra también sus medidas.
async function eliminarCausa(problemaId, causaId) {
  const db = getDb();
  const causa = await db.get('SELECT * FROM causas_raiz WHERE id = ? AND problema_id = ?', [causaId, problemaId]);
  if (!causa) return { error: 'no_encontrada' };
  const total = await db.get('SELECT COUNT(*) AS total FROM causas_raiz WHERE problema_id = ?', [problemaId]);
  if (total.total <= 1) return { error: 'ultima_causa' };
  await db.run('DELETE FROM medidas WHERE causa_id = ?', [causaId]);
  await db.run('DELETE FROM causas_raiz WHERE id = ?', [causaId]);
  await recalcularEstadoProblema(problemaId);
  await db.run('UPDATE problemas SET actualizado_en = ? WHERE id = ?', [nowSql(), problemaId]);
  await reevaluarAvisoRapido(problemaId);
  return { causaEliminada: causa, problema: await obtenerProblemaCompleto(problemaId) };
}

async function agregarMedida({ problema_id, causa_id, texto, estado, autor_id, autor_nombre }) {
  const db = getDb();
  const causa = await db.get('SELECT * FROM causas_raiz WHERE id = ? AND problema_id = ?', [causa_id, problema_id]);
  if (!causa) return { error: 'causa_no_encontrada' };
  const estadoFinal = ESTADOS_MEDIDA.includes(estado) ? estado : 'En_Proceso';
  await db.run(
    `INSERT INTO medidas (causa_id, texto, estado, autor_id, autor_nombre, responsable_id, responsable_nombre)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [causa_id, texto, estadoFinal, autor_id || null, autor_nombre || null, autor_id || null, autor_nombre || null]
  );
  await recalcularEstadoProblema(problema_id);
  return { problema: await obtenerProblemaCompleto(problema_id) };
}

async function actualizarEstadoMedida(problemaId, medidaId, estado) {
  const db = getDb();
  if (!ESTADOS_MEDIDA.includes(estado)) return { error: 'estado_invalido' };
  const medida = await db.get(
    `SELECT m.* FROM medidas m JOIN causas_raiz cr ON cr.id = m.causa_id WHERE m.id = ? AND cr.problema_id = ?`,
    [medidaId, problemaId]
  );
  if (!medida) return { error: 'no_encontrada' };
  await db.run('UPDATE medidas SET estado = ?, actualizado_en = ? WHERE id = ?', [estado, nowSql(), medidaId]);
  await recalcularEstadoProblema(problemaId);
  return { problema: await obtenerProblemaCompleto(problemaId) };
}

async function eliminarMedida(problemaId, medidaId) {
  const db = getDb();
  const medida = await db.get(
    `SELECT m.* FROM medidas m JOIN causas_raiz cr ON cr.id = m.causa_id WHERE m.id = ? AND cr.problema_id = ?`,
    [medidaId, problemaId]
  );
  if (!medida) return { error: 'no_encontrada' };
  await db.run('DELETE FROM medidas WHERE id = ?', [medidaId]);
  await recalcularEstadoProblema(problemaId);
  return { medidaEliminada: medida, problema: await obtenerProblemaCompleto(problemaId) };
}

// Implementado si alguna medida quedó "Funcionó"; En_Proceso si tiene
// medidas pero ninguna funcionó todavía; Pendiente si no tiene ninguna
// medida -- mismo criterio de siempre. Si el problema está Descartado
// (salida manual), no se recalcula solo -- se mantiene así hasta que se
// reabra explícitamente (ver reabrirProblema); agregar/cambiar una medida
// después de reabrirlo sí vuelve a recalcularlo normalmente.
async function recalcularEstadoProblema(problemaId) {
  const db = getDb();
  const actual = await db.get('SELECT estado, cerrado_en FROM problemas WHERE id = ?', [problemaId]);
  if (!actual) return null;
  if (actual.estado === 'Descartado') return actual.estado;
  const medidas = await db.all(
    `SELECT m.estado FROM medidas m JOIN causas_raiz cr ON cr.id = m.causa_id WHERE cr.problema_id = ?`,
    [problemaId]
  );
  let estado;
  if (medidas.some((m) => m.estado === 'Funciono')) estado = 'Implementado';
  else if (medidas.length > 0) estado = 'En_Proceso';
  else estado = 'Pendiente';
  const cerradoEn = estado === 'Implementado' ? (actual.cerrado_en || nowSql()) : null;
  await db.run('UPDATE problemas SET estado = ?, cerrado_en = ?, actualizado_en = ? WHERE id = ?', [estado, cerradoEn, nowSql(), problemaId]);
  return estado;
}

// El usuario confirmó que la solución del caso anterior (ya Implementado)
// no funcionó -- toda medida que estuviera en "Funcionó" pasa a "No
// Funcionó" (tiene que ser TODAS, no solo la más reciente, si no el caso
// seguiría recalculándose como Implementado). recalcularEstadoProblema
// reabre solo el problema, sin perder nada de su historial.
async function marcarSolucionAnteriorComoFallida(problemaId) {
  const db = getDb();
  const existe = await db.get('SELECT id FROM problemas WHERE id = ?', [problemaId]);
  if (!existe) return null;
  await db.run(
    `UPDATE medidas SET estado = 'No_Funciono', actualizado_en = ?
     WHERE estado = 'Funciono' AND causa_id IN (SELECT id FROM causas_raiz WHERE problema_id = ?)`,
    [nowSql(), problemaId]
  );
  await recalcularEstadoProblema(problemaId);
  return obtenerProblemaCompleto(problemaId);
}

// Salida manual nueva (no existía en Trazabilidad de Producción ni en
// Reportes): al revisar la lista abierta, se puede decidir que un problema
// no amerita seguimiento -- se marca Descartado en vez de quedar forzado en
// Pendiente para siempre.
async function descartarProblema(problemaId) {
  const db = getDb();
  const existe = await db.get('SELECT id FROM problemas WHERE id = ?', [problemaId]);
  if (!existe) return null;
  await db.run(`UPDATE problemas SET estado = 'Descartado', actualizado_en = ? WHERE id = ?`, [nowSql(), problemaId]);
  return obtenerProblemaCompleto(problemaId);
}

// ======================== ADJUNTOS (evidencia gráfica) ========================
// MIGRACIÓN #42, calcado de las funciones homónimas de data/reportes.js.
function agregarAdjunto({ problema_id, archivo, nombre_original, autor_id, autor_nombre }) {
  return getDb().run(
    `INSERT INTO problemas_adjuntos (problema_id, archivo, nombre_original, autor_id, autor_nombre) VALUES (?, ?, ?, ?, ?)`,
    [problema_id, archivo, nombre_original || null, autor_id || null, autor_nombre || null]
  );
}

function obtenerAdjunto(problemaId, adjuntoId) {
  return getDb().get('SELECT * FROM problemas_adjuntos WHERE id = ? AND problema_id = ?', [adjuntoId, problemaId]);
}

function eliminarAdjunto(problemaId, adjuntoId) {
  return getDb().run('DELETE FROM problemas_adjuntos WHERE id = ? AND problema_id = ?', [adjuntoId, problemaId]);
}

async function reabrirProblema(problemaId) {
  const db = getDb();
  const existe = await db.get('SELECT id FROM problemas WHERE id = ?', [problemaId]);
  if (!existe) return null;
  await db.run(`UPDATE problemas SET estado = 'Pendiente', cerrado_en = NULL, actualizado_en = ? WHERE id = ?`, [nowSql(), problemaId]);
  await recalcularEstadoProblema(problemaId);
  return obtenerProblemaCompleto(problemaId);
}

module.exports = {
  ORIGENES,
  TIPOS_CONTEXTO,
  CRITICIDADES,
  ESTADOS,
  ESTADOS_MEDIDA,
  TRATAMIENTOS,
  CHECKLIST_PREGUNTAS,
  VALORES_CHECKLIST,
  nowSql,
  semanaISO,
  calcularPctDesperdicio,
  listarAreasActivas,
  listarDefectosActivos,
  resolverDefectoIdPorMotivo,
  obtenerProblemaCompleto,
  buscarActivo,
  buscarUltimo,
  listarProblemas,
  listarAlertasCriticas,
  crearProblema,
  actualizarProblema,
  agregarCausa,
  eliminarCausa,
  agregarMedida,
  actualizarEstadoMedida,
  eliminarMedida,
  recalcularEstadoProblema,
  marcarSolucionAnteriorComoFallida,
  descartarProblema,
  reabrirProblema,
  agregarAdjunto,
  obtenerAdjunto,
  eliminarAdjunto,
};
