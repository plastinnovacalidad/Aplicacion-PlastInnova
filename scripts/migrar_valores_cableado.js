// ======================== MIGRACIÓN DE DATOS: circuitos-app → módulo "Valores y Cableado" ========================
// Copia, UNA SOLA VEZ, los datos reales que Julio ya tenía cargados en la
// app aparte "circuitos-app" (valores eléctricos medidos, rangos de
// revisión, configuración de cableado y fotos de cableado) hacia las
// tablas elec_* de este proyecto — SIN duplicar el catálogo de
// referencia/color/versión ni la foto de circuito, que ya existen en las
// tablas `referencias` y `versiones` de Circuitos SMD (confirmado con
// Julio: son el mismo producto, mismo código, misma foto).
//
// El archivo data/migracion_valores_cableado.json que este script lee ya
// viene resuelto de antemano (no es un volcado crudo de circuitos-app):
// cada fila ya trae el codigo_base de Circuitos SMD al que corresponde. De
// los 482 productos que tenía circuitos-app, 448 combinaciones
// referencia+versión únicas quedaron así:
//   - 411 emparejan exacto con una referencia que ya existe en Circuitos SMD.
//   - 26 son referencias que no existían todavía en Circuitos SMD (familias
//     "1075" y "1075B", 8 y 18 colores respectivamente) — Julio pidió
//     crearlas de una vez. Se crean con sufijo "MUL" (como sus referencias
//     hermanas "1075AL"/"1075ALB"), sin foto de circuito todavía (se agrega
//     después, normal, desde Circuitos SMD).
//   - El resto son la misma referencia "1075AL"/"1075ALB" (que en Circuitos
//     SMD es una sola ficha "UNICA" sin distinción de color) repetida por
//     cada color que circuitos-app sí distinguía.
//
// Se ejecuta a mano, una vez:
//   node scripts/migrar_valores_cableado.js
//
// Es seguro correrlo más de una vez: usa INSERT OR IGNORE / UPDATE por
// llave (version_id), así que no duplica nada si se vuelve a correr.
const path = require('path');
const fs = require('fs');

const { inicializarBaseDatos } = require('../db/init');
const { getDb } = require('../db/connection');
// Se reutilizan las mismas funciones que usa la pantalla de Circuitos SMD
// para crear referencias/versiones nuevas — así se respeta exactamente el
// mismo esquema real de la tabla (varias columnas son NOT NULL sin
// default, como imagen_ruta/creado_por/created_at, algo que no se ve en el
// CREATE TABLE de db/init.js porque esa tabla ya existía de antes).
const refData = require('../data/referencias');

const RUTA_JSON = path.join(__dirname, '..', 'data', 'migracion_valores_cableado.json');

async function obtenerOcrearReferencia(codigoBase, creadoPor) {
  const existente = await refData.buscarIdReferenciaPorCodigo(codigoBase);
  if (existente) return { id: existente.id, creada: false };
  const resultado = await refData.crearReferencia(codigoBase, creadoPor);
  return { id: resultado.lastID, creada: true };
}

async function obtenerOcrearVersion(referenciaId, version, creadoPor) {
  const db = getDb();
  const existente = await db.get('SELECT id FROM versiones WHERE referencia_id = ? AND version = ?', [referenciaId, version]);
  if (existente) return { id: existente.id, creada: false };
  // imagen_ruta='' (no NULL, la columna es NOT NULL): esta versión se creó
  // desde datos eléctricos, todavía sin foto de circuito — se le puede
  // subir una normal desde Circuitos SMD cuando esté disponible.
  const resultado = await refData.crearVersion(referenciaId, version, '', 'activa', creadoPor, 0);
  return { id: resultado.lastID, creada: true };
}

async function main() {
  console.log('======================== Migración circuitos-app → Valores y Cableado ========================\n');

  if (!fs.existsSync(RUTA_JSON)) {
    console.error(`❌ No se encontró el archivo de datos:\n   ${RUTA_JSON}\n`);
    process.exit(1);
  }
  const datos = JSON.parse(fs.readFileSync(RUTA_JSON, 'utf8'));
  console.log(`📂 Datos a migrar: ${datos.versiones.length} versiones, ${datos.fotos_cableado.length} fotos de cableado.\n`);

  // Asegura que las tablas elec_* (y todo lo demás) ya existan, igual que
  // si el servidor acabara de arrancar. Seguro de llamar aunque el servidor
  // ya esté corriendo — todo el proceso de inicialización es idempotente.
  await inicializarBaseDatos();
  const db = getDb();
  console.log('📦 Base de datos lista (tablas elec_* creadas si hacía falta).\n');

  const admin = await db.get("SELECT id FROM usuarios WHERE usuario = 'admin' OR usuario = 'JulioLopez' ORDER BY (usuario = 'admin') DESC LIMIT 1");
  const creadoPor = admin ? admin.id : null;

  let referenciasCreadas = 0, versionesCreadas = 0, medicionesGuardadas = 0;

  for (const v of datos.versiones) {
    try {
      const { id: referenciaId, creada: refCreada } = await obtenerOcrearReferencia(v.codigo_base, creadoPor);
      if (refCreada) referenciasCreadas++;

      const { id: versionId, creada: verCreada } = await obtenerOcrearVersion(referenciaId, v.version, creadoPor);
      if (verCreada) versionesCreadas++;

      const m = v.mediciones, r = v.rangos, c = v.cableado;

      await db.run(
        `INSERT INTO elec_mediciones (version_id, voltaje_revision, amperaje_medias, amperaje_altas, potencia_medias, potencia_altas)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(version_id) DO UPDATE SET
           voltaje_revision=excluded.voltaje_revision, amperaje_medias=excluded.amperaje_medias,
           amperaje_altas=excluded.amperaje_altas, potencia_medias=excluded.potencia_medias, potencia_altas=excluded.potencia_altas`,
        [versionId, m.voltaje_revision, m.amperaje_medias, m.amperaje_altas, m.potencia_medias, m.potencia_altas]
      );

      await db.run(
        `INSERT INTO elec_rangos_revision (version_id, voltaje_min, voltaje_max, amperaje_min_bajas, amperaje_min_altas, amperaje_max, potencia_min_bajas, potencia_min_altas, potencia_max)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(version_id) DO UPDATE SET
           voltaje_min=excluded.voltaje_min, voltaje_max=excluded.voltaje_max,
           amperaje_min_bajas=excluded.amperaje_min_bajas, amperaje_min_altas=excluded.amperaje_min_altas, amperaje_max=excluded.amperaje_max,
           potencia_min_bajas=excluded.potencia_min_bajas, potencia_min_altas=excluded.potencia_min_altas, potencia_max=excluded.potencia_max`,
        [versionId, r.voltaje_min, r.voltaje_max, r.amperaje_min_bajas, r.amperaje_min_altas, r.amperaje_max, r.potencia_min_bajas, r.potencia_min_altas, r.potencia_max]
      );

      await db.run(
        `INSERT INTO elec_config_cableado (version_id, cortar_puntas, posicion_punto, empujar_cables, forma_cableado, referencia_cable)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(version_id) DO UPDATE SET
           cortar_puntas=excluded.cortar_puntas, posicion_punto=excluded.posicion_punto,
           empujar_cables=excluded.empujar_cables, forma_cableado=excluded.forma_cableado, referencia_cable=excluded.referencia_cable`,
        [versionId, c.cortar_puntas, c.posicion_punto, c.empujar_cables, c.forma_cableado, c.referencia_cable]
      );

      medicionesGuardadas++;
    } catch (e) {
      console.error(`  ⚠️ Error migrando ${v.codigo_base} ${v.version}: ${e.message}`);
    }
  }

  let fotosNuevas = 0;
  for (const f of datos.fotos_cableado) {
    const resultado = await db.run(
      'INSERT OR IGNORE INTO elec_fotos_cableado (forma_cableado, url_foto) VALUES (?, ?)',
      [f.forma_cableado, f.url_foto]
    );
    if (resultado.changes > 0) fotosNuevas++;
  }

  console.log(`  referencias nuevas creadas en Circuitos SMD: ${referenciasCreadas}`);
  console.log(`  versiones nuevas creadas: ${versionesCreadas}`);
  console.log(`  fichas de valores/cableado guardadas o actualizadas: ${medicionesGuardadas}`);
  console.log(`  fotos de cableado nuevas: ${fotosNuevas} (de ${datos.fotos_cableado.length} en el catálogo)`);
  console.log('\n✅ Migración terminada. Puedes correr este script otra vez sin riesgo (no duplica nada).\n');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error inesperado durante la migración:', err);
  process.exit(1);
});
