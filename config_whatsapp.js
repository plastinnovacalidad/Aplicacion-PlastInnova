// ============================================
// CONFIGURACIÓN DEL BOT DE WHATSAPP - ÁREAS
// ============================================

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

const ALLOWED_NUMBERS = [
  '199939468558544@lid',
  '573202502529@c.us',
];

const NOMBRES = {
  '199939468558544@lid': 'Julio',
  '573202502529@c.us': 'Compañero 1',
};

const TIMEZONE = 'America/Bogota';
const IGNORE_OLD_MESSAGES_SECONDS = 30;

const RECORDATORIOS = [
  { hora: 15, minuto: 30, mensaje: '⏰ Son las 3:30 PM. Recuerda escribir "salir" para cerrar tu registro del día.' },
  { hora: 16, minuto: 30, mensaje: '⏰ Son las 4:30 PM. Último recordatorio: cierra tu registro antes de irte.' },
];

const RESUMEN_HORA = 15;
const RESUMEN_MINUTO = 0;
const ADMIN_NUMERO = '199939468558544@lid';

const MENSAJES_SALIDA = {
  '199939468558544@lid': '¡Buen trabajo {nombre}! Descansa y nos vemos mañana. 👋',
  '573202502529@c.us': '¡Buen trabajo {nombre}! Descansa y nos vemos mañana. 👋',
};

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
};
