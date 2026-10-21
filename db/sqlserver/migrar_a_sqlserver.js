/* =====================================================================
   Plast Innova · App de calidad (Circuitos SMD)
   Migración de datos: SQLite (db/base_datos.db) -> SQL Server, esquema [calidad]

   QUÉ HACE
     1. Abre la base SQLite en SOLO LECTURA (no la modifica nunca).
     2. Revisa cada tabla y convierte los datos al tipo de SQL Server:
        - Fechas en cualquiera de los formatos que hay hoy
          (31/07/2026 · 2026/08/03 12:59 · 2026-08-13 14:11:53 ·
           2026-08-11T11:57:39.731Z) -> fecha real.
          Las que terminan en "Z" están en hora UTC y se pasan a hora de
          Colombia (UTC-5).
        - Sí/No (0/1), números y textos.
     3. Copia las filas conservando los mismos id.
     4. Al final muestra una tabla con los conteos SQLite vs SQL Server y
        deja un reporte en db/sqlserver/reporte_migracion.txt

   SEGURIDAD
     - Cada tabla se carga dentro de una transacción: o entra completa, o
       no entra nada de esa tabla.
     - Si una tabla tiene un dato que no cabe (texto más largo que la
       columna, número inválido, fecha obligatoria ilegible), esa tabla NO
       se carga y el problema queda en el reporte. Las demás siguen.
     - Una fecha opcional que no se pueda leer queda vacía (NULL) y se
       anota en el reporte como advertencia.
     - Si las tablas de SQL Server ya tienen datos, se detiene, salvo que
       se ejecute con --vaciar.

   CÓMO EJECUTARLO (desde la carpeta del proyecto)
     node db/sqlserver/migrar_a_sqlserver.js            (carga normal)
     node db/sqlserver/migrar_a_sqlserver.js --vaciar   (borra lo cargado en
                                                         SQL Server y vuelve a cargar)

   Los datos de conexión salen del archivo .env:
     MSSQL_SERVER, MSSQL_PORT, MSSQL_DATABASE, MSSQL_USER,
     MSSQL_PASSWORD, MSSQL_TRUST_CERT
   ===================================================================== */

const path = require('path');
const fs = require('fs');

const RAIZ = path.resolve(__dirname, '..', '..');
require('dotenv').config({ path: path.join(RAIZ, '.env') });

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
let sql;
try {
  sql = require('mssql');
} catch (e) {
  console.error('\nFalta el paquete "mssql". Ejecuta primero:  npm install mssql\n');
  process.exit(1);
}

const ESQUEMA = 'calidad';
const SQLITE_PATH = process.env.SQLITE_PATH || path.join(RAIZ, 'db', 'base_datos.db');
const REPORTE = path.join(__dirname, 'reporte_migracion.txt');
const VACIAR = process.argv.includes('--vaciar');
const MAX_PARAMS = 2000; // SQL Server acepta hasta 2100 parámetros por instrucción

// ----------------------------------------------------------------- fechas
// Colombia no usa horario de verano: siempre UTC-5.
const OFFSET_COLOMBIA_MIN = -5 * 60;

function fechaLocal(y, mo, d, h = 0, mi = 0, s = 0) {
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Validar que la fecha exista (por ejemplo, que no sea 31/02)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2100) return null;
  return dt; // Se maneja como "hora de pared" (ver useUTC más abajo)
}

/**
 * Convierte un texto de fecha a Date. Devuelve null si no se puede leer.
 * Las fechas se guardan como "hora de pared" de Colombia: el objeto Date
 * lleva en UTC exactamente la hora local que debe quedar en SQL Server.
 */
function leerFecha(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return null;
  const s = String(valor).trim();
  let m;

  // 2026-08-11T11:57:39.731Z  -> UTC, se pasa a hora de Colombia
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?Z$/);
  if (m) {
    const utc = fechaLocal(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0));
    return utc ? new Date(utc.getTime() + OFFSET_COLOMBIA_MIN * 60000) : null;
  }
  // 2026-08-13 14:11:53  /  2026-08-13T14:11  /  2026-08-13
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/);
  if (m) return fechaLocal(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  // 2026/08/03 12:59
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return fechaLocal(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  // 31/07/2026  /  10/08/2026, 12:56:13   (día/mes/año)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return fechaLocal(+m[3], +m[2], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return null;
}

// ------------------------------------------------------- conversión de tipos
function tipoMssql(col) {
  switch (col.tipo) {
    case 'int': return sql.Int;
    case 'tinyint': return sql.TinyInt;
    case 'decimal': return sql.Decimal(col.precision, col.escala);
    case 'date': return sql.Date;
    case 'datetime2': return sql.DateTime2(col.escalaFecha);
    case 'nvarchar': return col.largo === -1 ? sql.NVarChar(sql.MAX) : sql.NVarChar(col.largo);
    default: throw new Error(`Tipo no previsto: ${col.tipo} en ${col.nombre}`);
  }
}

/**
 * Convierte un valor de SQLite al valor que va a SQL Server.
 * Devuelve { valor } o { error } (bloquea la tabla) o { valor, aviso }.
 */
function convertir(valor, col) {
  if (valor === null || valor === undefined) {
    return col.nulo ? { valor: null } : { error: 'vacío en una columna obligatoria' };
  }
  switch (col.tipo) {
    case 'int':
    case 'tinyint': {
      const n = Number(valor);
      if (!Number.isInteger(n)) return { error: `"${valor}" no es un número entero` };
      if (col.tipo === 'tinyint' && n !== 0 && n !== 1) return { error: `"${valor}" debería ser 0 o 1` };
      return { valor: n };
    }
    case 'decimal': {
      const n = Number(valor);
      if (!Number.isFinite(n)) return { error: `"${valor}" no es un número` };
      const limite = Math.pow(10, col.precision - col.escala);
      if (Math.abs(n) >= limite) return { error: `${n} es demasiado grande para DECIMAL(${col.precision},${col.escala})` };
      return { valor: Number(n.toFixed(col.escala)) };
    }
    case 'date':
    case 'datetime2': {
      const f = leerFecha(valor);
      if (f) return { valor: f };
      if (col.nulo) return { valor: null, aviso: `fecha ilegible "${valor}" -> quedó vacía` };
      return { error: `fecha ilegible "${valor}" en una columna obligatoria` };
    }
    case 'nvarchar': {
      const s = String(valor);
      if (col.largo !== -1 && s.length > col.largo) {
        return { error: `texto de ${s.length} caracteres no cabe en NVARCHAR(${col.largo})` };
      }
      return { valor: s };
    }
    default:
      return { error: `tipo no previsto ${col.tipo}` };
  }
}

// ------------------------------------------------------------- utilidades
const qn = (x) => '[' + String(x).replace(/]/g, ']]') + ']';
const tabla = (t) => `${qn(ESQUEMA)}.${qn(t)}`;
const fmt = (n) => Number(n).toLocaleString('es-CO');
const lineasReporte = [];
function reportar(texto) { lineasReporte.push(texto); }

function ordenarPorDependencias(tablas, dependencias) {
  // Padres primero (así funciona aunque ya existan las llaves foráneas)
  const orden = [];
  const visitado = new Set();
  const visitar = (t, pila = new Set()) => {
    if (visitado.has(t) || pila.has(t)) return;
    pila.add(t);
    for (const p of dependencias.get(t) || []) if (p !== t) visitar(p, pila);
    visitado.add(t);
    orden.push(t);
  };
  tablas.forEach((t) => visitar(t));
  return orden;
}

// ------------------------------------------------------------------ inicio
async function main() {
  const faltan = ['MSSQL_SERVER', 'MSSQL_DATABASE', 'MSSQL_USER', 'MSSQL_PASSWORD']
    .filter((k) => !process.env[k]);
  if (faltan.length) {
    console.error(`\nFaltan estas líneas en el .env: ${faltan.join(', ')}\n`);
    process.exit(1);
  }
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`\nNo encuentro la base SQLite en: ${SQLITE_PATH}\n`);
    process.exit(1);
  }

  console.log('\n=== Migración SQLite -> SQL Server ===');
  console.log(`SQLite:     ${SQLITE_PATH} (solo lectura)`);
  console.log(`SQL Server: ${process.env.MSSQL_SERVER}:${process.env.MSSQL_PORT || 1433} · base ${process.env.MSSQL_DATABASE} · usuario ${process.env.MSSQL_USER}`);
  reportar(`Migración ejecutada el ${new Date().toLocaleString('es-CO')}`);
  reportar(`Destino: ${process.env.MSSQL_SERVER} / ${process.env.MSSQL_DATABASE} / esquema ${ESQUEMA}`);

  const lite = await open({ filename: SQLITE_PATH, driver: sqlite3.Database, mode: sqlite3.OPEN_READONLY });

  const pool = await new sql.ConnectionPool({
    server: process.env.MSSQL_SERVER,
    port: Number(process.env.MSSQL_PORT || 1433),
    database: process.env.MSSQL_DATABASE,
    user: process.env.MSSQL_USER,
    password: process.env.MSSQL_PASSWORD,
    options: {
      encrypt: true,
      trustServerCertificate: String(process.env.MSSQL_TRUST_CERT).toLowerCase() === 'true',
      useUTC: true, // las fechas ya vienen como "hora de pared" de Colombia
    },
    pool: { max: 2, min: 0 },
    requestTimeout: 300000,
  }).connect();

  // Seguridad: nunca escribir en una base del sistema
  const base = (await pool.request().query('SELECT DB_NAME() AS b')).recordset[0].b;
  if (['master', 'model', 'msdb', 'tempdb'].includes(base.toLowerCase())) {
    throw new Error(`La conexión quedó en la base "${base}". Revisa MSSQL_DATABASE en el .env.`);
  }

  // Columnas de destino (tipos reales de SQL Server)
  const meta = (await pool.request().input('esq', sql.NVarChar, ESQUEMA).query(`
    SELECT t.name AS tabla, c.name AS columna, ty.name AS tipo, c.max_length, c.precision, c.scale,
           c.is_nullable, c.is_identity, c.column_id
    FROM sys.tables t
    JOIN sys.columns c ON c.object_id = t.object_id
    JOIN sys.types ty ON ty.user_type_id = c.user_type_id
    WHERE t.schema_id = SCHEMA_ID(@esq)
    ORDER BY t.name, c.column_id`)).recordset;
  if (!meta.length) throw new Error(`No hay tablas en el esquema [${ESQUEMA}]. Ejecuta primero 01_crear_tablas.sql.`);

  // Columnas de la llave primaria de cada tabla
  const pkRows = (await pool.request().input('esq', sql.NVarChar, ESQUEMA).query(`
    SELECT t.name AS tabla, c.name AS columna
    FROM sys.tables t
    JOIN sys.indexes i ON i.object_id = t.object_id AND i.is_primary_key = 1
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
    WHERE t.schema_id = SCHEMA_ID(@esq)
    ORDER BY t.name, ic.key_ordinal`)).recordset;
  const llaves = new Map();
  for (const r of pkRows) {
    if (!llaves.has(r.tabla)) llaves.set(r.tabla, []);
    llaves.get(r.tabla).push(r.columna);
  }

  const destino = new Map();
  for (const r of meta) {
    if (!destino.has(r.tabla)) destino.set(r.tabla, { columnas: [], identidad: false });
    const d = destino.get(r.tabla);
    d.columnas.push({
      nombre: r.columna,
      tipo: r.tipo,
      largo: r.tipo === 'nvarchar' ? (r.max_length === -1 ? -1 : r.max_length / 2) : null,
      precision: r.precision,
      escala: r.scale,
      escalaFecha: r.scale,
      nulo: r.is_nullable,
    });
    if (r.is_identity) d.identidad = true;
  }

  // Tablas de SQLite
  const tablasLite = (await lite.all(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )).map((r) => r.name);

  const sinDestino = tablasLite.filter((t) => !destino.has(t));
  if (sinDestino.length) {
    throw new Error(`Estas tablas de SQLite no existen en SQL Server: ${sinDestino.join(', ')}`);
  }

  // Orden: padres primero
  const deps = new Map();
  for (const t of tablasLite) {
    const fks = await lite.all(`PRAGMA foreign_key_list("${t}")`);
    const padres = fks.map((f) => tablasLite.find((x) => x.toLowerCase() === String(f.table).toLowerCase())).filter(Boolean);
    deps.set(t, padres);
  }
  const orden = ordenarPorDependencias(tablasLite, deps);

  // ¿Ya hay datos en SQL Server?
  const conDatos = [];
  for (const t of orden) {
    const n = (await pool.request().query(`SELECT COUNT_BIG(*) AS n FROM ${tabla(t)}`)).recordset[0].n;
    if (Number(n) > 0) conDatos.push(t);
  }
  if (conDatos.length && !VACIAR) {
    throw new Error(
      `Ya hay datos en ${conDatos.length} tabla(s) de SQL Server (por ejemplo ${conDatos.slice(0, 3).join(', ')}).\n` +
      '  Si quieres borrar lo cargado y volver a cargar, ejecuta con:  --vaciar'
    );
  }
  if (VACIAR && conDatos.length) {
    console.log(`\nVaciando ${conDatos.length} tabla(s) en SQL Server (hijos primero)...`);
    for (const t of [...orden].reverse()) {
      if (conDatos.includes(t)) await pool.request().query(`DELETE FROM ${tabla(t)}`);
    }
  }

  // --------------------------------------------------------- carga por tabla
  // Si ya existen las relaciones (02_relaciones.sql), se pausan durante la carga
  // para no depender del orden, y se vuelven a activar al final.
  const nFks = Number((await pool.request().input('esq', sql.NVarChar, ESQUEMA).query(
    'SELECT COUNT(*) AS n FROM sys.foreign_keys WHERE schema_id = SCHEMA_ID(@esq)')).recordset[0].n);
  if (nFks > 0) {
    console.log(`\nPausando ${nFks} relaciones durante la carga...`);
    for (const t of orden) await pool.request().batch(`ALTER TABLE ${tabla(t)} NOCHECK CONSTRAINT ALL;`);
  }

  console.log('\nCargando tablas...\n');
  const resumen = [];
  for (const t of orden) {
    const d = destino.get(t);
    const colsLite = (await lite.all(`PRAGMA table_info("${t}")`)).map((c) => c.name);
    const faltanCols = d.columnas.filter((c) => !colsLite.includes(c.nombre)).map((c) => c.nombre);
    const sobranCols = colsLite.filter((c) => !d.columnas.some((x) => x.nombre === c));
    if (faltanCols.length || sobranCols.length) {
      const msg = `columnas distintas (faltan en SQLite: ${faltanCols.join(', ') || '-'}; faltan en SQL Server: ${sobranCols.join(', ') || '-'})`;
      resumen.push({ t, lite: '?', sql: 0, estado: 'NO CARGADA' });
      reportar(`\n[${t}] NO CARGADA: ${msg}`);
      continue;
    }
    const cols = d.columnas;
    const filas = await lite.all(`SELECT ${cols.map((c) => `"${c.nombre}"`).join(', ')} FROM "${t}"`);

    // 1) Revisar y convertir todo antes de escribir nada
    const errores = [];
    const avisos = [];
    const convertidas = [];
    const omitidas = [];
    // SQL Server no distingue mayúsculas ni espacios finales en las llaves de texto;
    // SQLite sí. Si dos filas solo difieren en eso y el resto es idéntico, se deja la primera.
    const idxLlave = (llaves.get(t) || []).map((n) => cols.findIndex((c) => c.nombre === n));
    const normal = (v) => (typeof v === 'string' ? v.replace(/ +$/, '').toLowerCase() : v instanceof Date ? v.getTime() : v);
    const vistas = new Map();
    for (let i = 0; i < filas.length; i++) {
      const fila = filas[i];
      const fuera = new Array(cols.length);
      for (let j = 0; j < cols.length; j++) {
        const r = convertir(fila[cols[j].nombre], cols[j]);
        if (r.error) errores.push(`fila ${i + 1} (${idFila(fila)}) · ${cols[j].nombre}: ${r.error}`);
        else {
          fuera[j] = r.valor;
          if (r.aviso) avisos.push(`fila ${i + 1} (${idFila(fila)}) · ${cols[j].nombre}: ${r.aviso}`);
        }
      }
      if (idxLlave.length && idxLlave.every((j) => j >= 0)) {
        const clave = JSON.stringify(idxLlave.map((j) => normal(fuera[j])));
        const previa = vistas.get(clave);
        if (previa) {
          const igual = fuera.every((v, j) => idxLlave.includes(j) || normal(v) === normal(previa.fila[j]));
          const texto = idxLlave.map((j) => `${cols[j].nombre}="${fuera[j]}"`).join(', ');
          const textoPrevio = idxLlave.map((j) => `"${previa.fila[j]}"`).join(', ');
          if (igual) { omitidas.push(`${texto} (igual a ${textoPrevio}, solo cambia en mayúsculas/espacios)`); continue; }
          errores.push(`fila ${i + 1}: ${texto} choca con ${textoPrevio} (solo cambia en mayúsculas/espacios) y sus datos son distintos`);
          continue;
        }
        vistas.set(clave, { fila: fuera });
      }
      convertidas.push(fuera);
    }
    if (omitidas.length) {
      reportar(`\n[${t}] ${omitidas.length} fila(s) duplicada(s) omitida(s):`);
      omitidas.forEach((o) => reportar('  - ' + o));
    }
    if (avisos.length) {
      reportar(`\n[${t}] ${avisos.length} advertencia(s):`);
      avisos.slice(0, 200).forEach((a) => reportar('  - ' + a));
      if (avisos.length > 200) reportar(`  ... y ${avisos.length - 200} más`);
    }
    if (errores.length) {
      resumen.push({ t, lite: filas.length, sql: 0, estado: 'NO CARGADA' });
      reportar(`\n[${t}] NO CARGADA por ${errores.length} problema(s):`);
      errores.slice(0, 200).forEach((e) => reportar('  - ' + e));
      if (errores.length > 200) reportar(`  ... y ${errores.length - 200} más`);
      console.log(`  ✗ ${t.padEnd(34)} no cargada (ver reporte)`);
      continue;
    }

    // 2) Escribir en lotes dentro de una transacción
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      if (d.identidad) await new sql.Request(tx).batch(`SET IDENTITY_INSERT ${tabla(t)} ON;`);
      const porLote = Math.max(1, Math.min(1000, Math.floor(MAX_PARAMS / cols.length)));
      const listaCols = cols.map((c) => qn(c.nombre)).join(', ');
      for (let i = 0; i < convertidas.length; i += porLote) {
        const lote = convertidas.slice(i, i + porLote);
        const req = new sql.Request(tx);
        const valores = lote.map((fila, k) => {
          return '(' + fila.map((v, j) => {
            const p = `p${k}_${j}`;
            req.input(p, tipoMssql(cols[j]), v);
            return '@' + p;
          }).join(', ') + ')';
        });
        await req.query(`INSERT INTO ${tabla(t)} (${listaCols}) VALUES ${valores.join(', ')};`);
        if (convertidas.length > 20000 && (i / porLote) % 40 === 0) {
          process.stdout.write(`\r  … ${t}: ${fmt(Math.min(i + porLote, convertidas.length))} / ${fmt(convertidas.length)}`);
        }
      }
      if (d.identidad) await new sql.Request(tx).batch(`SET IDENTITY_INSERT ${tabla(t)} OFF;`);
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch (_) { /* ya se deshizo */ }
      resumen.push({ t, lite: filas.length, sql: 0, estado: 'NO CARGADA' });
      reportar(`\n[${t}] NO CARGADA, error de SQL Server: ${e.message}`);
      console.log(`\r  ✗ ${t.padEnd(34)} error de SQL Server (ver reporte)          `);
      continue;
    }
    const n = Number((await pool.request().query(`SELECT COUNT_BIG(*) AS n FROM ${tabla(t)}`)).recordset[0].n);
    const ok = n === convertidas.length;
    const notas = [avisos.length ? `${avisos.length} aviso(s)` : '', omitidas.length ? `${omitidas.length} duplicado(s) omitido(s)` : ''].filter(Boolean).join(', ');
    resumen.push({ t, lite: filas.length, sql: n, estado: ok ? (notas ? `OK (${notas})` : 'OK') : 'DIFERENTE' });
    console.log(`\r  ${ok ? '✓' : '!'} ${t.padEnd(34)} ${fmt(n).padStart(9)} filas${notas ? `  (${notas})` : ''}          `);
  }

  // Reactivar relaciones: primero intentando validar todo lo cargado; si una
  // tabla tiene excepciones conocidas (p. ej. los 18 registros históricos de
  // WhatsApp con áreas viejas) se reactiva solo para los datos nuevos.
  if (nFks > 0) {
    console.log('\nReactivando relaciones...');
    for (const t of orden) {
      try {
        await pool.request().batch(`ALTER TABLE ${tabla(t)} WITH CHECK CHECK CONSTRAINT ALL;`);
      } catch (e) {
        await pool.request().batch(`ALTER TABLE ${tabla(t)} CHECK CONSTRAINT ALL;`);
        reportar(`\n[${t}] relaciones reactivadas solo para datos nuevos (los datos actuales tienen excepciones): ${e.message}`);
        console.log(`  · ${t}: relaciones activas para datos nuevos (ver reporte)`);
      }
    }
  }

  // ---------------------------------------------------------------- resumen
  const anchoT = 34;
  const lineas = [
    '',
    'RESUMEN (SQLite vs SQL Server)',
    `${'Tabla'.padEnd(anchoT)} ${'SQLite'.padStart(9)} ${'SQL Server'.padStart(11)}  Estado`,
    '-'.repeat(anchoT + 36),
    ...resumen.map((r) => `${r.t.padEnd(anchoT)} ${String(r.lite === '?' ? '?' : fmt(r.lite)).padStart(9)} ${fmt(r.sql).padStart(11)}  ${r.estado}`),
  ];
  const tot = resumen.reduce((a, r) => ({ lite: a.lite + (Number(r.lite) || 0), sql: a.sql + r.sql }), { lite: 0, sql: 0 });
  const malas = resumen.filter((r) => !r.estado.startsWith('OK'));
  lineas.push('-'.repeat(anchoT + 36));
  lineas.push(`${'TOTAL'.padEnd(anchoT)} ${fmt(tot.lite).padStart(9)} ${fmt(tot.sql).padStart(11)}`);
  lineas.push('');
  lineas.push(malas.length
    ? `ATENCIÓN: ${malas.length} tabla(s) sin cargar o con diferencias. El detalle está en el reporte.`
    : (nFks > 0
      ? 'Todas las tablas quedaron con el mismo número de filas y las relaciones están activas. Base de ensayo lista.'
      : 'Todas las tablas quedaron con el mismo número de filas. Siguiente paso: ejecutar 02_relaciones.sql.'));
  lineas.forEach((l) => console.log(l));
  lineasReporte.unshift(...lineas, '', 'DETALLE', '=======');
  fs.writeFileSync(REPORTE, lineasReporte.join('\n'), 'utf8');
  console.log(`\nReporte: ${path.relative(RAIZ, REPORTE)}\n`);

  await lite.close();
  await pool.close();
  process.exitCode = malas.length ? 2 : 0;
}

function idFila(fila) {
  for (const k of ['id', 'id_lote', 'id_muestreo', 'id_revision', 'nombre', 'producto', 'tipo', 'telefono']) {
    if (fila[k] !== undefined && fila[k] !== null) return `${k}=${fila[k]}`;
  }
  return 'sin id';
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\n✗ La migración se detuvo:\n  ' + e.message + '\n');
    try { fs.writeFileSync(REPORTE, [...lineasReporte, '', 'DETENIDA: ' + e.message].join('\n'), 'utf8'); } catch (_) { /* nada */ }
    process.exit(1);
  });
}

// Para pruebas
module.exports = { leerFecha, convertir };
