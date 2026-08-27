// ============================================
// SERVICIO DE BOT DE WHATSAPP INTEGRADO
// ============================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const config = require('./settings/config_whatsapp');
const whatsappAlertas = require('./data/whatsappAlertas');
const calidadData = require('./data/calidad');
const { generarPdfResumenCalidad } = require('./utils/pdfResumenCalidad');
const { generarPdfReporteGarantias } = require('./utils/pdfReporteGarantias');
const { construirHtmlReporteInspeccion } = require('./utils/imagenReporteMetrologia');
// Julio quiere comparar: volvió a mandar el reporte de inspección como PDF
// (en vez de la imagen compacta) para ver cómo se ve ahora que cambió dos
// planos de PDF a PNG (Iny_Ap0111 e Iny_Bas_0111) — antes esos dos siempre
// caían en la nota de texto "el plano está en PDF, consúltelo en el
// sistema" porque PDFKit no puede insertar la página de otro PDF como
// imagen. Ver enviarReporteInspeccionMetrologia más abajo: por ahora usa
// generarPdfInspeccionMetrologia otra vez en vez de generarImagenInspeccion
// (que se deja intacta, lista para volver a activarla).
const { generarPdfInspeccionMetrologia } = require('./utils/pdfInspeccionMetrologia');

const {
  AREAS, TIMEZONE,
  IGNORE_OLD_MESSAGES_SECONDS, RECORDATORIOS,
  RESUMEN_HORA, RESUMEN_MINUTO, MENSAJES_SALIDA,
  RESUMEN_CALIDAD_HORA, RESUMEN_CALIDAD_MINUTO,
} = config;

let dbInstance = null;
let client = null;
let readyTime = null;
let enviadosHoy = new Set();
let flagResumenEnviadoHoy = false;
let reconectando = false;

// ======================== NÚMEROS AUTORIZADOS (en memoria) ========================
// Antes esto salía de ALLOWED_NUMBERS/NOMBRES/ADMIN_NUMERO (config_whatsapp.js,
// que a su vez venía del .env). Ahora la fuente de verdad es la tabla
// whatsapp_numeros (administrable desde Public/whatsapp_bot.html), pero se
// sigue guardando en memoria para no tener que consultar la base de datos en
// cada mensaje que llega. recargarNumerosWhatsApp() se llama una vez al
// arrancar el bot y, de ahí en adelante, cada vez que routes/whatsapp.js
// crea/edita/elimina un número — mismo patrón que recargarPermisos() en
// middleware/auth.js para los roles.
let numerosCache = new Map(); // telefono -> { nombre, es_admin, permisos: Set<string> }

async function recargarNumerosWhatsApp() {
  try {
    const numeros = await whatsappAlertas.listarNumerosActivos();
    numerosCache = new Map(numeros.map(n => [n.telefono, { nombre: n.nombre, es_admin: !!n.es_admin, permisos: n.permisos || new Set() }]));
    console.log(`📇 Números de WhatsApp recargados en memoria (${numerosCache.size} activo(s)).`);
  } catch (e) {
    console.error('⚠️ Error recargando números de WhatsApp:', e.message);
  }
}

function numeroAutorizado(telefono) { return numerosCache.has(telefono); }
function esAdmin(telefono) { return !!numerosCache.get(telefono)?.es_admin; }
function numerosAdmin() { return [...numerosCache.entries()].filter(([, v]) => v.es_admin).map(([tel]) => tel); }
// Qué puede pedirle este número al bot (ver settings/permisosBot.js) —
// independiente de es_admin, que solo decide quién RECIBE los avisos
// automáticos. `es_admin` además da acceso a todo, como interruptor
// maestro, para no obligar a marcar las 7 casillas una por una si de
// verdad se quiere que alguien tenga acceso completo.
function tienePermisoBot(telefono, codigo) {
  const n = numerosCache.get(telefono);
  if (!n) return false;
  return n.es_admin || n.permisos.has(codigo);
}

function nombreDe(telefono) { return numerosCache.get(telefono)?.nombre || telefono; }
function horaStr(fecha) {
  return fecha.toLocaleString('es-419', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: TIMEZONE
  });
}
function duracion(inicio, fin) {
  const ms = fin - inicio;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function msgBienvenida() {
  let t = '📋 *Sistema de Registro de Áreas*\n\nSelecciona un área para registrar tu *ENTRADA*:\n\n';
  AREAS.forEach(a => t += `  ${a.id}. ${a.nombre}\n`);
  t += '\n💡 Escribe el *número* del área.';
  return t;
}
function msgEntrada(area, h) {
  return `✅ *ENTRADA registrada*\n\n📍 Área: *${area.nombre}*\n🕐 Hora: *${h}*\n\nCuando termines, escribe *"salir"*.`;
}
function msgSalida(tel, area, hEnt, hSal, dur) {
  const nombre = nombreDe(tel);
  const tpl = MENSAJES_SALIDA[tel];
  if (tpl) {
    return tpl
      .replace(/{nombre}/g, nombre)
      .replace(/{area}/g, area.nombre)
      .replace(/{duracion}/g, dur)
      .replace(/{horaEntrada}/g, hEnt)
      .replace(/{horaSalida}/g, hSal);
  }
  return `🔴 *SALIDA registrada*\n\n📍 Área: *${area.nombre}*\n🕐 Entrada: ${hEnt}\n🕐 Salida: ${hSal}\n⏱️ Duración: *${dur}*\n\nPuedes entrar a otra área. Escribe *"areas"*.`;
}
function msgEstado(s) {
  if (!s) return '⚪ No tienes sesión activa.\nEscribe *"areas"* para ver la lista.';
  return `🟢 *Sesión activa*\n\n📍 Área: *${s.area_nombre}*\n🕐 Entrada: ${s.entrada}\n\nEscribe *"salir"* cuando termines.`;
}

async function generarResumen() {
  if (!dbInstance) return '📊 *Resumen del día*\n\nBase de datos no disponible.';
  const hoy = new Date().toLocaleDateString('es-419', { timeZone: TIMEZONE });
  const regs = await dbInstance.all('SELECT * FROM whatsapp_registros ORDER BY id ASC');
  const hoyRegs = regs.filter(r => {
    const f = new Date(r.timestamp_entrada || r.timestamp_salida || Date.now())
      .toLocaleDateString('es-419', { timeZone: TIMEZONE });
    return f === hoy;
  });
  if (hoyRegs.length === 0) return `📊 *Resumen del día*\n${hoy}\n\nNo hay registros hoy.`;

  const porPersona = {};
  hoyRegs.forEach(r => { (porPersona[r.telefono] ||= []).push(r); });

  let t = `📊 *RESUMEN DEL DÍA*\n${hoy}\n\n`;
  Object.entries(porPersona).forEach(([tel, rs]) => {
    rs.sort((a, b) => new Date(a.timestamp_entrada || 0) - new Date(b.timestamp_entrada || 0));
    t += `👤 *${nombreDe(tel)}*\n`;
    let totalMs = 0;
    rs.forEach(r => {
      if (r.tipo === 'ENTRADA') {
        const sal = rs.find(x => x.tipo === 'SALIDA' && x.area_id === r.area_id && new Date(x.timestamp_salida) > new Date(r.timestamp_entrada));
        if (sal) {
          const d = duracion(new Date(r.timestamp_entrada), new Date(sal.timestamp_salida));
          t += `   • ${r.area_nombre} → ${r.entrada} a ${sal.salida} | ${d}\n`;
          totalMs += new Date(sal.timestamp_salida) - new Date(r.timestamp_entrada);
        } else {
          t += `   • ${r.area_nombre} → ${r.entrada} a ??? | ⚠️ SIN CERRAR\n`;
        }
      }
    });
    if (totalMs > 0) {
      const th = Math.floor(totalMs / 3600000), tm = Math.floor((totalMs % 3600000) / 60000);
      t += `   ⏱️ Total: ${th}h ${tm}m\n`;
    }
    t += '\n';
  });

  const sesionesActivas = await dbInstance.all('SELECT * FROM whatsapp_sesiones_activas');
  if (sesionesActivas.length > 0) {
    t += '🔴 *SESIONES ACTIVAS AHORA*:\n';
    sesionesActivas.forEach(s => {
      t += `   ${nombreDe(s.telefono)}: ${s.area_nombre} desde ${s.entrada} (${duracion(new Date(s.entrada_raw), new Date())})\n`;
    });
  }
  return t;
}

async function enviarResumenAdmin() {
  if (!client) return;
  try {
    const resumen = await generarResumen();
    for (const admin of numerosAdmin()) {
      await client.sendMessage(admin, resumen);
    }
    flagResumenEnviadoHoy = true;
    console.log('📊 Resumen diario enviado al admin vía WhatsApp.');
  } catch (e) {
    console.error('❌ Error enviando resumen:', e.message);
  }
}

// ======================== ALERTAS DE CALIDAD (roadmap #2) ========================
// Punto de entrada único para cualquier alerta de calidad que se quiera
// mandar por WhatsApp: revisa si ese tipo de alerta está activo en
// whatsapp_alertas_config y, si lo está, la manda a todos los números
// marcados como administrador. Se llama desde routes/iso2859.js (lote
// rechazado, Primera Pieza rechazada, "Parar" en En Proceso) y desde
// routes/roles.js / routes/usuarios.js (cambio a un permiso sensible).
//
// A propósito nunca lanza una excepción hacia quien la llama: si el bot no
// está conectado, o la base de datos falla al leer la configuración, o el
// envío de WhatsApp falla, el error queda solo en el log del servidor — el
// muestreo, el rol o el usuario ya se guardaron bien de todas formas, y no
// tiene sentido que ese guardado le muestre un error al usuario solo porque
// no se pudo mandar un aviso de WhatsApp.
async function enviarAlerta(tipo, mensaje) {
  try {
    if (!client) return;
    const cfg = await whatsappAlertas.obtenerConfigAlerta(tipo);
    if (cfg && cfg.activo === 0) return; // desactivada desde el panel
    const admins = numerosAdmin();
    if (admins.length === 0) return;
    for (const admin of admins) {
      try {
        await client.sendMessage(admin, mensaje);
      } catch (e) {
        console.error(`❌ Error enviando alerta "${tipo}" a ${nombreDe(admin)}:`, e.message);
      }
    }
    console.log(`🔔 Alerta "${tipo}" enviada a ${admins.length} administrador(es).`);
  } catch (e) {
    console.error(`⚠️ No se pudo procesar la alerta "${tipo}":`, e.message);
  }
}

// Igual que enviarAlerta, pero para los resúmenes periódicos (diario/
// quincenal/mensual): en vez de un mensaje de texto, genera el PDF con el
// mismo diseño institucional que los reportes de Auditoría/Lote/
// Trazabilidad (ver utils/pdfResumenCalidad.js) y lo manda como archivo
// adjunto. Las alertas de un solo evento (lote rechazado, "Parar", pico de
// garantías, permiso sensible) y el comando "garantias" se quedan en texto
// a propósito — son avisos cortos pensados para leerse al toque, no
// reportes. Si por lo que sea el PDF no se pudo generar, no se pierde el
// aviso: se manda como el mensaje de texto de siempre (formatearResumenCalidad),
// para no dejar a nadie sin su resumen por un problema de PDFKit/disco.
async function enviarResumenPDF(tipo, etiquetaPeriodo, r) {
  try {
    if (!client) return;
    const cfg = await whatsappAlertas.obtenerConfigAlerta(tipo);
    if (cfg && cfg.activo === 0) return; // desactivada desde el panel
    const admins = numerosAdmin();
    if (admins.length === 0) return;

    let rutaArchivo;
    try {
      rutaArchivo = await generarPdfResumenCalidad(etiquetaPeriodo, r);
    } catch (e) {
      console.error(`⚠️ No se pudo generar el PDF de "${tipo}", se manda como texto:`, e.message);
      await enviarAlerta(tipo, formatearResumenCalidad(etiquetaPeriodo, r));
      return;
    }

    try {
      const media = MessageMedia.fromFilePath(rutaArchivo);
      const caption = `📊 *Resumen de Calidad — ${etiquetaPeriodo}*`;
      for (const admin of admins) {
        try {
          await client.sendMessage(admin, media, { caption });
        } catch (e) {
          console.error(`❌ Error enviando resumen PDF "${tipo}" a ${nombreDe(admin)}:`, e.message);
        }
      }
      console.log(`🔔 Resumen "${tipo}" (PDF) enviado a ${admins.length} administrador(es).`);
    } finally {
      fs.unlink(rutaArchivo, () => {});
    }
  } catch (e) {
    console.error(`⚠️ No se pudo procesar el resumen "${tipo}":`, e.message);
  }
}

// Misma idea que enviarResumenPDF, pero para los comandos bajo demanda
// ("diario"/"quincenal"/"mensual"): responde con el PDF directo a quien
// preguntó en vez de mandarlo a todos los administradores. También cae de
// vuelta al texto plano si el PDF no se pudo generar.
async function responderResumenPDF(msg, etiquetaPeriodo, r) {
  let rutaArchivo;
  try {
    rutaArchivo = await generarPdfResumenCalidad(etiquetaPeriodo, r);
  } catch (e) {
    console.error('⚠️ No se pudo generar el PDF del resumen, se manda como texto:', e.message);
    await msg.reply(formatearResumenCalidad(etiquetaPeriodo, r));
    return;
  }
  try {
    const media = MessageMedia.fromFilePath(rutaArchivo);
    await msg.reply(media, null, { caption: `📊 *Resumen de Calidad — ${etiquetaPeriodo}*` });
  } finally {
    fs.unlink(rutaArchivo, () => {});
  }
}

// Respaldo en texto plano del reporte de garantías, por si el PDF no se
// pudo generar — mismo criterio que formatearResumenCalidad para el
// resumen general (ver responderResumenPDF más arriba).
function formatearReporteGarantiasTexto(etiquetaPeriodo, g) {
  let t = `🛡️ *REPORTE DE GARANTÍAS — ${etiquetaPeriodo}*\n\n`;
  t += `Total: ${g.total || 0} | Referencias distintas: ${g.referenciasDistintas || 0} | Clientes distintos: ${g.clientesDistintos || 0}\n\n`;
  if ((g.topReferencias || []).length > 0) {
    t += `*Top referencias más frecuentes:*\n`;
    g.topReferencias.forEach((r, i) => { t += `  ${i + 1}. ${r.referencia}: ${r.total}\n`; });
    t += '\n';
  }
  if ((g.topMotivos || []).length > 0) {
    t += `*Motivos más frecuentes:*\n`;
    g.topMotivos.forEach(m => { t += `  • ${m.problema}: ${m.total}\n`; });
  }
  if ((g.total || 0) === 0) t += 'No se reportaron garantías en este periodo.\n';
  return t;
}

// Reporte aparte de garantías (roadmap #2) — a diferencia de
// responderResumenPDF (que manda el resumen general de TODO calidad),
// esto es solo garantías, con más detalle del que cabría en el resumen
// general (referencias/clientes distintos, motivos, detalle completo).
async function responderReporteGarantiasPDF(msg, etiquetaPeriodo, g) {
  let rutaArchivo;
  try {
    rutaArchivo = await generarPdfReporteGarantias(etiquetaPeriodo, g);
  } catch (e) {
    console.error('⚠️ No se pudo generar el PDF del reporte de garantías, se manda como texto:', e.message);
    await msg.reply(formatearReporteGarantiasTexto(etiquetaPeriodo, g));
    return;
  }
  try {
    const media = MessageMedia.fromFilePath(rutaArchivo);
    await msg.reply(media, null, { caption: `🛡️ *Reporte de Garantías — ${etiquetaPeriodo}*` });
  } finally {
    fs.unlink(rutaArchivo, () => {});
  }
}

// Genera el reporte de una inspección como UNA SOLA IMAGEN compacta (Julio
// primero pidió PDF y luego cambió a esto: quería algo más compacto que un
// PDF de varias páginas). Se arma el HTML en utils/imagenReporteMetrologia.js
// y acá se convierte a PNG abriendo una pestaña nueva en el MISMO navegador
// que whatsapp-web.js ya tiene corriendo para la sesión de WhatsApp
// (client.pupBrowser) — así no hace falta agregar Puppeteer como
// dependencia aparte ni descargar un Chrome adicional, solo se reutiliza el
// que ya está abierto.
async function generarImagenInspeccion(codigo, inspeccion, medidas, planoRuta) {
  if (!client || !client.pupBrowser) {
    throw new Error('El bot de WhatsApp no está conectado (no hay navegador disponible para generar la imagen).');
  }
  const html = construirHtmlReporteInspeccion(codigo, inspeccion, medidas, planoRuta);
  const nombreArchivo = `inspeccion-metrologia-${Date.now()}-${Math.round(Math.random() * 1e6)}.png`;
  const rutaArchivo = path.join(os.tmpdir(), nombreArchivo);

  const ANCHO = 640;
  const page = await client.pupBrowser.newPage();
  try {
    // El alto real del reporte varía según cuántas cotas/fotos tenga la
    // inspección — un viewport de alto fijo (ej. 800px) deja una franja en
    // blanco abajo cuando el contenido es más corto (justo lo que Julio no
    // quería, "mucho más compacta"), y recortaría el reporte si es más
    // largo. Por eso primero se renderiza con un alto cualquiera, se mide
    // cuánto ocupó realmente el documento (scrollHeight) y se ajusta el
    // viewport a ese alto exacto antes de la captura — así la imagen queda
    // del tamaño justo del contenido, ni más ni menos.
    await page.setViewport({ width: ANCHO, height: 800 });
    await page.setContent(html, { waitUntil: 'load' });
    // OJO: document.documentElement.scrollHeight queda "pisado" al alto del
    // viewport cuando el contenido es más corto que la ventana (comprobado
    // con capturas de prueba) — document.body.scrollHeight sí refleja el
    // alto real del contenido en ambos casos (corto o largo).
    const altoReal = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewport({ width: ANCHO, height: Math.max(1, altoReal) });
    await page.screenshot({ path: rutaArchivo, type: 'png' });
  } finally {
    await page.close();
  }
  return rutaArchivo;
}

// Reporte de una inspección de Metrología (roadmap: separar Garantías/
// Calidad — Julio pidió, aparte, que al guardar una inspección de un molde
// se pueda mandar por WhatsApp un reporte con el plano, los datos
// cargados, si cada cota quedó conforme y las fotos de evidencia. A
// diferencia de enviarAlerta/enviarResumenPDF (que son avisos automáticos,
// "fire and forget", sin nadie esperando el resultado), esta función la
// llama routes/metrologia.js justo después de que la persona confirma "sí,
// enviar" en un cuadro de diálogo — por eso SÍ devuelve un resultado
// {enviado, motivo} en vez de solo loguear el error, para poder avisarle en
// pantalla si no se pudo mandar (por ejemplo, porque el bot no está
// conectado) en vez de dejarla pensando que sí se envió.
async function enviarReporteInspeccionMetrologia(codigo, inspeccion, medidas, planoRuta) {
  if (!client) {
    return { enviado: false, motivo: 'El bot de WhatsApp no está conectado en este momento.' };
  }
  const admins = numerosAdmin();
  if (admins.length === 0) {
    return { enviado: false, motivo: 'No hay ningún número configurado como administrador para recibir el reporte.' };
  }

  let rutaArchivo;
  try {
    rutaArchivo = await generarPdfInspeccionMetrologia(codigo, inspeccion, medidas, planoRuta);
  } catch (e) {
    console.error('⚠️ No se pudo generar el PDF de la inspección de Metrología:', e.message);
    return { enviado: false, motivo: 'No se pudo generar el PDF del reporte.' };
  }

  try {
    const media = MessageMedia.fromFilePath(rutaArchivo);
    // Julio pidió quitar todo el texto del mensaje y dejar solo la
    // referencia (antes tenía emoji, título y fecha/responsable).
    const caption = codigo;
    let algunoEnviado = false;
    for (const admin of admins) {
      try {
        await client.sendMessage(admin, media, { caption });
        algunoEnviado = true;
      } catch (e) {
        console.error(`❌ Error enviando reporte de inspección a ${nombreDe(admin)}:`, e.message);
      }
    }
    if (algunoEnviado) {
      console.log(`🔔 Reporte de inspección "${codigo}" enviado por WhatsApp.`);
      return { enviado: true };
    }
    return { enviado: false, motivo: 'No se pudo entregar el mensaje a ningún administrador.' };
  } finally {
    fs.unlink(rutaArchivo, () => {});
  }
}

// ---- Fechas para los reportes periódicos -----------------------------
// iso_muestreos/iso_lotes guardan fecha_hora/fecha_cierre con
// datetime('now','localtime') (hora del propio servidor); garantias y
// moldes_inspecciones guardan sus timestamps con datetime('now')/
// CURRENT_TIMESTAMP (UTC). Para no comparar peras con manzanas, cada límite
// de periodo se calcula dos veces: una con los componentes de fecha locales
// (getFullYear/getMonth/getDate del propio proceso de Node, que corre en la
// misma máquina y por lo tanto en la misma hora que SQLite usa para
// 'localtime') y otra en UTC.
function fmtFecha(d, utc) {
  const p = n => String(n).padStart(2, '0');
  const y = utc ? d.getUTCFullYear() : d.getFullYear();
  const mo = utc ? d.getUTCMonth() : d.getMonth();
  const day = utc ? d.getUTCDate() : d.getDate();
  const h = utc ? d.getUTCHours() : d.getHours();
  const mi = utc ? d.getUTCMinutes() : d.getMinutes();
  const s = utc ? d.getUTCSeconds() : d.getSeconds();
  return `${y}-${p(mo + 1)}-${p(day)} ${p(h)}:${p(mi)}:${p(s)}`;
}
function limitesPeriodo(desdeDate, hastaDate) {
  return {
    desdeLocal: fmtFecha(desdeDate, false), hastaLocal: fmtFecha(hastaDate, false),
    desdeUTC: fmtFecha(desdeDate, true), hastaUTC: fmtFecha(hastaDate, true),
  };
}
function inicioDia(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0); }

// ---- Rangos de mes/quincena reutilizables --------------------------
// Los usan tanto revisarAlertasCalidadPeriodicas() (los resúmenes
// automáticos) como los comandos de WhatsApp "diario"/"quincenal"/"mensual"
// (más abajo), para que las dos vías calculen exactamente el mismo periodo
// para el mismo mes/quincena — nunca se duplica la lógica de fechas.
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function rangoMes(anio, mes) {
  return { desde: new Date(anio, mes, 1), hasta: new Date(anio, mes + 1, 1) };
}
function etiquetaMes(anio, mes) {
  return new Date(anio, mes, 1).toLocaleString('es-419', { month: 'long', year: 'numeric' });
}
// cual: 1 = del 1 al 15 del mes indicado; 2 = del 16 al fin de ese mes.
function rangoQuincena(anio, mes, cual) {
  if (cual === 1) return { desde: new Date(anio, mes, 1), hasta: new Date(anio, mes, 16) };
  return { desde: new Date(anio, mes, 16), hasta: new Date(anio, mes + 1, 1) };
}
function etiquetaQuincena(anio, mes, cual) {
  const nombreMes = etiquetaMes(anio, mes);
  return cual === 1 ? `1-15 de ${nombreMes}` : `16-fin de ${nombreMes}`;
}
// Convierte ["agosto","2026"] o ["8","2026"] en { anio, mes } (mes 0-indexado
// para Date()). Devuelve null si no se pudo interpretar, para que quien
// llame pueda contestar con el formato de uso esperado en vez de fallar feo.
function parsearMesAnio(partes) {
  if (!partes || partes.length < 2) return null;
  const token = partes[0].toLowerCase();
  let mes;
  if (/^\d+$/.test(token)) {
    mes = parseInt(token, 10) - 1;
  } else {
    mes = MESES.findIndex(m => m === token || (token.length >= 3 && m.startsWith(token)));
  }
  const anio = parseInt(partes[1], 10);
  if (mes < 0 || mes > 11 || isNaN(anio)) return null;
  return { mes, anio };
}
// La quincena/mes ya cerrado más reciente respecto a "ahora" — es el
// default cuando el comando de WhatsApp se manda sin mes/año (ej. escribir
// solo "quincenal" o solo "mensual").
function quincenaMasRecienteCerrada(ahora) {
  if (ahora.getDate() >= 16) return { anio: ahora.getFullYear(), mes: ahora.getMonth(), cual: 1 };
  const ma = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  return { anio: ma.getFullYear(), mes: ma.getMonth(), cual: 2 };
}
function mesMasRecienteCerrado(ahora) {
  const ma = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  return { anio: ma.getFullYear(), mes: ma.getMonth() };
}

// Ya no es el formato principal de los resúmenes de calidad (eso ahora es
// el PDF, ver enviarResumenPDF/responderResumenPDF más arriba) — se
// conserva únicamente como respaldo en texto plano por si el PDF no se
// pudo generar (PDFKit fallando, disco lleno, etc.), para no dejar a nadie
// sin su resumen por un problema ajeno al contenido.
function formatearResumenCalidad(etiquetaPeriodo, r) {
  const pp = {};
  (r.primeraPieza || []).forEach(x => { pp[x.decision] = x.total; });
  const fin = {};
  (r.final || []).forEach(x => { fin[x.decision] = x.total; });
  const trat = {};
  (r.lotesTratamiento || []).forEach(x => { trat[x.estado_final] = x.total; });
  const ep = r.enProceso || {};

  let t = `📊 *RESUMEN DE CALIDAD — ${etiquetaPeriodo}*\n\n`;
  t += `🧪 *Muestreos ISO 2859*\n`;
  t += `  Primera Pieza: ${pp.Liberar || 0} liberadas, ${pp.Rechazar || 0} rechazadas, ${pp.Reclasificar || 0} reclasificadas\n`;
  t += `  En Proceso: ${ep.total || 0} muestreo(s) (${ep.paradas || 0} Parar, ${ep.alertas || 0} Alerta) | piezas reclasificadas: ${ep.piezas_reclasificadas || 0}, reparadas: ${ep.piezas_reparadas || 0}\n`;
  t += `  Auditoría Final: ${fin.Aceptado || 0} aceptados, ${fin.Aceptado_con_obs || 0} con obs., ${fin.Rechazado || 0} rechazados`;
  if ((trat.Reclasificado || 0) + (trat.Reparacion || 0) > 0) {
    t += ` (de los cierres: ${trat.Reclasificado || 0} reclasificados, ${trat.Reparacion || 0} en reparación)`;
  }
  t += `\n\n🛡️ *Garantías*: ${r.garantias || 0} nueva(s) reportada(s)\n`;
  t += `📏 *Metrología*: ${r.fueraTolerancia || 0} medida(s) fuera de tolerancia\n`;
  return t;
}

// Revisa (una vez al día, a la hora configurada en RESUMEN_CALIDAD_HORA/
// MINUTO) el pico de garantías y los tres resúmenes periódicos de calidad.
// Se llama desde revisarCron(), igual que el resumen de asistencia.
async function revisarAlertasCalidadPeriodicas() {
  if (!dbInstance || !client) return;
  const ahora = new Date();
  const hora = parseInt(ahora.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TIMEZONE }));
  const min = parseInt(ahora.toLocaleString('en-US', { minute: 'numeric', timeZone: TIMEZONE }));
  const seg = parseInt(ahora.toLocaleString('en-US', { second: 'numeric', timeZone: TIMEZONE }));
  if (hora !== RESUMEN_CALIDAD_HORA || min !== RESUMEN_CALIDAD_MINUTO || seg >= 10) return;

  const dia = ahora.getDate();
  const hoyStr = fmtFecha(ahora, false).slice(0, 10);

  // --- Pico de garantías ---
  try {
    const cfgG = await whatsappAlertas.obtenerConfigAlerta('pico_garantias');
    if (cfgG && cfgG.activo) {
      const picos = await calidadData.obtenerPicoGarantias(cfgG.umbral, cfgG.ventana_dias);
      for (const p of picos) {
        // Semana ISO aproximada (año-semana), suficiente para no repetir el
        // mismo aviso todos los días mientras el conteo se mantenga alto.
        const semana = `${ahora.getFullYear()}-S${Math.ceil((((ahora - new Date(ahora.getFullYear(), 0, 1)) / 86400000) + new Date(ahora.getFullYear(), 0, 1).getDay() + 1) / 7)}`;
        const clave = `${p.referencia}|${semana}`;
        if (await whatsappAlertas.yaSeEnvio('pico_garantias', clave)) continue;
        const msg = `⚠️ *PICO DE GARANTÍAS*\n\nLa referencia *${p.referencia}* acumula *${p.total}* garantía(s) en los últimos ${cfgG.ventana_dias || 7} días (umbral: ${cfgG.umbral || 10}).\n\nVale la pena revisar si hay un problema de lote sin detectar en muestreo.`;
        await enviarAlerta('pico_garantias', msg);
        await whatsappAlertas.marcarEnviado('pico_garantias', clave);
      }
    }
  } catch (e) {
    console.error('⚠️ Error revisando pico de garantías:', e.message);
  }

  // --- Resumen diario ---
  try {
    const cfgD = await whatsappAlertas.obtenerConfigAlerta('resumen_diario');
    if (cfgD && cfgD.activo && !(await whatsappAlertas.yaSeEnvio('resumen_diario', hoyStr))) {
      const r = await calidadData.obtenerResumenPeriodo(limitesPeriodo(inicioDia(ahora), ahora));
      await enviarResumenPDF('resumen_diario', `Hoy ${hoyStr}`, r);
      await whatsappAlertas.marcarEnviado('resumen_diario', hoyStr);
    }
  } catch (e) {
    console.error('⚠️ Error enviando resumen diario de calidad:', e.message);
  }

  // --- Resumen quincenal (día 16: cubre 1-15; día 1: cubre 16-fin del mes anterior) ---
  try {
    const cfgQ = await whatsappAlertas.obtenerConfigAlerta('resumen_quincenal');
    if (cfgQ && cfgQ.activo && (dia === 16 || dia === 1)) {
      let anio, mes, cual;
      if (dia === 16) {
        anio = ahora.getFullYear(); mes = ahora.getMonth(); cual = 1;
      } else {
        const ma = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
        anio = ma.getFullYear(); mes = ma.getMonth(); cual = 2;
      }
      const clave = `${anio}-${String(mes + 1).padStart(2, '0')}-Q${cual}`;
      if (!(await whatsappAlertas.yaSeEnvio('resumen_quincenal', clave))) {
        const { desde, hasta } = rangoQuincena(anio, mes, cual);
        const r = await calidadData.obtenerResumenPeriodo(limitesPeriodo(desde, hasta));
        await enviarResumenPDF('resumen_quincenal', etiquetaQuincena(anio, mes, cual), r);
        await whatsappAlertas.marcarEnviado('resumen_quincenal', clave);
      }
    }
  } catch (e) {
    console.error('⚠️ Error enviando resumen quincenal de calidad:', e.message);
  }

  // --- Resumen mensual (día 1: cubre todo el mes anterior) ---
  try {
    const cfgM = await whatsappAlertas.obtenerConfigAlerta('resumen_mensual');
    if (cfgM && cfgM.activo && dia === 1) {
      const { anio, mes } = mesMasRecienteCerrado(ahora);
      const clave = `${anio}-${String(mes + 1).padStart(2, '0')}`;
      if (!(await whatsappAlertas.yaSeEnvio('resumen_mensual', clave))) {
        const { desde, hasta } = rangoMes(anio, mes);
        const r = await calidadData.obtenerResumenPeriodo(limitesPeriodo(desde, hasta));
        await enviarResumenPDF('resumen_mensual', etiquetaMes(anio, mes), r);
        await whatsappAlertas.marcarEnviado('resumen_mensual', clave);
      }
    }
  } catch (e) {
    console.error('⚠️ Error enviando resumen mensual de calidad:', e.message);
  }
}

// ======================== COMANDOS DE WHATSAPP PARA PEDIR REPORTES ========================
// Solo para administradores (ver esAdmin() en el handler de mensajes). Son
// "jalar" un reporte bajo demanda — responden directo a quien escribió, y a
// propósito NO tocan whatsapp_alertas_enviadas (esa tabla es solo para que
// los envíos AUTOMÁTICOS de las 5pm no se dupliquen); pedir un resumen por
// comando nunca cancela ni adelanta el envío automático del día.
async function comandoResumenDiario(msg) {
  const ahora = new Date();
  const r = await calidadData.obtenerResumenPeriodo(limitesPeriodo(inicioDia(ahora), ahora));
  await responderResumenPDF(msg, `Hoy ${fmtFecha(ahora, false).slice(0, 10)}`, r);
}

async function comandoResumenQuincenal(txtOrig, msg) {
  const partes = txtOrig.trim().split(/\s+/).slice(1);
  let anio, mes, cual;
  if (partes.length === 0) {
    ({ anio, mes, cual } = quincenaMasRecienteCerrada(new Date()));
  } else {
    cual = parseInt(partes[0], 10);
    const mesAnio = parsearMesAnio(partes.slice(1));
    if ((cual !== 1 && cual !== 2) || !mesAnio) {
      await msg.reply('⚠️ Uso: *quincenal* (la última quincena cerrada), o *quincenal 1 agosto 2026* (1-15) / *quincenal 2 agosto 2026* (16-fin).');
      return;
    }
    anio = mesAnio.anio; mes = mesAnio.mes;
  }
  const { desde, hasta } = rangoQuincena(anio, mes, cual);
  const r = await calidadData.obtenerResumenPeriodo(limitesPeriodo(desde, hasta));
  await responderResumenPDF(msg, etiquetaQuincena(anio, mes, cual), r);
}

async function comandoResumenMensual(txtOrig, msg) {
  const partes = txtOrig.trim().split(/\s+/).slice(1);
  let anio, mes;
  if (partes.length === 0) {
    ({ anio, mes } = mesMasRecienteCerrado(new Date()));
  } else {
    const mesAnio = parsearMesAnio(partes);
    if (!mesAnio) {
      await msg.reply('⚠️ Uso: *mensual* (el mes pasado), o *mensual agosto 2026*.');
      return;
    }
    anio = mesAnio.anio; mes = mesAnio.mes;
  }
  const { desde, hasta } = rangoMes(anio, mes);
  const r = await calidadData.obtenerResumenPeriodo(limitesPeriodo(desde, hasta));
  await responderResumenPDF(msg, etiquetaMes(anio, mes), r);
}

async function comandoGarantiasAhora(msg) {
  const cfgG = await whatsappAlertas.obtenerConfigAlerta('pico_garantias');
  const umbral = (cfgG && cfgG.umbral) || 10;
  const ventana = (cfgG && cfgG.ventana_dias) || 7;
  const picos = await calidadData.obtenerPicoGarantias(umbral, ventana);
  if (picos.length === 0) {
    await msg.reply(`📈 *Pico de garantías*\n\nNinguna referencia supera las ${umbral} garantías en los últimos ${ventana} días, ahora mismo.`);
    return;
  }
  let t = `📈 *Pico de garantías* (últimos ${ventana} días, umbral ${umbral})\n\n`;
  picos.forEach(p => { t += `• ${p.referencia}: ${p.total}\n`; });
  await msg.reply(t);
}

// Reporte aparte de garantías por periodo — "garantias diario"/"garantias
// quincenal [...]"/"garantias mensual [...]", con el mismo manejo de
// argumentos que ya usan comandoResumenQuincenal/comandoResumenMensual
// (misma quincena/mes cerrado más reciente si no se especifica). No toca
// whatsapp_alertas_enviadas por la misma razón que los demás comandos bajo
// demanda: pedirlo nunca afecta lo que se manda automático.
async function comandoReporteGarantiasDiario(msg) {
  const ahora = new Date();
  const g = await calidadData.obtenerGarantiasReportePeriodo(limitesPeriodo(inicioDia(ahora), ahora));
  await responderReporteGarantiasPDF(msg, `Hoy ${fmtFecha(ahora, false).slice(0, 10)}`, g);
}

async function comandoReporteGarantiasQuincenal(msg, partesRestantes) {
  let anio, mes, cual;
  if (partesRestantes.length === 0) {
    ({ anio, mes, cual } = quincenaMasRecienteCerrada(new Date()));
  } else {
    cual = parseInt(partesRestantes[0], 10);
    const mesAnio = parsearMesAnio(partesRestantes.slice(1));
    if ((cual !== 1 && cual !== 2) || !mesAnio) {
      await msg.reply('⚠️ Uso: *garantias quincenal* (la última quincena cerrada), o *garantias quincenal 1 agosto 2026* (1-15) / *garantias quincenal 2 agosto 2026* (16-fin).');
      return;
    }
    anio = mesAnio.anio; mes = mesAnio.mes;
  }
  const { desde, hasta } = rangoQuincena(anio, mes, cual);
  const g = await calidadData.obtenerGarantiasReportePeriodo(limitesPeriodo(desde, hasta));
  await responderReporteGarantiasPDF(msg, etiquetaQuincena(anio, mes, cual), g);
}

async function comandoReporteGarantiasMensual(msg, partesRestantes) {
  let anio, mes;
  if (partesRestantes.length === 0) {
    ({ anio, mes } = mesMasRecienteCerrado(new Date()));
  } else {
    const mesAnio = parsearMesAnio(partesRestantes);
    if (!mesAnio) {
      await msg.reply('⚠️ Uso: *garantias mensual* (el mes pasado), o *garantias mensual agosto 2026*.');
      return;
    }
    anio = mesAnio.anio; mes = mesAnio.mes;
  }
  const { desde, hasta } = rangoMes(anio, mes);
  const g = await calidadData.obtenerGarantiasReportePeriodo(limitesPeriodo(desde, hasta));
  await responderReporteGarantiasPDF(msg, etiquetaMes(anio, mes), g);
}

// Punto de entrada único del comando "garantias": sin argumentos se
// mantiene el comportamiento de siempre (estado del pico ahora mismo); con
// "diario"/"quincenal"/"mensual" como primer argumento, entrega el reporte
// aparte de garantías de ese periodo en vez del resumen general.
async function comandoGarantiasRouter(txtOrig, msg) {
  const partes = txtOrig.trim().split(/\s+/).slice(1);
  if (partes.length === 0) {
    await comandoGarantiasAhora(msg);
    return;
  }
  const sub = partes[0].toLowerCase();
  if (sub === 'diario') { await comandoReporteGarantiasDiario(msg); return; }
  if (sub === 'quincenal') { await comandoReporteGarantiasQuincenal(msg, partes.slice(1)); return; }
  if (sub === 'mensual') { await comandoReporteGarantiasMensual(msg, partes.slice(1)); return; }
  await msg.reply('⚠️ Uso: *garantias* (pico actual), *garantias diario*, *garantias quincenal [1|2] [mes] [año]*, o *garantias mensual [mes] [año]*.');
}

// Cada línea solo aparece si el número que escribió "ayuda" tiene el
// permiso correspondiente (ver settings/permisosBot.js) — así, alguien que
// solo puede marcar entrada/salida ve nada más que eso, y no una lista de
// comandos que igual le van a responder "no tienes permiso" si los usa.
const LINEAS_COMANDOS = [
  { permiso: 'ver_resumen_asistencia', linea: '• *resumen* → resumen de asistencia de hoy' },
  { permiso: 'calidad_diario', linea: '• *diario* → resumen de calidad de hoy' },
  { permiso: 'calidad_quincenal', linea: '• *quincenal* → resumen de calidad de la última quincena cerrada\n  *quincenal 1 agosto 2026* / *quincenal 2 agosto 2026* → una quincena específica (1=del 1-15, 2=del 16-fin)' },
  { permiso: 'calidad_mensual', linea: '• *mensual* → resumen de calidad del mes pasado\n  *mensual agosto 2026* → resumen de calidad de un mes específico' },
  { permiso: 'calidad_garantias', linea: '• *garantias* → estado actual del pico de garantías\n  *garantias diario* / *garantias quincenal [1|2] [mes] [año]* / *garantias mensual [mes] [año]* → reporte aparte de garantías de ese periodo (referencias y motivos más frecuentes, detalle completo)' },
  { permiso: 'cerrar_sesiones', linea: '• *cerrar <número>* → cierra la sesión activa de alguien' },
];

// Arma el mensaje de "ayuda"/"hola"/"menu" a la medida de lo que ese número
// específico puede hacer — reemplaza la combinación fija de
// msgBienvenida() + un bloque de admin igual para todos que había antes.
function construirMenuPara(telefono) {
  const partes = [];
  if (tienePermisoBot(telefono, 'registro_entrada')) {
    partes.push(msgBienvenida());
  }
  const lineasPermitidas = LINEAS_COMANDOS.filter(c => tienePermisoBot(telefono, c.permiso)).map(c => c.linea);
  if (lineasPermitidas.length > 0) {
    partes.push('🛠️ *Comandos disponibles*\n' + lineasPermitidas.join('\n'));
  }
  if (partes.length === 0) {
    return 'Por ahora no tienes ninguna función habilitada en este bot. Pídele a un administrador que revise tus permisos.';
  }
  return partes.join('\n\n');
}

async function cerrarSesionPorAdmin(telefono, msgAdmin = null) {
  if (!dbInstance) return { success: false, error: 'DB no inicializada' };
  const s = await dbInstance.get('SELECT * FROM whatsapp_sesiones_activas WHERE telefono = ?', [telefono]);
  if (!s) {
    if (msgAdmin) await msgAdmin.reply(`⚠️ ${nombreDe(telefono)} no tiene sesión activa.`);
    return { success: false, error: 'Sesión no encontrada' };
  }
  const ahora = new Date(), h = horaStr(ahora);
  const area = AREAS.find(a => a.id === s.area_id) || { nombre: s.area_nombre };
  const dur = duracion(new Date(s.entrada_raw), ahora);

  await dbInstance.run(`
    INSERT INTO whatsapp_registros (telefono, tipo, area_id, area_nombre, entrada, salida, duracion, timestamp_salida, cerrado_por_admin)
    VALUES (?, 'SALIDA', ?, ?, ?, ?, ?, ?, 1)
  `, [telefono, s.area_id, s.area_nombre, s.entrada, h, dur, ahora.toISOString()]);

  await dbInstance.run('DELETE FROM whatsapp_sesiones_activas WHERE telefono = ?', [telefono]);

  if (msgAdmin) {
    await msgAdmin.reply(`✅ Sesión de *${nombreDe(telefono)}* cerrada.\n📍 ${area.nombre || s.area_nombre}\n⏱️ ${dur}`);
  }
  try {
    if (client) {
      await client.sendMessage(telefono, `🔴 Tu sesión en *${area.nombre || s.area_nombre}* fue cerrada por el administrador.\n🕐 Entrada: ${s.entrada}\n🕐 Salida: ${h}\n⏱️ ${dur}`);
    }
  } catch {}
  return { success: true };
}

// Reintenta client.initialize() con espera creciente entre intento e intento
// (5s, 10s, 20s... hasta un tope de 5 minutos), hasta 10 veces. Antes, la
// desconexión solo programaba UN reintento a los 5 segundos y ni siquiera
// esperaba su resultado (`client.initialize()` sin `await` dentro de un
// try/catch no captura un rechazo de la promesa, solo una excepción
// síncrona) — si ese único reintento fallaba (por ejemplo, por no tener
// internet en ese momento), quedaba como una "unhandled promise rejection"
// que en versiones recientes de Node.js tumba TODO el proceso del
// servidor (no solo el bot), afectando también SMD, Garantías y
// Metrología. `reconectando` evita que dos reintentos queden corriendo a
// la vez si "disconnected" se dispara varias veces seguidas.
async function reconectarBot() {
  if (reconectando) return;
  reconectando = true;
  const maxIntentos = 10;
  let delayMs = 5000;
  for (let intento = 1; intento <= maxIntentos; intento++) {
    await new Promise(r => setTimeout(r, delayMs));
    try {
      console.log(`🔄 Reintentando conexión de WhatsApp (intento ${intento}/${maxIntentos})...`);
      await client.initialize();
      console.log('✅ Reconexión de WhatsApp iniciada correctamente.');
      reconectando = false;
      return;
    } catch (e) {
      console.error(`⚠️ Falló el intento ${intento} de reconexión de WhatsApp:`, e.message);
      delayMs = Math.min(delayMs * 2, 5 * 60 * 1000);
    }
  }
  console.error(`❌ No se pudo reconectar WhatsApp tras ${maxIntentos} intentos. Revisa la conexión a internet o reinicia el servidor para volver a intentarlo.`);
  reconectando = false;
}

function resetDiario() {
  const horaActual = parseInt(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TIMEZONE }));
  if (horaActual === 0) {
    enviadosHoy.clear();
    flagResumenEnviadoHoy = false;
  }
}

async function revisarCron() {
  const ahora = new Date();
  const hora = parseInt(ahora.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TIMEZONE }));
  const min = parseInt(ahora.toLocaleString('en-US', { minute: 'numeric', timeZone: TIMEZONE }));
  const seg = parseInt(ahora.toLocaleString('en-US', { second: 'numeric', timeZone: TIMEZONE }));
  resetDiario();

  for (const rec of RECORDATORIOS) {
    const key = `${rec.hora}:${rec.minuto}`;
    if (hora === rec.hora && min === rec.minuto && seg < 10 && !enviadosHoy.has(key)) {
      enviadosHoy.add(key);
      if (dbInstance && client) {
        const sesionesActivas = await dbInstance.all('SELECT * FROM whatsapp_sesiones_activas');
        let c = 0;
        for (const s of sesionesActivas) {
          try { await client.sendMessage(s.telefono, rec.mensaje); c++; } catch {}
        }
        console.log(`🔔 Recordatorio WhatsApp ${key} → ${c} persona(s)`);
      }
    }
  }

  const rk = `${RESUMEN_HORA}:${RESUMEN_MINUTO}`;
  if (hora === RESUMEN_HORA && min === RESUMEN_MINUTO && seg < 10 && !enviadosHoy.has(rk) && !flagResumenEnviadoHoy) {
    enviadosHoy.add(rk);
    await enviarResumenAdmin();
  }

  await revisarAlertasCalidadPeriodicas();
}

async function iniciarBotWhatsApp(db) {
  dbInstance = db;
  console.log('🤖 Inicializando cliente de WhatsApp Web...');
  await recargarNumerosWhatsApp();

  try {
    client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });

    client.on('qr', qr => {
      console.log('\n📱 Escanea este código QR para WhatsApp Bot:');
      try {
        qrcode.generate(qr, { small: true });
      } catch (e) {
        console.log('QR Code:', qr);
      }
    });

    client.on('ready', () => {
      readyTime = Date.now();
      console.log('\n✅ Bot de WhatsApp listo y conectado!');
      // Se muestran los nombres (para confirmar de un vistazo que la
      // configuración es la esperada) pero nunca los números de teléfono,
      // para no dejarlos escritos en la consola ni en un log guardado.
      const autorizados = [...numerosCache.keys()];
      console.log(`👥 Autorizados (${autorizados.length}): ${autorizados.map(nombreDe).join(', ')}`);
      console.log(`👤 Admin(es) WhatsApp: ${numerosAdmin().map(nombreDe).join(', ') || '(ninguno configurado)'}\n`);
      setInterval(revisarCron, 60000);
    });

    client.on('disconnected', reason => {
      console.log('\n⚠️ WhatsApp desconectado:', reason);
      reconectarBot();
    });

    // A diferencia de "disconnected" (se cayó una sesión que sí estaba
    // autenticada), esto significa que la sesión guardada (LocalAuth) ya no
    // sirve — por ejemplo, si se cerró la sesión desde el celular, o
    // WhatsApp la invalidó. Reintentar initialize() automáticamente aquí no
    // sirve de nada porque el problema no es de conexión sino de
    // autenticación: hace falta que una persona vuelva a escanear el
    // código QR. Por eso solo se deja un registro claro en el log en vez de
    // reintentar en un ciclo que fallaría una y otra vez.
    client.on('auth_failure', msg => {
      console.error('\n❌ Falló la autenticación de WhatsApp (la sesión guardada ya no es válida):', msg);
      console.error('   Es necesario volver a escanear el código QR desde la consola del servidor.');
    });

    client.on('message', async msg => {
      if (!dbInstance) return;
      const tel = msg.from;
      const txtOrig = msg.body.trim();
      const txt = txtOrig.toLowerCase();
      const ahora = new Date();
      const h = horaStr(ahora);

      if (msg.fromMe) return;
      if (tel.endsWith('@g.us')) return;
      if (readyTime && (msg.timestamp * 1000 < (readyTime - IGNORE_OLD_MESSAGES_SECONDS * 1000))) return;

      const ok = numeroAutorizado(tel);
      console.log(`[WhatsApp ${h}] ${ok ? '✅' : '❌'} ${nombreDe(tel)} (${tel}) → "${txtOrig}"`);
      if (!ok) return;

      const sinPermiso = async () => { await msg.reply('⚠️ No tienes permiso para esa función. Escribe *ayuda* para ver qué puedes hacer.'); };

      // Admin commands
      if (txt === 'resumen') {
        if (!tienePermisoBot(tel, 'ver_resumen_asistencia')) { await sinPermiso(); return; }
        await msg.reply(await generarResumen());
        return;
      }
      if (txt.startsWith('cerrar ')) {
        if (!tienePermisoBot(tel, 'cerrar_sesiones')) { await sinPermiso(); return; }
        const p = txtOrig.split(' ');
        if (p.length >= 2) {
          let t = p[1].trim();
          if (!t.includes('@')) t += '@c.us';
          await cerrarSesionPorAdmin(t, msg);
          return;
        }
        await msg.reply('⚠️ Uso: cerrar 199939468558544@lid');
        return;
      }
      // Comandos de reportes de calidad bajo demanda (roadmap #2) — cada uno
      // responde directo a quien preguntó, sin afectar el envío automático
      // de las 5pm (ver el comentario arriba de comandoResumenDiario). Cada
      // uno pide su propio permiso (ver settings/permisosBot.js), así que
      // un número puede tener acceso a "diario" sin tener "mensual", etc.
      const comandosCalidad = [
        { prefijo: 'diario', exacto: true, permiso: 'calidad_diario', fn: () => comandoResumenDiario(msg) },
        { prefijo: 'quincenal', exacto: false, permiso: 'calidad_quincenal', fn: () => comandoResumenQuincenal(txtOrig, msg) },
        { prefijo: 'mensual', exacto: false, permiso: 'calidad_mensual', fn: () => comandoResumenMensual(txtOrig, msg) },
        { prefijo: 'garantias', exacto: false, permiso: 'calidad_garantias', fn: () => comandoGarantiasRouter(txtOrig, msg) },
      ];
      for (const c of comandosCalidad) {
        const coincide = c.exacto ? txt === c.prefijo : (txt === c.prefijo || txt.startsWith(c.prefijo + ' '));
        if (!coincide) continue;
        if (!tienePermisoBot(tel, c.permiso)) { await sinPermiso(); return; }
        try {
          await c.fn();
        } catch (e) {
          console.error(`⚠️ Error procesando comando "${txtOrig}":`, e.message);
          await msg.reply('⚠️ No se pudo generar ese reporte. Revisa el formato del comando (escribe *ayuda* para ver la lista).');
        }
        return;
      }

      // Standard commands
      if (['hola', 'areas', 'ayuda', 'menu', 'inicio'].includes(txt)) {
        await msg.reply(construirMenuPara(tel));
        return;
      }

      // El registro de entrada/salida (estado/salir/número de área) es su
      // propio permiso ('registro_entrada') — antes lo podía usar cualquier
      // número autorizado, ahora depende de la casilla de cada número. Para
      // estos tres si se avisa explícitamente que no hay permiso (en vez de
      // quedarse callado) porque son intentos claros de usar el bot, no
      // texto suelto — silencio ahí se sentiría como que el bot está roto.
      const esIntentoDeRegistro = txt === 'estado' || txt === 'salir' || !isNaN(parseInt(txt, 10));
      if (esIntentoDeRegistro && !tienePermisoBot(tel, 'registro_entrada')) { await sinPermiso(); return; }

      if (txt === 'estado') {
        const s = await dbInstance.get('SELECT * FROM whatsapp_sesiones_activas WHERE telefono = ?', [tel]);
        await msg.reply(msgEstado(s));
        return;
      }

      if (txt === 'salir') {
        const s = await dbInstance.get('SELECT * FROM whatsapp_sesiones_activas WHERE telefono = ?', [tel]);
        if (!s) {
          await msg.reply('⚠️ No tienes sesión activa.\nEscribe *"areas"*.');
          return;
        }
        const area = AREAS.find(a => a.id === s.area_id) || { nombre: s.area_nombre };
        const dur = duracion(new Date(s.entrada_raw), ahora);

        await dbInstance.run(`
          INSERT INTO whatsapp_registros (telefono, tipo, area_id, area_nombre, entrada, salida, duracion, timestamp_salida)
          VALUES (?, 'SALIDA', ?, ?, ?, ?, ?, ?)
        `, [tel, s.area_id, s.area_nombre, s.entrada, h, dur, ahora.toISOString()]);

        await dbInstance.run('DELETE FROM whatsapp_sesiones_activas WHERE telefono = ?', [tel]);

        await msg.reply(msgSalida(tel, area, s.entrada, h, dur));
        return;
      }

      const areaId = parseInt(txt);
      if (!isNaN(areaId)) {
        const area = AREAS.find(a => a.id === areaId);
        if (!area) {
          await msg.reply('❌ Área no válida. Escribe *"areas"*.');
          return;
        }
        const act = await dbInstance.get('SELECT * FROM whatsapp_sesiones_activas WHERE telefono = ?', [tel]);
        if (act) {
          await msg.reply(`⚠️ Ya estás en *${act.area_nombre}*. Escribe *"salir"* primero.`);
          return;
        }

        await dbInstance.run(`
          INSERT INTO whatsapp_sesiones_activas (telefono, area_id, area_nombre, entrada, entrada_raw)
          VALUES (?, ?, ?, ?, ?)
        `, [tel, area.id, area.nombre, h, ahora.toISOString()]);

        await dbInstance.run(`
          INSERT INTO whatsapp_registros (telefono, tipo, area_id, area_nombre, entrada, timestamp_entrada)
          VALUES (?, 'ENTRADA', ?, ?, ?, ?)
        `, [tel, area.id, area.nombre, h, ahora.toISOString()]);

        await msg.reply(msgEntrada(area, h));
        return;
      }
    });

    // client.initialize() devuelve una promesa: si se llama sin "await" (como
    // antes) y esa promesa se rechaza (por ejemplo, Puppeteer no pudo abrir
    // Chrome), el catch de aquí abajo NUNCA se entera porque solo atrapa
    // errores síncronos — el rechazo queda "sin manejar" y en versiones
    // recientes de Node.js eso tumba TODO el proceso del servidor (no solo
    // el bot). Con .catch() se atrapa ese rechazo y se registra el mismo
    // mensaje de siempre, dejando el servidor funcionando sin el bot.
    client.initialize().catch(e => {
      console.error('⚠️ No se pudo inicializar WhatsApp Bot (continuando sin bot activo):', e.message);
    });
  } catch (e) {
    console.error('⚠️ No se pudo inicializar WhatsApp Bot (continuando sin bot activo):', e.message);
  }
}

module.exports = {
  iniciarBotWhatsApp,
  generarResumen,
  enviarResumenAdmin,
  cerrarSesionPorAdmin,
  nombreDe,
  recargarNumerosWhatsApp,
  enviarAlerta,
  esAdmin,
  enviarReporteInspeccionMetrologia,
};
