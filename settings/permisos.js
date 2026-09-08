// ======================== PERMISOS DISPONIBLES ========================
// Catálogo de permisos que se siembra en la base de datos al iniciar
// (tabla `permisos`). Vive aparte porque tanto db/init.js (para crearlos)
// como, en teoría, cualquier pantalla de administración futura, lo pueden
// necesitar.
const PERMISOS_DISPONIBLES = [
  { codigo: 'referencias.ver',        descripcion: 'Ver referencias e imágenes' },
  { codigo: 'referencias.crear',      descripcion: 'Crear nuevas referencias' },
  { codigo: 'referencias.editar',     descripcion: 'Editar datos de referencias' },
  // Borrado suave: oculta la referencia de las listas/búsquedas del día a
  // día, pero no borra nada de verdad (versiones, fotos y auditoría siguen
  // intactas) — quien tiene este permiso también puede restaurarla después.
  { codigo: 'referencias.eliminar',   descripcion: 'Eliminar (ocultar) y restaurar referencias de Circuitos SMD' },
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
  // de muestreo, y ahora también causas raíz posibles y sus medidas
  // posibles de Producción) desde la propia aplicación, sin tener que abrir
  // la base de datos con un programa aparte. Es un permiso separado de los
  // "gestion" de cada módulo porque cruza varios módulos a la vez.
  { codigo: 'catalogos.gestionar',   descripcion: 'Editar catálogos del sistema (defectos ISO, causales de garantías, áreas, planes de muestreo, causas y medidas de Producción)' },
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
  // Trazabilidad de soluciones: crear un caso y agregarle causas raíz y
  // medidas de solución (cada medida ligada a la causa raíz que busca
  // resolver) sigue pidiendo este permiso aparte y más restringido — el
  // responsable de cada causa/medida ya no se elige, es automáticamente
  // quien esté conectado al agregarla. El estado general del caso se
  // recalcula solo.
  // OJO (MIGRACIÓN #38, 08/09): desde el rediseño del módulo "Problemas",
  // este permiso ya NO da acceso a nada -- trazabilidad_problemas se
  // eliminó y toda la lógica de causas/medidas vive ahora en Problemas
  // (permisos 'problemas.*' más abajo). Se deja el código sin borrar por si
  // algún rol ya lo tenía asignado, pero hay que reasignar 'problemas.*' a
  // quien lo necesite.
  { codigo: 'produccion.trazabilidad.gestionar', descripcion: '(En desuso desde MIGRACIÓN #38, ver problemas.gestionar) Registrar problemas del tablero de Producción (Referencias/Motivos) y agregarles causas raíz y medidas de solución' },
  // Módulo "Seguimiento de Producción" (antes una pestaña de Producción,
  // ahora su propia página en el portal, dentro de la sección Calidad): ver
  // la bitácora completa de casos (todas las fábricas/referencias/motivos,
  // no solo lo que se ve al abrir un caso puntual desde Producción) pide
  // este permiso propio y más restringido, en vez de reusar 'calidad.ver'
  // -- quien tenga 'produccion.trazabilidad.gestionar' también puede
  // entrar (no tendría sentido poder editar un caso pero no poder ver la
  // lista de casos).
  // OJO (MIGRACIÓN #38, 08/09): la bitácora de Seguimiento de Producción
  // ahora se lee del módulo Problemas (filtrado a origen='produccion'), así
  // que ver esta pantalla realmente necesita además 'problemas.ver' (o
  // gestionar/eliminar) -- este permiso ya no alcanza por sí solo.
  { codigo: 'produccion.trazabilidad.ver', descripcion: '(Ver también problemas.ver, MIGRACIÓN #38) Ver el módulo de Seguimiento de Producción (bitácora de casos: causas raíz y medidas de solución)' },
  // Pedido por Julio (04/09): poder borrar una causa raíz o una medida ya
  // registrada (por ejemplo, si se agregó por error) es un permiso aparte
  // del de agregar ('produccion.trazabilidad.gestionar') -- así se puede
  // dar a alguien la capacidad de agregar sin la de borrar, o al revés. Ver
  // el ejemplo (ver, agregar, eliminar) que dio: quedan como 3 permisos
  // independientes en vez de que "gestionar" incluya borrar. Borrar una
  // causa raíz borra también sus medidas; no se puede borrar la última
  // causa raíz de un caso (routes/produccion.js lo rechaza).
  // OJO (MIGRACIÓN #38, 08/09): en desuso, mismo motivo que
  // produccion.trazabilidad.gestionar de arriba -- ver problemas.eliminar.
  { codigo: 'produccion.trazabilidad.eliminar', descripcion: '(En desuso desde MIGRACIÓN #38, ver problemas.eliminar) Eliminar causas raíz y medidas ya registradas en un caso de Producción (Referencias/Motivos)' },
  // Módulo "Reportes por Áreas" (pedido por Julio, 04/09): Reporte Rápido
  // (incidencia inmediata sin causa raíz todavía), Reporte de Problema
  // Completo (causa raíz + medidas, escalado desde uno Rápido) y Reporte
  // Informativo (boletín entre áreas). Mismo criterio de 4 permisos
  // separados que ya usa Trazabilidad de Producción (ver/crear/gestionar/
  // eliminar), para poder dar a alguien solo la capacidad de crear reportes
  // (por ejemplo, un operario) sin darle la de investigar/escalar/borrar.
  // OJO (MIGRACIÓN #38, 08/09): Reportes Rápido y Completo se eliminaron --
  // este módulo ahora solo administra Reportes Informativos (boletines
  // entre áreas). Todo lo que era seguimiento de un problema real (causa
  // raíz + medidas) se mudó al módulo Problemas (ver permisos
  // 'problemas.*' más abajo).
  { codigo: 'reportes.ver',        descripcion: 'Ver el módulo de Reportes por Áreas (Reportes Informativos de todas las áreas)' },
  { codigo: 'reportes.crear',      descripcion: 'Publicar Reportes Informativos' },
  { codigo: 'reportes.gestionar',  descripcion: 'Editar un Reporte Informativo ya publicado' },
  { codigo: 'reportes.eliminar',   descripcion: 'Eliminar adjuntos ya registrados en un Reporte de Áreas' },
  // Módulo "Problemas" (rediseño de la MIGRACIÓN #38, pedido por Julio
  // 08/09): reemplaza a Trazabilidad de Producción y a la parte de causa
  // raíz/medidas de Reportes por Áreas -- un solo lugar para registrar y
  // hacerle seguimiento a CUALQUIER problema (de Producción, de un área, o
  // detectado caminando la planta / revisando los "tops"), sin depender de
  // la memoria de nadie. Mismo criterio de 4 permisos separados que ya
  // usaban esos dos módulos -- 'problemas.ver' se puede asignar aparte, a
  // alguien que solo necesite ver la lista y las alertas de críticos (p.ej.
  // un encargado de área), sin darle además la capacidad de crear o editar.
  //
  // Reemplaza en la práctica a 'produccion.trazabilidad.ver/gestionar/
  // eliminar' y a la parte de causas/medidas de 'reportes.gestionar'/
  // 'reportes.eliminar' -- esos permisos viejos NO se borran (puede haber
  // roles ya armados con ellos, y el criterio del proyecto es no borrar
  // nada de una migración anterior), pero desde esta migración ya no dan
  // acceso a nada de causas raíz/medidas: a quien deba seguir viendo o
  // trabajando problemas hay que asignarle estos 4 nuevos desde Gestión →
  // Roles.
  { codigo: 'problemas.ver',        descripcion: 'Ver el módulo Problemas (lista completa, alertas de críticos y el detalle de cada uno)' },
  { codigo: 'problemas.crear',      descripcion: 'Registrar problemas nuevos en el módulo Problemas' },
  { codigo: 'problemas.gestionar',  descripcion: 'Editar un problema, agregar/editar sus causas raíz y medidas, descartarlo o reabrirlo' },
  { codigo: 'problemas.eliminar',   descripcion: 'Eliminar causas raíz y medidas ya registradas en un problema' },
];

module.exports = { PERMISOS_DISPONIBLES };
