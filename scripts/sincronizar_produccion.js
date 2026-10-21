// ============ SINCRONIZACIÓN: Calidad.xlsx / Lotes.xlsx / Produccion.xlsx → base de datos ============
// Este script hace dos cosas, en orden:
//   1) Refresca los tres archivos (dispara "Actualizar todo" de Excel, que a
//      su vez corre las consultas de Power Query hacia los .xlsm de la NAS)
//      usando scripts/refrescar_excel.ps1.
//   2) Si el refresco de un archivo salió bien, lee ese archivo ya actualizado
//      y sincroniza su contenido hacia las tablas rechazos_produccion / lotes
//      / entregas_produccion en db/base_datos.db (creadas en db/init.js,
//      MIGRACIÓN #20 y #22), de forma incremental (no vuelve a insertar lo
//      que ya estaba).
//
// Produccion.xlsx es un archivo nuevo que Julio agregó el 01/09 (y Lotes.xlsx
// lo simplificó ese mismo día a solo una tabla de consulta) — ver el
// comentario largo en db/init.js (MIGRACIÓN #22) sobre por qué el modelo de
// datos cambió y qué significa cada tabla ahora.
//
// Enganchado a app_circuitos.js: corre una vez al arrancar el servidor y
// luego cada 6 horas (mismo patrón que ejecutarLimpiezaObsoletas /
// ejecutarCierreLotesInactivosIso). También se puede correr a mano en
// cualquier momento, aparte del servidor:
//   node scripts/sincronizar_produccion.js
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

let ExcelJS;
try {
  ExcelJS = require('exceljs');
} catch (e) {
  console.error('❌ Falta la dependencia "exceljs". Cuando se libere package.json, correr: npm install exceljs');
  process.exit(1);
}

const { inicializarBaseDatos } = require('../db/init');
const { getDb } = require('../db/connection');
const whatsappAlertas = require('../data/whatsappAlertas');
const { enviarAlerta } = require('../whatsapp_bot_service');

// Configurables por variable de entorno (para no tener que tocar
// settings/paths.js todavía); si no están definidas, usan la ruta real donde
// viven hoy los tres archivos.
const RUTA_CALIDAD = process.env.CALIDAD_XLSX_PATH
  || 'C:\\Users\\produ\\OneDrive\\Escritorio\\Documentos\\Calidad.xlsx';
const RUTA_LOTES = process.env.LOTES_XLSX_PATH
  || 'C:\\Users\\produ\\OneDrive\\Escritorio\\Documentos\\Lotes.xlsx';
const RUTA_PRODUCCION = process.env.PRODUCCION_XLSX_PATH
  || 'C:\\Users\\produ\\OneDrive\\Escritorio\\Documentos\\Produccion.xlsx';
const RUTA_SCRIPT_REFRESCO = path.join(__dirname, 'refrescar_excel.ps1');

// ======================== PASO 1: REFRESCAR LOS ARCHIVOS EN EXCEL ========================
// Devuelve un mapa { rutaArchivo: true|false } según si ese archivo en
// particular quedó bien refrescado. Un archivo que falla no le impide a los
// otros seguir su curso (ver scripts/refrescar_excel.ps1: reporta uno por
// uno, no aborta todo por el primero que falle).
function refrescarExcel(rutas) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      // Solo puede pasar corriendo esto fuera de Windows (ej. probando la
      // lógica de lectura/sincronización sin tocar Excel de verdad).
      console.warn('⚠️  No es Windows: se omite el refresco de Excel y se sincroniza con los archivos tal como están.');
      const resultado = {};
      rutas.forEach(r => { resultado[r] = true; });
      return resolve(resultado);
    }

    // Tres parámetros de un solo valor cada uno (-ArchivoCalidad /
    // -ArchivoLotes / -ArchivoProduccion), no un arreglo -- ver el
    // comentario en refrescar_excel.ps1 sobre por qué un parámetro
    // [string[]] no funcionaba de forma confiable invocado así.
    execFile('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', RUTA_SCRIPT_REFRESCO,
      '-ArchivoCalidad', rutas[0], '-ArchivoLotes', rutas[1], '-ArchivoProduccion', rutas[2]
    ], { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      const resultado = {};
      rutas.forEach(r => { resultado[r] = false; });

      (stdout || '').split(/\r?\n/).forEach(linea => {
        const okMatch = linea.match(/^OK: (.+)$/);
        const errMatch = linea.match(/^ERROR: (.+?) -> (.+)$/);
        if (okMatch) {
          resultado[okMatch[1].trim()] = true;
          console.log(`  ✅ Refrescado: ${okMatch[1].trim()}`);
        } else if (errMatch) {
          console.error(`  ⚠️  No se pudo refrescar ${errMatch[1].trim()}: ${errMatch[2].trim()}`);
        }
      });

      if (error) {
        console.error('⚠️  El script de refresco de Excel terminó con error:', error.message);
        if (stderr) console.error(stderr);
      }
      resolve(resultado);
    });
  });
}

// ======================== PASO 2: LEER LOS ARCHIVOS YA REFRESCADOS ========================
function normalizarFabrica(valor) {
  // Unifica "Fabrica1" / "Fabrica 2" (la inconsistencia viene de la propia
  // consulta de Power Query, no de un error de captura) en un mismo formato:
  // "Fabrica 1", "Fabrica 2", etc.
  const limpio = String(valor || '').trim();
  const numero = limpio.match(/(\d+)/);
  if (!numero) return limpio;
  return `Fabrica ${numero[1]}`;
}

// Encontrado 08/09 al mapear qué tablas cruzan entre sí y cuáles no: 149
// filas de rechazos_produccion/entregas_produccion no encontraban su lote
// real en `lotes` solo porque en Cableado.xlsx algunas quedan tipiadas en
// minúscula (ej. "c1048000914") mientras que en Lotes.xlsx el mismo lote
// está en mayúscula ("C1048000914") -- SQLite compara texto distinguiendo
// mayúscula de minúscula, así que nunca cruzaban. Normalizar aquí, en el
// punto donde se lee cada Excel, evita que el problema vuelva a aparecer
// en cada sincronización (a diferencia de corregir solo lo que ya estaba
// guardado, que la siguiente sincronización habría vuelto a desordenar).
function normalizarLote(valor) {
  if (valor === null || valor === undefined) return valor;
  const limpio = String(valor).trim();
  return limpio ? limpio.toUpperCase() : limpio;
}

function formatearFecha(valor) {
  if (!valor) return null;
  if (valor instanceof Date) {
    const pad = n => String(n).padStart(2, '0');
    const tieneHora = valor.getHours() || valor.getMinutes() || valor.getSeconds();
    const fecha = `${valor.getFullYear()}-${pad(valor.getMonth() + 1)}-${pad(valor.getDate())}`;
    return tieneHora ? `${fecha} ${pad(valor.getHours())}:${pad(valor.getMinutes())}:${pad(valor.getSeconds())}` : fecha;
  }
  return String(valor);
}

// Solo hace falta para las pocas filas de entregas_produccion sin
// Id_Entrega (dato faltante en el origen) — el resto usa la llave natural
// (fabrica + id_entrega) y no necesita hash.
function hashFila(valores) {
  return crypto.createHash('sha256')
    .update(valores.map(v => (v === null || v === undefined) ? '' : String(v)).join('|'))
    .digest('hex');
}

async function leerHoja(archivo, nombreHoja, columnas) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(archivo);
  const ws = wb.getWorksheet(nombreHoja);
  if (!ws) throw new Error(`No se encontró la hoja "${nombreHoja}" en ${archivo}`);
  const filas = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (row.cellCount === 0) continue;
    const obj = {};
    columnas.forEach((col, i) => {
      const cell = row.getCell(i + 1);
      obj[col] = (cell.value && cell.value.result !== undefined) ? cell.value.result : cell.value;
    });
    if (Object.values(obj).every(v => v === null || v === undefined)) continue; // fila vacía al final de la hoja
    filas.push(obj);
  }
  return filas;
}

// ======================== PASO 3: SINCRONIZAR ========================
// Rechazos sí tiene una llave natural confiable dentro de cada fábrica
// (fabrica + Id_Rechazo, verificado sin duplicados), así que se hace un
// upsert real: entra lo nuevo, y si un rechazo ya sincronizado cambió en el
// Excel (ej. se corrige el motivo), se actualiza en vez de duplicarse.
async function sincronizarRechazos(db, filas) {
  let nuevos = 0, actualizados = 0, sinCambios = 0;
  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const f of filas) {
      const fabrica = normalizarFabrica(f.Area);
      const existente = await db.get(
        'SELECT id FROM rechazos_produccion WHERE fabrica = ? AND id_rechazo_origen = ?',
        [fabrica, f.Id_Rechazo]
      );
      const resultado = await db.run(`
        INSERT INTO rechazos_produccion
          (fabrica, id_rechazo_origen, fecha_rechazo, linea_org, proceso_org, linea_rep, proceso_rep, lote_produccion, lote, referencia, cantidad, motivo, observaciones)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(fabrica, id_rechazo_origen) DO UPDATE SET
          fecha_rechazo=excluded.fecha_rechazo, linea_org=excluded.linea_org, proceso_org=excluded.proceso_org,
          linea_rep=excluded.linea_rep, proceso_rep=excluded.proceso_rep, lote_produccion=excluded.lote_produccion,
          lote=excluded.lote, referencia=excluded.referencia, cantidad=excluded.cantidad, motivo=excluded.motivo,
          observaciones=excluded.observaciones
        WHERE excluded.fecha_rechazo IS NOT rechazos_produccion.fecha_rechazo
           OR excluded.linea_org IS NOT rechazos_produccion.linea_org
           OR excluded.proceso_org IS NOT rechazos_produccion.proceso_org
           OR excluded.linea_rep IS NOT rechazos_produccion.linea_rep
           OR excluded.proceso_rep IS NOT rechazos_produccion.proceso_rep
           OR excluded.lote_produccion IS NOT rechazos_produccion.lote_produccion
           OR excluded.lote IS NOT rechazos_produccion.lote
           OR excluded.referencia IS NOT rechazos_produccion.referencia
           OR excluded.cantidad IS NOT rechazos_produccion.cantidad
           OR excluded.motivo IS NOT rechazos_produccion.motivo
           OR excluded.observaciones IS NOT rechazos_produccion.observaciones
      `, [
        fabrica, f.Id_Rechazo, formatearFecha(f.Fecha_Rechazo), f.LineaOrg_Rechazo, f.ProcesoOrg_Rechazo,
        f.LineaRep_Rechazo, f.ProcesoRep_Rechazo, normalizarLote(f.LoteProduccion_Rechazo), f.Lote_Rechazo, f.Referencia_Rechazo,
        f.Cantidad_Rechazo, f.Motivo_Rechazo, f.Observaciones
      ]);
      if (!existente) nuevos++;
      else if (resultado.changes > 0) actualizados++;
      else sinCambios++;
    }
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
  return { nuevos, actualizados, sinCambios, total: filas.length };
}

// lotes: desde el 01/09 es una tabla de solo consulta (No_Lote ->
// Referencia/Color/Voltaje/Código), y No_Lote SÍ es único de verdad entre
// las filas que sí lo traen (verificado contra los datos reales: 56361
// filas, 56361 no_lote distintos en la primera versión) — así que es un
// upsert directo por no_lote, ya no hace falta el hash de fila completa que
// se usaba antes.
//
// Agregado 01/09 al sumar Fábrica 3, Cableado e Inyección: Lotes.xlsx creció
// a 114.834 filas y aparecieron 30 con No_Lote vacío o en blanco (todas de
// registros tipo "Servicio Externo" / referencias sin lote real de
// Inyección — coincide con las mismas filas sin Lote_Entrega que aparecen
// en Produccion.xlsx). Como no_lote es NOT NULL UNIQUE, esas 30 filas no se
// pueden guardar como "lotes" de verdad (no identifican ningún lote), así
// que se descartan aquí en vez de dejar que revienten toda la transacción
// (antes de este cambio, UNA sola fila así hacía fallar el INSERT a mitad
// de las 114 mil filas, con ROLLBACK completo — ningún lote quedaba
// sincronizado ese ciclo).
async function sincronizarLotes(db, filas) {
  let nuevos = 0, actualizados = 0, sinCambios = 0, sinNoLote = 0;
  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const f of filas) {
      const noLote = normalizarLote(f.No_Lote) || '';
      if (!noLote) { sinNoLote++; continue; }
      const existente = await db.get('SELECT id FROM lotes WHERE no_lote = ?', [noLote]);
      const resultado = await db.run(`
        INSERT INTO lotes (no_lote, referencia, color, voltaje, codigo)
        VALUES (?,?,?,?,?)
        ON CONFLICT(no_lote) DO UPDATE SET
          referencia=excluded.referencia, color=excluded.color, voltaje=excluded.voltaje, codigo=excluded.codigo
        WHERE excluded.referencia IS NOT lotes.referencia
           OR excluded.color IS NOT lotes.color
           OR excluded.voltaje IS NOT lotes.voltaje
           OR excluded.codigo IS NOT lotes.codigo
      `, [noLote, f.Referencia_Lote, f.Color_Lote, f.Voltaje_Lote, f.Codigo_Lote]);
      if (!existente) nuevos++;
      else if (resultado.changes > 0) actualizados++;
      else sinCambios++;
    }
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
  return { nuevos, actualizados, sinCambios, sinNoLote, total: filas.length };
}

// entregas_produccion: Id_Entrega es una llave natural POR FÁBRICA (cada
// fábrica numera sus propias entregas desde 1 — verificado 01/09: el mismo
// número se repite entre Fabrica1 y Fabrica2, pero nunca dentro de la misma
// fábrica), así que el upsert real usa (fabrica, id_entrega) — igual que
// rechazos_produccion con (fabrica, id_rechazo_origen). Las pocas filas sin
// Id_Entrega (dato faltante en el origen) se identifican por el hash de su
// contenido completo en vez de romper el cruce.
async function sincronizarEntregas(db, filas) {
  let nuevas = 0, actualizadas = 0, sinCambios = 0, sinIdEntrega = 0;
  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const f of filas) {
      const fabrica = normalizarFabrica(f.Area);
      const fecha = formatearFecha(f.Fecha_Entrega);

      if (f.Id_Entrega === null || f.Id_Entrega === undefined) {
        sinIdEntrega++;
        // El hash se calcula sobre f.Lote_Entrega tal cual viene del Excel
        // (sin normalizar) para no cambiarle el hash a filas que ya estaban
        // sincronizadas de ciclos anteriores -- si cambiara, INSERT OR
        // IGNORE ya no reconocería la fila como la misma y la duplicaría.
        // Lo que sí se guarda normalizado es el valor visible de la columna.
        const hash = hashFila([fabrica, fecha, f.Linea_Entrega, f.Lote_Entrega, f.Referencia_Entrega, f.Operacion_Entrega, f.CantidadBuenas_Entrega]);
        const resultado = await db.run(`
          INSERT OR IGNORE INTO entregas_produccion
            (fabrica, id_entrega, fecha_entrega, linea_entrega, lote_entrega, referencia_entrega, operacion_entrega, cantidad_buenas, hash_fila)
          VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)
        `, [fabrica, fecha, f.Linea_Entrega, normalizarLote(f.Lote_Entrega), f.Referencia_Entrega, f.Operacion_Entrega, f.CantidadBuenas_Entrega, hash]);
        if (resultado.changes > 0) nuevas++; else sinCambios++;
        continue;
      }

      const existente = await db.get(
        'SELECT id FROM entregas_produccion WHERE fabrica = ? AND id_entrega = ?',
        [fabrica, f.Id_Entrega]
      );
      const resultado = await db.run(`
        INSERT INTO entregas_produccion
          (fabrica, id_entrega, fecha_entrega, linea_entrega, lote_entrega, referencia_entrega, operacion_entrega, cantidad_buenas)
        VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(fabrica, id_entrega) DO UPDATE SET
          fecha_entrega=excluded.fecha_entrega, linea_entrega=excluded.linea_entrega,
          lote_entrega=excluded.lote_entrega, referencia_entrega=excluded.referencia_entrega,
          operacion_entrega=excluded.operacion_entrega, cantidad_buenas=excluded.cantidad_buenas
        WHERE excluded.fecha_entrega IS NOT entregas_produccion.fecha_entrega
           OR excluded.linea_entrega IS NOT entregas_produccion.linea_entrega
           OR excluded.lote_entrega IS NOT entregas_produccion.lote_entrega
           OR excluded.referencia_entrega IS NOT entregas_produccion.referencia_entrega
           OR excluded.operacion_entrega IS NOT entregas_produccion.operacion_entrega
           OR excluded.cantidad_buenas IS NOT entregas_produccion.cantidad_buenas
      `, [fabrica, f.Id_Entrega, fecha, f.Linea_Entrega, normalizarLote(f.Lote_Entrega), f.Referencia_Entrega, f.Operacion_Entrega, f.CantidadBuenas_Entrega]);
      if (!existente) nuevas++;
      else if (resultado.changes > 0) actualizadas++;
      else sinCambios++;
    }
    await db.exec('COMMIT');
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
  return { nuevas, actualizadas, sinCambios, sinIdEntrega, total: filas.length };
}

// ======================== ESTADO DE SINCRONIZACIÓN (fallos consecutivos) ========================
// Funciones para leer y actualizar la tabla singleton sincronizacion_estado.

async function obtenerEstadoSincronizacion(db) {
  const fila = await db.get('SELECT * FROM sincronizacion_estado WHERE id = 1');
  if (!fila) {
    // Si por alguna razón no existe la fila, la creamos con valores por defecto
    await db.run('INSERT OR IGNORE INTO sincronizacion_estado (id, fallos_consecutivos, alerta_enviada) VALUES (1, 0, 0)');
    return { fallos_consecutivos: 0, alerta_enviada: 0, ultimo_ciclo_exitoso: null, ultima_actualizacion: null };
  }
  return fila;
}

async function actualizarEstadoSincronizacion(db, fallosConsecutivos, alertaEnviada, cicloExitoso = false) {
  const ahora = new Date().toISOString().replace('T', ' ').substring(0, 19);
  if (cicloExitoso) {
    await db.run(
      'UPDATE sincronizacion_estado SET fallos_consecutivos = 0, alerta_enviada = 0, ultimo_ciclo_exitoso = ?, ultima_actualizacion = ? WHERE id = 1',
      [ahora, ahora]
    );
  } else {
    await db.run(
      'UPDATE sincronizacion_estado SET fallos_consecutivos = ?, alerta_enviada = ?, ultima_actualizacion = ? WHERE id = 1',
      [fallosConsecutivos, alertaEnviada ? 1 : 0, ahora]
    );
  }
}

// Envía alerta de WhatsApp y devuelve true si al menos un envío fue confirmado (no lanzó excepción).
// NOTA: enviarAlerta() del bot actual NO devuelve estado de envío real (fire-and-forget).
// Esta función intenta detectar si el cliente WhatsApp está conectado antes de considerar "enviado".
async function enviarAlertaConConfirmacion(tipo, mensaje) {
  try {
    const { client } = require('../whatsapp_bot_service');
    if (!client) {
      console.warn(`⚠️  WhatsApp no inicializado: no se puede enviar alerta "${tipo}"`);
      return false;
    }
    // whatsapp-web.js expone client.info cuando está conectado; si es null/undefined, no hay sesión activa
    if (!client.info || !client.info.wid) {
      console.warn(`⚠️  WhatsApp desconectado (sin sesión activa): alerta "${tipo}" NO se envió`);
      return false;
    }
    await enviarAlerta(tipo, mensaje);
    // Si llegamos aquí sin excepción, asumimos que el envío fue solicitado correctamente.
    // LIMITACIÓN: no hay confirmación real de entrega (el bot no devuelve recibo).
    return true;
  } catch (e) {
    console.error(`❌ Error enviando alerta "${tipo}":`, e.message);
    return false;
  }
}

// Maneja la lógica de alertas según el resultado del ciclo.
// Devuelve { exito: boolean, alertaEnviada: boolean, recuperacion: boolean }
async function procesarResultadoCiclo(db, esAutomatico, huboFallo) {
  if (!esAutomatico) {
    // Ejecución manual: no afecta contador ni envía alertas
    console.log('ℹ️  Ejecución manual: no se actualiza contador de fallos consecutivos ni se envían alertas.');
    return { exito: !huboFallo, alertaEnviada: false, recuperacion: false };
  }

  const estado = await obtenerEstadoSincronizacion(db);
  let fallosConsecutivos = estado.fallos_consecutivos;
  let alertaEnviada = estado.alerta_enviada === 1;

  if (huboFallo) {
    // Ciclo fallido: incrementar contador
    fallosConsecutivos++;
    console.log(`⚠️  Ciclo fallido. Fallos consecutivos: ${fallosConsecutivos}`);

    if (fallosConsecutivos === 3 && !alertaEnviada) {
      // Tercer fallo consecutivo y no se ha enviado alerta aún
      const mensaje = `⚠️ ALERTA: Sincronización de producción fallida 3 ciclos consecutivos

Las últimas 3 sincronizaciones automáticas (cada 6 horas) han presentado fallos.

Los datos de Calidad/Lotes/Producción pueden estar desactualizados.

Revisar logs del servidor y estado de Excel/NAS.`;
      const enviado = await enviarAlertaConConfirmacion('sync_falla_consecutiva', mensaje);
      if (enviado) {
        alertaEnviada = true;
        console.log('🔔 Alerta de 3 fallos consecutivos enviada por WhatsApp.');
      } else {
        console.log('⚠️  No se pudo confirmar envío de alerta (WhatsApp desconectado). No se marca como enviada.');
      }
    } else if (fallosConsecutivos > 3) {
      console.log(`ℹ️  Fallos consecutivos: ${fallosConsecutivos} (alerta ya ${alertaEnviada ? 'enviada' : 'no enviada'}).`);
    }

    await actualizarEstadoSincronizacion(db, fallosConsecutivos, alertaEnviada);
    return { exito: false, alertaEnviada: enviado === true, recuperacion: false };
  } else {
    // Ciclo exitoso
    const huboAlertaPrevia = alertaEnviada;
    await actualizarEstadoSincronizacion(db, 0, false, true);
    console.log('✅ Ciclo exitoso. Contador de fallos reiniciado a 0.');

    if (huboAlertaPrevia) {
      // Hubo alerta previa y ahora se recuperó: enviar alerta de recuperación
      const mensaje = `✅ Sincronización de producción recuperada

El ciclo automático volvió a completarse correctamente.

Los datos de producción están actualizados.`;
      const enviado = await enviarAlertaConConfirmacion('sync_recuperacion', mensaje);
      if (enviado) {
        console.log('🔔 Alerta de recuperación enviada por WhatsApp.');
      } else {
        console.log('⚠️  No se pudo confirmar envío de alerta de recuperación (WhatsApp desconectado).');
      }
      return { exito: true, alertaEnviada: false, recuperacion: enviado === true };
    }

    return { exito: true, alertaEnviada: false, recuperacion: false };
  }
}

// ======================== ORQUESTACIÓN ========================
const COLUMNAS_CALIDAD = ['Id_Rechazo', 'Fecha_Rechazo', 'LineaOrg_Rechazo', 'ProcesoOrg_Rechazo', 'LineaRep_Rechazo', 'ProcesoRep_Rechazo', 'LoteProduccion_Rechazo', 'Lote_Rechazo', 'Referencia_Rechazo', 'Cantidad_Rechazo', 'Motivo_Rechazo', 'Observaciones', 'Area'];
const COLUMNAS_LOTES = ['No_Lote', 'Referencia_Lote', 'Color_Lote', 'Voltaje_Lote', 'Codigo_Lote'];
const COLUMNAS_PRODUCCION = ['Id_Entrega', 'Fecha_Entrega', 'Linea_Entrega', 'Lote_Entrega', 'Referencia_Entrega', 'Operacion_Entrega', 'CantidadBuenas_Entrega', 'Area'];

// Función reutilizable: la usa tanto app_circuitos.js (una vez al arrancar y
// luego cada 6 horas) como el bloque CLI de más abajo (node
// scripts/sincronizar_produccion.js, para correrlo a mano aparte del
// servidor). A propósito NO llama a process.exit() en ningún punto — si lo
// hiciera, un ciclo llamado desde dentro del servidor tumbaría toda la app,
// no solo esta sincronización.
// Parámetros:
// - forzarRefresco: true = refrescar Excel antes de leer (CLI manual), false = usar archivos tal como están (ciclo automático)
// - esAutomatico: true = ciclo automático del servidor (cada 6h), false = ejecución manual CLI
// Devuelve: { exito: boolean, alertaEnviada: boolean, recuperacion: boolean }
async function sincronizarProduccion(forzarRefresco = false, esAutomatico = false) {
  console.log('======================== Sincronización de Producción (rechazos + lotes + entregas) ========================');
  console.log(new Date().toLocaleString('es-CO'), '\n');

  let estadoRefresco = { [RUTA_CALIDAD]: true, [RUTA_LOTES]: true, [RUTA_PRODUCCION]: true };
  if (forzarRefresco) {
    console.log('📤 Refrescando Calidad.xlsx, Lotes.xlsx y Produccion.xlsx en Excel...');
    estadoRefresco = await refrescarExcel([RUTA_CALIDAD, RUTA_LOTES, RUTA_PRODUCCION]);
  } else {
    console.log('📂 Omitiendo refresco de Excel (usando archivos locales)...');
  }

  // getDb() ya funciona si app_circuitos.js llamó a inicializarBaseDatos() al
  // arrancar (es el caso normal: este ciclo corre dentro del servidor cada 6
  // horas) — se reutiliza esa misma conexión en vez de abrir otra. Solo se
  // inicializa aparte cuando este script corre solo (CLI), donde nadie más
  // abrió la base de datos todavía. Importante no llamar a
  // inicializarBaseDatos() en cada ciclo sin este chequeo: abre una conexión
  // SQLite nueva cada vez sin cerrar la anterior, y en un servidor que corre
  // meses seguidos eso se acumula.
  let db;
  try {
    db = getDb();
  } catch (e) {
    await inicializarBaseDatos();
    db = getDb();
  }

  // Flags para rastrear si cada fuente se procesó correctamente
  let calidadOk = true;
  let lotesOk = true;
  let produccionOk = true;

  // Si el refresco de un archivo falló en este ciclo, igual se sincroniza con
  // lo último que haya quedado guardado en el Excel (no es lo más nuevo de la
  // NAS, pero tampoco hay razón para no sincronizarlo) — solo cambia el
  // mensaje, para que quede claro en el log que ese archivo no se refrescó.
  if (!estadoRefresco[RUTA_CALIDAD]) {
    console.warn('⚠️  Calidad.xlsx no se pudo refrescar en este ciclo; se sincroniza con la última versión que haya guardada.');
  }
  try {
    const filasCalidad = await leerHoja(RUTA_CALIDAD, 'Calidad', COLUMNAS_CALIDAD);
    const r = await sincronizarRechazos(db, filasCalidad);
    console.log(`✅ Rechazos: ${r.total} filas en el Excel → ${r.nuevos} nuevas, ${r.actualizados} actualizadas, ${r.sinCambios} sin cambios.`);
  } catch (e) {
    console.error('⚠️  Error leyendo/sincronizando Calidad.xlsx:', e.message);
    calidadOk = false;
  }

  if (!estadoRefresco[RUTA_LOTES]) {
    console.warn('⚠️  Lotes.xlsx no se pudo refrescar en este ciclo; se sincroniza con la última versión que haya guardada.');
  }
  try {
    const filasLotes = await leerHoja(RUTA_LOTES, 'Lotes', COLUMNAS_LOTES);
    const r = await sincronizarLotes(db, filasLotes);
    console.log(`✅ Lotes: ${r.total} filas en el Excel → ${r.nuevos} nuevos, ${r.actualizados} actualizados, ${r.sinCambios} sin cambios${r.sinNoLote ? ` (${r.sinNoLote} sin No_Lote, descartadas)` : ''}.`);
  } catch (e) {
    console.error('⚠️  Error leyendo/sincronizando Lotes.xlsx:', e.message);
    lotesOk = false;
  }

  if (!estadoRefresco[RUTA_PRODUCCION]) {
    console.warn('⚠️  Produccion.xlsx no se pudo refrescar en este ciclo; se sincroniza con la última versión que haya guardada.');
  }
  try {
    const filasProduccion = await leerHoja(RUTA_PRODUCCION, 'Produccion', COLUMNAS_PRODUCCION);
    const r = await sincronizarEntregas(db, filasProduccion);
    console.log(`✅ Entregas de producción: ${r.total} filas en el Excel → ${r.nuevas} nuevas, ${r.actualizadas} actualizadas, ${r.sinCambios} sin cambios${r.sinIdEntrega ? ` (${r.sinIdEntrega} sin Id_Entrega, identificadas por hash)` : ''}.`);
  } catch (e) {
    console.error('⚠️  Error leyendo/sincronizando Produccion.xlsx:', e.message);
    produccionOk = false;
  }

  console.log('\n✅ Ciclo de sincronización terminado.\n');

  // Un ciclo es EXITOSO solo si las TRES fuentes se procesaron sin errores
  const huboFallo = !(calidadOk && lotesOk && produccionOk);

  // Procesar alertas según resultado (solo para ciclos automáticos)
  const resultado = await procesarResultadoCiclo(db, esAutomatico, huboFallo);
  return resultado;
}

module.exports = { sincronizarProduccion };

// Solo corre como CLI si se invoca directamente (node
// scripts/sincronizar_produccion.js), no cuando app_circuitos.js hace
// require('./scripts/sincronizar_produccion') para engancharlo al ciclo de
// 6 horas.
// CLI: forzarRefresco=true, esAutomatico=false (no cuenta para alertas)
if (require.main === module) {
  sincronizarProduccion(true, false)
    .then(() => process.exit(0))
    .catch(err => {
      console.error('❌ Error inesperado durante la sincronización:', err);
      process.exit(1);
    });
}
