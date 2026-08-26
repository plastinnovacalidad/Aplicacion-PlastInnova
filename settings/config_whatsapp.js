// ============================================
// CONFIGURACIÓN DEL BOT DE WHATSAPP - ÁREAS
// ============================================
// Los números de WhatsApp, sus nombres y el mensaje de despedida ahora se
// leen desde .env (a través de settings/paths.js), con estos mismos valores
// de siempre como respaldo si el .env no existe o no los define. Así, esta
// información personal ya no queda escrita directamente en el código fuente.
const { WHATSAPP_NUMEROS, WHATSAPP_ADMIN_NUMERO, WHATSAPP_MENSAJE_SALIDA } = require('./paths');

const AREAS = [
  { id: 1, nombre: 'Producción' },
  { id: 2, nombre: 'Almacén' },
  { id: 3, nombre: 'Calidad' },
  { id: 4, nombre: 'Mantenimiento' },
  { id: 5, nombre: 'Oficina' },
  { id: 6, nombre: 'Recepción' },
  { id: 7, nombre: 'Limpieza' },
  { id: 8, nombre: 'Seguridad' },
];

const { ALLOWED_NUMBERS, NOMBRES } = WHATSAPP_NUMEROS;

const TIMEZONE = 'America/Bogota';
const IGNORE_OLD_MESSAGES_SECONDS = 30;

const RECORDATORIOS = [
  { hora: 15, minuto: 30, mensaje: '⏰ Son las 3:30 PM. Recuerda escribir "salir" para cerrar tu registro del día.' },
  { hora: 16, minuto: 30, mensaje: '⏰ Son las 4:30 PM. Último recordatorio: cierra tu registro antes de irte.' },
];

const RESUMEN_HORA = 15;
const RESUMEN_MINUTO = 0;
const ADMIN_NUMERO = WHATSAPP_ADMIN_NUMERO;

// Hora a la que se revisan y mandan las alertas de calidad periódicas
// (resumen diario, quincenal, mensual y el chequeo de pico de garantías).
// Aparte de RESUMEN_HORA/RESUMEN_MINUTO (que son solo para el resumen de
// asistencia) porque son dos reportes distintos, para gente distinta.
const RESUMEN_CALIDAD_HORA = 17;
const RESUMEN_CALIDAD_MINUTO = 0;

// El mismo mensaje de despedida se usa para todos los números autorizados
// (igual que antes: los dos números tenían exactamente el mismo texto).
const MENSAJES_SALIDA = {};
ALLOWED_NUMBERS.forEach(numero => { MENSAJES_SALIDA[numero] = WHATSAPP_MENSAJE_SALIDA; });

module.exports = {
  AREAS,
  ALLOWED_NUMBERS,
  NOMBRES,
  TIMEZONE,
  IGNORE_OLD_MESSAGES_SECONDS,
  RECORDATORIOS,
  RESUMEN_HORA,
  RESUMEN_MINUTO,
  ADMIN_NUMERO,
  MENSAJES_SALIDA,
  RESUMEN_CALIDAD_HORA,
  RESUMEN_CALIDAD_MINUTO,
};
