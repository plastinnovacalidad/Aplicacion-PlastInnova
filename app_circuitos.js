// dotenv: carga el archivo .env (rutas de carpetas, archivos CSV, etc.) antes
// de leer cualquier variable de entorno. Si el .env no existe, simplemente no
// carga nada y el código sigue usando los valores por defecto de siempre.
require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const { DB_PATH, CARPETAS_FOTOS, CARPETA_FOTOS_CABLEADO, OBSOLETAS_DIR, DIAS_RETENCION_OBSOLETAS, DIAS_INACTIVIDAD_CIERRE_LOTES_ISO, PORT, RAIZ_PROYECTO } = require('./settings/paths');
const { inicializarBaseDatos } = require('./db/init');
const { getDb } = require('./db/connection');
const { manejadorDeErrores } = require('./middleware/errores');
const { limpiarObsoletas } = require('./utils/archivos');
const { cerrarLotesInactivos } = require('./data/iso2859');
const { sincronizarProduccion } = require('./scripts/sincronizar_produccion');

const app = express();

// Cabeceras de seguridad básicas (helmet). Se desactiva el Content-Security-
// Policy por defecto de helmet porque las páginas de este sistema usan
// estilos y scripts "inline" (atributos onclick, <style> en el mismo HTML);
// activar el CSP estricto por defecto rompería la interfaz actual. Queda
// como una mejora futura aparte, más invasiva, si se quiere endurecer más.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS: esta app no tiene un frontend en otro dominio ni se consume desde
// otros sitios, así que no hay ningún origen externo que deba poder leer
// las respuestas de la API desde el navegador. Se deja explícito (en vez de
// no decir nada) para que quede claro que es una decisión tomada a
// propósito, y sea fácil abrir un origen puntual el día que haga falta.
app.use(cors({ origin: false }));

app.use(express.json());
// La carpeta de archivos estáticos se llama "Public" (con mayúscula) en el
// proyecto; antes el código decía 'public' en minúscula, que en Windows no
// se nota (el sistema de archivos no distingue mayúsculas), pero en Linux o
// Mac sí rompería. Se usa la ruta completa y con el nombre real para que
// funcione igual sin importar el sistema operativo.
app.use(express.static(path.join(RAIZ_PROYECTO, 'Public')));

// Assets de marca (logos, isotipo) servidos directo desde la carpeta que
// entregó publicidad ("Plast Innova design system/assets"), en vez de
// mantener una copia aparte en Public/img — así solo hay un lugar donde
// vive el logo oficial, y si algún día lo actualizan ahí, se refleja en
// toda la app sin tocar código. Se expone solo la subcarpeta "assets" (no
// toda la carpeta del manual de marca), para no publicar por HTTP los
// documentos internos de guía/tokens/componentes que trae esa carpeta.
app.use('/marca', express.static(path.join(RAIZ_PROYECTO, 'Plast Innova design system', 'assets')));

// ======================== RUTAS ========================
// Cada módulo de negocio vive en su propio archivo bajo routes/ (y su
// correspondiente data/*.js con las consultas SQL). Todas siguen montadas
// bajo /api, exactamente con las mismas rutas de siempre — el frontend no
// necesita ningún cambio.
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/roles'));
app.use('/api', require('./routes/usuarios'));
app.use('/api', require('./routes/referencias'));
app.use('/api', require('./routes/observaciones'));
app.use('/api', require('./routes/recomendaciones'));
app.use('/api', require('./routes/garantias'));
app.use('/api', require('./routes/whatsapp'));
app.use('/api', require('./routes/metrologia'));
app.use('/api', require('./routes/iso2859'));
app.use('/api', require('./routes/auditoria'));
app.use('/api', require('./routes/calidad'));
app.use('/api', require('./routes/valoresCableado'));
app.use('/api', require('./routes/produccion'));

// Cualquier /api/... que no coincidió con ninguna ruta de arriba (ej. una URL
// mal escrita) responde con JSON en vez de la página HTML de error por
// defecto de Express, que es lo que espera el frontend.
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Manejador de errores centralizado: debe ir después de todas las rutas.
// Cualquier error que una ruta no haya manejado por su cuenta (por ejemplo,
// uno que llegue a través de asyncHandler) termina respondiendo aquí con el
// mismo formato de siempre ({ error: mensaje }), en vez de tumbar el
// servidor o mostrar una página de error genérica.
app.use(manejadorDeErrores);

// ======================== INICIAR SERVIDOR ========================
inicializarBaseDatos().then(() => {
  // whatsapp_bot_service ya fue requerido dentro de routes/whatsapp.js; Node
  // cachea el módulo, así que esta es la misma instancia (comportamiento de
  // siempre: un solo cliente de WhatsApp compartido).
  const whatsappService = require('./whatsapp_bot_service');
  whatsappService.iniciarBotWhatsApp(getDb());

  app.listen(PORT, () => {
    console.log(`\n🚀 Servidor en http://localhost:${PORT}`);
    console.log(`📁 BD: ${DB_PATH}`);
    console.log(`📁 Carpetas activas:`);
    CARPETAS_FOTOS.forEach((c, i) => console.log(`   [${i}] ${c}`));
    console.log(`📁 Fotos de cableado: ${CARPETA_FOTOS_CABLEADO}`);
    console.log(`📁 Obsoletas: ${OBSOLETAS_DIR} (se borra lo de más de ${DIAS_RETENCION_OBSOLETAS} días)\n`);
  });

  // Limpieza de uploads/obsoletas: una vez al arrancar y luego cada 24 horas,
  // para que la carpeta no crezca sin límite con fotos y planos que ya
  // fueron reemplazados por una versión nueva hace mucho tiempo.
  const ejecutarLimpiezaObsoletas = () => {
    const borrados = limpiarObsoletas(DIAS_RETENCION_OBSOLETAS);
    if (borrados > 0) console.log(`🧹 Limpieza de obsoletas: ${borrados} archivo(s) con más de ${DIAS_RETENCION_OBSOLETAS} días eliminado(s).`);
  };
  ejecutarLimpiezaObsoletas();
  setInterval(ejecutarLimpiezaObsoletas, 24 * 60 * 60 * 1000);

  // Cierre automático de lotes de Muestreos ISO 2859-1 que llevan
  // DIAS_INACTIVIDAD_CIERRE_LOTES_ISO días "Pendientes" sin ningún muestreo
  // nuevo (ver cerrarLotesInactivos en data/iso2859.js para el porqué): una
  // vez al arrancar y luego cada 24 horas, igual que la limpieza de
  // obsoletas de arriba.
  const ejecutarCierreLotesInactivosIso = async () => {
    try {
      const cerrados = await cerrarLotesInactivos(DIAS_INACTIVIDAD_CIERRE_LOTES_ISO);
      if (cerrados > 0) console.log(`🔒 Muestreos ISO 2859-1: ${cerrados} lote(s) cerrado(s) por ${DIAS_INACTIVIDAD_CIERRE_LOTES_ISO} día(s) sin actividad.`);
    } catch (e) {
      console.error('⚠️ Error cerrando lotes inactivos de ISO 2859-1:', e.message);
    }
  };
  ejecutarCierreLotesInactivosIso();
  setInterval(ejecutarCierreLotesInactivosIso, 24 * 60 * 60 * 1000);

  // Producción por Fábrica (rechazos + lotes): refresca Calidad.xlsx y
  // Lotes.xlsx en Excel (Power Query hacia la NAS) y sincroniza el resultado
  // hacia rechazos_produccion / lotes_produccion — una vez al arrancar y
  // luego cada 6 horas. Un fallo en un ciclo (Excel no abrió, no había
  // sesión de Windows iniciada, etc.) queda en el log y se reintenta solo en
  // el siguiente ciclo, sin tumbar el servidor (ver scripts/sincronizar_produccion.js).
  const ejecutarSincronizacionProduccion = async () => {
    try {
      await sincronizarProduccion();
    } catch (e) {
      console.error('⚠️ Error en la sincronización de Producción (rechazos/lotes):', e.message);
    }
  };
  ejecutarSincronizacionProduccion();
  setInterval(ejecutarSincronizacionProduccion, 6 * 60 * 60 * 1000);
});
