// ======================== ADAPTADOR SQL SERVER ========================
//
// Migración SQLite -> SQL Server, módulo M00.
//
// Este archivo hace que SQL Server "se vea" igual que la conexión SQLite que
// la app usa desde siempre: el mismo objeto con db.get / db.all / db.run /
// db.exec, con los mismos parámetros "?" y los mismos resultados
// ({ lastID, changes } en db.run). Así, las rutas y los archivos de data/ no
// necesitan saber con qué motor están hablando.
//
// Lo que se traduce aquí, en un solo lugar (para no repetirlo en cada módulo):
//   - Parámetros "?"            -> @p0, @p1, ... (sin tocar los "?" dentro de textos)
//   - datetime('now','localtime') / date('now', ...) -> SYSDATETIME() / DATEADD(...)
//   - IFNULL(                    -> ISNULL(
//   - LIMIT n [OFFSET m] al final -> TOP (n)  u  OFFSET m ROWS FETCH NEXT n ROWS ONLY
//   - INSERT OR IGNORE           -> INSERT normal; si choca con una llave única no hace nada
//   - BEGIN / COMMIT / ROLLBACK  -> una transacción real de SQL Server
//   - Fechas: la app sigue recibiendo TEXTO "AAAA-MM-DD HH:MM:SS" (o "AAAA-MM-DD"
//     para columnas de solo fecha), igual que con SQLite. Y lo que la app manda
//     (por ejemplo new Date().toISOString(), que viene en hora UTC con "Z") se
//     guarda en hora de Colombia.
//
// Lo que NO se traduce aquí (porque depende de cada consulta) se ajusta módulo
// por módulo: "||" para unir textos, GROUP_CONCAT, strftime, substr sobre
// fechas, INSERT OR REPLACE, ON CONFLICT, PRAGMA. Cuando una consulta trae
// algo de eso, se avisa en la consola con "[SQL Server] Revisar consulta" para
// ubicarla fácil durante las pruebas de cada módulo.

const sql = require('mssql');
const { AsyncLocalStorage } = require('async_hooks');

// ------------------------------------------------------------- configuración
function configuracionDesdeEnv() {
  const faltan = ['MSSQL_SERVER', 'MSSQL_DATABASE', 'MSSQL_APP_USER', 'MSSQL_APP_PASSWORD']
    .filter((k) => !process.env[k]);
  if (faltan.length) {
    throw new Error(`MOTOR_BD=sqlserver pero faltan en el .env: ${faltan.join(', ')}`);
  }
  return {
    server: process.env.MSSQL_SERVER,
    port: Number(process.env.MSSQL_PORT || 1433),
    database: process.env.MSSQL_DATABASE,
    user: process.env.MSSQL_APP_USER,
    password: process.env.MSSQL_APP_PASSWORD,
    options: {
      encrypt: true,
      trustServerCertificate: String(process.env.MSSQL_TRUST_CERT).toLowerCase() === 'true',
      // Las fechas se manejan como "hora de pared" de Colombia (ver más abajo).
      useUTC: true,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 60000,
  };
}

// --------------------------------------------------------------------- fechas
const dos = (n) => String(n).padStart(2, '0');

// Date (convención "hora de pared": sus componentes UTC son la hora de Colombia) -> texto
function fechaATexto(d, soloFecha) {
  const base = `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`;
  return soloFecha ? base : `${base} ${dos(d.getUTCHours())}:${dos(d.getUTCMinutes())}:${dos(d.getUTCSeconds())}`;
}

// Un instante real (Date de JavaScript) -> texto en hora local del servidor (Colombia)
function instanteATextoLocal(d) {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

const RE_ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const RE_DIA_MES_ANO = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

// Ajusta un parámetro antes de mandarlo a SQL Server
function prepararValor(v) {
  if (v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return isNaN(v) ? null : instanteATextoLocal(v);
  if (typeof v === 'string') {
    // new Date().toISOString() -> "2026-10-19T14:13:52.123Z" (UTC): se guarda en hora de Colombia
    if (RE_ISO_CON_ZONA.test(v)) {
      const d = new Date(v);
      if (!isNaN(d)) return instanteATextoLocal(d);
    }
    // "31/07/2026" (día/mes/año): SQL Server lo leería como mes/día, se pasa a "2026-07-31"
    const m = v.match(RE_DIA_MES_ANO);
    if (m) return `${m[3]}-${dos(m[2])}-${dos(m[1])}`;
  }
  return v;
}

function tipoParametro(v) {
  if (v === null) return sql.NVarChar(sql.MAX);
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) < 2147483648) return sql.Int;
    if (Number.isInteger(v)) return sql.BigInt;
    return sql.Float;
  }
  if (Buffer.isBuffer(v)) return sql.VarBinary(sql.MAX);
  const s = String(v);
  return s.length <= 4000 ? sql.NVarChar(4000) : sql.NVarChar(sql.MAX);
}

// Convierte las filas que devuelve SQL Server al formato que la app espera
function normalizarFilas(recordset) {
  if (!recordset || !recordset.length) return recordset ? [...recordset] : [];
  const columnas = recordset.columns || {};
  const soloFecha = new Set(
    Object.entries(columnas).filter(([, c]) => c.type === sql.Date).map(([n]) => n)
  );
  return recordset.map((fila) => {
    const nueva = {};
    for (const k of Object.keys(fila)) {
      let v = fila[k];
      // Si la consulta repite un nombre de columna (ej. "u.*, r.id as rol_id"),
      // SQL Server entrega un arreglo con los dos valores; SQLite se queda con
      // el último. Se hace igual para que la app reciba un solo valor.
      if (Array.isArray(v)) v = v[v.length - 1];
      if (v instanceof Date) nueva[k] = fechaATexto(v, soloFecha.has(k));
      else if (typeof v === 'bigint') nueva[k] = Number(v);
      else nueva[k] = v;
    }
    return nueva;
  });
}

// -------------------------------------------------------------- traducción SQL
// Separa el texto en partes "código" y partes "texto entre comillas simples",
// para que las traducciones nunca toquen el contenido de un texto.
function partir(sqlTexto) {
  const partes = [];
  let i = 0, inicio = 0;
  while (i < sqlTexto.length) {
    if (sqlTexto[i] === "'") {
      if (i > inicio) partes.push({ codigo: true, t: sqlTexto.slice(inicio, i) });
      let j = i + 1;
      while (j < sqlTexto.length) {
        if (sqlTexto[j] === "'" && sqlTexto[j + 1] === "'") { j += 2; continue; }
        if (sqlTexto[j] === "'") break;
        j++;
      }
      partes.push({ codigo: false, t: sqlTexto.slice(i, j + 1) });
      i = j + 1; inicio = i;
    } else i++;
  }
  if (inicio < sqlTexto.length) partes.push({ codigo: true, t: sqlTexto.slice(inicio) });
  return partes;
}

// Parte una lista "a, b(c, d), 'e,f'" por las comas de primer nivel
// (sin cortar dentro de paréntesis ni de textos entre comillas).
function partirPorComas(texto) {
  const piezas = [];
  let nivel = 0, actual = '';
  for (const p of partir(texto)) {
    if (!p.codigo) { actual += p.t; continue; }
    for (const c of p.t) {
      if (c === '(') nivel++;
      if (c === ')') nivel--;
      if (c === ',' && nivel === 0) { piezas.push(actual.trim()); actual = ''; continue; }
      actual += c;
    }
  }
  if (actual.trim()) piezas.push(actual.trim());
  return piezas;
}

// "INSERT ... ON CONFLICT(col) DO UPDATE SET ... / DO NOTHING" (upsert de
// SQLite) -> MERGE de SQL Server. Los valores nuevos quedan con el mismo
// nombre "excluded", así el SET de la consulta original sirve tal cual.
// WITH (HOLDLOCK) evita que dos personas guardando a la vez creen la fila
// dos veces.
const RE_UPSERT = /^\s*INSERT\s+INTO\s+([\w.\[\]]+)\s*\(([^)]*)\)\s*VALUES\s*\(([\s\S]*)\)\s*ON\s+CONFLICT\s*\(([^)]*)\)\s*DO\s+(NOTHING|UPDATE\s+SET\s+([\s\S]*?))\s*(;\s*SELECT\s+CAST\(SCOPE_IDENTITY\(\)\s+AS\s+INT\)\s+AS\s+__lastID)?\s*;?\s*$/i;
function convertirUpsert(s) {
  const m = s.match(RE_UPSERT);
  if (!m) return s;
  const [, tabla, colsTxt, valsTxt, llavesTxt, accion, setTxt, sufijo] = m;
  const cols = colsTxt.split(',').map((c) => c.trim());
  const vals = partirPorComas(valsTxt);
  if (cols.length !== vals.length) return s; // no se reconoce: queda el aviso para revisarla a mano
  const llaves = llavesTxt.split(',').map((c) => c.trim());
  let set = setTxt, condicion = '';
  if (set) {
    const mWhere = set.match(/\s+WHERE\s+([\s\S]+)$/i);
    if (mWhere) { condicion = ` AND (${mWhere[1]})`; set = set.slice(0, mWhere.index); }
  }
  return `MERGE INTO ${tabla} WITH (HOLDLOCK)
USING (SELECT ${cols.map((c, i) => `${vals[i]} AS ${c}`).join(', ')}) AS excluded
ON (${llaves.map((k) => `${tabla}.${k} = excluded.${k}`).join(' AND ')})
${/^NOTHING$/i.test(accion) ? '' : `WHEN MATCHED${condicion} THEN UPDATE SET ${set}\n`}WHEN NOT MATCHED THEN INSERT (${cols.join(', ')}) VALUES (${cols.map((c) => `excluded.${c}`).join(', ')});${sufijo ? sufijo.replace(/^;/, '') : ''}`;
}

const RE_SQLITE_PENDIENTE = [
  [/\|\|/, '"||" para unir textos (usar CONCAT)'],
  [/\bGROUP_CONCAT\s*\(/i, 'GROUP_CONCAT (usar STRING_AGG)'],
  [/\bstrftime\s*\(/i, 'strftime'],
  [/\bjulianday\s*\(/i, 'julianday'],
  [/\bdate(time)?\s*\(/i, 'date()/datetime() de SQLite'],
  [/\bsubstr\s*\(/i, 'substr (revisar si es sobre una fecha)'],
  [/\bINSERT\s+OR\s+REPLACE\b/i, 'INSERT OR REPLACE'],
  [/\bON\s+CONFLICT\b/i, 'ON CONFLICT'],
  [/\bPRAGMA\b/i, 'PRAGMA'],
  [/\bCOLLATE\s+NOCASE\b/i, 'COLLATE NOCASE'],
  [/\browid\b/i, 'rowid'],
  [/\blast_insert_rowid\s*\(/i, 'last_insert_rowid()'],
  [/\bLIMIT\b/i, 'LIMIT en una subconsulta'],
];
const yaAvisadas = new Set();

function traducir(sqlOriginal) {
  let s = String(sqlOriginal);

  // Funciones de fecha de SQLite con textos fijos (se hacen antes de partir, porque llevan comillas)
  s = s.replace(/\bdatetime\s*\(\s*'now'\s*,\s*'localtime'\s*\)/gi, 'SYSDATETIME()');
  s = s.replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, 'SYSDATETIME()');
  s = s.replace(/\bdate\s*\(\s*'now'\s*,\s*'localtime'\s*\)/gi, 'CAST(SYSDATETIME() AS DATE)');
  s = s.replace(/\bdate\s*\(\s*'now'\s*\)/gi, 'CAST(SYSDATETIME() AS DATE)');
  s = s.replace(/\bdate\s*\(\s*'now'\s*,\s*'([+-]?\d+)\s+(day|days|month|months|year|years)'\s*\)/gi,
    (_, n, u) => `CAST(DATEADD(${u.toLowerCase().startsWith('day') ? 'day' : u.toLowerCase().startsWith('month') ? 'month' : 'year'}, ${parseInt(n, 10)}, SYSDATETIME()) AS DATE)`);
  s = s.replace(/\bdatetime\s*\(\s*'now'\s*,\s*'localtime'\s*,\s*'([+-]?\d+)\s+(day|days|hour|hours|minute|minutes)'\s*\)/gi,
    (_, n, u) => `DATEADD(${u.toLowerCase().replace(/s$/, '')}, ${parseInt(n, 10)}, SYSDATETIME())`);

  // INSERT OR IGNORE: se ejecuta como INSERT normal (el choque se maneja en ejecutar)
  let ignorarDuplicados = false;
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(s)) {
    s = s.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
    ignorarDuplicados = true;
  }

  // Parámetros e IFNULL, solo fuera de los textos
  let n = 0;
  s = partir(s).map((p) => {
    if (!p.codigo) return p.t;
    return p.t.replace(/\?/g, () => `@p${n++}`).replace(/\bIFNULL\s*\(/gi, 'ISNULL(');
  }).join('');

  // Upsert de SQLite (ON CONFLICT) -> MERGE
  s = convertirUpsert(s);

  // LIMIT n [OFFSET m] al final de la consulta
  const mLimit = s.match(/\s+LIMIT\s+(\d+|@p\d+)(?:\s+OFFSET\s+(\d+|@p\d+))?\s*;?\s*$/i);
  if (mLimit) {
    const cuantos = mLimit[1], desde = mLimit[2];
    s = s.slice(0, mLimit.index);
    const codigoSinTextos = partir(s).filter((p) => p.codigo).map((p) => p.t).join(' ');
    if (desde || /\bORDER\s+BY\b/i.test(codigoSinTextos)) {
      if (!/\bORDER\s+BY\b/i.test(codigoSinTextos)) s += ' ORDER BY (SELECT NULL)';
      s += ` OFFSET ${desde || 0} ROWS FETCH NEXT ${cuantos} ROWS ONLY`;
    } else {
      s = s.replace(/^\s*SELECT\s+(DISTINCT\s+)?/i, (m0, d) => `SELECT ${d || ''}TOP (${cuantos}) `);
    }
  }

  // Avisar (una sola vez por consulta) si quedó algo de SQLite sin traducir
  const codigo = partir(s).filter((p) => p.codigo).map((p) => p.t).join(' ');
  const pendientes = RE_SQLITE_PENDIENTE.filter(([re]) => re.test(codigo)).map(([, nombre]) => nombre);
  if (pendientes.length) {
    const clave = String(sqlOriginal).replace(/\s+/g, ' ').trim();
    if (!yaAvisadas.has(clave)) {
      yaAvisadas.add(clave);
      console.warn(`⚠️ [SQL Server] Revisar consulta (${pendientes.join(', ')}): ${clave.slice(0, 300)}`);
    }
  }

  return { sql: s, cantidadParametros: n, ignorarDuplicados };
}

function aplanarParametros(params) {
  if (params === undefined || params === null) return [];
  if (Array.isArray(params)) return params;
  if (typeof params === 'object' && !(params instanceof Date) && !Buffer.isBuffer(params)) {
    throw new Error('El adaptador SQL Server solo acepta parámetros "?" (lista), no parámetros con nombre.');
  }
  return [params];
}

const numeroError = (e) => e && (e.number ?? e.originalError?.number ?? e.originalError?.info?.number);
const ES_DUPLICADO = (e) => [2627, 2601].includes(numeroError(e));

// ------------------------------------------------------------------ adaptador
async function crearAdaptador() {
  const pool = await new sql.ConnectionPool(configuracionDesdeEnv()).connect();

  // Transacciones (M01). Igual que con SQLite (BEGIN IMMEDIATE) se abre una
  // sola transacción a la vez; las demás esperan su turno.
  //  - enTransaccion() (db/connection.js) usa db.transaccion(fn): la
  //    transacción queda amarrada SOLO a las consultas de esa operación
  //    (AsyncLocalStorage), así las consultas de otras personas que llegan al
  //    mismo tiempo siguen por fuera y no se deshacen si esa operación falla.
  //  - db.exec('BEGIN') / COMMIT / ROLLBACK directos (scripts) siguen
  //    funcionando con una transacción general, como en M00.
  const contexto = new AsyncLocalStorage();
  let tx = null;                          // transacción general abierta con exec('BEGIN')
  let ocupado = false;                    // hay una transacción abierta (de cualquier tipo)
  const esperandoTx = [];                 // quienes esperan para abrir su propia transacción

  async function tomarTurno() {
    while (ocupado) await new Promise((r) => esperandoTx.push(r));
    ocupado = true;
  }
  function soltarTurno() {
    ocupado = false;
    const siguiente = esperandoTx.shift();
    if (siguiente) siguiente();
  }

  async function ejecutar(sqlTexto, params) {
    const { sql: consulta, ignorarDuplicados } = traducir(sqlTexto);
    const valores = aplanarParametros(params).map(prepararValor);
    const T = contexto.getStore() || tx;  // transacción a la que pertenece esta consulta (si hay)
    const correr = async () => {
      const req = T ? new sql.Request(T.t) : pool.request();
      valores.forEach((v, i) => {
        const tipo = tipoParametro(v);
        // Lo que no es número, null ni Buffer viaja como texto: se convierte a
        // String para que el driver no lo rechace ("Invalid string").
        if (v !== null && typeof v === 'object' && !Buffer.isBuffer(v)) {
          console.warn(`⚠️ [SQL Server] Parámetro p${i} llegó como objeto/arreglo (${JSON.stringify(v).slice(0, 80)}). Consulta: ${consulta.replace(/\s+/g, ' ').slice(0, 200)}`);
        }
        const valor = (v === null || typeof v === 'number' || Buffer.isBuffer(v)) ? v : String(v);
        req.input(`p${i}`, tipo, valor);
      });
      return req.query(consulta);
    };
    try {
      if (T) {
        // dentro de una transacción las consultas van una por una
        const p = T.cola.then(correr);
        T.cola = p.catch(() => {});
        return await p;
      }
      return await correr();
    } catch (e) {
      if (ignorarDuplicados && ES_DUPLICADO(e)) return { recordset: [], recordsets: [], rowsAffected: [0], ignorado: true };
      // Las rutas reconocen "ya existe" buscando la palabra UNIQUE en el
      // mensaje (así lo decía SQLite); SQL Server lo dice distinto y en el
      // idioma del servidor, por eso se agrega la misma marca.
      if (ES_DUPLICADO(e) && !/UNIQUE/.test(e.message)) e.message = `UNIQUE constraint failed: ${e.message}`;
      e.message = `${e.message}\n   Consulta: ${consulta.replace(/\s+/g, ' ').slice(0, 400)}`;
      throw e;
    }
  }

  async function iniciarTransaccion() {
    if (contexto.getStore()) throw new Error('Ya hay una transacción abierta en esta operación (BEGIN dentro de enTransaccion).');
    await tomarTurno();
    const t = new sql.Transaction(pool);
    try { await t.begin(); } catch (e) { soltarTurno(); throw e; }
    tx = { t, cola: Promise.resolve() };
  }
  async function terminarTransaccion(confirmar) {
    if (!tx) return; // igual que antes: un COMMIT/ROLLBACK sin transacción no rompe nada
    const T = tx;
    try {
      await T.cola;
      if (confirmar) await T.t.commit(); else await T.t.rollback();
    } finally {
      tx = null;
      soltarTurno();
    }
  }

  const db = {
    motor: 'sqlserver',
    pool,

    async all(sqlTexto, params) {
      const r = await ejecutar(sqlTexto, params);
      return normalizarFilas(r.recordset);
    },

    async get(sqlTexto, params) {
      const r = await ejecutar(sqlTexto, params);
      return normalizarFilas(r.recordset)[0];
    },

    async run(sqlTexto, params) {
      const esInsert = /^\s*INSERT\b/i.test(String(sqlTexto).replace(/^\s*INSERT\s+OR\s+IGNORE/i, 'INSERT'));
      const texto = esInsert ? `${sqlTexto};\nSELECT CAST(SCOPE_IDENTITY() AS INT) AS __lastID` : sqlTexto;
      const r = await ejecutar(texto, params);
      if (r.ignorado) return { lastID: undefined, changes: 0 };
      const changes = esInsert ? ((r.rowsAffected || [])[0] || 0) : (r.rowsAffected || []).reduce((a, b) => a + b, 0);
      let lastID;
      if (esInsert && r.recordset && r.recordset[0]) lastID = r.recordset[0].__lastID ?? undefined;
      return { lastID, changes };
    },

    // Usado por enTransaccion() de db/connection.js. Si fn falla, se deshace
    // todo y el error sigue su camino igual que antes.
    async transaccion(fn) {
      if (contexto.getStore()) return fn(db); // ya estamos dentro de una: se une a ella
      await tomarTurno();
      const T = { t: new sql.Transaction(pool), cola: Promise.resolve() };
      try { await T.t.begin(); } catch (e) { soltarTurno(); throw e; }
      try {
        const resultado = await contexto.run(T, () => fn(db));
        await T.cola;
        await T.t.commit();
        return resultado;
      } catch (error) {
        try { await T.cola; await T.t.rollback(); } catch (e) { /* SQL Server pudo haberla cancelado ya */ }
        throw error;
      } finally {
        soltarTurno();
      }
    },

    async exec(sqlTexto) {
      const s = String(sqlTexto).trim().replace(/;\s*$/, '');
      if (/^BEGIN(\s+(IMMEDIATE|DEFERRED|EXCLUSIVE|TRANSACTION))?$/i.test(s)) return iniciarTransaccion();
      if (/^(COMMIT|END)(\s+TRANSACTION)?$/i.test(s)) return terminarTransaccion(true);
      if (/^ROLLBACK(\s+TRANSACTION)?$/i.test(s)) return terminarTransaccion(false);
      if (/^PRAGMA\b/i.test(s)) return; // configuraciones propias de SQLite: no aplican
      await ejecutar(sqlTexto, []);
    },

    async close() {
      await pool.close();
    },
  };
  return db;
}

module.exports = { crearAdaptador, traducir, prepararValor, fechaATexto };
