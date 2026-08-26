// ======================== PERMISOS DEL BOT DE WHATSAPP ========================
// Catálogo de lo que un número autorizado puede pedirle al bot por
// WhatsApp — equivalente, para el bot, al catálogo PERMISOS_DISPONIBLES de
// settings/permisos.js para la app web. Se administra por número desde
// Public/whatsapp_bot.html (pestaña "Números Autorizados"), guardado en la
// tabla whatsapp_numero_permisos (ver MIGRACIÓN #16 en db/init.js).
//
// Es independiente de la columna `es_admin` de whatsapp_numeros: `es_admin`
// solo decide quién RECIBE los avisos automáticos (resumen de asistencia,
// alertas de calidad); estos permisos deciden qué comandos puede ESCRIBIRLE
// alguien al bot y obtener respuesta.
const PERMISOS_BOT_DISPONIBLES = [
  { codigo: 'registro_entrada', descripcion: 'Marcar entrada/salida de área ("areas", número de área, "estado", "salir")' },
  { codigo: 'ver_resumen_asistencia', descripcion: 'Comando "resumen" (resumen de asistencia del día)' },
  { codigo: 'cerrar_sesiones', descripcion: 'Comando "cerrar <número>" (cerrar la sesión activa de otra persona)' },
  { codigo: 'calidad_diario', descripcion: 'Comando "diario" (resumen de calidad de hoy)' },
  { codigo: 'calidad_quincenal', descripcion: 'Comando "quincenal" (resumen de calidad de una quincena)' },
  { codigo: 'calidad_mensual', descripcion: 'Comando "mensual" (resumen de calidad de un mes)' },
  { codigo: 'calidad_garantias', descripcion: 'Comando "garantias" (estado actual del pico de garantías)' },
];

module.exports = { PERMISOS_BOT_DISPONIBLES };
