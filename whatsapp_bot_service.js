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
const garantiasData = require('./data/garantias'); // modo consulta (Roadmap Bot WhatsApp, puntos 10-11)
const isoData = require('./data/iso2859'); // modo consulta — "últimos muestreos..." (comandos fijos que pidió Julio)
// Modo consulta LIBRE (Roadmap Bot WhatsApp, punto 8 — segunda revisión,
// 28/08): Julio pidió poder preguntarle "lo que sea" sobre la base, no solo
// los tipos fijos de arriba — ver interpretarYEjecutarConsultaLibre más
// abajo y data/consultaLibreIA.js para todas las protecciones (solo
// lectura, lista blanca de tablas, sin usuarios/contraseñas, límite de
// filas, etc.).
const consultaLibreIA = require('./data/consultaLibreIA');
const { generarPdfResumenCalidad } = require('./utils/pdfResumenCalidad');
const { generarPdfReporteGarantias } = require('./utils/pdfReporteGarantias');
// Comando "reportes" (menú por número, 31/08): módulo de Metrología aparte
// del resumen general — antes no existía ningún reporte periódico de
// Metrología, solo el de una inspección individual (más abajo). Ver
// utils/pdfReporteMetrologia.js y data/calidad.js#obtenerMetrologiaReportePeriodo.
const { generarPdfReporteMetrologia } = require('./utils/pdfReporteMetrologia');
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
// Modo consulta con IA (Roadmap Bot WhatsApp, punto 8 — revisado): Julio
// pidió que el bot entienda preguntas parecidas, no solo frases exactas.
// Se usa Gemini (Google) — decisión de Julio, empezando con el plan
// gratis — vía el SDK oficial @google/genai. El cliente solo se instancia
// si hay una llave configurada (ver settings/paths.js) — si Julio todavía
// no la puso, el require no falla (el paquete sí está instalado, vía
// "npm install"), solo queda sin usarse y el modo consulta sigue
// funcionando con las reglas de siempre, sin ningún cambio de
// comportamiento.
const { GoogleGenAI, FunctionCallingConfigMode, Type, ApiError } = require('@google/genai');
const { GEMINI_API_KEY, MODELO_IA_MODO_CONSULTA } = require('./settings/paths');

const {
  AREAS, TIMEZONE,
  IGNORE_OLD_MESSAGES_SECONDS, RECORDATORIOS,
  RESUMEN_HORA, RESUMEN_MINUTO, MENSAJES_SALIDA,
  RESUMEN_CALIDAD_HORA, RESUMEN_CALIDAD_MINUTO,
} = config;

// null si GEMINI_API_KEY no está configurada en el .env — todo el resto
// del código revisa "if (geminiClient)" antes de usarlo, nunca asume que
// existe.
const geminiClient = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
if (!geminiClient) {
  console.log('ℹ️ Modo consulta del bot: GEMINI_API_KEY no configurada — usando solo reglas/palabras clave (sin IA).');
}

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

// ======================== MODO CONSULTA (Roadmap Bot WhatsApp, puntos 3-4) ========================
// Mapa en memoria con los números que están, ahora mismo, "dentro" del modo
// consulta → timestamp (ms) de su última actividad — mismo patrón en memoria
// que numerosCache de arriba, pero con el dato extra del reloj de
// inactividad que pide el punto 7 del roadmap ("diseñar el almacenamiento
// con expiración"). Implementado hasta ahora: activación (punto 3) y cierre
// automático a los 5 minutos de inactividad (punto 4, este cambio). A
// propósito todavía NO hace nada más — el cierre manual con "salir" (punto 5,
// que primero necesita resolver el choque con el "salir" que ya usa el
// registro de entrada/salida — punto 6, marcado Crítico y sin decidir
// todavía) y la interpretación de la pregunta (puntos 8 en adelante) quedan
// pendientes como sus propios puntos del roadmap. Mientras tanto, entrar en
// modo consulta no bloquea ni cambia el comportamiento de ningún otro
// comando — es solo un interruptor guardado, con su reloj de inactividad,
// pero sin efecto sobre las respuestas todavía.
let numerosEnModoConsulta = new Map(); // telefono -> timestamp (ms) de la última actividad en modo consulta
const MODO_CONSULTA_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos (Roadmap Bot WhatsApp, punto 4)

function activarModoConsulta(telefono) {
  numerosEnModoConsulta.set(telefono, Date.now());
}

// Cierre automático del modo consulta por inactividad (punto 4). Se revisa
// desde revisarCron() cada 60s (ver más abajo) en vez de tener un
// temporizador aparte por número — con un timeout de 5 minutos, un margen de
// hasta 60s para detectarlo no se nota, y así se reutiliza el mismo cron que
// ya corre para recordatorios y resumen diario, en vez de sumar otro
// setInterval más al proceso.
async function revisarModoConsultaExpirado() {
  const ahoraMs = Date.now();
  for (const [telefono, ultimaActividad] of numerosEnModoConsulta) {
    if (ahoraMs - ultimaActividad > MODO_CONSULTA_TIMEOUT_MS) {
      numerosEnModoConsulta.delete(telefono);
      try {
        await client.sendMessage(telefono, '🔒 Tu *modo consulta* se cerró automáticamente por 5 minutos de inactividad.\n\nEscribe *consulta* cuando quieras volver a activarlo.');
      } catch {}
    }
  }
}

// ======================== COMANDO "reportes" (menú por número, 31/08) ========================
// Julio pidió un asistente de PDF por número, en vez de comandos de una
// sola línea con argumentos: "reportes" -> elige módulo (Garantías/
// Metrología/Muestreos) -> elige tipo (Mensual/Quincenal/General) -> si es
// Mensual/Quincenal, elige el periodo (actual, o uno de una lista numerada
// de los últimos anteriores) -> genera y manda el PDF. Reusa los reportes
// que ya existían (Garantías: generarPdfReporteGarantias; Muestreos: se
// reusa el Resumen de Calidad completo tal cual, decisión de Julio, aunque
// también trae una sección de Garantías/Metrología) y agrega el de
// Metrología, que no existía como reporte periódico.
//
// A diferencia de modo consulta (conversación libre, con cierre activo por
// inactividad avisado cada 60s vía revisarModoConsultaExpirado), este es un
// asistente corto de pocos pasos — se cierra "en silencio" si pasan 5
// minutos sin responder (sin mandar un aviso aparte, a propósito, para no
// sumar otro barrido periódico por algo tan corto): si alguien vuelve
// después de expirado y escribe un número suelto, simplemente cae de
// vuelta al comportamiento de siempre para ese número (ej. registro de
// entrada/salida de área), que es el correcto.
let numerosEnModoReportes = new Map(); // telefono -> { paso, modulo, tipo, ultimaActividad }
const REPORTES_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos, mismo criterio que modo consulta

const REPORTES_MODULOS = [
  { clave: 'garantias', etiqueta: 'Garantías', emoji: '🛡️' },
  { clave: 'metrologia', etiqueta: 'Metrología', emoji: '📏' },
  { clave: 'muestreos', etiqueta: 'Muestreos', emoji: '🧪' },
];
const REPORTES_TIPOS = [
  { clave: 'mensual', etiqueta: 'Mensual' },
  { clave: 'quincenal', etiqueta: 'Quincenal' },
  { clave: 'general', etiqueta: 'General (histórico completo)' },
];
// Cuántos meses/quincenas anteriores ofrecer en la lista numerada del
// último paso — 6 es un primer valor razonable (medio año hacia atrás);
// fácil de subir si Julio necesita ver más atrás.
const REPORTES_CANTIDAD_ANTERIORES = 6;

function menuReportesModulos() {
  return '📊 *Reportes disponibles:*\n\n' +
    REPORTES_MODULOS.map((m, i) => `${i + 1}. ${m.etiqueta}`).join('\n') +
    '\n\n0. Cancelar\n\nResponde con el número.';
}
function menuReportesTipos(modulo) {
  const m = REPORTES_MODULOS.find(x => x.clave === modulo);
  return `${m.emoji} *${m.etiqueta} — ¿qué tipo de reporte?*\n\n` +
    REPORTES_TIPOS.map((t, i) => `${i + 1}. ${t.etiqueta}`).join('\n') +
    '\n\n0. Cancelar';
}
// tipo: 'mensual' o 'quincenal'. etiquetaActual ya viene armada (ej. "Agosto
// 2026" o "16-fin de agosto 2026") para no repetir el cálculo de fechas acá.
function menuReportesPeriodo(tipo, etiquetaActual) {
  const sustantivo = tipo === 'mensual' ? 'mes' : 'quincena';
  return `📅 *¿Cuál periodo?*\n\n` +
    `1. ${sustantivo === 'mes' ? 'Mes actual' : 'Quincena actual'} (${etiquetaActual})\n` +
    `2. ${sustantivo === 'mes' ? 'Meses anteriores' : 'Quincenas anteriores'}\n\n` +
    '0. Cancelar';
}
function menuReportesAnteriores(opciones) {
  return '📅 *¿Cuál de estos?*\n\n' +
    opciones.map((o, i) => `${i + 1}. ${o.etiqueta}`).join('\n') +
    '\n\n0. Cancelar';
}

// Últimos N meses YA CERRADOS (sin contar el actual), del más reciente al
// más antiguo — para la lista numerada de "meses anteriores". Encadena
// mesMasRecienteCerrado() hacia atrás en vez de repetir su lógica.
function ultimosNMesesCerrados(ahora, n) {
  const lista = [];
  let cursor = mesMasRecienteCerrado(ahora);
  for (let i = 0; i < n; i++) {
    lista.push(cursor);
    const anterior = new Date(cursor.anio, cursor.mes - 1, 1);
    cursor = { anio: anterior.getFullYear(), mes: anterior.getMonth() };
  }
  return lista;
}
// Mismo criterio que ultimosNMesesCerrados pero para quincenas (cual: 1 =
// 1-15, 2 = 16-fin de mes).
function ultimasNQuincenasCerradas(ahora, n) {
  const lista = [];
  let cursor = quincenaMasRecienteCerrada(ahora);
  for (let i = 0; i < n; i++) {
    lista.push(cursor);
    if (cursor.cual === 2) {
      cursor = { anio: cursor.anio, mes: cursor.mes, cual: 1 };
    } else {
      const anterior = new Date(cursor.anio, cursor.mes - 1, 1);
      cursor = { anio: anterior.getFullYear(), mes: anterior.getMonth(), cual: 2 };
    }
  }
  return lista;
}

// Genera y manda (o cae a texto si el PDF falla) el reporte del módulo/tipo/
// periodo ya resueltos — el punto de salida del asistente, sin importar por
// cuál de los 3 módulos ni cuál periodo se llegó ahí.
async function generarYResponderReporte(msg, modulo, etiquetaPeriodo, limites) {
  if (modulo === 'garantias') {
    const g = await calidadData.obtenerGarantiasReportePeriodo(limites);
    await responderReporteGarantiasPDF(msg, etiquetaPeriodo, g);
    return;
  }
  if (modulo === 'metrologia') {
    const m = await calidadData.obtenerMetrologiaReportePeriodo(limites);
    await responderReporteMetrologiaPDF(msg, etiquetaPeriodo, m);
    return;
  }
  // 'muestreos' reusa el Resumen de Calidad completo tal cual (decisión de
  // Julio) — sí trae también una sección de Garantías/Metrología, no es
  // exclusivo de muestreos, pero evita duplicar un reporte nuevo solo para
  // separar esas dos secciones que ya tienen su propio botón en el menú.
  const r = await calidadData.obtenerResumenPeriodo(limites);
  await responderResumenPDF(msg, etiquetaPeriodo, r);
}

// Maneja UN mensaje de alguien que ya está dentro del asistente "reportes"
// (numerosEnModoReportes.has(tel) es true antes de llamar esto). Devuelve
// siempre después de responder algo — el llamador (el manejador de
// mensajes) hace `return` apenas esta función termina, para que ningún otro
// bloque de abajo (modo consulta, comandos fijos, registro de área) llegue
// a ver este mensaje.
async function manejarPasoReportes(tel, txtOrig, msg) {
  const estado = numerosEnModoReportes.get(tel);

  if (normalizarTexto(txtOrig) === 'cancelar' || txtOrig.trim() === '0') {
    numerosEnModoReportes.delete(tel);
    await msg.reply('❌ Reporte cancelado.\n\nEscribe *reportes* cuando quieras volver a pedir uno.');
    return;
  }

  const opcion = parseInt(txtOrig.trim(), 10);
  const invalida = () => msg.reply('⚠️ No entendí. Responde solo con el número de la lista (o 0 para cancelar).');

  if (estado.paso === 'modulo') {
    if (isNaN(opcion) || opcion < 1 || opcion > REPORTES_MODULOS.length) { await invalida(); return; }
    estado.modulo = REPORTES_MODULOS[opcion - 1].clave;
    estado.paso = 'tipo';
    estado.ultimaActividad = Date.now();
    await msg.reply(menuReportesTipos(estado.modulo));
    return;
  }

  if (estado.paso === 'tipo') {
    if (isNaN(opcion) || opcion < 1 || opcion > REPORTES_TIPOS.length) { await invalida(); return; }
    const tipo = REPORTES_TIPOS[opcion - 1].clave;
    estado.ultimaActividad = Date.now();

    // "General" no tiene periodo que elegir — genera directo (confirmado
    // con Julio) y cierra el asistente.
    if (tipo === 'general') {
      numerosEnModoReportes.delete(tel);
      await msg.reply('⏳ Generando el reporte, un momento…');
      const limites = limitesPeriodo(new Date(2000, 0, 1), new Date());
      await generarYResponderReporte(msg, estado.modulo, 'Histórico completo', limites);
      return;
    }

    estado.tipo = tipo;
    estado.paso = 'periodo';
    const ahora = new Date();
    const etiquetaActual = tipo === 'mensual'
      ? etiquetaMes(ahora.getFullYear(), ahora.getMonth())
      : (() => { const q = ahora.getDate() >= 16 ? 2 : 1; return etiquetaQuincena(ahora.getFullYear(), ahora.getMonth(), q); })();
    await msg.reply(menuReportesPeriodo(tipo, etiquetaActual));
    return;
  }

  if (estado.paso === 'periodo') {
    if (isNaN(opcion) || opcion < 1 || opcion > 2) { await invalida(); return; }
    estado.ultimaActividad = Date.now();

    if (opcion === 1) {
      // Periodo actual (mes o quincena en curso, todavía sin cerrar).
      numerosEnModoReportes.delete(tel);
      await msg.reply('⏳ Generando el reporte, un momento…');
      const ahora = new Date();
      let limites, etiqueta;
      if (estado.tipo === 'mensual') {
        limites = limitesPeriodo(new Date(ahora.getFullYear(), ahora.getMonth(), 1), ahora);
        etiqueta = etiquetaMes(ahora.getFullYear(), ahora.getMonth());
      } else {
        const cual = ahora.getDate() >= 16 ? 2 : 1;
        const { desde } = rangoQuincena(ahora.getFullYear(), ahora.getMonth(), cual);
        limites = limitesPeriodo(desde, ahora);
        etiqueta = etiquetaQuincena(ahora.getFullYear(), ahora.getMonth(), cual);
      }
      await generarYResponderReporte(msg, estado.modulo, etiqueta, limites);
      return;
    }

    // Opción 2: "anteriores" — arma la lista numerada de los últimos
    // REPORTES_CANTIDAD_ANTERIORES ya cerrados y pasa al último paso.
    const ahora = new Date();
    const opciones = estado.tipo === 'mensual'
      ? ultimosNMesesCerrados(ahora, REPORTES_CANTIDAD_ANTERIORES).map(p => ({ ...p, etiqueta: etiquetaMes(p.anio, p.mes) }))
      : ultimasNQuincenasCerradas(ahora, REPORTES_CANTIDAD_ANTERIORES).map(p => ({ ...p, etiqueta: etiquetaQuincena(p.anio, p.mes, p.cual) }));
    estado.opcionesAnteriores = opciones;
    estado.paso = 'cual_anterior';
    await msg.reply(menuReportesAnteriores(opciones));
    return;
  }

  if (estado.paso === 'cual_anterior') {
    const opciones = estado.opcionesAnteriores || [];
    if (isNaN(opcion) || opcion < 1 || opcion > opciones.length) { await invalida(); return; }
    const elegido = opciones[opcion - 1];
    numerosEnModoReportes.delete(tel);
    await msg.reply('⏳ Generando el reporte, un momento…');
    let limites, etiqueta;
    if (estado.tipo === 'mensual') {
      const { desde, hasta } = rangoMes(elegido.anio, elegido.mes);
      limites = limitesPeriodo(desde, hasta);
      etiqueta = etiquetaMes(elegido.anio, elegido.mes);
    } else {
      const { desde, hasta } = rangoQuincena(elegido.anio, elegido.mes, elegido.cual);
      limites = limitesPeriodo(desde, hasta);
      etiqueta = etiquetaQuincena(elegido.anio, elegido.mes, elegido.cual);
    }
    await generarYResponderReporte(msg, estado.modulo, etiqueta, limites);
    return;
  }
}

// Punto 17: a partir de cuántos registros la respuesta del modo consulta se
// manda como PDF en vez de texto plano. A diferencia de los otros reportes
// del bot (diario/quincenal/mensual — ver enviarResumenPDF más abajo), que
// SIEMPRE intentan PDF primero y solo caen a texto si PDFKit falla, aquí se
// decide ANTES de generar nada, según el tamaño real de la respuesta: una
// consulta puntual de pocas filas se siente más natural como texto directo
// en el chat, mientras que un listado largo es más legible como PDF que
// como un bloque de texto interminable. Se fijó en 10 porque coincide con
// el default de N cuando la persona no especifica cantidad (punto 1 de la
// planeación) — es decir, una pregunta sin número de por medio ("últimos de
// SUP/1077/RS/MUL") siempre cae en texto, y solo pasa a PDF si de verdad se
// pidió (o el resultado da) más de eso. Aplica igual para el punto 10
// (últimos/top N) y el 11 (porcentaje por causal). Todavía sin usar en
// ningún lado — queda lista para cuando se conecte la interpretación de la
// pregunta (puntos 8-9) con estas respuestas.
const UMBRAL_FILAS_PDF_MODO_CONSULTA = 10;
function debeEnviarseComoPdf(cantidadFilas) {
  return cantidadFilas > UMBRAL_FILAS_PDF_MODO_CONSULTA;
}

// ======================== MODO CONSULTA — INTERPRETACIÓN DE LA PREGUNTA (punto 9) ========================
// Decisión del punto 8: reglas/palabras clave, no modelo de lenguaje. Dada
// la frase que escribió la persona, decide cuál de los dos tipos del punto
// 1 es (o null si no encaja en ninguno — cae en el mensaje de "no entendí"
// del punto 2), y extrae la referencia y, para el tipo "últimos/top N", la
// cantidad pedida.
//
// LIMITACIÓN CONOCIDA, a propósito documentada como V1 y no como diseño
// cerrado: las referencias no tienen un formato fijo (hay desde
// "SUP/1077/RS/MUL" hasta cosas simples como "123" o "Referencia prueba" —
// ver la tabla Referencias), así que no se puede reconocer con una regla
// genérica. Se asume el mismo patrón de los ejemplos del punto 1: la
// referencia es lo que queda después de la última palabra "de" de la
// frase. Si la frase no tiene "de", no se puede identificar la referencia y
// se trata como no reconocida. Esto es justo lo que hay que poner a prueba
// con casos reales en los puntos 18-22 (pruebas), todavía pendientes.
const CANTIDAD_DEFAULT_MODO_CONSULTA = 10; // punto 1 de la planeación

// Quita tildes/diéresis (incluida la "ñ", que en NFD se separa en "n" + "~")
// para no tener que escribir cada palabra clave dos veces (con y sin
// acento) — "último"/"ultimo", "garantías"/"garantias", "dañan"/"danan".
function normalizarTexto(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ======================== SEÑAL DE "ESTO NECESITA EL MODO LIBRE" ========================
// Hallazgo real con Julio (28/08, mismo día que se construyó el modo
// libre): preguntó "qué referencias se les hizo muestreo la semana pasada" y
// "cuántos muestreos se han hecho en agosto" — dos preguntas válidas y
// distintas, pero la IA de tipos fijos (interpretarConsultaConIA), a pesar
// de tener instrucciones explícitas de admitir cuando no sabe, forzó las
// DOS hacia el tipo "muestreos_realizados" (sin ningún filtro) — Julio
// recibió la MISMA respuesta genérica las tres veces que preguntó cosas
// distintas ese día. Ajustar el texto de las instrucciones (ver
// DECLARACION_EXTRAER_PARAMETROS_CONSULTA e INSTRUCCION_SISTEMA_MODO_CONSULTA
// más abajo) ayuda, pero no basta con confiar en que el modelo "se acuerde"
// de decir no_reconocido cada vez — así que se agrega esta señal barata
// (sin IA, no cuesta nada) para preguntas que casi siempre necesitan un
// filtro de fecha/periodo, un conteo, o una lista de valores distintos —
// justo lo que los tipos fijos NO saben hacer. Si aparece alguna de estas
// palabras, el manejador de mensajes se salta DIRECTO al modo libre (SQL),
// sin intentarlo primero con la IA de tipos fijos (la que se equivocó en
// el caso real). Ojo: "ano"/"anos" (sin tildes) es cómo queda "año"/"años"
// después de normalizarTexto (le quita la tilde de la ñ) — no es la palabra
// vulgar, es una coincidencia del proceso de normalización.
const SENALES_REQUIERE_MODO_LIBRE = /\b(semana|semanas|mes|meses|ano|anos|ayer|hoy|trimestre|quincena|periodo|periodos|entre|desde|hasta|cuantos?|cuantas?|cuanto|promedio|distinta|distintas|diferente|diferentes|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/;
function necesitaModoLibre(fraseOriginal) {
  return SENALES_REQUIERE_MODO_LIBRE.test(normalizarTexto(fraseOriginal));
}

// Comandos fijos que pidió Julio porque escribir una referencia le pareció
// muy largo — a diferencia de los tipos A/B (que sí piden una referencia),
// estos son frases EXACTAS, sin ningún dato que extraer: siempre traen la
// cantidad por defecto (10) y ninguno pide referencia. "muestreos
// rechazados" filtra por la decisión del muestreo (m.decision = 'Rechazado'
// en iso_muestreos — ver consultarUltimosMuestreos en data/iso2859.js), no
// por el estado del lote completo.
const COMANDOS_FIJOS_MODO_CONSULTA = {
  'ultimas garantias ingresadas': 'garantias_recientes',
  'ultimos muestreos realizados': 'muestreos_realizados',
  'ultimos muestreos rechazados': 'muestreos_rechazados',
};

// Un solo texto para "qué puede preguntar" — lo usan tanto la confirmación
// de activación como el mensaje de "no entendí", para que las dos cosas no
// se desactualicen por separado según se vayan agregando comandos.
const MENU_MODO_CONSULTA =
  'Puedo ayudarte con:\n' +
  '• Últimas garantías ingresadas\n' +
  '• Últimos muestreos realizados\n' +
  '• Últimos muestreos rechazados\n' +
  '• Últimos o top N registros de una referencia (ej. últimos 5 de SUP/1077/RS/MUL)\n' +
  '• Porcentaje por causal de una referencia (ej. causales de SUP/1077/RS/MUL)\n' +
  '• Top N referencias con más garantías (ej. las 5 referencias con más garantías)\n' +
  '• Cualquier otra pregunta sobre calidad, garantías o asistencia (lo intento aunque no esté en esta lista)';
const MENSAJE_NO_ENTENDI_MODO_CONSULTA =
  `No entendí esa pregunta. ${MENU_MODO_CONSULTA}\n\nEscribe *salir consulta* si quieres cerrar el modo consulta.`;

function extraerParametrosConsulta(fraseOriginal) {
  const frase = normalizarTexto(fraseOriginal.trim());
  if (!frase) return null;

  if (COMANDOS_FIJOS_MODO_CONSULTA[frase]) {
    return { tipo: COMANDOS_FIJOS_MODO_CONSULTA[frase], referencia: null, cantidad: CANTIDAD_DEFAULT_MODO_CONSULTA, orden: 'reciente' };
  }

  // "orden" (hallazgo real con Julio, 28/08 — ver interpretarConsultaConIA
  // más abajo, donde está el detalle completo): por defecto se traen los
  // más RECIENTES (como siempre); si la frase pide el/los "primero(s)" o
  // "más antiguo(s)", se invierte a 'antiguo'. Se detecta ANTES de decidir
  // esUltimos para que "primeros 5 de X" también dispare el tipo A, igual
  // que "últimos 5 de X".
  const esAntiguo = /\b(primero|primeros|antiguo|antiguos|inicial|iniciales)\b/.test(frase);

  // Tipo B primero: "causal"/"causales"/"porcentaje", o el giro "por qué se
  // dañan/dañó" (normalizado, "danan"/"dano" ya cubre daña/dañan/dañado/
  // dañó). Se revisa antes que el tipo A porque frases como "porcentaje de
  // causales de X" tienen la palabra "de" dos veces y hay que asegurarse de
  // no tratarlas como el tipo A por error.
  const esCausal = /\b(causal|causales|porcentaje)\b/.test(frase) || /\bdan(a|o|ada|ado)/.test(frase);
  const esUltimos = !esCausal && /\b(ultimo|ultimos|top|registro|registros|garantia|garantias|muestrame|lista|listado|primero|primeros|antiguo|antiguos)\b/.test(frase);
  if (!esCausal && !esUltimos) return null;

  // Cantidad: un número junto a "top"/"último(s)" — si no aparece, se usa
  // el default (10, punto 1). Se busca en el texto normalizado, ANTES de
  // tocar la referencia, para no confundir un número que en realidad es
  // parte del código de referencia (ej. el "1017" de "1017C/AMAM/MULTI").
  let cantidad = CANTIDAD_DEFAULT_MODO_CONSULTA;
  const matchCantidad = frase.match(/\b(?:top|ultimos?|primeros?)\s+(\d{1,4})\b/);
  if (matchCantidad) cantidad = parseInt(matchCantidad[1], 10);

  // Referencia: lo que queda después de la última " de " de la frase
  // ORIGINAL (no la normalizada/minúscula, para conservar mayúsculas y
  // tildes tal como las escribió la persona — la comparación contra la
  // base ya es insensible a mayúsculas, ver consultarUltimosGarantias
  // PorReferencia / consultarPorcentajeCausalPorReferencia). Se recorta
  // puntuación de cierre (?, !, ., ,) que a veces queda pegada al final.
  let idxCorte = frase.lastIndexOf(' de ');
  let longitudCorte = 4; // ' de '.length
  if (idxCorte === -1) {
    // Fallback para frases sin " de " (ej. "por qué se dañan las
    // SUP/0111/Az/Mul", uno de los ejemplos ya documentados del punto 1) —
    // se prueba " las "/" los " antes de rendirse.
    const idxLas = frase.lastIndexOf(' las ');
    const idxLos = frase.lastIndexOf(' los ');
    idxCorte = Math.max(idxLas, idxLos);
    longitudCorte = 5; // ' las '.length === ' los '.length
  }
  if (idxCorte === -1) return null;
  const referencia = fraseOriginal.trim().slice(idxCorte + longitudCorte).trim().replace(/[?¿!¡.,]+$/g, '');
  if (!referencia) return null;

  return { tipo: esCausal ? 'causal' : 'ultimos', referencia, cantidad, orden: esAntiguo ? 'antiguo' : 'reciente' };
}

// ======================== MODO CONSULTA — INTERPRETACIÓN CON IA (punto 8, revisado) ========================
// Julio: "no me gustaría que las frases las pre escogiéramos acá... más
// como una IA que como un bot". Esta función es el reemplazo/complemento de
// extraerParametrosConsulta cuando las reglas de arriba no reconocen la
// frase — NO reemplaza las reglas, se usa como respaldo (ver el switch más
// abajo, donde primero se intenta extraerParametrosConsulta y solo si
// devuelve null se llama a esta función). Esto es a propósito, no solo por
// velocidad: mantiene en $0 y con respuesta instantánea todo lo que ya
// reconocían las reglas (los 3 comandos fijos y las preguntas por
// referencia con "de"/"las"/"los"), y solo gasta una llamada a la IA
// (con su costo y latencia) cuando de verdad hace falta — una pregunta
// escrita distinto a como se esperaba.
//
// Devuelve exactamente la misma forma que extraerParametrosConsulta
// ({ tipo, referencia, cantidad } o null), así que TODO lo que viene
// después en el switch (las consultas a la base y los formateadores de
// respuesta) no tuvo que cambiar ni una línea.
const DECLARACION_EXTRAER_PARAMETROS_CONSULTA = {
  name: 'extraer_parametros_consulta',
  description:
    'Identifica qué está pidiendo la persona, a partir de su pregunta en lenguaje natural (escrita por WhatsApp, en español, puede tener errores de tipeo o forma coloquial), y en qué consulta de garantías o muestreos de calidad se traduce.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      tipo: {
        type: Type.STRING,
        enum: ['ultimos', 'causal', 'garantias_recientes', 'top_referencias_garantias', 'muestreos_realizados', 'muestreos_rechazados', 'no_reconocido'],
        description:
          'IMPORTANTE, léelo antes de elegir: cada tipo de abajo cubre EXACTAMENTE lo que dice su descripción, ni una gota más — es una lista fija de consultas, SIN ningún filtro de fecha o periodo (nada de "esta semana", "el mes pasado", "en agosto", "ayer", "este año", "entre tal fecha y tal otra"), SIN contar/sumar/promediar/comparar, y SIN listar valores distintos de una columna (ej. "qué referencias..."). ' +
          'Si la pregunta agrega CUALQUIERA de esas cosas, usa "no_reconocido" — AUNQUE la pregunta mencione palabras como "garantía" o "muestreo" que suenen parecidas a uno de los tipos de abajo. Es mucho mejor decir honestamente "no_reconocido" (hay otro sistema, más flexible, que sí puede responder preguntas así) que forzar uno de los tipos fijos cuando no calza exactamente — responder con el tipo equivocado es peor que admitir que no sabes, porque le da a la persona una respuesta que no tiene nada que ver con lo que preguntó. ' +
          'Ejemplos que NO son ninguno de los tipos de abajo (usa "no_reconocido"): "qué referencias se les hizo muestreo la semana pasada" (filtra por periodo Y lista valores distintos), "cuántos muestreos se han hecho en agosto" (filtra por periodo Y cuenta), "cuántas garantías hay este mes" (filtra por periodo Y cuenta), "compara las garantías de esta semana con la pasada" (comparación). ' +
          '"ultimos": últimos/top N registros de garantías de UNA referencia específica, SIN filtro de fecha (necesita "referencia"). ' +
          '"causal": porcentaje de causales/motivos de garantía de UNA referencia específica, del histórico completo sin filtro de fecha (necesita "referencia"). ' +
          '"garantias_recientes": últimas N garantías ingresadas, SIN filtrar por referencia NI por fecha/periodo (de todo el negocio, las más recientes nada más). ' +
          '"top_referencias_garantias": las N referencias/productos con MÁS garantías en el histórico completo, contando TODAS las garantías agrupadas por referencia, SIN filtro de fecha (NO necesita "referencia" — es a través de todo el negocio). Usar esto para preguntas como "cuáles son las referencias con más garantías", "qué productos tienen más reclamos", "top 5 de garantías más frecuentes" (cuando se refiere a qué PRODUCTOS se repiten más, no a causales, y sin pedir un periodo específico). ' +
          '"muestreos_realizados": los últimos N muestreos de control de calidad ISO 2859-1 realizados (cualquier resultado), SIN ningún filtro de fecha/periodo ni agrupación — es literalmente "los N más recientes, tal cual, de todos los tiempos". ' +
          '"muestreos_rechazados": igual que "muestreos_realizados" pero solo los que salieron rechazados — mismas restricciones (sin fecha, sin agrupar). ' +
          '"no_reconocido": la pregunta no encaja EXACTAMENTE en ninguna de las anteriores (incluye cualquier filtro de fecha/periodo, conteo, agrupación, comparación, o cualquier otra cosa no tiene que ver con garantías/muestreos de calidad).',
      },
      referencia: {
        type: Type.STRING,
        description:
          'Código de referencia del producto mencionado (ej. "SUP/1077/RS/MUL", "1017C/AMAM/MULTI"), tal como lo escribió la persona. Cadena vacía "" si el tipo no necesita referencia, o si no se mencionó ninguna.',
      },
      cantidad: {
        type: Type.INTEGER,
        description: 'Cantidad de registros pedida (ej. "últimos 5" -> 5, "top 20" -> 20). 0 si la persona no especificó ninguna cantidad (se usará un valor por defecto).',
      },
      orden: {
        type: Type.STRING,
        enum: ['reciente', 'antiguo'],
        description:
          '"reciente" (usar esto por defecto) si pide los ÚLTIMOS / más recientes / lo más nuevo. ' +
          '"antiguo" si pide el/los PRIMERO(S), lo más viejo/antiguo, o el inicio de una lista (ej. "cuál fue el primer muestreo que se hizo", "el más antiguo").',
      },
    },
    required: ['tipo', 'referencia', 'cantidad', 'orden'],
  },
};

const INSTRUCCION_SISTEMA_MODO_CONSULTA =
  'Eres el intérprete de preguntas del "modo consulta" de un bot de WhatsApp para control de calidad de una fábrica de circuitos SMD (Plast-Innova). ' +
  'Una persona autorizada escribió una pregunta sobre garantías o muestreos de calidad. Tu única tarea es llamar a la función ' +
  'extraer_parametros_consulta con lo que esa pregunta está pidiendo. No respondas la pregunta directamente, no inventes datos: ' +
  'solo clasifícala y extrae referencia/cantidad si aplican. Si la pregunta no tiene nada que ver con garantías o muestreos de calidad, usa tipo "no_reconocido". ' +
  'Sé estricto al elegir el tipo: los tipos fijos son una lista corta y cerrada de consultas simples, sin filtros de fecha/periodo, sin conteos ni agrupaciones. ' +
  'Ante la duda, o si la pregunta se parece a un tipo pero le agrega cualquier condición extra (una fecha, un periodo, un conteo, un promedio, una comparación, un listado de valores distintos), usa "no_reconocido" — hay otro sistema más flexible, con acceso directo a la base de datos, que se encarga de esas preguntas después. Nunca fuerces el tipo que más se parezca solo porque comparte alguna palabra con la pregunta.';

function llamarGeminiExtraerParametros(fraseOriginal) {
  return geminiClient.models.generateContent({
    model: MODELO_IA_MODO_CONSULTA,
    contents: fraseOriginal,
    config: {
      systemInstruction: INSTRUCCION_SISTEMA_MODO_CONSULTA,
      tools: [{ functionDeclarations: [DECLARACION_EXTRAER_PARAMETROS_CONSULTA] }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ['extraer_parametros_consulta'],
        },
      },
    },
  });
}

async function interpretarConsultaConIA(fraseOriginal) {
  if (!geminiClient) return null;
  try {
    let respuesta;
    try {
      respuesta = await llamarGeminiExtraerParametros(fraseOriginal);
    } catch (e) {
      // Caso real visto en producción: Gemini (sobre todo en el plan
      // gratis, en horas de mucha demanda) a veces responde 503
      // "UNAVAILABLE" ("This model is currently experiencing high
      // demand..."). Es transitorio — Google mismo dice que la solución es
      // reintentar — así que se reintenta UNA sola vez después de una
      // pausa corta antes de rendirse. Cualquier otro error (llave
      // inválida, red caída, límite de uso agotado, etc.) NO se reintenta,
      // pasa directo al catch de afuera.
      if (e instanceof ApiError && e.status >= 500) {
        console.warn('⚠️ Gemini no disponible temporalmente (reintentando en 1s):', e.message);
        await new Promise(resolve => setTimeout(resolve, 1000));
        respuesta = await llamarGeminiExtraerParametros(fraseOriginal);
      } else {
        throw e;
      }
    }
    const llamada = respuesta.functionCalls && respuesta.functionCalls[0];
    if (!llamada || !llamada.args) return null;
    const { tipo, referencia, cantidad, orden } = llamada.args;

    if (tipo === 'no_reconocido' || !tipo) return null;

    const referenciaLimpia = typeof referencia === 'string' && referencia.trim() ? referencia.trim() : null;
    // "ultimos" y "causal" son por referencia — sin una, no hay qué
    // consultar (igual que en extraerParametrosConsulta), así que se trata
    // como no reconocida en vez de mandarla a la base sin filtro.
    if ((tipo === 'ultimos' || tipo === 'causal') && !referenciaLimpia) return null;

    const cantidadFinal = Number.isInteger(cantidad) && cantidad > 0 ? cantidad : CANTIDAD_DEFAULT_MODO_CONSULTA;
    // Cualquier valor que no sea exactamente 'antiguo' se trata como
    // 'reciente' (el default de siempre) — nunca se confía ciegamente en lo
    // que devuelva la IA para este campo.
    const ordenFinal = orden === 'antiguo' ? 'antiguo' : 'reciente';

    return { tipo, referencia: referenciaLimpia, cantidad: cantidadFinal, orden: ordenFinal };
  } catch (e) {
    // Cualquier falla (red, llave inválida, límite de uso, etc.) cae de
    // vuelta al mensaje de "no entendí" — nunca debe tumbar el bot ni dejar
    // a la persona sin respuesta.
    console.error('⚠️ Error consultando IA para modo consulta:', e.message);
    return null;
  }
}

// ======================== MODO CONSULTA — PREGUNTAS LIBRES (punto 8, segunda revisión) ========================
// Julio: "yo quiero es poder preguntarle algo sobre mi base de datos como si
// fuera una IA" — ya no quiere que cada tipo de pregunta se programe a mano
// una por una (interpretarConsultaConIA de arriba SOLO reconoce un enum fijo
// de "tipo"s). Esta es la última instancia, DE ÚLTIMO a propósito (ver el
// manejador de mensajes más abajo): si ni las reglas ni la IA "de enum fijo"
// reconocieron la pregunta, se le da a la IA el esquema completo de las
// tablas permitidas (data/consultaLibreIA.js) y se le pide que ESCRIBA su
// propio SELECT para responder. Es la opción más cara y lenta de las tres
// (dos llamadas a la IA en el peor caso: una para el enum fijo, que falla, y
// otra para el SQL), así que solo se paga ese costo cuando de verdad hace
// falta.
//
// Todas las protecciones de seguridad (solo lectura, lista blanca de
// tablas — sin "usuarios"/"roles"/"permisos", un único SELECT, sin punto y
// coma, límite de filas) viven en data/consultaLibreIA.js, no acá — esta
// función solo arma la pregunta para la IA y formatea lo que devuelva
// ejecutarConsultaSql. A propósito NO se le pide a la IA que redacte la
// respuesta final en lenguaje natural a partir de los datos (un segundo
// paso de IA sobre datos reales abriría la puerta a que "adorne" o
// invente algo que no está en las filas) — se arma con un formateador
// determinístico (formatearRespuestaLibre), igual que todas las respuestas
// de arriba.
const DECLARACION_EJECUTAR_CONSULTA_SQL = {
  name: 'ejecutar_consulta_sql',
  description:
    'Genera la consulta SQL de SOLO LECTURA (un único SELECT) que responde la pregunta de la persona, usando exclusivamente las tablas y columnas del esquema permitido que se te dio en las instrucciones.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      sql: {
        type: Type.STRING,
        description: 'La consulta SQL. Debe ser un único SELECT (sin punto y coma), usando solo tablas de la lista permitida.',
      },
    },
    required: ['sql'],
  },
};

// El esquema (obtenerEsquemaPermitido) no cambia mientras el servidor está
// corriendo, así que la instrucción de sistema se arma una sola vez y se
// reusa — igual que el cache interno de obtenerEsquemaPermitido.
let instruccionConsultaLibreCache = null;
async function construirInstruccionConsultaLibre() {
  if (instruccionConsultaLibreCache) return instruccionConsultaLibreCache;
  const esquema = await consultaLibreIA.obtenerEsquemaPermitido();
  instruccionConsultaLibreCache =
    'Eres el intérprete de preguntas del "modo consulta" de un bot de WhatsApp para control de calidad de una ' +
    'fábrica de circuitos SMD (Plast-Innova). Una persona autorizada escribió una pregunta en español (por ' +
    'WhatsApp, puede tener errores de tipeo o forma coloquial) sobre calidad, garantías o asistencia. Tu única ' +
    'tarea es llamar a la función ejecutar_consulta_sql con el SQL (un único SELECT) que responde esa pregunta.\n\n' +
    'Estas son las ÚNICAS tablas y columnas que existen para ti — cualquier otra tabla no existe, no la ' +
    `inventes, y nunca escribas nada que no sea SELECT:\n${esquema}\n\n` +
    'Si la pregunta no se puede responder con estas tablas, igual debes llamar a la función con el SELECT que ' +
    'más se acerque — no hace falta que sea perfecto.';
  return instruccionConsultaLibreCache;
}

function llamarGeminiConsultaLibre(fraseOriginal, instruccion) {
  return geminiClient.models.generateContent({
    model: MODELO_IA_MODO_CONSULTA,
    contents: fraseOriginal,
    config: {
      systemInstruction: instruccion,
      tools: [{ functionDeclarations: [DECLARACION_EJECUTAR_CONSULTA_SQL] }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ['ejecutar_consulta_sql'],
        },
      },
    },
  });
}

// Formateador genérico (no sabe de antemano qué columnas va a traer cada
// consulta, a diferencia de los formateadores de arriba que sí conocen su
// forma fija) — muestra cada fila como una lista de "columna: valor".
function formatearRespuestaLibre(filas) {
  if (!filas || filas.length === 0) return 'No encontré resultados para tu pregunta.';
  let texto = `🔎 *Resultado (${filas.length} fila(s)):*\n\n`;
  filas.forEach((f, i) => {
    const partes = Object.entries(f).map(([k, v]) => `${k}: ${v === null || v === undefined || v === '' ? '(vacío)' : v}`);
    texto += `${i + 1}. ${partes.join(' — ')}\n`;
  });
  if (filas.length >= consultaLibreIA.LIMITE_MAXIMO_FILAS) {
    texto += `\n_(Se limitó a los primeros ${consultaLibreIA.LIMITE_MAXIMO_FILAS} resultados — intenta una pregunta más puntual si buscabas algo más específico.)_`;
  }
  return texto.trim();
}

// Nunca lanza — cualquier error (de la IA, de validación del SQL, o de
// SQLite al ejecutarlo) devuelve null, igual que interpretarConsultaConIA,
// para que quien llama simplemente caiga al "no entendí" de siempre sin
// mostrarle a la persona ni el SQL ni el error crudo.
async function interpretarYEjecutarConsultaLibre(fraseOriginal) {
  if (!geminiClient) return null;
  try {
    const instruccion = await construirInstruccionConsultaLibre();
    let respuesta;
    try {
      respuesta = await llamarGeminiConsultaLibre(fraseOriginal, instruccion);
    } catch (e) {
      // Mismo caso real que en interpretarConsultaConIA (Gemini 503 "high
      // demand" en el plan gratis) — un solo reintento tras una pausa
      // corta, y solo para errores 5xx.
      if (e instanceof ApiError && e.status >= 500) {
        console.warn('⚠️ Gemini no disponible temporalmente (consulta libre, reintentando en 1s):', e.message);
        await new Promise(resolve => setTimeout(resolve, 1000));
        respuesta = await llamarGeminiConsultaLibre(fraseOriginal, instruccion);
      } else {
        throw e;
      }
    }
    const llamada = respuesta.functionCalls && respuesta.functionCalls[0];
    const sql = llamada && llamada.args && llamada.args.sql;
    if (!sql || typeof sql !== 'string') return null;
    const filas = await consultaLibreIA.ejecutarConsultaSql(sql, fraseOriginal);
    return { texto: formatearRespuestaLibre(filas) };
  } catch (e) {
    console.error('⚠️ Error en modo consulta libre (SQL generado por IA):', e.message);
    return null;
  }
}

// Arma el texto de respuesta para el tipo "últimos/top N" (puntos 10/15).
// El PDF del punto 17 todavía no tiene plantilla propia (generarPdfReporte
// Garantias es específico del resumen periódico de calidad, con otra
// estructura — no sirve para una tabla suelta de registros), así que por
// ahora SIEMPRE se manda como texto, incluso pasado el umbral que decide
// cuándo "debería" ir en PDF; si pasa ese umbral, el mensaje lo aclara para
// que no parezca un resultado incompleto por error.
function formatearRespuestaUltimos(referencia, filas, orden) {
  if (filas.length === 0) return `No encontré garantías registradas para *${referencia}*.`;
  const etiquetaOrden = orden === 'antiguo' ? 'Primeros' : 'Últimos';
  let texto = `📋 *${etiquetaOrden} ${filas.length} registro(s) de ${referencia}:*\n\n`;
  filas.forEach((f, i) => {
    texto += `${i + 1}. ${f.fecha_reporte || '(sin fecha)'} — Cant: ${f.cantidad || 1}\n   Causal: ${f.problema || 'Sin causal registrado'}\n   Estado: ${f.estado || 'Pendiente'}${f.quien_aprobo_rechazo ? ' — ' + f.quien_aprobo_rechazo : ''}\n\n`;
  });
  if (debeEnviarseComoPdf(filas.length)) {
    texto += '_(Esto ya debería mandarse como PDF — punto 17 — pero esa plantilla todavía no está construida, así que va como texto.)_';
  }
  return texto.trim();
}

// Arma el texto de respuesta para el tipo "porcentaje por causal" (punto 11).
function formatearRespuestaCausal(referencia, filas) {
  if (filas.length === 0) return `No encontré garantías registradas para *${referencia}*.`;
  let texto = `📊 *Causales de ${referencia}:*\n\n`;
  filas.forEach(f => { texto += `• ${f.causal}: ${f.porcentaje}% (${f.cantidad})\n`; });
  if (debeEnviarseComoPdf(filas.length)) {
    texto += '\n_(Esto ya debería mandarse como PDF — punto 17 — pero esa plantilla todavía no está construida, así que va como texto.)_';
  }
  return texto.trim();
}

// Arma el texto de respuesta para "últimas garantías ingresadas" — a
// diferencia de formatearRespuestaUltimos, abarca varias referencias a la
// vez, así que cada línea muestra también la referencia y el cliente.
function formatearRespuestaGarantiasRecientes(filas, orden) {
  if (filas.length === 0) return 'No encontré garantías registradas todavía.';
  const etiquetaOrden = orden === 'antiguo' ? 'Primeras' : 'Últimas';
  let texto = `📋 *${etiquetaOrden} ${filas.length} garantía(s) ingresada(s):*\n\n`;
  filas.forEach((f, i) => {
    texto += `${i + 1}. ${f.fecha_reporte || '(sin fecha)'} — ${f.referencia || '(sin referencia)'}\n   Cliente: ${f.cliente || '(sin cliente)'} — Cant: ${f.cantidad || 1}\n   Causal: ${f.problema || 'Sin causal registrado'} — Estado: ${f.estado || 'Pendiente'}\n\n`;
  });
  if (debeEnviarseComoPdf(filas.length)) {
    texto += '_(Esto ya debería mandarse como PDF — punto 17 — pero esa plantilla todavía no está construida, así que va como texto.)_';
  }
  return texto.trim();
}

// Arma el texto de respuesta para "top N referencias con más garantías"
// (confirmado con Julio, 28/08, tras el hallazgo de "top 5 de garantías
// con más porcentaje/más frecuentes" — ver el bloque de MODO CONSULTA —
// INTERPRETACIÓN CON IA más arriba para el detalle completo).
function formatearRespuestaTopReferencias(filas) {
  if (filas.length === 0) return 'No encontré garantías registradas todavía.';
  let texto = `🏆 *Top ${filas.length} referencia(s) con más garantías:*\n\n`;
  filas.forEach((f, i) => {
    texto += `${i + 1}. ${f.referencia} — ${f.cantidad_garantias} garantía(s)\n`;
  });
  if (debeEnviarseComoPdf(filas.length)) {
    texto += '\n_(Esto ya debería mandarse como PDF — punto 17 — pero esa plantilla todavía no está construida, así que va como texto.)_';
  }
  return texto.trim();
}

// Arma el texto de respuesta para "últimos muestreos realizados/rechazados".
function formatearRespuestaMuestreos(filas, soloRechazados, orden) {
  if (filas.length === 0) {
    return soloRechazados ? 'No encontré muestreos rechazados registrados.' : 'No encontré muestreos registrados todavía.';
  }
  const etiqueta = soloRechazados ? 'rechazado(s)' : 'realizado(s)';
  const etiquetaOrden = orden === 'antiguo' ? 'Primeros' : 'Últimos';
  let texto = `🔬 *${etiquetaOrden} ${filas.length} muestreo(s) ${etiqueta}:*\n\n`;
  filas.forEach((f, i) => {
    const emojiDecision = f.decision === 'Rechazado' ? '🔴' : f.decision === 'Alerta' ? '🟡' : '🟢';
    texto += `${i + 1}. ${f.fecha_hora || '(sin fecha)'} — ${f.referencia || f.id_lote}\n   Lote: ${f.id_lote} (${f.modulo}) — Tipo: ${f.tipo}\n   ${emojiDecision} ${f.decision} — Analista: ${f.analista}\n\n`;
  });
  if (debeEnviarseComoPdf(filas.length)) {
    texto += '_(Esto ya debería mandarse como PDF — punto 17 — pero esa plantilla todavía no está construida, así que va como texto.)_';
  }
  return texto.trim();
}

// Ejecuta la consulta a la base que corresponde a "parametros.tipo" y arma
// el texto de respuesta — separado del manejador de mensajes para poder
// llamarlo dos veces si hace falta (ver el bug real de Julio, 28/08, en el
// manejador de mensajes más abajo: si las reglas "adivinan" una referencia
// que en realidad no es un código real, esto devuelve 0 filas y
// posibleFalsoNegativo=true, para intentar de nuevo con la IA antes de
// darle a la persona un "no encontré" que en realidad es un "no entendí"
// disfrazado). posibleFalsoNegativo solo aplica a "ultimos"/"causal"
// (los únicos tipos que dependen de una referencia adivinada de la frase);
// los demás tipos (comandos fijos, sin referencia) no tienen ese riesgo.
async function generarRespuestaModoConsulta(parametros) {
  switch (parametros.tipo) {
    case 'ultimos': {
      const filas = await garantiasData.consultarUltimosGarantiasPorReferencia(parametros.referencia, parametros.cantidad, parametros.orden);
      return { texto: formatearRespuestaUltimos(parametros.referencia, filas, parametros.orden), posibleFalsoNegativo: filas.length === 0 };
    }
    case 'causal': {
      const filas = await garantiasData.consultarPorcentajeCausalPorReferencia(parametros.referencia);
      return { texto: formatearRespuestaCausal(parametros.referencia, filas), posibleFalsoNegativo: filas.length === 0 };
    }
    case 'garantias_recientes': {
      const filas = await garantiasData.consultarUltimasGarantiasIngresadas(parametros.cantidad, parametros.orden);
      return { texto: formatearRespuestaGarantiasRecientes(filas, parametros.orden), posibleFalsoNegativo: false };
    }
    case 'top_referencias_garantias': {
      const filas = await garantiasData.consultarTopReferenciasConMasGarantias(parametros.cantidad);
      return { texto: formatearRespuestaTopReferencias(filas), posibleFalsoNegativo: false };
    }
    case 'muestreos_realizados': {
      const filas = await isoData.consultarUltimosMuestreos(parametros.cantidad, { orden: parametros.orden });
      return { texto: formatearRespuestaMuestreos(filas, false, parametros.orden), posibleFalsoNegativo: false };
    }
    case 'muestreos_rechazados': {
      const filas = await isoData.consultarUltimosMuestreos(parametros.cantidad, { soloRechazados: true, orden: parametros.orden });
      return { texto: formatearRespuestaMuestreos(filas, true, parametros.orden), posibleFalsoNegativo: false };
    }
    default:
      return { texto: MENSAJE_NO_ENTENDI_MODO_CONSULTA, posibleFalsoNegativo: false };
  }
}

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

// Respaldo en texto plano del reporte de metrología, por si el PDF no se
// pudo generar — mismo criterio que formatearReporteGarantiasTexto.
function formatearReporteMetrologiaTexto(etiquetaPeriodo, m) {
  let t = `📏 *REPORTE DE METROLOGÍA — ${etiquetaPeriodo}*\n\n`;
  t += `Inspecciones: ${m.totalInspecciones || 0} | Medidas tomadas: ${m.totalMedidas || 0} | Conformes: ${m.conformes || 0} | Fuera de tolerancia: ${m.fueraTolerancia || 0}\n\n`;
  if (m.pctFueraTolerancia !== null && m.pctFueraTolerancia !== undefined && (m.totalMedidas || 0) > 0) {
    t += `${m.pctFueraTolerancia}% de las medidas del periodo quedaron fuera de tolerancia.\n\n`;
  }
  if ((m.topReferenciasProblema || []).length > 0) {
    t += `*Top referencias con más medidas fuera de tolerancia:*\n`;
    m.topReferenciasProblema.forEach((r, i) => { t += `  ${i + 1}. ${r.referencia}: ${r.medidas_fuera_tolerancia}\n`; });
    t += '\n';
  }
  if ((m.totalInspecciones || 0) === 0) t += 'No se registraron inspecciones de Metrología en este periodo.\n';
  return t;
}

// Reporte aparte de metrología (comando "reportes") — mismo patrón que
// responderReporteGarantiasPDF: intenta el PDF y, si falla, cae a texto.
async function responderReporteMetrologiaPDF(msg, etiquetaPeriodo, m) {
  let rutaArchivo;
  try {
    rutaArchivo = await generarPdfReporteMetrologia(etiquetaPeriodo, m);
  } catch (e) {
    console.error('⚠️ No se pudo generar el PDF del reporte de metrología, se manda como texto:', e.message);
    await msg.reply(formatearReporteMetrologiaTexto(etiquetaPeriodo, m));
    return;
  }
  try {
    const media = MessageMedia.fromFilePath(rutaArchivo);
    await msg.reply(media, null, { caption: `📏 *Reporte de Metrología — ${etiquetaPeriodo}*` });
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
  { permiso: 'reportes', linea: '• *reportes* → menú por número para pedir el PDF de Garantías, Metrología o Muestreos (mensual, quincenal o histórico general)' },
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
  await revisarModoConsultaExpirado();
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

      // Cualquier mensaje de alguien que ya esté en modo consulta cuenta
      // como actividad y le renueva los 5 minutos (Roadmap Bot WhatsApp,
      // punto 4) — no importa si el mensaje es "consulta" otra vez, un
      // comando distinto, o (más adelante) una pregunta real; lo único que
      // cierra el modo por inactividad es no escribir nada en 5 minutos.
      // El cierre en sí se decide aparte, cada 60s, en
      // revisarModoConsultaExpirado() — aquí solo se refresca el reloj.
      if (numerosEnModoConsulta.has(tel)) {
        numerosEnModoConsulta.set(tel, Date.now());
      }

      const sinPermiso = async () => { await msg.reply('⚠️ No tienes permiso para esa función. Escribe *ayuda* para ver qué puedes hacer.'); };

      // Asistente "reportes" — interceptar ANTES que cualquier otro comando
      // si el número está a mitad del asistente (ver manejarPasoReportes y
      // numerosEnModoReportes más arriba). Cierre "en silencio" por
      // inactividad (a diferencia del modo consulta, que avisa cada 60s vía
      // revisarModoConsultaExpirado): si ya pasaron los 5 minutos, se borra
      // el estado acá mismo (revisión perezosa, sin barrido aparte) y el
      // mensaje sigue su camino normal — así un número suelto (ej. "3") que
      // llega después de expirado cae de vuelta en el registro de
      // entrada/salida de área, que es el comportamiento correcto.
      if (numerosEnModoReportes.has(tel)) {
        const estadoReportes = numerosEnModoReportes.get(tel);
        if (Date.now() - estadoReportes.ultimaActividad > REPORTES_TIMEOUT_MS) {
          numerosEnModoReportes.delete(tel);
        } else {
          await manejarPasoReportes(tel, txtOrig, msg);
          return;
        }
      }

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

      // Modo consulta — activación (Roadmap Bot WhatsApp, punto 3). Palabra
      // exacta "consulta", sin variantes ("consultar", "quiero consultar",
      // etc. NO activan el modo) — así quedó definido en la planeación. Pide
      // el permiso 'consulta_garantias_detalle' (punto 13) — antes de que
      // existiera este permiso en el catálogo, cualquier número autorizado
      // en el bot podía activar el modo; ya con el permiso creado, sin él no
      // se puede ni entrar, en vez de entrar y enterarse después de que no
      // se puede preguntar nada. La sesión que arranca aquí se cierra sola a
      // los 5 minutos de inactividad (punto 4, ver revisarModoConsultaExpirado)
      // o manualmente con "salir consulta" (punto 5). Ya responde preguntas
      // (puntos 9-11) — dejó de ser solo la activación.
      if (txt === 'consulta') {
        if (!tienePermisoBot(tel, 'consulta_garantias_detalle')) { await sinPermiso(); return; }
        activarModoConsulta(tel);
        await msg.reply(`🔍 *Modo consulta activado.*\n\n${MENU_MODO_CONSULTA}\n\nSe cierra solo si pasan 5 minutos sin actividad, o escribe *salir consulta* para cerrarlo ahora.`);
        return;
      }

      // Modo consulta — cierre manual (Roadmap Bot WhatsApp, punto 5).
      // Palabra exacta "salir consulta", NO simplemente "salir" — esa
      // palabra ya la usa el registro de entrada/salida de área (más abajo)
      // y así lo decidió Julio para el punto 6 (Crítica): "salir" se queda
      // significando SOLO cerrar la entrada/salida de área, sin excepción,
      // para que nadie cierre por accidente su registro de asistencia (o
      // deje de cerrarlo) por estar además en modo consulta. Cerrar el modo
      // consulta es su propia palabra, sin relación con "salir".
      if (txt === 'salir consulta') {
        if (numerosEnModoConsulta.has(tel)) {
          numerosEnModoConsulta.delete(tel);
          await msg.reply('🔓 *Modo consulta cerrado.*\n\nEscribe *consulta* cuando quieras volver a activarlo.');
        } else {
          await msg.reply('No tienes el modo consulta activo. Escribe *consulta* para activarlo.');
        }
        return;
      }

      // Comando "reportes" — punto de entrada al asistente por número (ver
      // manejarPasoReportes/menuReportesModulos más arriba). Un solo permiso
      // ('reportes') para las 3 pantallas del menú (Garantías/Metrología/
      // Muestreos) — decisión de Julio: más simple de administrar que
      // separar por módulo dentro del menú.
      if (txt === 'reportes') {
        if (!tienePermisoBot(tel, 'reportes')) { await sinPermiso(); return; }
        numerosEnModoReportes.set(tel, { paso: 'modulo', ultimaActividad: Date.now() });
        await msg.reply(menuReportesModulos());
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

      // Modo consulta — responder la pregunta (puntos 9, 10, 11). Va al
      // final, después de TODOS los comandos de arriba, y solo entra en
      // juego si la persona está en el modo (activado con "consulta") Y el
      // texto no coincidió con ningún comando conocido — así "ayuda",
      // "resumen", los números de área, etc. siguen funcionando exactamente
      // igual estando en modo consulta, tal como se documentó desde la
      // activación (punto 3): el modo no bloquea ni cambia el
      // comportamiento de ningún otro comando, solo agrega esto encima.
      if (numerosEnModoConsulta.has(tel)) {
        // Primero las reglas (gratis, instantáneo, cubren los 3 comandos
        // fijos y las preguntas por referencia con formato conocido). Solo
        // si no reconocen nada Y hay una llave de IA configurada, se
        // intenta con el modelo de lenguaje (punto 8, revisado a pedido de
        // Julio) — así el costo de la IA solo se paga en las preguntas que
        // de verdad lo necesitan.
        let parametros = extraerParametrosConsulta(txtOrig);
        const vinoDeReglas = !!parametros;
        // Ver el comentario de SENALES_REQUIERE_MODO_LIBRE más arriba (caso
        // real con Julio, 28/08): si la pregunta tiene un filtro de fecha/
        // periodo, un conteo, o pide valores distintos, no se le da a la IA
        // de tipos fijos ni la oportunidad de "adivinar" — se sabe de
        // antemano que ninguno de sus tipos cubre eso, y forzarlo fue
        // justo lo que causó que Julio recibiera la misma respuesta
        // genérica para tres preguntas distintas.
        const requiereModoLibre = necesitaModoLibre(txtOrig);
        if (!parametros && geminiClient && !requiereModoLibre) {
          parametros = await interpretarConsultaConIA(txtOrig);
        }
        if (!parametros) {
          // Última instancia (Roadmap Bot WhatsApp, punto 8 — segunda
          // revisión, 28/08): ni las reglas ni el enum fijo de tipos
          // reconocieron la pregunta. Antes de rendirse con el "no
          // entendí", si hay IA configurada se le da una última
          // oportunidad: que ella misma escriba y corra su propia consulta
          // SQL de solo lectura sobre las tablas permitidas (ver
          // interpretarYEjecutarConsultaLibre y data/consultaLibreIA.js).
          // Nunca lanza — si por lo que sea no puede (SQL inválido, tabla
          // no permitida, error de la IA), devuelve null y se cae al "no
          // entendí" de siempre.
          if (geminiClient) {
            const resultadoLibre = await interpretarYEjecutarConsultaLibre(txtOrig);
            if (resultadoLibre) {
              await msg.reply(resultadoLibre.texto);
              return;
            }
          }
          await msg.reply(MENSAJE_NO_ENTENDI_MODO_CONSULTA);
          return;
        }
        try {
          let resultado = await generarRespuestaModoConsulta(parametros);
          // Hallazgo real con Julio (28/08): "top 5 de garantías con más
          // porcentaje" — las reglas (V1, heurística "lo que sigue a la
          // última ' de '") tomaron "garantías con más porcentaje" como si
          // fuera un código de referencia real, y como SÍ lograron armar
          // una respuesta (aunque vacía, 0 filas), nunca le dieron la
          // oportunidad a la IA de interpretarlo mejor — el bot respondió
          // con un falso "no encontré garantías para X" en vez de admitir
          // que no entendió. Si la referencia vino de las reglas (no de la
          // IA) y no hay resultados, se le da una segunda oportunidad a la
          // IA con el texto original antes de responder.
          if (resultado.posibleFalsoNegativo && vinoDeReglas && geminiClient) {
            const parametrosIA = requiereModoLibre ? null : await interpretarConsultaConIA(txtOrig);
            if (parametrosIA) {
              resultado = await generarRespuestaModoConsulta(parametrosIA);
            } else {
              // Hallazgo real con Julio (28/08, mismo día): "Regálame las
              // garantías que menos unidades han llegado" — las reglas
              // adivinaron mal una referencia (0 filas, posibleFalsoNegativo),
              // y la IA de tipos fijos (interpretarConsultaConIA) TAMPOCO
              // reconoció la pregunta: no es ninguno de los tipos del enum
              // (ultimos/causal/garantias_recientes/etc.) — es una pregunta
              // nueva y válida (ordenar garantías por cantidad ascendente),
              // justo el caso para el que se construyó el modo libre. Antes
              // de esto, el código se rendía acá con el falso "no encontré"
              // de las reglas SIN llegar nunca a intentar el modo libre
              // (interpretarYEjecutarConsultaLibre solo se probaba cuando
              // "parametros" venía null desde el principio — no cuando venía
              // de las reglas con una referencia inventada). Se le da esta
              // última oportunidad antes de aceptar la respuesta original.
              const resultadoLibre = await interpretarYEjecutarConsultaLibre(txtOrig);
              if (resultadoLibre) {
                resultado = resultadoLibre;
              }
            }
          }
          await msg.reply(resultado.texto);
        } catch (e) {
          console.error('⚠️ Error respondiendo pregunta de modo consulta:', e.message);
          await msg.reply('⚠️ No pude responder esa pregunta. Intenta de nuevo o escribe *salir consulta*.');
        }
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
