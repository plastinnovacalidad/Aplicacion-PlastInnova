// ======================== PERMISOS SENSIBLES ========================
// Lista corta y fija de permisos que, si un rol los gana (o si a un usuario
// le cambian el rol a uno que ya los tiene), disparan una alerta de
// WhatsApp al administrador (ver whatsapp_bot_service.js -> enviarAlerta
// ('permiso_sensible', ...), usada desde routes/roles.js y routes/usuarios.js).
//
// Son a propósito solo los que dan control real sobre el sistema: crear o
// editar usuarios y roles, gestionar el bot de WhatsApp (que a su vez puede
// leer/gestionar estas mismas alertas), o tocar los catálogos compartidos
// entre módulos. 'calidad.ver' y los "*.ver" en general se dejan fuera para
// que dar de alta a un inspector nuevo no genere una alerta cada vez.
//
// Editar este arreglo es la única forma de cambiar qué cuenta como
// "sensible" (no hay pantalla para esto, a propósito: es una decisión de
// seguridad, no de configuración operativa del día a día).
const PERMISOS_SENSIBLES = [
  'usuarios.gestionar',
  'roles.gestionar',
  'whatsapp.bot.gestionar',
  'catalogos.gestionar',
];

module.exports = { PERMISOS_SENSIBLES };
