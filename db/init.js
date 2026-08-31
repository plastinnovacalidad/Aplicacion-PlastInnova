const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcryptjs');

const { DB_PATH, SALT_ROUNDS } = require('../settings/paths');
const { PERMISOS_DISPONIBLES } = require('../settings/permisos');
const { ahoraISO } = require('../utils/fechas');
const { setDb, getDb } = require('./connection');
const { recargarPermisos } = require('../middleware/auth');
const { importarCsvMetrologia } = require('../data/metrologia');
// Solo se usa para sembrar whatsapp_numeros una sola vez (MIGRACIÓN #13) con
// los valores que ya estaban en uso — de ahí en adelante, esos números se
// leen y administran desde la tabla, no desde aquí.
const configWhatsapp = require('../settings/config_whatsapp');
const { PERMISOS_BOT_DISPONIBLES } = require('../settings/permisosBot');

// Un hash de bcrypt siempre tiene este formato ($2a$/$2b$/$2y$ + costo +
// 53 caracteres); una contraseña en texto plano nunca lo tiene. Con esto
// se puede saber, sin guardar nada aparte, cuáles usuarios todavía tienen
// la contraseña vieja sin encriptar.
function esHashBcrypt(valor) {
  return typeof valor === 'string' && /^\$2[aby]\$\d{2}\$.{53}$/.test(valor);
}

// Migración de contraseñas en texto plano a bcrypt. Es transparente para
// los usuarios: cada quien sigue entrando con la misma contraseña de
// siempre, solo que a partir de aquí queda guardada encriptada en la base
// de datos en vez de en texto plano. Se puede correr tantas veces como se
// quiera (cada arranque del servidor) sin problema: a la segunda vez ya no
// encuentra ninguna contraseña sin encriptar y no hace nada.
async function migrarContrasenasAntiguas() {
  const db = getDb();
  try {
    const usuarios = await db.all('SELECT id, contrasena FROM usuarios');
    const pendientes = usuarios.filter(u => !esHashBcrypt(u.contrasena));
    if (pendientes.length === 0) return;

    for (const u of pendientes) {
      const hash = await bcrypt.hash(u.contrasena, SALT_ROUNDS);
      await db.run('UPDATE usuarios SET contrasena = ? WHERE id = ?', [hash, u.id]);
    }
    console.log(`🔒 ${pendientes.length} contraseña(s) migrada(s) a bcrypt.`);
  } catch (e) {
    console.error('⚠️ Error migrando contraseñas a bcrypt:', e.message);
  }
}

// ======================== BASE DE DATOS ========================
//
// HISTORIAL DE MIGRACIONES
// -------------------------------------------------------------------------
// Este proyecto no usa un framework formal de migraciones (como Knex o
// Sequelize); en su lugar, cada cambio de esquema posterior a la creación
// original de una tabla se aplica aquí mismo, justo después del bloque
// `CREATE TABLE IF NOT EXISTS`, como un `ALTER TABLE` (o script equivalente)
// envuelto en un try/catch que ignora el error "duplicate column name" /
// detecta con PRAGMA table_info si la columna ya existe. Esto hace que
// `inicializarBaseDatos()` sea segura de correr en cada arranque del
// servidor: en una base de datos nueva las tablas ya nacen con la columna
// (por el CREATE TABLE) y el ALTER falla silenciosamente; en una base de
// datos existente que todavía no tiene la columna, el ALTER la agrega una
// sola vez y en los arranques siguientes vuelve a fallar silenciosamente
// porque ya existe.
//
// Migraciones aplicadas hasta ahora (ver cada bloque "MIGRACIÓN #N" más
// abajo para el detalle):
//   #1 - moldes_medidas_detalle: agrega columna imagen_evidencia
//   #2 - usuarios: agrega columna created_at
//   #3 - seguimiento_cambios: elimina columna obsoleta codigo_base y agrega
//        referencia_id / motivo (recreando la tabla, porque SQLite no
//        soporta DROP COLUMN en las versiones usadas por este proyecto)
//   #4 - versiones: agrega columna necesita_prueba
//   #5 - permisos: elimina los códigos obsoletos metrologia.crear,
//        metrologia.editar y metrologia.medir (y sus asignaciones a roles)
//   #6 - iso_lotes: agrega el estado 'Cerrado_sin_auditoria' y las columnas
//        cierre_tipo/cierre_motivo/cerrado_por/fecha_cierre (recreando la
//        tabla, porque SQLite no soporta modificar un CHECK con ALTER TABLE)
//   #7 - garantias_tipificacion_problemas: tabla nueva con el catálogo de
//        causales de garantía (antes solo existían como texto libre); se
//        siembra una sola vez con los valores "G## - DESCRIPCIÓN" que ya
//        estaban en uso en la tabla garantias, para no perder el historial
//   #8 - registro_cambios: bitácora única de cambios para todo el sistema
//        (reemplaza la necesidad de crear una tabla de historial nueva por
//        cada módulo); se siembra una sola vez copiando lo que ya existía
//        en seguimiento_cambios, moldes_seguimiento_cambios e
//        iso_historial_planes, para que el registro global no arranque vacío
//   #9 - elimina seguimiento_cambios, moldes_seguimiento_cambios e
//        iso_historial_planes (ya copiadas a registro_cambios en la #8):
//        de ahí en adelante ese es el único lugar donde se guarda y se lee
//        el historial de cambios, para que no queden dos tablas con la
//        misma información
//   #10 - iso_lotes: agrega el estado 'Reclasificado' (recreando la tabla,
//        misma razón que la #6: SQLite no soporta modificar un CHECK con
//        ALTER TABLE). Es la disposición manual que puede darle Calidad a
//        un lote que salió Rechazado en la Auditoría Final, cuando se
//        decide usarlo en otra referencia o con otro fin en vez de
//        desecharlo — no cambia el veredicto estadístico ya calculado
//        (eso queda igual, para no perder el historial real de la
//        auditoría), solo el destino final que se le dio al lote.
//   #11 - iso_muestreos: agrega piezas_reclasificadas y piezas_reparadas
//        (columnas simples, ALTER TABLE normal). En un muestreo "En
//        Proceso", qué se hizo con las piezas defectuosas encontradas
//        (separarlas para otro uso, o repararlas) es un dato aparte de la
//        decisión sobre la máquina (Seguir/Alerta/Parar).
//   #12 - iso_lotes: agrega el estado 'Reparacion' (recreando la tabla,
//        misma razón que la #6/#10). Es la otra disposición manual para un
//        lote Rechazado, junto con 'Reclasificado'.
//   #13 - whatsapp_numeros: tabla nueva para administrar desde una pantalla
//        (en vez de solo desde el .env) quiénes están autorizados a usar el
//        bot y quién es el/los administrador(es) que reciben resúmenes y
//        alertas. Se siembra una sola vez con los números que ya estaban
//        configurados (WHATSAPP_NUMEROS/WHATSAPP_ADMIN_NUMERO), para que el
//        bot siga funcionando igual sin que nadie tenga que volver a
//        escribirlos.
//   #14 - whatsapp_alertas_config: tabla nueva con un interruptor
//        activo/inactivo (y, para la de pico de garantías, un umbral y una
//        ventana de días) por cada tipo de alerta de calidad que manda el
//        bot de WhatsApp. Se siembra una sola vez con todas las alertas
//        activas y el umbral de garantías en 10 por semana.
//   #15 - whatsapp_alertas_enviadas: tabla nueva para no mandar la misma
//        alerta de "pico de garantías" o el mismo resumen periódico dos
//        veces (por ejemplo, si el servidor se reinicia justo en el minuto
//        en que tocaba enviarlo).
//   #16 - whatsapp_numero_permisos: tabla nueva (numero_id, permiso) para
//        decidir, número por número, qué comandos puede usar cada quien
//        (ver settings/permisosBot.js) — antes cualquier número marcado
//        como administrador (es_admin) podía usar TODOS los comandos de
//        calidad, y cualquier número autorizado podía marcar entrada/salida
//        sin distinción. Se siembra una sola vez para que nadie pierda
//        acceso al pasar por esta migración: todo número activo recibe
//        'registro_entrada' (lo único que todos podían hacer antes), y
//        cada número que ya era es_admin=1 recibe además el resto de
//        permisos de calidad, para que siga pudiendo hacer todo lo que ya
//        venía haciendo.
//   #17 - whatsapp_alertas_config: agrega la fila 'lote_tratamiento_aplicado'
//        (INSERT OR IGNORE sobre la tabla que ya existe desde la #14, no la
//        vuelve a crear). Es un tipo de alerta nuevo: cuando Calidad decide
//        Reclasificar o Reparar un lote que había salido Rechazado, se
//        manda un aviso aparte con el tratamiento y el motivo — antes solo
//        se avisaba que el lote había sido rechazado, sin decir después qué
//        se hizo con él.
//   #18 - tablas nuevas del módulo "Valores y Cableado" (Electrónica):
//        elec_mediciones, elec_rangos_revision, elec_config_cableado (las
//        3 enganchadas a versiones.id — sin catálogo de referencia/color/
//        versión aparte, porque ese ya es el mismo de Circuitos SMD) y
//        elec_fotos_cableado (catálogo de fotos por forma de cableado,
//        compartida entre varias referencias). Los datos existentes se
//        cargan aparte con scripts/migrar_valores_cableado.js, no aquí.
//   #19 - elec_config_cableado: agrega columna no_aplica_medias. Algunas
//        referencias no manejan valores de "Medias (Bajas)" por diseño
//        (solo Altas) — antes eso se contaba como "faltante" en la alerta
//        de Valores y Cableado sin serlo. Se marca a mano por versión desde
//        "Editar Referencia".
//
// Si en el futuro se necesita otro cambio de esquema, seguir el mismo
// patrón: agregar un nuevo bloque "MIGRACIÓN #20" (y sumarlo a esta lista)
// en vez de modificar el CREATE TABLE original, para que instalaciones ya
// existentes también reciban el cambio la próxima vez que arranque el
// servidor.
// -------------------------------------------------------------------------
async function inicializarBaseDatos() {
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
  });
  db.configure('busyTimeout', 5000);
  await db.run('PRAGMA journal_mode = WAL;');
  console.log('📦 Conexión a SQLite establecida (WAL mode, busyTimeout=5000ms).');
  setDb(db);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT UNIQUE NOT NULL,
      descripcion TEXT,
      es_sistema INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS permisos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT UNIQUE NOT NULL,
      descripcion TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rol_permisos (
      rol_id INTEGER NOT NULL,
      permiso_id INTEGER NOT NULL,
      PRIMARY KEY (rol_id, permiso_id),
      FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (permiso_id) REFERENCES permisos(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      usuario TEXT UNIQUE NOT NULL,
      contrasena TEXT NOT NULL,
      rol_id INTEGER REFERENCES roles(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS recomendaciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referencia TEXT NOT NULL,
      recomendacion TEXT NOT NULL,
      usuario_id INTEGER,
      usuario_nombre TEXT,
      fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
      eliminada INTEGER DEFAULT 0,
      eliminada_por INTEGER,
      fecha_eliminacion DATETIME,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
      FOREIGN KEY (eliminada_por) REFERENCES usuarios(id)
    );
    CREATE TABLE IF NOT EXISTS referencias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo_base TEXT UNIQUE NOT NULL,
      creado_por INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (creado_por) REFERENCES usuarios(id)
    );
    CREATE TABLE IF NOT EXISTS versiones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referencia_id INTEGER NOT NULL,
      version TEXT NOT NULL,
      imagen_ruta TEXT,
      estado TEXT CHECK(estado IN ('activa', 'obsoleta')) DEFAULT 'activa',
      creado_por INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      necesita_prueba INTEGER DEFAULT 0,
      FOREIGN KEY (referencia_id) REFERENCES referencias(id),
      FOREIGN KEY (creado_por) REFERENCES usuarios(id)
    );
    -- seguimiento_cambios se quitó de aquí: se unificó en registro_cambios
    -- (ver MIGRACIÓN #8/#9 más abajo). Si esta línea llegara a faltar en
    -- este archivo alguna vez y alguien la reintrodujera sin querer, la
    -- MIGRACIÓN #9 la volvería a eliminar en el siguiente arranque.
     CREATE TABLE IF NOT EXISTS observaciones (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       referencia_id INTEGER NOT NULL UNIQUE,
       observacion TEXT,
       actualizado_por INTEGER,
       actualizado_en DATETIME,
       FOREIGN KEY (referencia_id) REFERENCES referencias(id) ON DELETE CASCADE,
       FOREIGN KEY (actualizado_por) REFERENCES usuarios(id)
     );
     CREATE TABLE IF NOT EXISTS whatsapp_registros (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       telefono TEXT NOT NULL,
       tipo TEXT NOT NULL,
       area_id INTEGER,
       area_nombre TEXT,
       entrada TEXT,
       salida TEXT,
       duracion TEXT,
       timestamp_entrada DATETIME,
       timestamp_salida DATETIME,
       cerrado_por_admin INTEGER DEFAULT 0
     );
     CREATE TABLE IF NOT EXISTS whatsapp_sesiones_activas (
       telefono TEXT PRIMARY KEY,
       area_id INTEGER,
       area_nombre TEXT,
       entrada TEXT,
       entrada_raw DATETIME
     );
     CREATE TABLE IF NOT EXISTS moldes_referencias (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       codigo_base TEXT UNIQUE NOT NULL,
       creado_por INTEGER,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
       FOREIGN KEY (creado_por) REFERENCES usuarios(id)
     );
     CREATE TABLE IF NOT EXISTS moldes_versiones (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       referencia_id INTEGER NOT NULL,
       version TEXT NOT NULL,
       archivo_ruta TEXT,
       estado TEXT CHECK(estado IN ('activa', 'obsoleta')) DEFAULT 'activa',
       creado_por INTEGER,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
       FOREIGN KEY (referencia_id) REFERENCES moldes_referencias(id) ON DELETE CASCADE,
       FOREIGN KEY (creado_por) REFERENCES usuarios(id)
     );
     CREATE TABLE IF NOT EXISTS moldes_cotas (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       referencia_id INTEGER NOT NULL,
       cota TEXT NOT NULL,
       medida_estandar REAL NOT NULL,
       tolerancia REAL NOT NULL,
       tolerancia_maxima REAL NOT NULL,
       tolerancia_minima REAL NOT NULL,
       FOREIGN KEY (referencia_id) REFERENCES moldes_referencias(id) ON DELETE CASCADE
     );
     CREATE TABLE IF NOT EXISTS moldes_inspecciones (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       referencia_id INTEGER NOT NULL,
       fecha TEXT NOT NULL,
       responsable TEXT NOT NULL,
       lote TEXT,
       molde TEXT,
       imagen_evidencia TEXT,
       creado_por INTEGER,
       created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
       FOREIGN KEY (referencia_id) REFERENCES moldes_referencias(id) ON DELETE CASCADE,
       FOREIGN KEY (creado_por) REFERENCES usuarios(id)
     );
     CREATE TABLE IF NOT EXISTS moldes_medidas_detalle (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       inspeccion_id INTEGER NOT NULL,
       cota_id INTEGER NOT NULL,
       medida_real REAL NOT NULL,
       estado TEXT CHECK(estado IN ('CONFORME', 'FUERA DE TOLERANCIA')) NOT NULL,
       imagen_evidencia TEXT,
       FOREIGN KEY (inspeccion_id) REFERENCES moldes_inspecciones(id) ON DELETE CASCADE,
       FOREIGN KEY (cota_id) REFERENCES moldes_cotas(id) ON DELETE CASCADE
     );
     -- moldes_seguimiento_cambios se quitó de aquí por la misma razón que
     -- seguimiento_cambios arriba: unificado en registro_cambios.
     -- Módulo de Garantías: estas 3 tablas ya existían con datos en base_datos.db,
     -- pero nunca se creaban aquí en el script de inicialización. Se agregan con
     -- IF NOT EXISTS (no toca ni borra nada de lo que ya tienes) para que el
     -- módulo también funcione en una instalación nueva o si se restaura una
     -- base de datos vacía.
     CREATE TABLE IF NOT EXISTS garantias (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       no_garantia TEXT,
       fecha_reporte TEXT,
       responsable TEXT,
       vendedor_distribuidor TEXT,
       memorando TEXT,
       op_pedido TEXT,
       cliente TEXT,
       nit_cliente TEXT,
       ciudad TEXT,
       remision TEXT,
       referencia TEXT,
       cantidad INTEGER,
       tipo_solicitud TEXT,
       observaciones TEXT,
       fecha_revision TEXT,
       estado TEXT,
       lote_fecha TEXT,
       problema TEXT,
       quien_aprobo_rechazo TEXT,
       observacion_calidad TEXT,
       tipo_circuito TEXT,
       fecha_creacion TEXT
     );
     CREATE TABLE IF NOT EXISTS clientes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       nit TEXT,
       razon_social TEXT,
       codigo_vendedor TEXT,
       nombre_vendedor TEXT,
       ciudad TEXT
     );
     CREATE TABLE IF NOT EXISTS referencias_pt (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       referencia TEXT,
       linea_base TEXT,
       tipo_circuito TEXT
     );
     -- Módulo de Muestreos ISO 2859-1: viene de integrar una app aparte
     -- (iso2859-app) que ya tenía datos reales en uso (referencias,
     -- tipificación de defectos, lotes y muestreos). Todas las tablas usan
     -- el prefijo "iso_" para no chocar con nombres ya existentes en esta
     -- base de datos (por ejemplo, "referencias" ya es la tabla de
     -- referencias de circuitos SMD — nada que ver con las referencias de
     -- producto de este módulo). Los datos históricos de la app anterior se
     -- copian aparte con scripts/migrar_iso2859.js (no aquí), porque ese es
     -- un paso de una sola vez con su propio archivo fuente, no algo que
     -- deba correr en cada arranque del servidor.
     CREATE TABLE IF NOT EXISTS iso_referencias (
       nombre TEXT PRIMARY KEY,
       tipo_producto TEXT NOT NULL,
       estado TEXT DEFAULT 'Activo'
     );
     CREATE TABLE IF NOT EXISTS iso_planes_muestreo (
       producto TEXT PRIMARY KEY,
       nivel_inspeccion TEXT NOT NULL,
       nca_mayores REAL NOT NULL,
       nca_menores REAL NOT NULL,
       nca_criticos REAL NOT NULL
     );
     CREATE TABLE IF NOT EXISTS iso_tipificacion_defectos (
       id INTEGER PRIMARY KEY,
       codigo TEXT UNIQUE NOT NULL,
       area TEXT NOT NULL,
       descripcion TEXT,
       estado TEXT,
       severidad TEXT DEFAULT 'Menor' CHECK(severidad IN ('Crítico','Mayor','Menor'))
     );
     CREATE TABLE IF NOT EXISTS iso_areas (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       nombre TEXT NOT NULL,
       modulo TEXT NOT NULL CHECK(modulo IN ('Recepcion','Produccion','Ambos')),
       estado TEXT DEFAULT 'Activo'
     );
     CREATE TABLE IF NOT EXISTS iso_revisiones (
       id_revision INTEGER PRIMARY KEY AUTOINCREMENT,
       numero_revision TEXT UNIQUE NOT NULL,
       referencia TEXT NOT NULL,
       cantidad_programada INTEGER,
       maquina TEXT,
       fecha_inicio TEXT DEFAULT (datetime('now','localtime'))
     );
     CREATE TABLE IF NOT EXISTS iso_lotes (
       id_lote TEXT PRIMARY KEY,
       referencia TEXT NOT NULL REFERENCES iso_referencias(nombre),
       modulo TEXT NOT NULL CHECK(modulo IN ('Recepcion','Produccion')),
       cantidad_total INTEGER NOT NULL,
       metodo_en_proceso TEXT,
       fecha_creacion TEXT DEFAULT (datetime('now','localtime')),
       estado_final TEXT DEFAULT 'Pendiente' CHECK(estado_final IN ('Pendiente','Aceptado','Aceptado_con_obs','Rechazado','Cerrado_sin_auditoria','Reclasificado','Reparacion')),
       plan_actual TEXT DEFAULT 'Normal',
       id_revision INTEGER REFERENCES iso_revisiones(id_revision),
       proveedor TEXT,
       oc_factura TEXT,
       maquina TEXT,
       cierre_tipo TEXT CHECK(cierre_tipo IN ('automatico','manual')),
       cierre_motivo TEXT,
       cerrado_por TEXT,
       fecha_cierre TEXT
     );
     CREATE TABLE IF NOT EXISTS iso_muestreos (
       id_muestreo INTEGER PRIMARY KEY AUTOINCREMENT,
       id_lote TEXT NOT NULL REFERENCES iso_lotes(id_lote),
       tipo TEXT NOT NULL CHECK(tipo IN ('Primera_Pieza','En_Proceso','Final')),
       fecha_hora TEXT DEFAULT (datetime('now','localtime')),
       analista TEXT NOT NULL,
       cantidad_muestreada INTEGER NOT NULL,
       decision TEXT NOT NULL,
       observaciones TEXT,
       turno TEXT,
       area TEXT,
       operario TEXT,
       piezas_reclasificadas INTEGER DEFAULT 0,
       piezas_reparadas INTEGER DEFAULT 0
     );
     CREATE TABLE IF NOT EXISTS iso_defectos_encontrados (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       id_muestreo INTEGER NOT NULL REFERENCES iso_muestreos(id_muestreo),
       codigo_defecto TEXT NOT NULL REFERENCES iso_tipificacion_defectos(codigo),
       cantidad INTEGER NOT NULL DEFAULT 1
     );
     -- iso_historial_planes (y su índice idx_iso_historial_ref) se quitaron
     -- de aquí por la misma razón: unificado en registro_cambios.
     CREATE INDEX IF NOT EXISTS idx_iso_muestreo_lote ON iso_muestreos(id_lote);
     CREATE INDEX IF NOT EXISTS idx_iso_defecto_muestreo ON iso_defectos_encontrados(id_muestreo);
     CREATE INDEX IF NOT EXISTS idx_iso_lotes_referencia ON iso_lotes(referencia);
     CREATE INDEX IF NOT EXISTS idx_iso_lotes_modulo ON iso_lotes(modulo);
     CREATE INDEX IF NOT EXISTS idx_iso_muestreos_fecha ON iso_muestreos(fecha_hora);
   `);

  // MIGRACIÓN #1: moldes_medidas_detalle — agregar columna imagen_evidencia
  // (permite adjuntar una foto de evidencia a cada medida individual dentro
  // de una inspección de molde, no solo a la inspección completa).
  try {
    const colsMedidas = await db.all("PRAGMA table_info(moldes_medidas_detalle)");
    if (!colsMedidas.map(c => c.name).includes('imagen_evidencia')) {
      await db.run('ALTER TABLE moldes_medidas_detalle ADD COLUMN imagen_evidencia TEXT');
      console.log('➕ Columna imagen_evidencia agregada a moldes_medidas_detalle');
    }
  } catch (e) {
    console.error('⚠️ Error verificando columna imagen_evidencia en moldes_medidas_detalle:', e.message);
  }

  // MIGRACIÓN #2: usuarios — agregar columna created_at
  // (instalaciones creadas antes de que esta columna existiera no la tenían;
  // se agrega para poder mostrar fecha de creación de cada usuario).
  try {
    const colsUsuarios = await db.all("PRAGMA table_info(usuarios)");
    if (!colsUsuarios.map(c => c.name).includes('created_at')) {
      await db.run('ALTER TABLE usuarios ADD COLUMN created_at DATETIME');
      console.log('➕ Columna created_at agregada a usuarios');
    }
  } catch (e) {
    console.error('⚠️ Error verificando columna created_at en usuarios:', e.message);
  }

  // MIGRACIÓN #3: seguimiento_cambios — eliminar columna obsoleta
  // codigo_base y agregar referencia_id/motivo si faltan.
  // codigo_base quedó obsoleto al pasar a referenciar por id (más confiable
  // si el código de una referencia cambia); como SQLite (en las versiones
  // usadas aquí) no soporta DROP COLUMN, la única forma de quitarla es
  // recrear la tabla completa y migrar los datos fila por fila.
  // Esta migración deja de tener nada que hacer una vez que la tabla se
  // elimina del todo (ver MIGRACIÓN #9, más abajo) — se deja el bloque
  // completo (en vez de borrarlo) como referencia histórica de por qué la
  // tabla tenía la forma que tenía justo antes de unificarse en
  // registro_cambios, pero ya no debe ejecutar nada en instalaciones nuevas.
  try {
    const tablaSeg = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='seguimiento_cambios'");
    if (!tablaSeg) {
      // no-op: la tabla ya no existe (migrada a registro_cambios)
    } else {
    const colsSeg = await db.all("PRAGMA table_info(seguimiento_cambios)");
    const colNamesSeg = colsSeg.map(c => c.name);
    if (colNamesSeg.includes('codigo_base')) {
      console.log('🔄 Migrando tabla seguimiento_cambios (eliminando codigo_base obsoleto)...');
      await db.exec(`
        CREATE TABLE seguimiento_cambios_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          referencia_id INTEGER NOT NULL,
          tipo_cambio TEXT CHECK(tipo_cambio IN ('creacion', 'nueva_version', 'modificacion')) NOT NULL,
          cambio TEXT NOT NULL,
          hecho_por INTEGER NOT NULL,
          fecha_cambio DATETIME DEFAULT CURRENT_TIMESTAMP,
          motivo TEXT,
          FOREIGN KEY (referencia_id) REFERENCES referencias(id),
          FOREIGN KEY (hecho_por) REFERENCES usuarios(id)
        );
      `);
      const rows = await db.all('SELECT * FROM seguimiento_cambios');
      for (const row of rows) {
        let refId = row.referencia_id || 0;
        if ((!refId || refId === 0) && row.codigo_base) {
          const ref = await db.get('SELECT id FROM referencias WHERE codigo_base = ?', [row.codigo_base]);
          if (ref) refId = ref.id;
        }
        await db.run(
          'INSERT INTO seguimiento_cambios_new (id, referencia_id, tipo_cambio, cambio, hecho_por, fecha_cambio, motivo) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [row.id, refId, row.tipo_cambio, row.cambio, row.hecho_por, row.fecha_cambio, row.motivo || null]
        );
      }
      await db.run('DROP TABLE seguimiento_cambios');
      await db.run('ALTER TABLE seguimiento_cambios_new RENAME TO seguimiento_cambios');
      console.log('✅ Tabla seguimiento_cambios migrada correctamente.');
    } else {
      // Si no tiene codigo_base, solo verificar motivo y referencia_id
      if (!colNamesSeg.includes('referencia_id')) {
        await db.run('ALTER TABLE seguimiento_cambios ADD COLUMN referencia_id INTEGER');
        console.log('➕ Columna referencia_id agregada a seguimiento_cambios');
      }
      if (!colNamesSeg.includes('motivo')) {
        await db.run('ALTER TABLE seguimiento_cambios ADD COLUMN motivo TEXT');
        console.log('➕ Columna motivo agregada a seguimiento_cambios');
      }
    }
    }
  } catch (e) {
    console.error('⚠️ Error migrando seguimiento_cambios:', e.message);
  }

  // MIGRACIÓN #4: versiones — agregar columna necesita_prueba
  // (marca si una nueva versión de una referencia necesita pasar por
  // pruebas antes de darse por buena, distinto del estado activa/obsoleta).
  try {
    const columnsVer = await db.all("PRAGMA table_info(versiones)");
    const colNamesVer = columnsVer.map(c => c.name);
    if (!colNamesVer.includes('necesita_prueba')) {
      await db.run('ALTER TABLE versiones ADD COLUMN necesita_prueba INTEGER DEFAULT 0');
      console.log('➕ Columna necesita_prueba agregada a versiones');
    }
  } catch (e) {
    console.error('⚠️ Error verificando columnas de versiones:', e.message);
  }

  // Insertar catálogo de permisos
  for (const p of PERMISOS_DISPONIBLES) {
    await db.run('INSERT OR IGNORE INTO permisos (codigo, descripcion) VALUES (?, ?)', [p.codigo, p.descripcion]);
  }

  // Crear roles por defecto si no existen
  await db.run("INSERT OR IGNORE INTO roles (nombre, descripcion, es_sistema) VALUES ('admin', 'Administrador total', 1)");
  await db.run("INSERT OR IGNORE INTO roles (nombre, descripcion, es_sistema) VALUES ('inspector', 'Inspector de calidad', 1)");
  await db.run("INSERT OR IGNORE INTO roles (nombre, descripcion, es_sistema) VALUES ('operario', 'Operario de planta', 1)");

  // Asignar permisos a roles por defecto
  const rolesDefault = [
    { nombre: 'admin',     permisos: PERMISOS_DISPONIBLES.map(p => p.codigo) },
    // 'metrologia.gestion' se agrega explícitamente aquí porque el rol
    // inspector ya lo tenía asignado desde antes (con el código viejo que no
    // estaba en este catálogo); se deja igual para no quitarle a inspector
    // ningún permiso que ya tenía en la práctica.
    // 'iso2859.gestion' se agrega por la misma razón: inspector ya tiene
    // acceso maestro a los demás módulos de calidad (metrologia.gestion),
    // y el muestreo ISO 2859 es justamente una función de inspección de
    // calidad, así que sigue la misma lógica.
    { nombre: 'inspector', permisos: ['referencias.ver','referencias.editar','versiones.crear','recomendaciones.ver','recomendaciones.crear','recomendaciones.eliminar','gestion.ver','observaciones.ver','observaciones.editar','garantias.ver','garantias.crear','garantias.editar','garantias.eliminar','garantias.dashboard','portal.volver','whatsapp.bot.ver','whatsapp.bot.gestionar','metrologia.ver','metrologia.inspeccionar','metrologia.versiones','metrologia.historial','metrologia.auditoria','metrologia.crear_referencia','metrologia.editar_cotas','metrologia.gestion','iso2859.ver','iso2859.crear_lote','iso2859.muestrear','iso2859.cambiar_plan','iso2859.reportes','iso2859.gestion','calidad.ver','valores_cableado.ver','valores_cableado.gestion'] },
    { nombre: 'operario',  permisos: ['referencias.ver','recomendaciones.crear','observaciones.ver'] },
  ];

  for (const r of rolesDefault) {
    const rolRow = await db.get('SELECT id FROM roles WHERE nombre = ?', [r.nombre]);
    if (rolRow) {
      for (const codigo of r.permisos) {
        const permRow = await db.get('SELECT id FROM permisos WHERE codigo = ?', [codigo]);
        if (permRow) {
          await db.run('INSERT OR IGNORE INTO rol_permisos (rol_id, permiso_id) VALUES (?, ?)', [rolRow.id, permRow.id]);
        }
      }
    }
  }

  // MIGRACIÓN #5: limpiar códigos de permiso obsoletos ('metrologia.crear',
  // 'metrologia.editar', 'metrologia.medir'). Eran de una versión anterior
  // del catálogo de permisos (settings/permisos.js): ya no los usa ninguna
  // ruta ni pantalla, pero seguían en la tabla `permisos` (y asignados a
  // admin/inspector) desde antes. Se borran junto con las asignaciones que
  // los referenciaban, para que el catálogo de permisos quede al día con lo
  // que el código realmente usa.
  try {
    const codigosObsoletos = ['metrologia.crear', 'metrologia.editar', 'metrologia.medir'];
    const placeholders = codigosObsoletos.map(() => '?').join(',');
    const filasObsoletas = await db.all(`SELECT id FROM permisos WHERE codigo IN (${placeholders})`, codigosObsoletos);
    if (filasObsoletas.length > 0) {
      const idsObsoletos = filasObsoletas.map(f => f.id);
      const idPlaceholders = idsObsoletos.map(() => '?').join(',');
      await db.run(`DELETE FROM rol_permisos WHERE permiso_id IN (${idPlaceholders})`, idsObsoletos);
      await db.run(`DELETE FROM permisos WHERE id IN (${idPlaceholders})`, idsObsoletos);
    }
  } catch (e) {
    console.error('⚠️ Error limpiando permisos obsoletos:', e.message);
  }

  // MIGRACIÓN #6: iso_lotes — agregar el estado 'Cerrado_sin_auditoria' y las
  // columnas que registran cómo se llegó a él (cierre_tipo, cierre_motivo,
  // cerrado_por, fecha_cierre).
  //
  // Nace de un problema real de uso: en Producción, un lote puede recibir
  // varias pasadas "En Proceso" sin que quede claro cuándo terminó esa
  // corrida, así que nunca llega a tener una Auditoría Final y se queda en
  // "Pendiente" para siempre. Este estado nuevo permite cerrar esos lotes
  // —a mano, o solo por inactividad (ver cerrarLotesInactivos en
  // data/iso2859.js)— sin fingir un veredicto de calidad que nunca se hizo:
  // es un estado aparte de Aceptado/Rechazado, no un sinónimo de ninguno
  // de los dos.
  //
  // SQLite no permite modificar un CHECK con ALTER TABLE, así que —igual que
  // la migración #3 con seguimiento_cambios— hay que recrear la tabla y
  // copiar los datos.
  try {
    const infoLotes = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='iso_lotes'");
    if (infoLotes && !infoLotes.sql.includes('Cerrado_sin_auditoria')) {
      console.log('🔄 Migrando tabla iso_lotes (agregando estado Cerrado_sin_auditoria)...');
      await db.exec(`
        CREATE TABLE iso_lotes_new (
          id_lote TEXT PRIMARY KEY,
          referencia TEXT NOT NULL REFERENCES iso_referencias(nombre),
          modulo TEXT NOT NULL CHECK(modulo IN ('Recepcion','Produccion')),
          cantidad_total INTEGER NOT NULL,
          metodo_en_proceso TEXT,
          fecha_creacion TEXT DEFAULT (datetime('now','localtime')),
          estado_final TEXT DEFAULT 'Pendiente' CHECK(estado_final IN ('Pendiente','Aceptado','Aceptado_con_obs','Rechazado','Cerrado_sin_auditoria')),
          plan_actual TEXT DEFAULT 'Normal',
          id_revision INTEGER REFERENCES iso_revisiones(id_revision),
          proveedor TEXT,
          oc_factura TEXT,
          maquina TEXT,
          cierre_tipo TEXT CHECK(cierre_tipo IN ('automatico','manual')),
          cierre_motivo TEXT,
          cerrado_por TEXT,
          fecha_cierre TEXT
        );
        INSERT INTO iso_lotes_new (id_lote, referencia, modulo, cantidad_total, metodo_en_proceso, fecha_creacion, estado_final, plan_actual, id_revision, proveedor, oc_factura, maquina)
          SELECT id_lote, referencia, modulo, cantidad_total, metodo_en_proceso, fecha_creacion, estado_final, plan_actual, id_revision, proveedor, oc_factura, maquina FROM iso_lotes;
        DROP TABLE iso_lotes;
        ALTER TABLE iso_lotes_new RENAME TO iso_lotes;
        CREATE INDEX IF NOT EXISTS idx_iso_lotes_referencia ON iso_lotes(referencia);
        CREATE INDEX IF NOT EXISTS idx_iso_lotes_modulo ON iso_lotes(modulo);
      `);
      console.log('✅ Tabla iso_lotes migrada correctamente.');
    }
  } catch (e) {
    console.error('⚠️ Error migrando iso_lotes:', e.message);
  }

  // MIGRACIÓN #7: garantias_tipificacion_problemas — catálogo de causales de
  // garantía (equivalente, para el módulo de Garantías, al catálogo de
  // defectos de ISO 2859-1). Antes el campo "Causal / Problema" era texto
  // libre; en la práctica siempre se escribía como "G## - DESCRIPCIÓN" con
  // un conjunto pequeño y estable de valores, así que se convierte en un
  // catálogo de verdad para poder ofrecerlo como autocompletar al
  // registrar una garantía, en vez de que cada quien lo vuelva a escribir
  // a mano cada vez (con el riesgo de errores de tipeo que eso trae).
  //
  // La siembra inicial sale de los valores que ya estaban en uso en la
  // tabla garantias (columna "problema"), separando "G12 - NO PRENDE" en
  // codigo="G12" y descripcion="NO PRENDE". Solo se siembra una vez, la
  // primera vez que se crea la tabla — después de eso, los códigos se
  // administran desde la pestaña "Catálogos" (ver routes/garantias.js).
  try {
    const infoProblemas = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='garantias_tipificacion_problemas'");
    if (!infoProblemas) {
      console.log('🔄 Creando tabla garantias_tipificacion_problemas...');
      await db.exec(`
        CREATE TABLE garantias_tipificacion_problemas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          codigo TEXT UNIQUE NOT NULL,
          descripcion TEXT NOT NULL,
          estado TEXT DEFAULT 'Activo' CHECK(estado IN ('Activo','Inactivo'))
        );
      `);
      const existentes = await db.all(
        "SELECT DISTINCT problema FROM garantias WHERE problema IS NOT NULL AND TRIM(problema) != ''"
      );
      const vistos = new Set();
      for (const { problema } of existentes) {
        const idx = problema.indexOf(' - ');
        const codigo = (idx === -1 ? problema : problema.slice(0, idx)).trim();
        const descripcion = (idx === -1 ? '' : problema.slice(idx + 3)).trim() || problema.trim();
        if (!codigo || vistos.has(codigo.toUpperCase())) continue;
        vistos.add(codigo.toUpperCase());
        await db.run(
          `INSERT OR IGNORE INTO garantias_tipificacion_problemas (codigo, descripcion) VALUES (?, ?)`,
          [codigo, descripcion]
        );
      }
      console.log(`✅ Tabla garantias_tipificacion_problemas creada y sembrada con ${vistos.size} causal(es) ya en uso.`);
    }
  } catch (e) {
    console.error('⚠️ Error creando garantias_tipificacion_problemas:', e.message);
  }

  // MIGRACIÓN #8: registro_cambios — bitácora única de cambios de todo el
  // sistema. Antes de esto, cada módulo que quería guardar su propio
  // historial tenía que crear su propia tabla (seguimiento_cambios,
  // moldes_seguimiento_cambios, iso_historial_planes...), y otros módulos
  // enteros (Catálogos, Roles, Usuarios, Garantías) no dejaban ningún
  // rastro de quién cambió qué. Esta tabla es el reemplazo: cualquier ruta
  // que necesite guardar "quién cambió qué y cuándo" llama a
  // data/auditoria.js -> registrarCambio(), sin crear una tabla nueva. La
  // columna `entidad` es la que permite filtrar por módulo/tabla en la
  // pantalla "📜 Registro de Cambios" (Public/gestion.html).
  //
  // Las tablas de historial que ya existían NO se eliminan ni dejan de
  // usarse — las pantallas que ya las leían (Historial de una referencia
  // SMD, pestaña "Cambios" de un molde) siguen funcionando igual. Lo que
  // se agrega es una escritura doble hacia adelante (ver data/referencias.js
  // e data/metrologia.js), más esta copia de una sola vez de lo que ya
  // tenían, para que el registro global no arranque vacío.
  try {
    const infoRegistro = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='registro_cambios'");
    if (!infoRegistro) {
      console.log('🔄 Creando tabla registro_cambios...');
      await db.exec(`
        CREATE TABLE registro_cambios (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          modulo TEXT NOT NULL,
          entidad TEXT NOT NULL,
          entidad_id TEXT,
          accion TEXT NOT NULL CHECK(accion IN ('Creación','Edición','Eliminación')),
          detalle TEXT,
          hecho_por INTEGER,
          hecho_por_nombre TEXT,
          fecha DATETIME DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (hecho_por) REFERENCES usuarios(id)
        );
        CREATE INDEX idx_registro_cambios_entidad ON registro_cambios(entidad);
        CREATE INDEX idx_registro_cambios_fecha ON registro_cambios(fecha);
        CREATE INDEX idx_registro_cambios_usuario ON registro_cambios(hecho_por);
      `);

      // "inspeccion" se deja fuera a propósito: son lecturas/mediciones del
      // día a día, no cambios a un catálogo o a un plano — la propia
      // pantalla de Metrología ya las excluye de su tabla de "Cambios" hoy
      // (ver listarSeguimientoSinInspeccion en data/metrologia.js).
      const mapearAccion = (tipoCambio) => {
        if (!tipoCambio) return 'Edición';
        if (tipoCambio.startsWith('creacion')) return 'Creación';
        return 'Edición';
      };

      // El registro global se ordena por esta columna como texto, así que
      // todas las fechas tienen que quedar en el mismo formato ISO 8601 que
      // usa ahoraISO() (data/auditoria.js) para los cambios nuevos. Las
      // tablas viejas casi siempre ya están así, pero algunas filas antiguas
      // (de versiones de la app anteriores a que existiera ahoraISO()) tienen
      // formatos distintos (con "/" en vez de "-", sin segundos, etc.) que
      // ordenarían mal si se copiaran tal cual — se normalizan aquí, y si
      // alguna fecha no se puede interpretar, se usa "ahora" en vez de
      // perder la fila.
      const normalizarFecha = (valor) => {
        if (valor) {
          const d = new Date(valor);
          if (!isNaN(d.getTime())) return d.toISOString();
        }
        return ahoraISO();
      };

      const histSmd = await db.all(`
        SELECT s.tipo_cambio, s.cambio, s.motivo, s.hecho_por, s.fecha_cambio, r.codigo_base
        FROM seguimiento_cambios s LEFT JOIN referencias r ON s.referencia_id = r.id
      `);
      for (const h of histSmd) {
        await db.run(
          `INSERT INTO registro_cambios (modulo, entidad, entidad_id, accion, detalle, hecho_por, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ['Circuitos SMD', 'referencias', h.codigo_base || null, mapearAccion(h.tipo_cambio), h.motivo || h.cambio, h.hecho_por, normalizarFecha(h.fecha_cambio)]
        );
      }

      const histMoldes = await db.all(`
        SELECT s.tipo_cambio, s.cambio, s.motivo, s.hecho_por, s.fecha_cambio, r.codigo_base
        FROM moldes_seguimiento_cambios s LEFT JOIN moldes_referencias r ON s.referencia_id = r.id
        WHERE s.tipo_cambio != 'inspeccion'
      `);
      for (const h of histMoldes) {
        await db.run(
          `INSERT INTO registro_cambios (modulo, entidad, entidad_id, accion, detalle, hecho_por, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ['Metrología', 'moldes_referencias', h.codigo_base || null, mapearAccion(h.tipo_cambio), h.motivo || h.cambio, h.hecho_por, normalizarFecha(h.fecha_cambio)]
        );
      }

      const histPlanes = await db.all(`SELECT referencia, plan_anterior, plan_nuevo, justificacion, analista, fecha_cambio FROM iso_historial_planes`);
      for (const h of histPlanes) {
        await db.run(
          `INSERT INTO registro_cambios (modulo, entidad, entidad_id, accion, detalle, hecho_por_nombre, fecha) VALUES (?, ?, ?, 'Edición', ?, ?, ?)`,
          ['Muestreos ISO 2859', 'iso_planes_muestreo (por referencia)', h.referencia, `Plan cambiado de "${h.plan_anterior}" a "${h.plan_nuevo}". Justificación: ${h.justificacion}`, h.analista, normalizarFecha(h.fecha_cambio)]
        );
      }

      const total = histSmd.length + histMoldes.length + histPlanes.length;
      console.log(`✅ Tabla registro_cambios creada. Se copiaron ${total} registro(s) histórico(s) (${histSmd.length} de Circuitos SMD, ${histMoldes.length} de Metrología, ${histPlanes.length} de cambios de plan ISO).`);
    }
  } catch (e) {
    console.error('⚠️ Error creando registro_cambios:', e.message);
  }

  // MIGRACIÓN #9: eliminar las 3 tablas de historial que quedaron
  // reemplazadas por registro_cambios (seguimiento_cambios,
  // moldes_seguimiento_cambios, iso_historial_planes). Antes de esto se
  // dejaban vivas "por si acaso" y se les escribía por partida doble (una
  // vez en su tabla de siempre y otra en registro_cambios); ahora que todo
  // el código que las leía y escribía ya se movió a leer/escribir
  // directamente en registro_cambios (ver data/referencias.js,
  // data/metrologia.js, data/iso2859.js), mantenerlas solo significaba
  // tener el mismo historial duplicado en dos lugares que se podían
  // desincronizar. `DROP TABLE IF EXISTS` hace que este paso sea seguro de
  // repetir en cada arranque: la primera vez borra las tablas, después de
  // eso no encuentra nada que borrar y no hace nada.
  //
  // IMPORTANTE: este bloque tiene que ir después de la MIGRACIÓN #8 (la
  // que crea registro_cambios y copia el historial viejo) para que ninguna
  // instalación pierda datos — si algún día se reordena este archivo, que
  // esta migración se quede después de esa.
  try {
    await db.exec(`
      DROP INDEX IF EXISTS idx_iso_historial_ref;
      DROP TABLE IF EXISTS seguimiento_cambios;
      DROP TABLE IF EXISTS moldes_seguimiento_cambios;
      DROP TABLE IF EXISTS iso_historial_planes;
    `);
  } catch (e) {
    console.error('⚠️ Error eliminando las tablas de historial ya unificadas en registro_cambios:', e.message);
  }

  // MIGRACIÓN #10: iso_lotes — agrega el estado 'Reclasificado'. Misma
  // razón y misma técnica que la #6 (SQLite no soporta modificar un CHECK
  // con ALTER TABLE, así que hay que recrear la tabla y copiar los datos).
  // No toca el veredicto Aceptado/Rechazado que calcula la Auditoría Final
  // (esa cuenta sigue siendo la fórmula de siempre, para no perder el
  // historial estadístico real): 'Reclasificado' es un estado aparte que
  // Calidad puede darle después, a mano, a un lote que salió Rechazado —
  // ver POST /api/iso2859/lotes/:id/reclasificar en routes/iso2859.js.
  try {
    const infoLotes10 = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='iso_lotes'");
    if (infoLotes10 && !infoLotes10.sql.includes('Reclasificado')) {
      console.log('🔄 Migrando tabla iso_lotes (agregando estado Reclasificado)...');
      await db.exec(`
        CREATE TABLE iso_lotes_new (
          id_lote TEXT PRIMARY KEY,
          referencia TEXT NOT NULL REFERENCES iso_referencias(nombre),
          modulo TEXT NOT NULL CHECK(modulo IN ('Recepcion','Produccion')),
          cantidad_total INTEGER NOT NULL,
          metodo_en_proceso TEXT,
          fecha_creacion TEXT DEFAULT (datetime('now','localtime')),
          estado_final TEXT DEFAULT 'Pendiente' CHECK(estado_final IN ('Pendiente','Aceptado','Aceptado_con_obs','Rechazado','Cerrado_sin_auditoria','Reclasificado')),
          plan_actual TEXT DEFAULT 'Normal',
          id_revision INTEGER REFERENCES iso_revisiones(id_revision),
          proveedor TEXT,
          oc_factura TEXT,
          maquina TEXT,
          cierre_tipo TEXT CHECK(cierre_tipo IN ('automatico','manual')),
          cierre_motivo TEXT,
          cerrado_por TEXT,
          fecha_cierre TEXT
        );
        INSERT INTO iso_lotes_new (id_lote, referencia, modulo, cantidad_total, metodo_en_proceso, fecha_creacion, estado_final, plan_actual, id_revision, proveedor, oc_factura, maquina, cierre_tipo, cierre_motivo, cerrado_por, fecha_cierre)
          SELECT id_lote, referencia, modulo, cantidad_total, metodo_en_proceso, fecha_creacion, estado_final, plan_actual, id_revision, proveedor, oc_factura, maquina, cierre_tipo, cierre_motivo, cerrado_por, fecha_cierre FROM iso_lotes;
        DROP TABLE iso_lotes;
        ALTER TABLE iso_lotes_new RENAME TO iso_lotes;
        CREATE INDEX IF NOT EXISTS idx_iso_lotes_referencia ON iso_lotes(referencia);
        CREATE INDEX IF NOT EXISTS idx_iso_lotes_modulo ON iso_lotes(modulo);
      `);
      console.log('✅ Tabla iso_lotes migrada correctamente (estado Reclasificado agregado).');
    }
  } catch (e) {
    console.error('⚠️ Error migrando iso_lotes (Reclasificado):', e.message);
  }

  // MIGRACIÓN #11: iso_muestreos — agrega piezas_reclasificadas y
  // piezas_reparadas. En un muestreo "En Proceso" la decisión sobre la
  // máquina (Seguir/Alerta/Parar) es una cosa; qué se hizo con las piezas
  // defectuosas que se encontraron es otra aparte — algunas se separan
  // para usarlas en otra referencia (reclasificadas) y otras se corrigen
  // (reparadas). Son columnas simples (no un CHECK como en iso_lotes), así
  // que un ALTER TABLE normal alcanza.
  try {
    const colsMuestreos = await db.all("PRAGMA table_info(iso_muestreos)");
    const nombresCols = colsMuestreos.map(c => c.name);
    if (!nombresCols.includes('piezas_reclasificadas')) {
      await db.run('ALTER TABLE iso_muestreos ADD COLUMN piezas_reclasificadas INTEGER DEFAULT 0');
      console.log('➕ Columna piezas_reclasificadas agregada a iso_muestreos');
    }
    if (!nombresCols.includes('piezas_reparadas')) {
      await db.run('ALTER TABLE iso_muestreos ADD COLUMN piezas_reparadas INTEGER DEFAULT 0');
      console.log('➕ Columna piezas_reparadas agregada a iso_muestreos');
    }
  } catch (e) {
    console.error('⚠️ Error agregando columnas de piezas a iso_muestreos:', e.message);
  }

  // MIGRACIÓN #12: iso_lotes — agrega el estado 'Reparacion' (misma técnica
  // que la #6 y la #10: recrear la tabla porque SQLite no deja modificar un
  // CHECK con ALTER TABLE). Es la otra disposición manual que Calidad puede
  // darle a un lote Rechazado en la Auditoría Final, junto con
  // 'Reclasificado' — ver POST /api/iso2859/lotes/:id/tratamiento.
  try {
    const infoLotes12 = await db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='iso_lotes'");
    if (infoLotes12 && !infoLotes12.sql.includes('Reparacion')) {
      console.log('🔄 Migrando tabla iso_lotes (agregando estado Reparacion)...');
      await db.exec(`
        CREATE TABLE iso_lotes_new (
          id_lote TEXT PRIMARY KEY,
          referencia TEXT NOT NULL REFERENCES iso_referencias(nombre),
          modulo TEXT NOT NULL CHECK(modulo IN ('Recepcion','Produccion')),
          cantidad_total INTEGER NOT NULL,
          metodo_en_proceso TEXT,
          fecha_creacion TEXT DEFAULT (datetime('now','localtime')),
          estado_final TEXT DEFAULT 'Pendiente' CHECK(estado_final IN ('Pendiente','Aceptado','Aceptado_con_obs','Rechazado','Cerrado_sin_auditoria','Reclasificado','Reparacion')),
          plan_actual TEXT DEFAULT 'Normal',
          id_revision INTEGER REFERENCES iso_revisiones(id_revision),
          proveedor TEXT,
          oc_factura TEXT,
          maquina TEXT,
          cierre_tipo TEXT CHECK(cierre_tipo IN ('automatico','manual')),
          cierre_motivo TEXT,
          cerrado_por TEXT,
          fecha_cierre TEXT
        );
        INSERT INTO iso_lotes_new (id_lote, referencia, modulo, cantidad_total, metodo_en_proceso, fecha_creacion, estado_final, plan_actual, id_revision, proveedor, oc_factura, maquina, cierre_tipo, cierre_motivo, cerrado_por, fecha_cierre)
          SELECT id_lote, referencia, modulo, cantidad_total, metodo_en_proceso, fecha_creacion, estado_final, plan_actual, id_revision, proveedor, oc_factura, maquina, cierre_tipo, cierre_motivo, cerrado_por, fecha_cierre FROM iso_lotes;
        DROP TABLE iso_lotes;
        ALTER TABLE iso_lotes_new RENAME TO iso_lotes;
        CREATE INDEX IF NOT EXISTS idx_iso_lotes_referencia ON iso_lotes(referencia);
        CREATE INDEX IF NOT EXISTS idx_iso_lotes_modulo ON iso_lotes(modulo);
      `);
      console.log('✅ Tabla iso_lotes migrada correctamente (estado Reparacion agregado).');
    }
  } catch (e) {
    console.error('⚠️ Error migrando iso_lotes (Reparacion):', e.message);
  }

  // MIGRACIÓN #13: whatsapp_numeros — administrar los números autorizados
  // del bot (y quién es administrador) desde una pantalla, en vez de solo
  // desde el .env. Se siembra una sola vez, la primera vez que se crea la
  // tabla, con los valores que ya venían de WHATSAPP_NUMEROS/
  // WHATSAPP_ADMIN_NUMERO (settings/config_whatsapp.js), para que el bot
  // siga funcionando exactamente igual sin que nadie tenga que volver a
  // escribir los números. De ahí en adelante, agregar/editar/desactivar un
  // número se hace desde Public/whatsapp_bot.html (ver routes/whatsapp.js),
  // y whatsapp_bot_service.js lee esta tabla en vez de config_whatsapp.js.
  try {
    const infoNumeros = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_numeros'");
    if (!infoNumeros) {
      console.log('🔄 Creando tabla whatsapp_numeros...');
      await db.exec(`
        CREATE TABLE whatsapp_numeros (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          telefono TEXT UNIQUE NOT NULL,
          nombre TEXT NOT NULL,
          es_admin INTEGER NOT NULL DEFAULT 0,
          activo INTEGER NOT NULL DEFAULT 1,
          creado_en TEXT DEFAULT (datetime('now','localtime'))
        );
      `);
      const { ALLOWED_NUMBERS, NOMBRES, ADMIN_NUMERO } = configWhatsapp;
      for (const telefono of ALLOWED_NUMBERS) {
        await db.run(
          'INSERT OR IGNORE INTO whatsapp_numeros (telefono, nombre, es_admin) VALUES (?, ?, ?)',
          [telefono, NOMBRES[telefono] || telefono, telefono === ADMIN_NUMERO ? 1 : 0]
        );
      }
      // Por si ADMIN_NUMERO no estuviera en ALLOWED_NUMBERS (no debería
      // pasar, pero así no se queda el bot sin nadie a quién avisarle).
      if (ADMIN_NUMERO && !ALLOWED_NUMBERS.includes(ADMIN_NUMERO)) {
        await db.run(
          'INSERT OR IGNORE INTO whatsapp_numeros (telefono, nombre, es_admin) VALUES (?, ?, 1)',
          [ADMIN_NUMERO, NOMBRES[ADMIN_NUMERO] || ADMIN_NUMERO]
        );
      }
      console.log(`✅ Tabla whatsapp_numeros creada y sembrada con ${ALLOWED_NUMBERS.length} número(s) ya autorizados.`);
    }
  } catch (e) {
    console.error('⚠️ Error creando whatsapp_numeros:', e.message);
  }

  // MIGRACIÓN #14: whatsapp_alertas_config — un interruptor activo/inactivo
  // (y, solo para 'pico_garantias', un umbral y una ventana de días) por
  // cada tipo de alerta de calidad que puede mandar el bot de WhatsApp.
  // Se siembra una sola vez con todas activas y el umbral de garantías en
  // 10 por semana (valor pedido por Julio). Administrable desde
  // Public/whatsapp_bot.html (ver routes/whatsapp.js).
  try {
    const infoAlertasConfig = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_alertas_config'");
    if (!infoAlertasConfig) {
      console.log('🔄 Creando tabla whatsapp_alertas_config...');
      await db.exec(`
        CREATE TABLE whatsapp_alertas_config (
          tipo TEXT PRIMARY KEY,
          activo INTEGER NOT NULL DEFAULT 1,
          umbral INTEGER,
          ventana_dias INTEGER,
          actualizado_en TEXT DEFAULT (datetime('now','localtime'))
        );
      `);
      const alertasIniciales = [
        { tipo: 'lote_rechazado_final', umbral: null, ventana_dias: null },
        { tipo: 'primera_pieza_rechazada', umbral: null, ventana_dias: null },
        { tipo: 'muestreo_parar', umbral: null, ventana_dias: null },
        { tipo: 'permiso_sensible', umbral: null, ventana_dias: null },
        { tipo: 'pico_garantias', umbral: 10, ventana_dias: 7 },
        { tipo: 'resumen_diario', umbral: null, ventana_dias: null },
        { tipo: 'resumen_quincenal', umbral: null, ventana_dias: null },
        { tipo: 'resumen_mensual', umbral: null, ventana_dias: null },
      ];
      for (const a of alertasIniciales) {
        await db.run(
          'INSERT OR IGNORE INTO whatsapp_alertas_config (tipo, activo, umbral, ventana_dias) VALUES (?, 1, ?, ?)',
          [a.tipo, a.umbral, a.ventana_dias]
        );
      }
      console.log('✅ Tabla whatsapp_alertas_config creada y sembrada (todas las alertas activas).');
    }
  } catch (e) {
    console.error('⚠️ Error creando whatsapp_alertas_config:', e.message);
  }

  // MIGRACIÓN #15: whatsapp_alertas_enviadas — bitácora liviana para no
  // repetir un envío. Sirve para dos cosas: (1) el aviso de "pico de
  // garantías" no se manda otra vez por la misma referencia dentro de la
  // misma semana aunque se sigan sumando garantías nuevas, y (2) los
  // resúmenes periódicos (diario/quincenal/mensual) no se duplican si el
  // servidor se reinicia justo en el minuto en que tocaba enviarlos.
  try {
    const infoAlertasEnviadas = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_alertas_enviadas'");
    if (!infoAlertasEnviadas) {
      console.log('🔄 Creando tabla whatsapp_alertas_enviadas...');
      await db.exec(`
        CREATE TABLE whatsapp_alertas_enviadas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo TEXT NOT NULL,
          clave TEXT NOT NULL,
          fecha_envio TEXT DEFAULT (datetime('now','localtime')),
          UNIQUE(tipo, clave)
        );
      `);
      console.log('✅ Tabla whatsapp_alertas_enviadas creada.');
    }
  } catch (e) {
    console.error('⚠️ Error creando whatsapp_alertas_enviadas:', e.message);
  }

  // MIGRACIÓN #16: whatsapp_numero_permisos — qué comandos puede usar cada
  // número (ver settings/permisosBot.js). Se siembra una sola vez: todo
  // número activo recibe 'registro_entrada' (lo único que todos podían
  // hacer antes de esta migración), y los que ya eran es_admin=1 reciben
  // además todos los permisos de calidad — así nadie pierde, de un momento
  // a otro, acceso a algo que ya venía usando.
  try {
    const infoNumeroPermisos = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='whatsapp_numero_permisos'");
    if (!infoNumeroPermisos) {
      console.log('🔄 Creando tabla whatsapp_numero_permisos...');
      await db.exec(`
        CREATE TABLE whatsapp_numero_permisos (
          numero_id INTEGER NOT NULL REFERENCES whatsapp_numeros(id) ON DELETE CASCADE,
          permiso TEXT NOT NULL,
          PRIMARY KEY (numero_id, permiso)
        );
      `);
      const numeros = await db.all('SELECT id, es_admin FROM whatsapp_numeros');
      for (const n of numeros) {
        await db.run('INSERT OR IGNORE INTO whatsapp_numero_permisos (numero_id, permiso) VALUES (?, ?)', [n.id, 'registro_entrada']);
        if (n.es_admin) {
          for (const p of PERMISOS_BOT_DISPONIBLES) {
            await db.run('INSERT OR IGNORE INTO whatsapp_numero_permisos (numero_id, permiso) VALUES (?, ?)', [n.id, p.codigo]);
          }
        }
      }
      console.log(`✅ Tabla whatsapp_numero_permisos creada y sembrada para ${numeros.length} número(s).`);
    }
  } catch (e) {
    console.error('⚠️ Error creando whatsapp_numero_permisos:', e.message);
  }

  // MIGRACIÓN #17: agrega el tipo de alerta 'lote_tratamiento_aplicado' a
  // whatsapp_alertas_config — la tabla ya existe (creada en la #14), así
  // que aquí solo se inserta la fila nueva si todavía no está (INSERT OR
  // IGNORE), para que una instalación que ya venía de antes reciba este
  // tipo de alerta nuevo sin perder la configuración de las demás.
  try {
    await db.run(
      "INSERT OR IGNORE INTO whatsapp_alertas_config (tipo, activo, umbral, ventana_dias) VALUES ('lote_tratamiento_aplicado', 1, NULL, NULL)"
    );
  } catch (e) {
    console.error('⚠️ Error agregando la alerta lote_tratamiento_aplicado:', e.message);
  }

  // MIGRACIÓN #18: tablas del módulo "Valores y Cableado" (nuevo módulo de
  // Electrónica). A propósito NO se crea un catálogo de referencias/colores/
  // versiones aparte: ese ya existe (tablas `referencias` y `versiones` de
  // Circuitos SMD — confirmado con Julio que son el mismo producto, mismo
  // código, incluso la misma foto de circuito). Estas 4 tablas solo agregan
  // lo que Circuitos SMD no tenía: valores eléctricos medidos, rangos de
  // revisión, configuración de cableado (las 3 enganchadas a `versiones.id`,
  // porque ahí ya está resuelta la combinación referencia+color+versión), y
  // un catálogo de fotos de cableado por "forma de cableado" (esa foto se
  // repite entre varias referencias que comparten el mismo tipo de armado,
  // no es una foto por producto).
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS elec_mediciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER NOT NULL UNIQUE,
        voltaje_revision TEXT,
        amperaje_medias TEXT,
        amperaje_altas TEXT,
        potencia_medias TEXT,
        potencia_altas TEXT,
        FOREIGN KEY (version_id) REFERENCES versiones(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS elec_rangos_revision (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER NOT NULL UNIQUE,
        voltaje_min TEXT,
        voltaje_max TEXT,
        amperaje_min_bajas TEXT,
        amperaje_min_altas TEXT,
        amperaje_max TEXT,
        potencia_min_bajas TEXT,
        potencia_min_altas TEXT,
        potencia_max TEXT,
        FOREIGN KEY (version_id) REFERENCES versiones(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS elec_config_cableado (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER NOT NULL UNIQUE,
        cortar_puntas INTEGER DEFAULT 0,
        posicion_punto TEXT,
        empujar_cables INTEGER DEFAULT 0,
        forma_cableado TEXT,
        referencia_cable TEXT,
        no_aplica_medias INTEGER DEFAULT 0,
        FOREIGN KEY (version_id) REFERENCES versiones(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS elec_fotos_cableado (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        forma_cableado TEXT NOT NULL UNIQUE,
        url_foto TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_elec_config_forma ON elec_config_cableado(forma_cableado);
    `);
  } catch (e) {
    console.error('⚠️ Error creando tablas de Valores y Cableado:', e.message);
  }

  // MIGRACIÓN #19: elec_config_cableado — agrega columna no_aplica_medias.
  // Julio señaló que algunas referencias no manejan valores de "Medias
  // (Bajas)" (solo Altas) por diseño, y antes esto se contaba como
  // "faltante" en la alerta roja de Valores y Cableado sin serlo
  // realmente. Este interruptor, marcado a mano por versión desde "Editar
  // Referencia", saca esos 4 campos (amperaje/potencia medias y sus
  // mínimos) de la cuenta de faltantes para esa versión, y la ficha los
  // muestra como "N/A" en vez de "—".
  try {
    const colsCableado = await db.all("PRAGMA table_info(elec_config_cableado)");
    if (!colsCableado.map(c => c.name).includes('no_aplica_medias')) {
      await db.run('ALTER TABLE elec_config_cableado ADD COLUMN no_aplica_medias INTEGER DEFAULT 0');
      console.log('➕ Columna no_aplica_medias agregada a elec_config_cableado');
    }
  } catch (e) {
    console.error('⚠️ Error verificando columna no_aplica_medias en elec_config_cableado:', e.message);
  }

  // MIGRACIÓN #20: tablas del módulo "Producción por Fábrica" (rechazos +
  // lotes). Se sincronizan desde Calidad.xlsx / Lotes.xlsx —consultas de
  // Power Query hacia P:\3. Fabrica1\...\Calidad.xlsm, P:\4. Fabrica2\...\
  // Calidad.xlsm y P:\3. Fabrica1\...\Rendimiento.xlsm— por
  // scripts/sincronizar_produccion.js, enganchado a un ciclo de 6 horas en
  // app_circuitos.js (ver ejecutarSincronizacionProduccion).
  //
  // rechazos_produccion sí tiene una llave natural confiable dentro de cada
  // fábrica (fabrica + id_rechazo_origen, verificado sin duplicados contra
  // los datos reales), de ahí el UNIQUE: permite upsert real (si un rechazo
  // ya sincronizado cambia en el Excel —ej. se corrige el motivo—, se
  // actualiza en vez de duplicarse).
  //
  // lotes_produccion NO tiene esa llave (No_Lote se repite en el origen), así
  // que cada fila se identifica por el hash de su contenido completo
  // (hash_fila): confirmado con Julio (31/08) que la hoja de Lotes no
  // distingue Fábrica 1 de Fábrica 2 —la lista es la misma para ambas—, por
  // eso esta tabla no tiene columna de fábrica.
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS rechazos_produccion (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fabrica TEXT NOT NULL,
        id_rechazo_origen INTEGER NOT NULL,
        fecha_rechazo TEXT,
        linea_org TEXT,
        proceso_org TEXT,
        linea_rep TEXT,
        proceso_rep TEXT,
        lote_produccion TEXT,
        lote TEXT,
        referencia TEXT,
        cantidad INTEGER,
        motivo TEXT,
        observaciones TEXT,
        sincronizado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(fabrica, id_rechazo_origen)
      );
      CREATE TABLE IF NOT EXISTS lotes_produccion (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha_produccion TEXT,
        no_lote TEXT,
        referencia TEXT,
        color TEXT,
        voltaje INTEGER,
        codigo TEXT,
        cantidad INTEGER,
        hash_fila TEXT NOT NULL UNIQUE,
        sincronizado_en DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_rechazos_fabrica_fecha ON rechazos_produccion(fabrica, fecha_rechazo);
      CREATE INDEX IF NOT EXISTS idx_rechazos_motivo ON rechazos_produccion(motivo);
      CREATE INDEX IF NOT EXISTS idx_lotes_fecha ON lotes_produccion(fecha_produccion);
      CREATE INDEX IF NOT EXISTS idx_lotes_referencia ON lotes_produccion(referencia);
    `);
  } catch (e) {
    console.error('⚠️ Error creando tablas de Producción por Fábrica:', e.message);
  }

  // MIGRACIÓN #21: índice para el cruce por lote (bueno vs. malo) entre
  // rechazos_produccion y lotes_produccion — se buscan/agrupan por
  // lote_produccion en cada carga del tablero (ver data/produccion.js,
  // obtenerLotesConDetalle / obtenerBuenoVsMaloPorMes), y esa columna no
  // tenía índice todavía.
  try {
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_rechazos_lote_produccion ON rechazos_produccion(lote_produccion);
    `);
  } catch (e) {
    console.error('⚠️ Error creando índice de cruce por lote:', e.message);
  }

  // MIGRACIÓN #22: Julio agregó un archivo nuevo, Produccion.xlsx, y
  // simplificó Lotes.xlsx (01/09). El modelo de datos de producción cambió
  // de fondo:
  //   - Lotes.xlsx ya NO trae cantidad ni fecha — quedó como una tabla de
  //     solo consulta (No_Lote -> Referencia/Color/Voltaje/Código), con
  //     No_Lote ahora sí único de verdad (antes se repetía).
  //   - Produccion.xlsx (consulta nueva de Power Query hacia TEntregas en
  //     Rendimiento.xlsm de AMBAS fábricas) es la que de verdad trae
  //     cantidades: una fila por cada "entrega" de un lote entre estaciones
  //     del proceso (Preensamble/Ensamble/Resina/Calidad...), con su
  //     fábrica (columna Area). Verificado contra los datos reales (01/09):
  //     un mismo lote pasa por varias operaciones con la MISMA cantidad
  //     repartida en lotes parciales -- la cantidad buena final de un lote
  //     es la suma de sus filas en la operación "Calidad" (sin importar
  //     mayúsculas: "Calidad"/"CALIDAD"), no la suma de todas sus filas.
  //     Esto es clave porque MIENTRAS lotes_produccion no tenía fábrica,
  //     entregas_produccion sí la tiene -- así que ahora el % de desperdicio
  //     SÍ se puede calcular real por fábrica (ver data/produccion.js).
  //
  // Por eso lotes_produccion se reemplaza por dos tablas:
  //   - lotes: la tabla de consulta (reemplaza lo que hacía lotes_produccion
  //     antes, pero ahora no_lote es de verdad único, así que el upsert es
  //     directo por no_lote en vez de por hash de fila completa).
  //   - entregas_produccion: la tabla de hechos con las cantidades. Su llave
  //     natural es (fabrica + id_entrega) -- igual que rechazos_produccion,
  //     verificado 01/09 que Id_Entrega se numera por separado en cada
  //     fábrica (se repite el mismo número entre Fabrica1 y Fabrica2, nunca
  //     dentro de la misma). Un puñado de filas no traen Id_Entrega (dato
  //     faltante en el origen): esas se identifican por el hash de su
  //     contenido completo (hash_fila) en vez de romper el cruce -- ambas
  //     columnas admiten varios NULL sin chocar entre sí en SQLite.
  //
  // Julio confirmó (01/09) que está bien borrar lotes_produccion y
  // resincronizar todo desde cero: no se pierde información real, se
  // reconstruye desde los mismos Excel.
  try {
    await db.exec(`DROP TABLE IF EXISTS lotes_produccion;`);
  } catch (e) {
    console.error('⚠️ Error eliminando la tabla anterior lotes_produccion:', e.message);
  }

  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS lotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        no_lote TEXT NOT NULL UNIQUE,
        referencia TEXT,
        color TEXT,
        voltaje INTEGER,
        codigo TEXT,
        sincronizado_en DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS entregas_produccion (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fabrica TEXT NOT NULL,
        id_entrega INTEGER,
        fecha_entrega TEXT,
        linea_entrega TEXT,
        lote_entrega TEXT,
        referencia_entrega TEXT,
        operacion_entrega TEXT,
        cantidad_buenas INTEGER,
        hash_fila TEXT,
        sincronizado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(fabrica, id_entrega),
        UNIQUE(hash_fila)
      );
      CREATE INDEX IF NOT EXISTS idx_lotes_referencia ON lotes(referencia);
      CREATE INDEX IF NOT EXISTS idx_entregas_lote ON entregas_produccion(lote_entrega);
      CREATE INDEX IF NOT EXISTS idx_entregas_fabrica_fecha ON entregas_produccion(fabrica, fecha_entrega);
      CREATE INDEX IF NOT EXISTS idx_entregas_referencia ON entregas_produccion(referencia_entrega);
    `);
  } catch (e) {
    console.error('⚠️ Error creando tablas lotes / entregas_produccion:', e.message);
  }

  // Usuarios por defecto si está vacío
  const count = await db.get('SELECT COUNT(*) as total FROM usuarios');
  if (count.total === 0) {
    const adminRol = await db.get("SELECT id FROM roles WHERE nombre = 'admin'");
    const inspRol = await db.get("SELECT id FROM roles WHERE nombre = 'inspector'");
    const opRol = await db.get("SELECT id FROM roles WHERE nombre = 'operario'");

    await db.run('INSERT INTO usuarios (nombre, usuario, contrasena, rol_id, created_at) VALUES (?, ?, ?, ?, ?)',
      ['Administrador', 'admin', await bcrypt.hash('admin123', SALT_ROUNDS), adminRol.id, ahoraISO()]);
    await db.run('INSERT INTO usuarios (nombre, usuario, contrasena, rol_id, created_at) VALUES (?, ?, ?, ?, ?)',
      ['Inspector Calidad', 'inspector', await bcrypt.hash('inspector123', SALT_ROUNDS), inspRol.id, ahoraISO()]);
    await db.run('INSERT INTO usuarios (nombre, usuario, contrasena, rol_id, created_at) VALUES (?, ?, ?, ?, ?)',
      ['Operario Planta', 'operario', await bcrypt.hash('operario123', SALT_ROUNDS), opRol.id, ahoraISO()]);
    console.log('👤 Usuarios iniciales creados.');
  }

  await migrarContrasenasAntiguas();
  await importarCsvMetrologia();
  await recargarPermisos();
  console.log('✅ Base de datos lista.');

  return db;
}

module.exports = { inicializarBaseDatos, esHashBcrypt, migrarContrasenasAntiguas };
