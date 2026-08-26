// ======================== PERMISOS DISPONIBLES ========================
// Catálogo de permisos que se siembra en la base de datos al iniciar
// (tabla `permisos`). Vive aparte porque tanto db/init.js (para crearlos)
// como, en teoría, cualquier pantalla de administración futura, lo pueden
// necesitar.
const PERMISOS_DISPONIBLES = [
  { codigo: 'referencias.ver',        descripcion: 'Ver referencias e imágenes' },
  { codigo: 'referencias.crear',      descripcion: 'Crear nuevas referencias' },
  { codigo: 'referencias.editar',     descripcion: 'Editar datos de referencias' },
  { codigo: 'versiones.crear',        descripcion: 'Subir nuevas versiones de imagen' },
  { codigo: 'recomendaciones.ver',    descripcion: 'Ver todas las recomendaciones' },
  { codigo: 'recomendaciones.crear',  descripcion: 'Enviar recomendaciones' },
  { codigo: 'recomendaciones.eliminar', descripcion: 'Eliminar recomendaciones' },
  { codigo: 'usuarios.gestionar',     descripcion: 'Crear/editar/eliminar usuarios' },
  { codigo: 'roles.gestionar',        descripcion: 'Crear/editar/eliminar roles y permisos' },
  { codigo: 'configuracion.logo',     descripcion: 'Cambiar logo de la empresa' },
  { codigo: 'gestion.ver',            descripcion: 'Acceder al panel de gestión' },
  { codigo: 'observaciones.ver',      descripcion: 'Ver observaciones de referencias' },
  { codigo: 'observaciones.editar',   descripcion: 'Editar observaciones de referencias' },
  { codigo: 'garantias.ver',          descripcion: 'Ver módulo y tablero de garantías' },
  { codigo: 'garantias.crear',        descripcion: 'Crear nuevas garantías' },
  { codigo: 'garantias.editar',       descripcion: 'Editar garantías' },
  { codigo: 'garantias.eliminar',     descripcion: 'Eliminar garantías' },
  { codigo: 'garantias.dashboard',    descripcion: 'Ver tablero analítico (Dashboard) de garantías' },
  { codigo: 'portal.volver',          descripcion: 'Ver botón para volver al portal principal' },
  { codigo: 'whatsapp.bot.ver',       descripcion: 'Ver registros y sesiones del bot de WhatsApp' },
  { codigo: 'whatsapp.bot.gestionar', descripcion: 'Gestionar sesiones y resumen del bot de WhatsApp' },
  { codigo: 'metrologia.ver',             descripcion: 'Ver módulo de metrología y planos' },
  { codigo: 'metrologia.inspeccionar',    descripcion: 'Realizar inspecciones y registrar medidas' },
  { codigo: 'metrologia.versiones',       descripcion: 'Subir y gestionar nuevas versiones de planos' },
  { codigo: 'metrologia.historial',       descripcion: 'Ver historial de inspecciones' },
  { codigo: 'metrologia.auditoria',       descripcion: 'Ver registro de cambios y auditoría' },
  { codigo: 'metrologia.crear_referencia',descripcion: 'Crear nuevas referencias de moldes' },
  { codigo: 'metrologia.editar_cotas',    descripcion: 'Agregar o editar cotas y tolerancias' },
  { codigo: 'metrologia.eliminar_cotas',  descripcion: 'Eliminar cotas y tolerancias' },
  // Antes se usaba en el frontend (Public/metrologia.html) sin estar en este
  // catálogo, así que ninguna pantalla de administración podía asignarlo o
  // quitarlo a propósito — quedaba como un permiso "invisible". Funciona
  // como interruptor maestro: quien lo tenga puede hacer cualquier cosa en
  // metrología sin necesitar además cada permiso específico de arriba.
  { codigo: 'metrologia.gestion',         descripcion: 'Acceso completo a todas las funciones de metrología (equivale a tener todos los permisos de este módulo)' },
  // Módulo de Muestreos ISO 2859-1 (Recepción y Producción).
  { codigo: 'iso2859.ver',           descripcion: 'Ver módulo de muestreos ISO 2859, dashboard e historial' },
  { codigo: 'iso2859.crear_lote',    descripcion: 'Crear lotes y revisiones de inspección' },
  { codigo: 'iso2859.muestrear',     descripcion: 'Realizar muestreos (Primera Pieza, En Proceso, Auditoría Final)' },
  { codigo: 'iso2859.cambiar_plan',  descripcion: 'Cambiar el plan de muestreo (Normal/Reforzada/Reducida) de una referencia' },
  { codigo: 'iso2859.reportes',      descripcion: 'Ver y descargar reportes PDF de muestreos, lotes y trazabilidad' },
  { codigo: 'iso2859.gestion',       descripcion: 'Acceso completo a todas las funciones de muestreos ISO 2859 (equivale a tener todos los permisos de este módulo)' },
  // Pestaña "Catálogos" dentro de Gestión: editar catálogos de referencia
  // (defectos ISO 2859, causales de garantías, áreas de inspección, planes
  // de muestreo) desde la propia aplicación, sin tener que abrir la base de
  // datos con un programa aparte. Es un permiso separado de los "gestion"
  // de cada módulo porque cruza varios módulos a la vez.
  { codigo: 'catalogos.gestionar',   descripcion: 'Editar catálogos del sistema (defectos ISO, causales de garantías, áreas, planes de muestreo)' },
  // Pestaña "Registro de Cambios" dentro de Gestión: ver la bitácora global
  // de quién creó/editó/eliminó qué en todo el sistema (catálogos, roles,
  // usuarios, garantías, referencias SMD, planos de metrología, planes de
  // muestreo ISO). Es de solo lectura — no permite deshacer ni editar nada,
  // por eso es un permiso aparte y más liviano que 'catalogos.gestionar'.
  { codigo: 'auditoria.ver',         descripcion: 'Ver el registro global de cambios (auditoría) de todo el sistema' },
  // Módulo nuevo "Calidad General": cruza Garantías y Muestreos ISO 2859-1
  // por referencia de producto terminado (Circuitos SMD queda fuera, porque
  // maneja su propio catálogo de tarjetas/componentes, a otro nivel). Es de
  // solo lectura, así que un solo permiso alcanza — no hay nada que crear,
  // editar o eliminar desde esta pantalla.
  { codigo: 'calidad.ver',           descripcion: 'Ver el tablero general de Calidad (cruce de Garantías y Muestreos ISO 2859)' },
  // Módulo "Valores y Cableado" (Electrónica): ficha de valores eléctricos
  // medidos y configuración de cableado por referencia/color/versión de
  // Circuitos SMD. '.ver' es de solo lectura; '.gestion' habilita editar los
  // valores/cableado y subir fotos de cableado (crear la referencia+color+
  // versión en sí y su foto de circuito se sigue haciendo desde la pantalla
  // de Referencias de Circuitos SMD — es el mismo catálogo, no se duplica
  // esa pantalla aquí).
  { codigo: 'valores_cableado.ver',  descripcion: 'Ver el módulo de Valores y Cableado (valores eléctricos y configuración de cableado)' },
  { codigo: 'valores_cableado.gestion', descripcion: 'Crear/editar valores eléctricos, configuración de cableado y fotos de cableado en el módulo de Valores y Cableado' },
];

module.exports = { PERMISOS_DISPONIBLES };
