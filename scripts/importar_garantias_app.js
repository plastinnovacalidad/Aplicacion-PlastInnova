// ============ IMPORTAR GARANTÍAS DESDE LA APP DE GARANTÍAS (Firebase) ============
// Pedido por Julio (17/11/2026). La app aparte de Garantías (Firebase,
// proyecto garantias-a5829) guarda respaldos JSON en
//   C:\Users\produ\Documents\Proyectos\Aplicacion Garantias\Respaldos\Main
// Este script toma el respaldo más reciente (o el que se le indique) y pasa a
// la tabla `garantias` de esta app los ítems de cada remisión que Calidad YA
// REVISÓ en la otra app (garantía aceptada o rechazada). Los que todavía no
// se revisan no se cargan: entrarán en una corrida siguiente, cuando ya
// estén revisados.
//
// Se puede correr las veces que se quiera: cada fila guarda en
// `origen_app_id` de qué ítem vino (remisión/ítem de Firebase), así que un
// ítem ya cargado no se vuelve a cargar. Los ítems nuevos de una remisión
// que ya se había cargado quedan con el mismo número de garantía (G...).
//
// Cómo se llena cada columna:
//   no_garantia            siguiente número G (uno por remisión de la otra app)
//   fecha_reporte          día en que se cargó la remisión en la otra app
//   responsable            código de vendedor del cliente (tabla clientes, por NIT)
//   vendedor_distribuidor  primer nombre de la asesora que solicitó la garantía
//   op_pedido              número de pedido del ítem
//   cliente / nit / ciudad los de la remisión
//   remision               "APP-<número de remisión en la otra app>"
//   referencia             sin el "Lam/" del comienzo (igual que las demás)
//   cantidad               cantidad verificada, o recibida, o la reportada
//   tipo_solicitud         GARANTIA / CAMBIO / DEVOLUCION
//   estado                 aceptada -> Aprobada; no aceptada -> Rechazada
//   fecha_revision / quien_aprobo_rechazo  de la revisión de Calidad (historial)
//   lote_fecha             lote del ítem
//   tipo_circuito          misma regla que al crear en la app (data/garantias.js)
//   problema               "Fallos electrónicos" -> G12; "Filtración de agua" -> G1;
//                          vacío u otro motivo -> vacío (pedido por Julio)
//
// Uso (desde la carpeta de la app, con o sin la app encendida):
//   node scripts/importar_garantias_app.js              -> SIMULACIÓN: solo muestra qué haría
//   node scripts/importar_garantias_app.js --aplicar    -> copia de la base y carga
//   node scripts/importar_garantias_app.js "ruta\respaldo.json" [--aplicar]
// Opcional: --actualizar-estados  si en la otra app cambió la decisión de un
//   ítem ya cargado (aceptada <-> rechazada), la pasa también aquí. Sin esta
//   opción solo se avisa, para no pisar lo que se haya corregido en esta app.
//
// Solo funciona con SQLite (MOTOR_BD=sqlite, lo normal hoy).
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { DB_PATH } = require('../settings/paths');

const CARPETA_RESPALDOS = process.env.CARPETA_RESPALDOS_GARANTIAS
  || 'C:\\Users\\produ\\Documents\\Proyectos\\Aplicacion Garantias\\Respaldos\\Main';
const NOMBRE_IMPORTACION = 'Importación app Garantías';

// Motivo de la otra app -> código de causal del catálogo (pedido por Julio).
const CAUSAL_POR_MOTIVO = {
  'fallos electrónicos': 'G12',
  'fallos electronicos': 'G12',
  'filtración de agua': 'G1',
  'filtracion de agua': 'G1',
};
const TIPOS = { garantia: 'GARANTIA', cambio: 'CAMBIO', devolucion: 'DEVOLUCION', 'devolución': 'DEVOLUCION' };

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const ACTUALIZAR_ESTADOS = args.includes('--actualizar-estados');
const archivoArg = args.find(a => !a.startsWith('--'));

// ------------------------------------------------------------ utilidades
const diaLocal = (ms) => (ms ? new Date(ms).toLocaleDateString('sv-SE') : '');
const primerNombre = (s) => String(s || '').trim().split(/\s+/)[0] || '';
const texto = (v) => (v == null ? '' : String(v).trim());

function respaldoMasReciente() {
  if (!fs.existsSync(CARPETA_RESPALDOS)) throw new Error(`No existe la carpeta de respaldos: ${CARPETA_RESPALDOS}`);
  const archivos = fs.readdirSync(CARPETA_RESPALDOS)
    .filter(n => /^respaldo-garantias-.*\.json$/i.test(n))
    .map(n => ({ ruta: path.join(CARPETA_RESPALDOS, n), mtime: fs.statSync(path.join(CARPETA_RESPALDOS, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!archivos.length) throw new Error(`No hay respaldos respaldo-garantias-*.json en ${CARPETA_RESPALDOS}`);
  return archivos[0].ruta;
}

function numeroCantidad(item) {
  for (const campo of ['cantidadVerificada', 'cantidadRecibida', 'cantidad']) {
    const n = parseInt(item[campo], 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return 1;
}

// Última revisión de Calidad (o Producción, en cambios) que quedó en el historial del ítem.
function revisionDe(item) {
  const hist = Array.isArray(item.historial) ? item.historial : [];
  const revs = hist.filter(h => /^Revisado por/i.test(texto(h.accion))).sort((a, b) => (a.en || 0) - (b.en || 0));
  return revs.length ? revs[revs.length - 1] : null;
}

function asesoraDe(item, remision) {
  const hist = Array.isArray(item.historial) ? item.historial : [];
  const sol = hist.find(h => h.rol === 'asesora');
  if (sol) return primerNombre(sol.quien);
  return primerNombre(remision.recepcion && remision.recepcion.entregadoPor);
}

// Lee el respaldo y arma la lista de remisiones con sus ítems.
function leerRespaldo(ruta) {
  const json = JSON.parse(fs.readFileSync(ruta, 'utf-8'));
  const docs = json.documentos || {};
  const remisiones = new Map();
  for (const [clave, valor] of Object.entries(docs)) {
    const p = clave.split('/');
    if (p[0] !== 'remisiones') continue;
    if (p.length === 2) {
      if (!remisiones.has(p[1])) remisiones.set(p[1], { id: p[1], items: [] });
      Object.assign(remisiones.get(p[1]), { datos: valor });
    } else if (p.length === 4 && p[2] === 'items') {
      if (!remisiones.has(p[1])) remisiones.set(p[1], { id: p[1], items: [] });
      remisiones.get(p[1]).items.push({ id: p[3], datos: valor });
    }
  }
  return { info: { proyecto: json.proyecto, fecha: json.fecha }, remisiones: [...remisiones.values()].filter(r => r.datos) };
}

async function siguienteNumeroGarantia(db) {
  // Misma regla que data/garantias.js (obtenerSiguienteNumeroGarantia).
  const ultima = await db.get('SELECT no_garantia FROM garantias ORDER BY id DESC LIMIT 1');
  let siguiente = 1250;
  if (ultima && ultima.no_garantia) {
    const m = ultima.no_garantia.match(/\d+/);
    if (m) siguiente = Math.max(1250, parseInt(m[0], 10) + 1);
  }
  return siguiente;
}

async function main() {
  if (String(process.env.MOTOR_BD || 'sqlite').trim().toLowerCase() === 'sqlserver') {
    throw new Error('Este script solo trabaja con SQLite (MOTOR_BD=sqlserver en el .env).');
  }
  const archivo = archivoArg ? path.resolve(archivoArg) : respaldoMasReciente();
  const { info, remisiones } = leerRespaldo(archivo);
  console.log(`\nRespaldo: ${archivo}`);
  console.log(`Proyecto ${info.proyecto} · generado ${info.fecha} · ${remisiones.length} remisiones`);
  console.log(APLICAR ? 'MODO: APLICAR (se escribirá en la base)\n' : 'MODO: SIMULACIÓN (no se cambia nada; para cargar agrega --aplicar)\n');

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database, mode: APLICAR ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY });
  db.configure('busyTimeout', 15000);

  try {
    // Columna origen_app_id (MIGRACIÓN #54 en db/init.js). Si la app todavía
    // no se ha reiniciado con esa migración, se crea aquí igual.
    const cols = (await db.all('PRAGMA table_info(garantias)')).map(c => c.name);
    const tieneOrigen = cols.includes('origen_app_id');

    // Lo que ya se cargó antes (por ítem) y el número G de cada remisión.
    const yaCargados = new Map();
    const gPorRemision = new Map();
    if (tieneOrigen) {
      const filas = await db.all("SELECT id, no_garantia, estado, origen_app_id FROM garantias WHERE origen_app_id IS NOT NULL AND origen_app_id <> ''");
      for (const f of filas) {
        yaCargados.set(f.origen_app_id, f);
        gPorRemision.set(f.origen_app_id.split('/')[0], f.no_garantia);
      }
    }

    // Causales del catálogo ("G12 - NO PRENDE"), tal como las guarda la app.
    const catalogo = new Map((await db.all('SELECT codigo, descripcion FROM garantias_tipificacion_problemas')).map(c => [c.codigo, `${c.codigo} - ${c.descripcion}`]));
    // Tipo de circuito con la misma regla que al crear una garantía en la app
    // (ver resolverTipoCircuito en data/garantias.js).
    const { resolverTipoCircuito, cargarDatosTipoCircuito } = require('../data/garantias');
    const datosTipo = await cargarDatosTipoCircuito(db);
    const tipoCircuito = async (ref) => resolverTipoCircuito(ref, datosTipo);
    const codVendedor = async (nit) => {
      const c = await db.get("SELECT codigo_vendedor FROM clientes WHERE nit = ? AND codigo_vendedor IS NOT NULL AND codigo_vendedor <> '' LIMIT 1", [nit]);
      return c ? texto(c.codigo_vendedor) : '';
    };

    // ---------------------------------------------------------- plan
    const plan = [];       // por remisión: { rem, nuevos: [fila], yaCargados, sinRevisar, cambiosEstado }
    const motivosSinCausal = new Map();
    for (const rem of remisiones.sort((a, b) => (a.datos.codigo || 0) - (b.datos.codigo || 0))) {
      const r = rem.datos;
      const p = { codigo: r.codigo, cliente: texto(r.cliente), estadoApp: r.estado, nuevos: [], yaCargados: 0, sinRevisar: 0, cambiosEstado: [], noGarantia: gPorRemision.get(rem.id) || null };
      const responsable = await codVendedor(texto(r.nit));
      for (const it of rem.items) {
        const d = it.datos;
        const origen = `${rem.id}/${it.id}`;
        const decision = texto(d.garantiaAceptada).toLowerCase();
        const estado = decision === 'si' ? 'Aprobada' : decision === 'no' ? 'Rechazada' : null;
        const previo = yaCargados.get(origen);
        if (previo) {
          p.yaCargados++;
          if (estado && previo.estado !== estado) p.cambiosEstado.push({ id: previo.id, de: previo.estado, a: estado, d, ref: texto(d.referencia) });
          continue;
        }
        if (!estado) { p.sinRevisar++; continue; }

        const motivo = texto(d.motivo);
        const codigoCausal = CAUSAL_POR_MOTIVO[motivo.toLowerCase()];
        if (motivo && !codigoCausal) motivosSinCausal.set(motivo, (motivosSinCausal.get(motivo) || 0) + 1);
        const rev = revisionDe(d);
        let obs = texto(d.observaciones);
        if (texto(d.motivoCambio)) obs = [obs, `Cambio por: ${texto(d.motivoCambio)}`].filter(Boolean).join(' · ');
        const obsCalidad = [texto(d.observacionCalidad), typeof d.resolucionRechazo === 'string' ? texto(d.resolucionRechazo) : ''].filter(Boolean).join(' · ');

        p.nuevos.push({
          origen,
          fecha_reporte: diaLocal(r.creadoEn),
          responsable,
          vendedor_distribuidor: asesoraDe(d, r),
          op_pedido: texto(d.numeroPedido) || texto(d.numeroPedidoOrigen),
          cliente: texto(r.cliente),
          nit_cliente: texto(r.nit),
          ciudad: texto(r.ciudad),
          remision: `APP-${r.codigo}`,
          referencia: texto(d.referencia).replace(/^lam\//i, ''),
          tipo_circuito: await tipoCircuito(texto(d.referencia).replace(/^lam\//i, '')),
          cantidad: numeroCantidad(d),
          tipo_solicitud: TIPOS[texto(d.tipoSolicitud).toLowerCase()] || texto(d.tipoSolicitud).toUpperCase() || 'GARANTIA',
          observaciones: obs,
          fecha_revision: diaLocal(rev && rev.en) || diaLocal(r.recepcion && r.recepcion.en) || diaLocal(r.creadoEn),
          estado,
          lote_fecha: d.sinLote ? '' : texto(d.lote).toUpperCase(),
          problema: codigoCausal ? (catalogo.get(codigoCausal) || codigoCausal) : '',
          quien_aprobo_rechazo: texto(rev && rev.quien) || NOMBRE_IMPORTACION,
          observacion_calidad: obsCalidad,
        });
      }
      plan.push(p);
    }

    // --------------------------------------------------------- informe
    let numeroSimulado = await siguienteNumeroGarantia(db);
    let totNuevos = 0, totYa = 0, totSinRev = 0, totCambios = 0;
    console.log('Remisión app | Cliente                         | Estado app | Nuevos | Ya cargados | Sin revisar | Garantía');
    console.log('-------------|---------------------------------|------------|--------|-------------|-------------|---------');
    for (const p of plan) {
      let g = p.noGarantia || '';
      if (!g && p.nuevos.length) g = `G${numeroSimulado++}${APLICAR ? '' : ' (aprox.)'}`;
      p.gMostrado = g;
      totNuevos += p.nuevos.length; totYa += p.yaCargados; totSinRev += p.sinRevisar; totCambios += p.cambiosEstado.length;
      console.log(`${String(p.codigo).padEnd(12)} | ${p.cliente.slice(0, 31).padEnd(31)} | ${String(p.estadoApp).padEnd(10)} | ${String(p.nuevos.length).padStart(6)} | ${String(p.yaCargados).padStart(11)} | ${String(p.sinRevisar).padStart(11)} | ${g}`);
    }
    console.log(`\nTotal: ${totNuevos} ítem(s) nuevos para cargar, ${totYa} ya cargados antes, ${totSinRev} sin revisar todavía en la otra app.`);
    if (motivosSinCausal.size) {
      console.log('Motivos sin causal asignada (quedan con Problema vacío):', [...motivosSinCausal].map(([m, n]) => `"${m}" (${n})`).join(', '));
    }
    if (totCambios) {
      console.log(`\n${totCambios} ítem(s) ya cargados cambiaron de decisión en la otra app:`);
      for (const p of plan) for (const c of p.cambiosEstado) console.log(`  - id ${c.id} · ${c.ref} (remisión app ${p.codigo}): aquí "${c.de}", en la otra app "${c.a}"`);
      console.log(ACTUALIZAR_ESTADOS ? '  Se actualizarán (--actualizar-estados).' : '  No se cambian. Para pasarlos, corre de nuevo con --actualizar-estados.');
    }

    if (!APLICAR) {
      console.log('\nSimulación terminada: no se cambió nada. Para cargar: node scripts/importar_garantias_app.js --aplicar');
      return;
    }
    if (!totNuevos && !(ACTUALIZAR_ESTADOS && totCambios)) {
      console.log('\nNo hay nada nuevo para cargar.');
      return;
    }

    // ------------------------------------------- copia de seguridad
    const sello = new Date().toLocaleString('sv-SE').replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1_$2');
    const carpetaResp = path.join(path.dirname(DB_PATH), 'respaldos');
    fs.mkdirSync(carpetaResp, { recursive: true });
    const copia = path.join(carpetaResp, `base_datos_antes_importar_garantias_${sello}.db`);
    await db.exec(`VACUUM INTO '${copia.replace(/'/g, "''")}'`);
    console.log(`\nCopia de seguridad: ${copia}`);

    // ------------------------------------------------- escritura
    const ahora = new Date().toISOString();
    await db.exec('BEGIN IMMEDIATE');
    try {
      if (!tieneOrigen) {
        await db.exec('ALTER TABLE garantias ADD COLUMN origen_app_id TEXT');
        await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_garantias_origen_app ON garantias(origen_app_id)');
        console.log('Columna origen_app_id agregada a garantias.');
      }
      for (const p of plan) {
        if (!p.nuevos.length) continue;
        let g = p.noGarantia;
        if (!g) g = `G${await siguienteNumeroGarantia(db)}`;
        for (const f of p.nuevos) {
          await db.run(`
            INSERT INTO garantias (
              no_garantia, fecha_reporte, responsable, vendedor_distribuidor, memorando,
              op_pedido, cliente, nit_cliente, ciudad, remision, referencia, cantidad,
              tipo_solicitud, observaciones, fecha_revision, estado, lote_fecha,
              problema, quien_aprobo_rechazo, observacion_calidad, tipo_circuito, fecha_creacion, origen_app_id
            ) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
            [g, f.fecha_reporte, f.responsable, f.vendedor_distribuidor, f.op_pedido, f.cliente, f.nit_cliente, f.ciudad,
             f.remision, f.referencia, f.cantidad, f.tipo_solicitud, f.observaciones, f.fecha_revision, f.estado,
             f.lote_fecha, f.problema, f.quien_aprobo_rechazo, f.observacion_calidad, f.tipo_circuito, f.origen]);
        }
        await db.run(
          `INSERT INTO registro_cambios (modulo, entidad, entidad_id, accion, detalle, hecho_por, hecho_por_nombre, fecha)
           VALUES ('Garantías', 'garantias', ?, 'Creación', ?, NULL, ?, ?)`,
          [g, `Garantía ${g} cargada desde la app de Garantías (remisión ${p.codigo} de esa app, "${p.cliente}", ${p.nuevos.length} ítem(s)).`, NOMBRE_IMPORTACION, ahora]);
        p.gMostrado = g;
        console.log(`  ${g}: ${p.nuevos.length} ítem(s) de la remisión ${p.codigo} (${p.cliente})`);
      }
      if (ACTUALIZAR_ESTADOS) {
        for (const p of plan) for (const c of p.cambiosEstado) {
          const rev = revisionDe(c.d);
          await db.run('UPDATE garantias SET estado = ?, fecha_revision = ?, quien_aprobo_rechazo = ? WHERE id = ?',
            [c.a, diaLocal(rev && rev.en) || ahora.slice(0, 10), texto(rev && rev.quien) || NOMBRE_IMPORTACION, c.id]);
          await db.run(
            `INSERT INTO registro_cambios (modulo, entidad, entidad_id, accion, detalle, hecho_por, hecho_por_nombre, fecha)
             VALUES ('Garantías', 'garantias', ?, 'Edición', ?, NULL, ?, ?)`,
            [String(c.id), `Estado ${c.de} → ${c.a} según la app de Garantías (${c.ref}, remisión ${p.codigo}).`, NOMBRE_IMPORTACION, ahora]);
        }
      }
      await db.exec('COMMIT');
    } catch (e) {
      try { await db.exec('ROLLBACK'); } catch (e2) { /* sigue el error original */ }
      throw e;
    }
    console.log(`\nListo: ${totNuevos} ítem(s) cargados${ACTUALIZAR_ESTADOS && totCambios ? ` y ${totCambios} estado(s) actualizados` : ''}. Ya se ven en la app (Garantías), sin reiniciar.`);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error(`\nERROR: ${e.message}\nNo se cargó nada (si alcanzó a empezar, se deshizo).`);
  process.exit(1);
});
