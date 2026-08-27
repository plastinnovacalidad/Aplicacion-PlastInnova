const fs = require('fs');
const { getDb } = require('../db/connection');
const { ahoraISO } = require('../utils/fechas');
const { RUTAS_CSV_PATH, COTAS_CSV_PATH } = require('../settings/paths');
const { registrarCambio } = require('./auditoria');

// ======================== IMPORTAR CSV METROLOGÍA ========================
async function unificarReferenciasDuplicadas() {
  const db = getDb();
  try {
    const refs = await db.all('SELECT id, codigo_base FROM moldes_referencias ORDER BY id ASC');
    const map = new Map();

    for (const r of refs) {
      const norm = r.codigo_base.trim().toLowerCase();
      if (!map.has(norm)) {
        map.set(norm, r.id);
      } else {
        const primaryId = map.get(norm);
        const duplicateId = r.id;

        await db.run('UPDATE moldes_versiones SET referencia_id = ? WHERE referencia_id = ?', [primaryId, duplicateId]);
        await db.run('UPDATE moldes_cotas SET referencia_id = ? WHERE referencia_id = ?', [primaryId, duplicateId]);
        await db.run('UPDATE moldes_inspecciones SET referencia_id = ? WHERE referencia_id = ?', [primaryId, duplicateId]);
        // moldes_seguimiento_cambios ya no existe (ver migración #9): su
        // historial vive ahora en registro_cambios, indexado por el código
        // de la referencia (que no cambia al unificar duplicados), así que
        // no hace falta reasignar nada ahí.

        await db.run('DELETE FROM moldes_referencias WHERE id = ?', [duplicateId]);
        console.log(`🔗 Referencia duplicada unificada: ID ${duplicateId} (${r.codigo_base}) -> ID ${primaryId}`);
      }
    }
  } catch (e) {
    console.error('⚠️ Error unificando referencias duplicadas:', e.message);
  }
}

async function importarCsvMetrologia() {
  const db = getDb();
  try {
    const adminUser = await db.get('SELECT id FROM usuarios WHERE usuario = ?', ['admin']);
    const adminId = adminUser ? adminUser.id : 1;

    // 1. Importar Rutas.csv (ruta configurable en .env con RUTAS_CSV_PATH)
    const rutasPath = RUTAS_CSV_PATH;
    if (fs.existsSync(rutasPath)) {
      const contenido = fs.readFileSync(rutasPath, 'latin1');
      const lineas = contenido.split(/\r?\n/).filter(l => l.trim().length > 0);
      let countRutas = 0;
      for (let i = 1; i < lineas.length; i++) {
        const partes = lineas[i].split(';');
        if (partes.length >= 3) {
          const codigoBase = partes[1].trim();
          const rutaArchivo = partes[2].trim();
          if (!codigoBase) continue;

          let ref = await db.get('SELECT id FROM moldes_referencias WHERE LOWER(TRIM(codigo_base)) = LOWER(TRIM(?))', [codigoBase]);
          let refId;
          if (!ref) {
            const resRef = await db.run(
              'INSERT INTO moldes_referencias (codigo_base, creado_por, created_at) VALUES (?, ?, ?)',
              [codigoBase, adminId, ahoraISO()]
            );
            refId = resRef.lastID;
            await db.run(
              'INSERT INTO moldes_seguimiento_cambios (referencia_id, tipo_cambio, cambio, motivo, hecho_por, fecha_cambio) VALUES (?, ?, ?, ?, ?, ?)',
              [refId, 'creacion', JSON.stringify({ codigo_base: codigoBase }), 'Importación inicial desde Rutas.csv', adminId, ahoraISO()]
            );
          } else {
            refId = ref.id;
          }

          const verV1 = await db.get('SELECT id FROM moldes_versiones WHERE referencia_id = ? AND version = ?', [refId, 'V1']);
          if (!verV1) {
            await db.run(
              'INSERT INTO moldes_versiones (referencia_id, version, archivo_ruta, estado, creado_por, created_at) VALUES (?, ?, ?, ?, ?, ?)',
              [refId, 'V1', rutaArchivo, 'activa', adminId, ahoraISO()]
            );
            countRutas++;
          }
        }
      }
      console.log(`✅ Rutas.csv importado: ${countRutas} planos.`);
    }

    // 2. Importar cotas.csv (ruta configurable en .env con COTAS_CSV_PATH)
    const cotasPath = COTAS_CSV_PATH;
    if (fs.existsSync(cotasPath)) {
      const contenido = fs.readFileSync(cotasPath, 'latin1');
      const lineas = contenido.split(/\r?\n/).filter(l => l.trim().length > 0);
      let countCotas = 0;
      for (let i = 1; i < lineas.length; i++) {
        const partes = lineas[i].split(';');
        if (partes.length >= 4) {
          const codigoBase = partes[0].trim();
          const cota = partes[1].trim();
          const medidaEstandar = parseFloat(partes[2].trim().replace(',', '.')) || 0;
          const tolerancia = parseFloat(partes[3].trim().replace(',', '.')) || 0;
          const tolMax = medidaEstandar + tolerancia;
          const tolMin = medidaEstandar - tolerancia;

          if (!codigoBase || !cota) continue;

          let ref = await db.get('SELECT id FROM moldes_referencias WHERE LOWER(TRIM(codigo_base)) = LOWER(TRIM(?))', [codigoBase]);
          let refId;
          if (!ref) {
            const resRef = await db.run(
              'INSERT INTO moldes_referencias (codigo_base, creado_por, created_at) VALUES (?, ?, ?)',
              [codigoBase, adminId, ahoraISO()]
            );
            refId = resRef.lastID;
          } else {
            refId = ref.id;
          }

          const existeCota = await db.get('SELECT id FROM moldes_cotas WHERE referencia_id = ? AND cota = ?', [refId, cota]);
          if (!existeCota) {
            await db.run(
              'INSERT INTO moldes_cotas (referencia_id, cota, medida_estandar, tolerancia, tolerancia_maxima, tolerancia_minima) VALUES (?, ?, ?, ?, ?, ?)',
              [refId, cota, medidaEstandar, tolerancia, tolMax, tolMin]
            );
            countCotas++;
          }
        }
      }
      console.log(`✅ cotas.csv importado: ${countCotas} cotas.`);
    }

    // Unificar cualquier referencia duplicada existente
    await unificarReferenciasDuplicadas();
  } catch (e) {
    console.error('⚠️ Error en importarCsvMetrologia:', e.message);
  }
}

// ======================== MÓDULO METROLOGÍA Y PLANOS DE MOLDE ========================

function existeReferenciaPorCodigo(codigoBaseTrim) {
  return getDb().get('SELECT id FROM moldes_referencias WHERE LOWER(TRIM(codigo_base)) = LOWER(TRIM(?))', [codigoBaseTrim]);
}

function crearReferencia(codigoBaseTrim, usuarioId) {
  return getDb().run(
    'INSERT INTO moldes_referencias (codigo_base, creado_por, created_at) VALUES (?, ?, ?)',
    [codigoBaseTrim, usuarioId, ahoraISO()]
  );
}

function crearVersion(refId, version, archivoRuta, estado, usuarioId) {
  return getDb().run(
    'INSERT INTO moldes_versiones (referencia_id, version, archivo_ruta, estado, creado_por, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [refId, version, archivoRuta, estado, usuarioId, ahoraISO()]
  );
}

function crearCota(refId, cota, est, tol, tolMax, tolMin) {
  return getDb().run(`
    INSERT INTO moldes_cotas (referencia_id, cota, medida_estandar, tolerancia, tolerancia_maxima, tolerancia_minima)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [refId, cota, est, tol, tolMax, tolMin]);
}

// "inspeccion" se deja fuera del registro global a propósito: es una
// lectura/medición del día a día, no un cambio a un plano o cota — la
// propia pestaña "Cambios" de Metrología ya la excluía antes, y ahora
// directamente no se guarda como un "cambio" en ningún lado (sigue
// quedando la medición en sí en moldes_inspecciones).
async function insertarSeguimiento(refId, tipoCambio, cambioObj, motivo, usuarioId) {
  if (tipoCambio === 'inspeccion') return;
  // Antes esto también se guardaba en su propia tabla
  // (moldes_seguimiento_cambios); ahora todo el historial de cambios de la
  // aplicación vive en un solo lugar (registro_cambios, ver migración
  // #8/#9 en db/init.js y data/auditoria.js).
  const ref = await getDb().get('SELECT codigo_base FROM moldes_referencias WHERE id = ?', [refId]);
  await registrarCambio({
    modulo: 'Metrología', entidad: 'moldes_referencias', entidadId: ref ? ref.codigo_base : refId,
    accion: tipoCambio && tipoCambio.startsWith('creacion') ? 'Creación' : 'Edición',
    detalle: motivo || (typeof cambioObj === 'string' ? cambioObj : JSON.stringify(cambioObj)),
    usuarioId
  });
}

function listarReferenciasConVersionActiva() {
  return getDb().all(`
    SELECT r.id, r.codigo_base, r.created_at,
           v.version as version_activa, v.archivo_ruta,
           (SELECT COUNT(*) FROM moldes_cotas c WHERE c.referencia_id = r.id) as total_cotas
    FROM moldes_referencias r
    LEFT JOIN moldes_versiones v ON r.id = v.referencia_id AND LOWER(v.estado) = 'activa'
    ORDER BY r.codigo_base ASC
  `);
}

function buscarIdReferenciaPorCodigo(codigo) {
  return getDb().get('SELECT id FROM moldes_referencias WHERE codigo_base = ?', [codigo]);
}

function buscarReferenciaConCreador(codigo) {
  return getDb().get(`
    SELECT r.id, r.codigo_base, r.created_at, u.nombre as creado_por_nombre
    FROM moldes_referencias r
    LEFT JOIN usuarios u ON r.creado_por = u.id
    WHERE r.codigo_base = ?
  `, [codigo]);
}

// Antes había dos consultas separadas para "la versión activa" de un molde:
// esta (buscarVersionActiva, sin ORDER BY) para mostrarla en pantalla, y
// buscarVersionActivaMasReciente (con "ORDER BY id DESC") para crear/
// modificar versiones. Es exactamente el mismo problema que ya se encontró
// y se corrigió en Circuitos SMD (ver la nota equivalente en
// data/referencias.js): mientras una referencia tenga una sola fila
// 'activa' da igual cuál se use, pero si alguna vez queda más de una (por
// ejemplo, por una importación vieja de Rutas.csv que dejó registros
// sueltos), cada consulta podía devolver una distinta. Ahora las dos
// apuntan a la misma consulta para que mostrar y editar SIEMPRE coincidan.
function buscarVersionActivaMasReciente(refId) {
  return getDb().get('SELECT * FROM moldes_versiones WHERE referencia_id = ? AND LOWER(estado) = ? ORDER BY id DESC LIMIT 1', [refId, 'activa']);
}
const buscarVersionActiva = buscarVersionActivaMasReciente;

// Red de seguridad (mismo patrón que retirarOtrasVersionesActivas en
// data/referencias.js): al crear o modificar una versión, deja como
// 'activa' solo la que corresponde y pasa cualquier otra a 'obsoleta' — así
// una referencia con datos viejos duplicados se autocorrige sola la
// próxima vez que se edite, sin necesitar una migración aparte.
function retirarOtrasVersionesActivas(refId, idQueQuedaActiva) {
  return getDb().run(
    "UPDATE moldes_versiones SET estado = 'obsoleta' WHERE referencia_id = ? AND LOWER(estado) = 'activa' AND id != ?",
    [refId, idQueQuedaActiva]
  );
}

function actualizarArchivoVersion(archivoRuta, id) {
  return getDb().run('UPDATE moldes_versiones SET archivo_ruta = ? WHERE id = ?', [archivoRuta, id]);
}

function listarVersiones(refId) {
  return getDb().all('SELECT v.*, u.nombre as creado_por_nombre FROM moldes_versiones v LEFT JOIN usuarios u ON v.creado_por = u.id WHERE v.referencia_id = ? ORDER BY v.id DESC', [refId]);
}

function listarCotas(refId) {
  return getDb().all('SELECT * FROM moldes_cotas WHERE referencia_id = ? ORDER BY cota ASC', [refId]);
}

function listarInspecciones(refId) {
  return getDb().all('SELECT i.*, u.nombre as creado_por_nombre FROM moldes_inspecciones i LEFT JOIN usuarios u ON i.creado_por = u.id WHERE i.referencia_id = ? ORDER BY i.id DESC', [refId]);
}

// Ya no lee de la tabla moldes_seguimiento_cambios (eliminada, ver
// migración #9): el historial de un molde ahora se filtra directamente
// sobre la bitácora global por su código. Ya no hace falta excluir
// "inspeccion" a mano — esas nunca se guardan como "cambio" (ver
// insertarSeguimiento más arriba), así que no aparecen aquí.
async function listarSeguimientoSinInspeccion(refId) {
  const ref = await getDb().get('SELECT codigo_base FROM moldes_referencias WHERE id = ?', [refId]);
  if (!ref) return [];
  return getDb().all(
    `SELECT accion as tipo_cambio, detalle as cambio, detalle as motivo,
            COALESCE(hecho_por_nombre, (SELECT nombre FROM usuarios WHERE id = registro_cambios.hecho_por), 'Sistema') as hecho_por_nombre,
            hecho_por, fecha as fecha_cambio
     FROM registro_cambios
     WHERE entidad = 'moldes_referencias' AND entidad_id = ?
     ORDER BY fecha DESC`,
    [ref.codigo_base]
  );
}

function marcarVersionObsoleta(id) {
  return getDb().run('UPDATE moldes_versiones SET estado = ? WHERE id = ?', ['obsoleta', id]);
}

function crearInspeccion(refId, fecha, responsable, lote, molde, usuarioId) {
  return getDb().run(`
    INSERT INTO moldes_inspecciones (referencia_id, fecha, responsable, lote, molde, creado_por, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [refId, fecha, responsable, lote || '', molde || '', usuarioId, ahoraISO()]);
}

function buscarCotaPorId(cotaId) {
  return getDb().get('SELECT * FROM moldes_cotas WHERE id = ?', [cotaId]);
}

function crearMedidaDetalle(inspeccionId, cotaId, medidaReal, estado, evidenciaPath) {
  return getDb().run(`
    INSERT INTO moldes_medidas_detalle (inspeccion_id, cota_id, medida_real, estado, imagen_evidencia)
    VALUES (?, ?, ?, ?, ?)
  `, [inspeccionId, cotaId, medidaReal, estado, evidenciaPath]);
}

function actualizarCota(cotaId, nombre, est, tol, tolMax, tolMin) {
  return getDb().run(`
    UPDATE moldes_cotas SET cota = ?, medida_estandar = ?, tolerancia = ?, tolerancia_maxima = ?, tolerancia_minima = ?
    WHERE id = ?
  `, [nombre, est, tol, tolMax, tolMin, cotaId]);
}

function eliminarCota(cotaId) {
  return getDb().run('DELETE FROM moldes_cotas WHERE id = ?', [cotaId]);
}

// Julio pidió que borrar una cota NO pueda hacer desaparecer en silencio
// las mediciones que ya se guardaron contra ella en inspecciones pasadas.
// listarMedidasDeInspeccion() hace un JOIN con moldes_cotas — si la cota ya
// no existe, esa fila deja de aparecer en el reporte de esa inspección
// vieja, aunque el dato siga físicamente en moldes_medidas_detalle. Se usa
// antes de eliminarCota() para bloquear el borrado cuando existan.
function contarMedidasDeCota(cotaId) {
  return getDb().get('SELECT COUNT(*) as total FROM moldes_medidas_detalle WHERE cota_id = ?', [cotaId]);
}

function buscarInspeccionConCreador(inspId) {
  return getDb().get('SELECT i.*, u.nombre as creado_por_nombre FROM moldes_inspecciones i LEFT JOIN usuarios u ON i.creado_por = u.id WHERE i.id = ?', [inspId]);
}

function listarMedidasDeInspeccion(inspId) {
  return getDb().all(`
    SELECT m.*, c.cota, c.medida_estandar, c.tolerancia, c.tolerancia_maxima, c.tolerancia_minima
    FROM moldes_medidas_detalle m
    JOIN moldes_cotas c ON m.cota_id = c.id
    WHERE m.inspeccion_id = ?
    ORDER BY c.cota ASC
  `, [inspId]);
}

module.exports = {
  unificarReferenciasDuplicadas,
  importarCsvMetrologia,
  existeReferenciaPorCodigo,
  crearReferencia,
  crearVersion,
  crearCota,
  insertarSeguimiento,
  listarReferenciasConVersionActiva,
  buscarIdReferenciaPorCodigo,
  buscarReferenciaConCreador,
  buscarVersionActiva,
  buscarVersionActivaMasReciente,
  retirarOtrasVersionesActivas,
  actualizarArchivoVersion,
  listarVersiones,
  listarCotas,
  listarInspecciones,
  listarSeguimientoSinInspeccion,
  marcarVersionObsoleta,
  crearInspeccion,
  buscarCotaPorId,
  crearMedidaDetalle,
  actualizarCota,
  eliminarCota,
  contarMedidasDeCota,
  buscarInspeccionConCreador,
  listarMedidasDeInspeccion,
};
