const express = require('express');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const sharp = require('sharp');
const multer = require('multer');

const app = express();

// ======================== CONFIGURACIÓN ========================
const SESSIONS_FILE = path.join(__dirname, 'sesiones.json');
const CONFIG_PATH = path.join(__dirname, 'config');
const DB_PATH = path.join(__dirname, 'base_datos.db');

const CARPETAS_FOTOS = [
  'E:\\',
  'C:\\Users\\produ\\OneDrive\\Escritorio\\27.2 Imagen_Circuito',
  'C:\\Users\\produ\\OneDrive\\Escritorio\\Fotos planos'
];

const OBSOLETAS_DIR = path.join(__dirname, 'uploads', 'obsoletas');
const TMP_DIR = path.join(__dirname, 'uploads', 'tmp');
const EVIDENCIAS_DIR = path.join(__dirname, 'uploads', 'evidencias');

[OBSOLETAS_DIR, TMP_DIR, EVIDENCIAS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

if (!fs.existsSync(CONFIG_PATH)) {
  fs.mkdirSync(CONFIG_PATH, { recursive: true });
}

app.use(express.json());
app.use(express.static('public'));
app.use('/config', express.static(CONFIG_PATH));

let db;

// ======================== HELPERS FECHA ========================
function ahoraISO() {
  return new Date().toISOString();
}

// ======================== HELPER SEGUIMIENTO CAMBIOS (con validación de integridad) ========================
async function insertarSeguimientoCambios(referenciaId, tipoCambio, cambioObj, hechoPor, motivo) {
  // DEBUG: Verificar integridad referencial antes de insertar
  const refCheck = await db.get('SELECT id, codigo_base FROM referencias WHERE id = ?', [referenciaId]);
  if (!refCheck) {
    console.error(`🚨 INTEGRIDAD: referencia_id=${referenciaId} NO EXISTE en tabla referencias. Tipo cambio: ${tipoCambio}`);
    console.error(`🚨 Stack trace conceptual: tipo=${tipoCambio}, hecho_por=${hechoPor}`);
    console.error(`🚨 Cambio intentado:`, JSON.stringify(cambioObj, null, 2));
    throw new Error(`referencia_id ${referenciaId} no existe en tabla referencias. Posible corrupción de datos.`);
  }
  console.log(`📝 Seguimiento: ref_id=${referenciaId} (${refCheck.codigo_base}), tipo=${tipoCambio}, usuario=${hechoPor}`);
  await db.run(
    'INSERT INTO seguimiento_cambios (referencia_id, tipo_cambio, cambio, hecho_por, fecha_cambio, motivo) VALUES (?, ?, ?, ?, ?, ?)',
    [referenciaId, tipoCambio, JSON.stringify(cambioObj, null, 2), hechoPor, ahoraISO(), motivo || null]
  );
}


// ======================== PERMISOS DISPONIBLES ========================
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
];

// ======================== CACHE DE PERMISOS ========================
let permisosCache = new Map();

async function recargarPermisos() {
  permisosCache.clear();
  const roles = await db.all('SELECT id FROM roles');
  for (const rol of roles) {
    const perms = await db.all(`
      SELECT p.codigo FROM permisos p
      JOIN rol_permisos rp ON p.id = rp.permiso_id
      WHERE rp.rol_id = ?
    `, [rol.id]);
    permisosCache.set(rol.id, new Set(perms.map(p => p.codigo)));
  }
  console.log('🔐 Permisos recargados en memoria.');
}

function tienePermiso(rolId, codigo) {
  const set = permisosCache.get(rolId);
  if (!set) return false;
  return set.has(codigo);
}

function requerirPermiso(codigo) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
    if (!tienePermiso(req.usuario.rol_id, codigo)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

function requerirPermisoAlternativo(permisos) {
  return (req, res, next) => {
    if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
    const tieneAlguno = permisos.some(p => tienePermiso(req.usuario.rol_id, p));
    if (!tieneAlguno) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    }
    next();
  };
}

// ======================== MULTER ========================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'tmp-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// ======================== HELPERS ========================
function buscarEnDir(dir, nombreArchivo) {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const encontrado = buscarEnDir(fullPath, nombreArchivo);
      if (encontrado) return encontrado;
    } else if (item.toLowerCase() === nombreArchivo.toLowerCase()) {
      return fullPath;
    }
  }
  return null;
}

function buscarArchivoRecursivo(nombreArchivo, carpetas = CARPETAS_FOTOS) {
  for (const carpeta of carpetas) {
    if (!fs.existsSync(carpeta)) continue;
    const resultado = buscarEnDir(carpeta, nombreArchivo);
    if (resultado) return resultado;
  }
  return null;
}

function escanearRecursivo(dir, extensiones = /\.(jpg|jpeg|png|gif|bmp|webp|tiff)$/i) {
  const rutas = [];
  if (!fs.existsSync(dir)) return rutas;
  for (const item of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, item);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) rutas.push(...escanearRecursivo(fullPath, extensiones));
      else if (extensiones.test(item)) rutas.push(fullPath);
    } catch(e) {}
  }
  return rutas;
}

function moverArchivo(origen, destino) {
  function reintentar(fn, intentos = 10, delay = 50) {
    for (let i = 0; i < intentos; i++) {
      try { fn(); return; }
      catch (e) {
        const esBusy = e.code === 'EBUSY' || e.code === 'EPERM';
        if (esBusy && i < intentos - 1) {
          console.log(`⏳ ${e.code} en ${path.basename(origen)}, reintentando (${i + 1}/${intentos})...`);
          const start = Date.now();
          while (Date.now() - start < delay) { /* busy-wait sincrono */ }
          delay = Math.min(delay * 1.5, 500);
          continue;
        }
        throw e;
      }
    }
  }

  try {
    // Intentar rename primero (atómico, no deja handles abiertos)
    reintentar(() => fs.renameSync(origen, destino));
  } catch (e) {
    // Fallback: copy + unlink (para diferentes unidades / dispositivos)
    reintentar(() => fs.copyFileSync(origen, destino));
    reintentar(() => fs.unlinkSync(origen));
  }
}

function sanitizeFilename(str) {
  return str.replace(/[^a-zA-Z0-9]/g, '-');
}

function nombreBaseParaArchivo(codigoBase) {
  // Quita el prefijo "SUP/" al inicio (insensible a mayúsculas/minúsculas)
  return codigoBase.replace(/^SUP\//i, '');
}

function obtenerCarpetaDestino(req) {
  if (req.body.ruta_personalizada?.trim()) {
    const ruta = req.body.ruta_personalizada.trim();
    if (fs.existsSync(ruta)) return ruta;
    throw new Error('La ruta personalizada no existe: ' + ruta);
  }
  const idx = parseInt(req.body.carpeta_idx || '1', 10);
  const carpeta = CARPETAS_FOTOS[idx] || CARPETAS_FOTOS[1];
  if (!carpeta || !fs.existsSync(carpeta)) throw new Error('Carpeta destino no disponible');
  return carpeta;
}

// ======================== BASE DE DATOS ========================
async function inicializarBaseDatos() {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
    mode: sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE
  });
  db.configure('busyTimeout', 5000);
  await db.run('PRAGMA journal_mode = WAL;');
  console.log('📦 Conexión a SQLite establecida (WAL mode, busyTimeout=5000ms).');

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
    CREATE TABLE IF NOT EXISTS seguimiento_cambios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referencia_id INTEGER NOT NULL,
      tipo_cambio TEXT CHECK(tipo_cambio IN ('creacion', 'nueva_version', 'modificacion')) NOT NULL,
      cambio TEXT NOT NULL,
      hecho_por INTEGER NOT NULL,
      fecha_cambio DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (referencia_id) REFERENCES referencias(id),
      FOREIGN KEY (hecho_por) REFERENCES usuarios(id)
    );
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
     CREATE TABLE IF NOT EXISTS moldes_seguimiento_cambios (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       referencia_id INTEGER NOT NULL,
       tipo_cambio TEXT NOT NULL,
       cambio TEXT NOT NULL,
       motivo TEXT,
       hecho_por INTEGER NOT NULL,
       fecha_cambio DATETIME DEFAULT CURRENT_TIMESTAMP,
       FOREIGN KEY (referencia_id) REFERENCES moldes_referencias(id) ON DELETE CASCADE,
       FOREIGN KEY (hecho_por) REFERENCES usuarios(id)
     );
   `);

  // FIX: Migrar moldes_medidas_detalle (agregar imagen_evidencia si falta)
  try {
    await db.run('ALTER TABLE moldes_medidas_detalle ADD COLUMN imagen_evidencia TEXT');
    console.log('➕ Columna imagen_evidencia agregada a moldes_medidas_detalle');
  } catch (e) {
    if (e.message && e.message.toLowerCase().includes('duplicate column name')) {
      console.log('✅ Columna imagen_evidencia ya existe en moldes_medidas_detalle');
    } else {
      console.error('⚠️ Error agregando imagen_evidencia a moldes_medidas_detalle:', e.message);
    }
  }

  // FIX: Migrar usuarios (agregar created_at si falta) — MÉTODO ROBUSTO
  try {
    await db.run('ALTER TABLE usuarios ADD COLUMN created_at DATETIME');
    console.log('➕ Columna created_at agregada a usuarios');
  } catch (e) {
    if (e.message && e.message.toLowerCase().includes('duplicate column name')) {
      console.log('✅ Columna created_at ya existe en usuarios');
    } else {
      console.error('⚠️ Error agregando created_at a usuarios:', e.message);
    }
  }

  // FIX: Migrar seguimiento_cambios (eliminar codigo_base obsoleto si existe)
  try {
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
  } catch (e) {
    console.error('⚠️ Error migrando seguimiento_cambios:', e.message);
  }

  // FIX: Verificar y agregar necesita_prueba a versiones
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
    { nombre: 'inspector', permisos: ['referencias.ver','referencias.editar','versiones.crear','recomendaciones.ver','recomendaciones.crear','recomendaciones.eliminar','gestion.ver','observaciones.ver','observaciones.editar','garantias.ver','garantias.crear','garantias.editar','garantias.eliminar','garantias.dashboard','portal.volver','whatsapp.bot.ver','whatsapp.bot.gestionar','metrologia.ver','metrologia.inspeccionar','metrologia.versiones','metrologia.historial','metrologia.auditoria','metrologia.crear_referencia','metrologia.editar_cotas'] },
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

  // Usuarios por defecto si está vacío
  const count = await db.get('SELECT COUNT(*) as total FROM usuarios');
  if (count.total === 0) {
    const adminRol = await db.get("SELECT id FROM roles WHERE nombre = 'admin'");
    const inspRol = await db.get("SELECT id FROM roles WHERE nombre = 'inspector'");
    const opRol = await db.get("SELECT id FROM roles WHERE nombre = 'operario'");

    await db.run('INSERT INTO usuarios (nombre, usuario, contrasena, rol_id, created_at) VALUES (?, ?, ?, ?, ?)',
      ['Administrador', 'admin', 'admin123', adminRol.id, ahoraISO()]);
    await db.run('INSERT INTO usuarios (nombre, usuario, contrasena, rol_id, created_at) VALUES (?, ?, ?, ?, ?)',
      ['Inspector Calidad', 'inspector', 'inspector123', inspRol.id, ahoraISO()]);
    await db.run('INSERT INTO usuarios (nombre, usuario, contrasena, rol_id, created_at) VALUES (?, ?, ?, ?, ?)',
      ['Operario Planta', 'operario', 'operario123', opRol.id, ahoraISO()]);
    console.log('👤 Usuarios iniciales creados.');
  }

  await importarCsvMetrologia();
  await recargarPermisos();
  console.log('✅ Base de datos lista.');
}

// ======================== SESIONES ========================
function cargarSesiones() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
  } catch(e) {}
  return {};
}
function guardarSesiones(sesiones) {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sesiones, null, 2));
}
function generarToken() {
  return Math.random().toString(36).substr(2) + Date.now().toString(36);
}

function validarToken(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  const sesiones = cargarSesiones();
  if (!sesiones[token]) return res.status(401).json({ error: 'Token inválido' });
  req.usuario = sesiones[token];
  next();
}

// ======================== LOGO ========================
async function obtenerLogoBase64() {
  try {
    const files = fs.readdirSync(CONFIG_PATH);
    const logoFile = files.find(f => f.toLowerCase().match(/\.(jpg|jpeg|png|gif)$/i));
    if (!logoFile) return null;
    const logoBuffer = await sharp(path.join(CONFIG_PATH, logoFile))
      .resize(300, 120, { fit: 'inside' }).png().toBuffer();
    return { dataUrl: `data:image/png;base64,${logoBuffer.toString('base64')}` };
  } catch (e) { return null; }
}

// ======================== AUTENTICACIÓN ========================
app.post('/api/login', async (req, res) => {
  const { usuario, contrasena } = req.body;
  if (!usuario || !contrasena) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  try {
    const u = await db.get(
      'SELECT u.*, r.nombre as rol_nombre, r.id as rol_id FROM usuarios u LEFT JOIN roles r ON u.rol_id = r.id WHERE u.usuario = ? AND u.contrasena = ?',
      [usuario, contrasena]
    );
    if (!u) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    const token = generarToken();
    const sesiones = cargarSesiones();
    sesiones[token] = {
      id: u.id, nombre: u.nombre, usuario: u.usuario,
      rol_id: u.rol_id, rol: u.rol_nombre || 'sin_rol'
    };
    guardarSesiones(sesiones);

    res.json({ success: true, token, usuario: u.nombre, rol: u.rol_nombre });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/logout', validarToken, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const sesiones = cargarSesiones();
  delete sesiones[token];
  guardarSesiones(sesiones);
  res.json({ success: true });
});

app.get('/api/me', validarToken, async (req, res) => {
  const rol = await db.get('SELECT nombre FROM roles WHERE id = ?', [req.usuario.rol_id]);
  res.json({
    id: req.usuario.id,
    usuario: req.usuario.nombre,
    rol: rol?.nombre || 'sin_rol',
    rol_id: req.usuario.rol_id
  });
});

app.get('/api/logo', validarToken, (req, res) => {
  try {
    const files = fs.readdirSync(CONFIG_PATH);
    const logoFile = files.find(f => f.toLowerCase().match(/\.(jpg|jpeg|png|gif)$/i));
    if (!logoFile) return res.json({ logo: null });
    const logoPath = path.join(CONFIG_PATH, logoFile);
    const ext = path.extname(logoFile).toLowerCase();
    const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif' }[ext] || 'image/jpeg';
    res.json({ logo: `data:${mime};base64,${fs.readFileSync(logoPath).toString('base64')}` });
  } catch (e) { res.json({ logo: null }); }
});

// ======================== ROLES Y PERMISOS ========================

app.get('/api/permisos', validarToken, requerirPermiso('roles.gestionar'), async (req, res) => {
  try {
    const permisos = await db.all('SELECT * FROM permisos ORDER BY codigo');
    res.json({ permisos });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/roles', validarToken, async (req, res) => {
  try {
    const roles = await db.all('SELECT * FROM roles ORDER BY nombre');
    for (const rol of roles) {
      const perms = await db.all(`
        SELECT p.id, p.codigo, p.descripcion FROM permisos p
        JOIN rol_permisos rp ON p.id = rp.permiso_id
        WHERE rp.rol_id = ? ORDER BY p.codigo
      `, [rol.id]);
      rol.permisos = perms;
    }
    res.json({ roles });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/roles', validarToken, requerirPermiso('roles.gestionar'), async (req, res) => {
  const { nombre, descripcion, permisos } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre del rol requerido' });

  try {
    const result = await db.run(
      'INSERT INTO roles (nombre, descripcion) VALUES (?, ?)',
      [nombre, descripcion || '']
    );
    const rolId = result.lastID;

    if (Array.isArray(permisos) && permisos.length > 0) {
      for (const permId of permisos) {
        await db.run('INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (?, ?)', [rolId, permId]);
      }
    }

    await recargarPermisos();
    res.status(201).json({ success: true, id: rolId });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/roles/:id', validarToken, requerirPermiso('roles.gestionar'), async (req, res) => {
  const rolId = parseInt(req.params.id, 10);
  const { nombre, descripcion, permisos } = req.body;
  if (isNaN(rolId)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const rol = await db.get('SELECT * FROM roles WHERE id = ?', [rolId]);
    if (!rol) return res.status(404).json({ error: 'Rol no encontrado' });
    // NOTA: Ahora SÍ se pueden editar roles de sistema (solo no eliminar)

    if (nombre) await db.run('UPDATE roles SET nombre = ? WHERE id = ?', [nombre, rolId]);
    if (descripcion !== undefined) await db.run('UPDATE roles SET descripcion = ? WHERE id = ?', [descripcion, rolId]);

    if (Array.isArray(permisos)) {
      await db.run('DELETE FROM rol_permisos WHERE rol_id = ?', [rolId]);
      for (const permId of permisos) {
        await db.run('INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (?, ?)', [rolId, permId]);
      }
    }

    await recargarPermisos();
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/roles/:id', validarToken, requerirPermiso('roles.gestionar'), async (req, res) => {
  const rolId = parseInt(req.params.id, 10);
  if (isNaN(rolId)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const rol = await db.get('SELECT * FROM roles WHERE id = ?', [rolId]);
    if (!rol) return res.status(404).json({ error: 'Rol no encontrado' });
    if (rol.es_sistema === 1) return res.status(403).json({ error: 'No se puede eliminar un rol de sistema' });

    const usuarios = await db.get('SELECT COUNT(*) as total FROM usuarios WHERE rol_id = ?', [rolId]);
    if (usuarios.total > 0) return res.status(409).json({ error: `Hay ${usuarios.total} usuarios con este rol. Reasígnalos primero.` });

    await db.run('DELETE FROM roles WHERE id = ?', [rolId]);
    await recargarPermisos();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ======================== USUARIOS ========================

app.post('/api/admin/test-historial', validarToken, (req, res) => {
  res.json({ success: true, message: 'Endpoint de prueba historial operativo' });
});

app.get('/api/usuarios', validarToken, requerirPermiso('usuarios.gestionar'), async (req, res) => {
  try {
    const users = await db.all(`
      SELECT u.id, u.nombre, u.usuario, u.rol_id, r.nombre as rol_nombre
      FROM usuarios u LEFT JOIN roles r ON u.rol_id = r.id ORDER BY u.nombre
    `);
    res.json({ usuarios: users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/usuarios', validarToken, requerirPermiso('usuarios.gestionar'), async (req, res) => {
  const { nombre, usuario, contrasena, rol_id } = req.body;
  if (!nombre || !usuario || !contrasena) return res.status(400).json({ error: 'Nombre, usuario y contraseña requeridos' });

  try {
    const result = await db.run(
      'INSERT INTO usuarios (nombre, usuario, contrasena, rol_id, created_at) VALUES (?, ?, ?, ?, ?)',
      [nombre, usuario, contrasena, rol_id || null, ahoraISO()]
    );
    res.status(201).json({ success: true, id: result.lastID });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/usuarios/:id', validarToken, requerirPermiso('usuarios.gestionar'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre, usuario, contrasena, rol_id } = req.body;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const sets = [];
    const vals = [];
    if (nombre) { sets.push('nombre = ?'); vals.push(nombre); }
    if (usuario) { sets.push('usuario = ?'); vals.push(usuario); }
    if (contrasena) { sets.push('contrasena = ?'); vals.push(contrasena); }
    if (rol_id !== undefined) { sets.push('rol_id = ?'); vals.push(rol_id); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    vals.push(id);

    await db.run(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`, vals);
    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/usuarios/:id', validarToken, requerirPermiso('usuarios.gestionar'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  if (id === req.usuario.id) return res.status(403).json({ error: 'No puedes eliminarte a ti mismo' });

  try {
    const result = await db.run('DELETE FROM usuarios WHERE id = ?', [id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ======================== REFERENCIAS Y VERSIONES ========================

app.post('/api/referencias', validarToken, requerirPermiso('referencias.crear'), upload.single('imagen'), async (req, res) => {
  const { codigo_base, motivo } = req.body;
  const usuarioId = req.usuario.id;

  if (!codigo_base) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'codigo_base requerido' }); }
  if (!req.file) return res.status(400).json({ error: 'Debe subir una imagen' });

  let carpetaDestino;
  try { carpetaDestino = obtenerCarpetaDestino(req); }
  catch (e) { if (req.file) fs.unlinkSync(req.file.path); return res.status(500).json({ error: e.message }); }

  try {
    const existente = await db.get('SELECT id FROM referencias WHERE codigo_base = ?', [codigo_base]);
    if (existente) { fs.unlinkSync(req.file.path); return res.status(409).json({ error: 'Ya existe esa referencia' }); }

    const resultRef = await db.run(
      'INSERT INTO referencias (codigo_base, creado_por, created_at) VALUES (?, ?, ?)',
      [codigo_base, usuarioId, ahoraISO()]
    );
    const refId = resultRef.lastID;

    const ext = path.extname(req.file.originalname);
    const nombreArchivo = sanitizeFilename(nombreBaseParaArchivo(codigo_base)) + '_V1' + ext;
    const destinoFinal = path.join(carpetaDestino, nombreArchivo);
    moverArchivo(req.file.path, destinoFinal);

    await db.run(
      'INSERT INTO versiones (referencia_id, version, imagen_ruta, estado, creado_por, created_at, necesita_prueba) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [refId, 'V1', destinoFinal, 'activa', usuarioId, ahoraISO(), 1]
    );

    await insertarSeguimientoCambios(
      refId, 'creacion',
      { accion: 'Referencia creada', codigo_base, version: 'V1', imagen_ruta: destinoFinal },
      usuarioId, motivo || null
    );

    res.status(201).json({ success: true, referencia: { id: refId, codigo_base }, version: 'V1', imagen_ruta: destinoFinal });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error.message });
  }
});

// Crear nueva versión usando código_base (para el panel de edición)
app.post('/api/referencias-codigo/:codigo_base/versiones', validarToken, requerirPermiso('versiones.crear'), upload.single('imagen'), async (req, res) => {
  const codigoBase = decodeURIComponent(req.params.codigo_base || '');
  const { motivo, version: versionManual } = req.body;
  const usuarioId = req.usuario.id;

  if (!codigoBase) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'codigo_base requerido' }); }
  if (!req.file) return res.status(400).json({ error: 'Debe subir una imagen' });
  if (!motivo || !motivo.trim()) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'El motivo del cambio es obligatorio' }); }

  let carpetaDestino;
  try { carpetaDestino = obtenerCarpetaDestino(req); }
  catch (e) { if (req.file) fs.unlinkSync(req.file.path); return res.status(500).json({ error: e.message }); }

  try {
    const ref = await db.get('SELECT * FROM referencias WHERE codigo_base = ?', [codigoBase]);
    if (!ref) { fs.unlinkSync(req.file.path); return res.status(404).json({ error: 'Referencia no encontrada' }); }
    const referenciaId = ref.id;

    const versionActiva = await db.get(
      'SELECT * FROM versiones WHERE referencia_id = ? AND LOWER(estado) = ? ORDER BY id DESC LIMIT 1',
      [referenciaId, 'activa']
    );

    let nuevaVersion = 'V1';
    if (versionManual && versionManual.trim()) {
      const vTrim = versionManual.trim().toUpperCase();
      if (!/^V\d+$/i.test(vTrim)) {
        fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'El número de versión debe tener formato V1, V2, V3...' });
      }
      const existeVer = await db.get('SELECT id FROM versiones WHERE referencia_id = ? AND version = ?', [referenciaId, vTrim]);
      if (existeVer) {
        fs.unlinkSync(req.file.path);
        return res.status(409).json({ error: `Ya existe la versión ${vTrim} para esta referencia` });
      }
      nuevaVersion = vTrim;
    } else if (versionActiva) {
      const match = versionActiva.version.match(/V(\d+)/);
      nuevaVersion = 'V' + ((match ? parseInt(match[1], 10) : 0) + 1);
    }

    let rutaObsoleta = null;
    if (versionActiva && versionActiva.imagen_ruta) {
      const rutaAnterior = versionActiva.imagen_ruta;
      if (fs.existsSync(rutaAnterior)) {
        const fechaSufijo = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const ext = path.extname(rutaAnterior);
        const nombreBase = path.basename(rutaAnterior, ext);
        const destinoObsoleto = path.join(OBSOLETAS_DIR, nombreBase + '_' + fechaSufijo + ext);
        moverArchivo(rutaAnterior, destinoObsoleto);
        rutaObsoleta = destinoObsoleto;
        await db.run('UPDATE versiones SET estado = ?, imagen_ruta = ? WHERE id = ?', ['obsoleta', destinoObsoleto, versionActiva.id]);
      } else {
        await db.run('UPDATE versiones SET estado = ? WHERE id = ?', ['obsoleta', versionActiva.id]);
      }
    }

    const ext = path.extname(req.file.originalname);
    const nombreArchivo = sanitizeFilename(nombreBaseParaArchivo(ref.codigo_base)) + '_' + nuevaVersion + ext;
    const destinoFinal = path.join(carpetaDestino, nombreArchivo);
    moverArchivo(req.file.path, destinoFinal);

    const resultVer = await db.run(
      'INSERT INTO versiones (referencia_id, version, imagen_ruta, estado, creado_por, created_at, necesita_prueba) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [referenciaId, nuevaVersion, destinoFinal, 'activa', usuarioId, ahoraISO(), 1]
    );

    await insertarSeguimientoCambios(
      referenciaId, 'nueva_version',
      {
        accion: 'Nueva versión', version: { antes: versionActiva?.version, despues: nuevaVersion },
        imagen_ruta: { antes: versionActiva?.imagen_ruta, despues: destinoFinal }, ruta_obsoleta: rutaObsoleta
      },
      usuarioId, motivo || null
    );

    res.status(201).json({ success: true, version: { id: resultVer.lastID, version: nuevaVersion, imagen_ruta: destinoFinal, estado: 'activa' } });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error.message });
  }
});

// Modificar versión actual (reemplaza imagen, misma versión, mueve anterior a obsoletas)
app.post('/api/referencias/:codigo_base/modificar-version', validarToken, requerirPermiso('referencias.editar'), upload.single('imagen'), async (req, res) => {
  const codigoBase = decodeURIComponent(req.params.codigo_base || '');
  const { motivo } = req.body;
  const usuarioId = req.usuario.id;

  if (!codigoBase) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'codigo_base requerido' }); }
  if (!req.file) return res.status(400).json({ error: 'Debe subir una imagen para reemplazar la versión actual' });

  try {
    const ref = await db.get('SELECT * FROM referencias WHERE codigo_base = ?', [codigoBase]);
    if (!ref) { fs.unlinkSync(req.file.path); return res.status(404).json({ error: 'Referencia no encontrada' }); }

    const versionActiva = await db.get(
      'SELECT * FROM versiones WHERE referencia_id = ? AND LOWER(estado) = ? ORDER BY id DESC LIMIT 1',
      [ref.id, 'activa']
    );

    if (!versionActiva) { fs.unlinkSync(req.file.path); return res.status(404).json({ error: 'No hay versión activa para modificar' }); }

    let rutaObsoleta = null;
    const rutaAnterior = versionActiva.imagen_ruta;
    if (rutaAnterior && fs.existsSync(rutaAnterior)) {
      const fechaSufijo = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const ext = path.extname(rutaAnterior);
      const nombreBase = path.basename(rutaAnterior, ext);
      const destinoObsoleto = path.join(OBSOLETAS_DIR, nombreBase + '_' + fechaSufijo + '_mod' + ext);
      moverArchivo(rutaAnterior, destinoObsoleto);
      rutaObsoleta = destinoObsoleto;
    }

    const extNueva = path.extname(req.file.originalname);
    const nombreArchivo = sanitizeFilename(nombreBaseParaArchivo(ref.codigo_base)) + '_' + versionActiva.version + extNueva;
    const carpetaDestino = rutaAnterior ? path.dirname(rutaAnterior) : (CARPETAS_FOTOS[1] || CARPETAS_FOTOS[0]);
    const destinoFinal = path.join(carpetaDestino, nombreArchivo);
    moverArchivo(req.file.path, destinoFinal);

    await db.run(
      'UPDATE versiones SET imagen_ruta = ? WHERE id = ?',
      [destinoFinal, versionActiva.id]
    );
    await db.run('UPDATE versiones SET necesita_prueba = 1 WHERE id = ?', [versionActiva.id]);

    await insertarSeguimientoCambios(
      ref.id, 'modificacion',
      {
        accion: 'Modificación de versión actual',
        version: versionActiva.version,
        imagen_ruta: { antes: rutaAnterior, despues: destinoFinal },
        ruta_obsoleta: rutaObsoleta
      },
      usuarioId, motivo || null
    );

    res.json({ success: true, message: `Versión ${versionActiva.version} modificada correctamente`, imagen_ruta: destinoFinal });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/referencias/:id', validarToken, requerirPermiso('referencias.ver'), async (req, res) => {
  const referenciaId = parseInt(req.params.id, 10);
  if (isNaN(referenciaId)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const ref = await db.get('SELECT * FROM referencias WHERE id = ?', [referenciaId]);
    if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });
    const versiones = await db.all('SELECT * FROM versiones WHERE referencia_id = ? ORDER BY id DESC', [referenciaId]);
    const activa = versiones.find(v => v.estado?.toLowerCase() === 'activa');
    res.json({ referencia: ref, version_activa: activa || null, historial: versiones });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/referencias', validarToken, requerirPermiso('referencias.ver'), async (req, res) => {
  try {
    const refs = await db.all('SELECT codigo_base FROM referencias ORDER BY codigo_base');
    res.json({ referencias: refs.map(r => r.codigo_base) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/fotos/*', validarToken, requerirPermiso('referencias.ver'), async (req, res) => {
  try {
    const codigoBase = decodeURIComponent(req.params[0] || '');
    const nombreUsuario = req.usuario.nombre || 'Inspector';

    const ref = await db.get('SELECT id FROM referencias WHERE codigo_base = ?', [codigoBase]);
    if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });

    const versionActiva = await db.get(
      'SELECT * FROM versiones WHERE referencia_id = ? AND LOWER(estado) = ? LIMIT 1',
      [ref.id, 'activa']
    );
    if (!versionActiva || !versionActiva.imagen_ruta) return res.status(404).json({ error: 'No hay imagen activa' });

    let filePath = versionActiva.imagen_ruta;
    if (!fs.existsSync(filePath)) {
      const encontrada = buscarArchivoRecursivo(path.basename(filePath));
      if (encontrada) {
        await db.run('UPDATE versiones SET imagen_ruta = ? WHERE id = ?', [encontrada, versionActiva.id]);
        filePath = encontrada;
      } else return res.status(404).json({ error: 'Archivo no encontrado en disco' });
    }

    await aplicarMarcaDeAgua(filePath, nombreUsuario, res);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function aplicarMarcaDeAgua(filePath, nombreUsuario, res) {
  const logoInfo = await obtenerLogoBase64();
  // Leer imagen a buffer primero para liberar el handle del archivo en disco
  const imgBuffer = fs.readFileSync(filePath);
  const meta = await sharp(imgBuffer).metadata();
  const w = meta.width || 1200, h = meta.height || 800;
  const pw = 500, ph = 350, cx = pw/2, cy = ph/2;
  const lw = 220, lh = 90, lx = cx - lw/2, gap = 10, fsz = 26;
  const gh = lh + gap + fsz, sy = (ph - gh)/2, ty = sy + lh + gap + 20;

  const svgLogo = logoInfo ? `<image xlink:href="${logoInfo.dataUrl}" x="${lx}" y="${sy}" width="${lw}" height="${lh}" opacity="0.22" preserveAspectRatio="xMidYMid meet"/>` : '';
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><pattern id="g" width="${pw}" height="${ph}" patternUnits="userSpaceOnUse"><g transform="rotate(-25 ${cx} ${cy})">${svgLogo}<text x="${cx}" y="${ty}" fill="rgba(0,0,0,0.22)" font-size="${fsz}" font-family="sans-serif" font-weight="bold" text-anchor="middle">${nombreUsuario}</text></g></pattern></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;

  const buf = await sharp(imgBuffer).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 80 }).toBuffer();
  const b64 = buf.toString('base64');
  res.json({ fotos: [{ nombre: path.basename(filePath), data: `data:image/jpeg;base64,${b64}` }], referencia: path.basename(filePath, path.extname(filePath)) });
}

// GET datos de referencia para edición (simplificado)
app.get('/api/imagen/:referencia', validarToken, requerirPermiso('referencias.ver'), async (req, res) => {
  const codigoBase = decodeURIComponent(req.params.referencia || '');
  try {
    const ref = await db.get(`
      SELECT r.id, r.codigo_base, r.creado_por, r.created_at, u.nombre as creado_por_nombre
      FROM referencias r
      LEFT JOIN usuarios u ON r.creado_por = u.id
      WHERE r.codigo_base = ?
    `, [codigoBase]);
    if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });

    const versionActiva = await db.get('SELECT * FROM versiones WHERE referencia_id = ? AND LOWER(estado) = ? LIMIT 1', [ref.id, 'activa']);

    res.json({
      datos: {
        id: ref.id,
        codigo_base: ref.codigo_base,
        version_actual: versionActiva?.version || '',
        imagen_ruta: versionActiva?.imagen_ruta || '',
        estado: versionActiva?.estado || '',
        creado_por: ref.creado_por_nombre || 'Desconocido',
        fecha_creacion: ref.created_at,
        version_id: versionActiva?.id || null,
        necesita_prueba: versionActiva?.necesita_prueba || 0
      }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT: marcar/desmarcar necesita_prueba en una versión
app.put('/api/versiones/:id/prueba', validarToken, requerirPermiso('referencias.editar'), async (req, res) => {
  const versionId = parseInt(req.params.id, 10);
  const { necesita_prueba } = req.body;
  if (isNaN(versionId)) return res.status(400).json({ error: 'ID de versión inválido' });

  try {
    await db.run('UPDATE versiones SET necesita_prueba = ? WHERE id = ?', [necesita_prueba ? 1 : 0, versionId]);
    res.json({ success: true, necesita_prueba: necesita_prueba ? 1 : 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/versiones/:codigo_base', validarToken, requerirPermiso('referencias.ver'), async (req, res) => {
  try {
    const codigoBase = decodeURIComponent(req.params.codigo_base || '');
    const ref = await db.get('SELECT id FROM referencias WHERE codigo_base = ?', [codigoBase]);
    if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });
    const versiones = await db.all('SELECT * FROM versiones WHERE referencia_id = ? ORDER BY id DESC', [ref.id]);
    res.json({ versiones });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/seguimiento/:codigo_base', validarToken, requerirPermiso('referencias.ver'), async (req, res) => {
  try {
    const codigoBase = decodeURIComponent(req.params.codigo_base || '');
    const ref = await db.get('SELECT id FROM referencias WHERE codigo_base = ?', [codigoBase]);
    if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });
        const seguimiento = await db.all('SELECT * FROM seguimiento_cambios WHERE referencia_id = ? ORDER BY fecha_cambio DESC', [ref.id]);
    res.json({ seguimiento });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/rutas-fotos', validarToken, requerirPermiso('referencias.ver'), async (req, res) => {
  try {
    const rutas = [];
    for (const carpeta of CARPETAS_FOTOS) {
      if (fs.existsSync(carpeta)) rutas.push(...escanearRecursivo(carpeta));
    }
    rutas.sort((a, b) => a.localeCompare(b));
    res.json({ rutas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ======================== OBSERVACIONES ========================
app.get('/api/observaciones/:codigo_base', validarToken, requerirPermiso('observaciones.ver'), async (req, res) => {
  const codigoBase = decodeURIComponent(req.params.codigo_base || '');
  try {
    const ref = await db.get('SELECT id FROM referencias WHERE codigo_base = ?', [codigoBase]);
    if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });
    const obs = await db.get(`
      SELECT o.*, u.nombre as actualizado_por_nombre
      FROM observaciones o
      LEFT JOIN usuarios u ON o.actualizado_por = u.id
      WHERE o.referencia_id = ?
    `, [ref.id]);
    res.json({ observacion: obs || null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/observaciones/:codigo_base', validarToken, requerirPermiso('observaciones.editar'), async (req, res) => {
  const codigoBase = decodeURIComponent(req.params.codigo_base || '');
  const { observacion } = req.body;
  const usuarioId = req.usuario.id;

  try {
    const ref = await db.get('SELECT id FROM referencias WHERE codigo_base = ?', [codigoBase]);
    if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });

    const existente = await db.get('SELECT id FROM observaciones WHERE referencia_id = ?', [ref.id]);
    if (existente) {
      await db.run(
        'UPDATE observaciones SET observacion = ?, actualizado_por = ?, actualizado_en = ? WHERE id = ?',
        [observacion || '', usuarioId, ahoraISO(), existente.id]
      );
    } else {
      await db.run(
        'INSERT INTO observaciones (referencia_id, observacion, actualizado_por, actualizado_en) VALUES (?, ?, ?, ?)',
        [ref.id, observacion || '', usuarioId, ahoraISO()]
      );
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ======================== RECOMENDACIONES ========================
app.get('/api/recomendaciones/:referencia', validarToken, requerirPermisoAlternativo(['recomendaciones.ver', 'recomendaciones.crear']), async (req, res) => {
  const referencia = decodeURIComponent(req.params.referencia || '');
  const puedeVerTodas = tienePermiso(req.usuario.rol_id, 'recomendaciones.ver');
  try {
    let query = `
      SELECT r.id, r.referencia, r.recomendacion, r.usuario_id, r.usuario_nombre, r.fecha_creacion,
             u.nombre as autor_nombre
      FROM recomendaciones r
      LEFT JOIN usuarios u ON r.usuario_id = u.id
      WHERE r.referencia = ? AND (r.eliminada = 0 OR r.eliminada IS NULL)
    `;
    const params = [referencia];
    if (!puedeVerTodas) {
      query += ' AND r.usuario_id = ?';
      params.push(req.usuario.id);
    }
    query += ' ORDER BY r.fecha_creacion ASC';
    const rows = await db.all(query, params);
    res.json({ recomendaciones: rows.map(r => ({ id: r.id, referencia: r.referencia, recomendacion: r.recomendacion, usuario_id: r.usuario_id, autor: r.usuario_nombre || r.autor_nombre || 'Usuario', fecha: r.fecha_creacion })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/recomendacion', validarToken, requerirPermiso('recomendaciones.crear'), async (req, res) => {
  const { referencia, recomendacion } = req.body;
  if (!referencia || !recomendacion?.trim()) return res.status(400).json({ error: 'Referencia y recomendación requeridas' });
  try {
    const result = await db.run('INSERT INTO recomendaciones (referencia, recomendacion, usuario_id, usuario_nombre, fecha_creacion) VALUES (?, ?, ?, ?, ?)',
      [referencia, recomendacion.trim(), req.usuario.id, req.usuario.nombre, ahoraISO()]);
    res.json({ success: true, id: result.lastID });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/recomendacion/:id', validarToken, requerirPermiso('recomendaciones.eliminar'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const result = await db.run('UPDATE recomendaciones SET eliminada = 1, eliminada_por = ?, fecha_eliminacion = ? WHERE id = ? AND (eliminada = 0 OR eliminada IS NULL)', [req.usuario.id, ahoraISO(), id]);
    if (result.changes === 0) return res.status(404).json({ error: 'No encontrada' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ======================== MÓDULO DE GARANTÍAS ========================
app.get('/api/clientes/buscar', validarToken, requerirPermisoAlternativo(['garantias.ver', 'garantias.crear', 'garantias.editar']), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const clientes = await db.all(
      'SELECT nit, razon_social, codigo_vendedor, nombre_vendedor, ciudad FROM clientes WHERE nit LIKE ? OR razon_social LIKE ? LIMIT 15',
      [`%${q}%`, `%${q}%`]
    );
    res.json(clientes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/referencias-pt/buscar', validarToken, requerirPermisoAlternativo(['garantias.ver', 'garantias.crear', 'garantias.editar']), async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const refs = await db.all(
      'SELECT referencia, linea_base, tipo_circuito FROM referencias_pt WHERE referencia LIKE ? LIMIT 15',
      [`%${q}%`]
    );
    res.json(refs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function obtenerSiguienteNumeroGarantia(dbInstance) {
  const ultima = await dbInstance.get('SELECT no_garantia FROM garantias ORDER BY id DESC LIMIT 1');
  let siguienteNum = 1250;
  if (ultima && ultima.no_garantia) {
    const match = ultima.no_garantia.match(/\d+/);
    if (match) {
      const num = parseInt(match[0], 10);
      siguienteNum = Math.max(1250, num + 1);
    }
  }
  return `G${siguienteNum}`;
}

app.get('/api/siguiente-garantia', validarToken, requerirPermisoAlternativo(['garantias.ver', 'garantias.crear']), async (req, res) => {
  try {
    const siguiente = await obtenerSiguienteNumeroGarantia(db);
    res.json({ siguiente });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/garantias', validarToken, requerirPermiso('garantias.ver'), async (req, res) => {
  try {
    const garantias = await db.all('SELECT * FROM garantias ORDER BY id DESC');
    res.json(garantias);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/garantias', validarToken, requerirPermiso('garantias.crear'), async (req, res) => {
  const {
    fecha_reporte, nit_cliente, cliente, ciudad,
    responsable, vendedor_distribuidor, remision,
    tipo_solicitud, estado, fecha_revision,
    quien_aprobo_rechazo, observaciones_general, items,
    referencia, cantidad, lote_fecha, problema, observaciones
  } = req.body;

  if (!nit_cliente) {
    return res.status(400).json({ error: 'NIT del cliente es obligatorio' });
  }

  const listaItems = items && Array.isArray(items) && items.length > 0 
    ? items 
    : [{ referencia, cantidad, lote_fecha, problema, observaciones }];

  if (listaItems.length === 0 || !listaItems[0].referencia) {
    return res.status(400).json({ error: 'Debe agregar al menos una referencia de producto' });
  }

  try {
    const usuarioLogeado = req.usuario.nombre || req.usuario.usuario || 'Sistema';
    const fechaRep = fecha_reporte || new Date().toISOString().split('T')[0];
    const fechaRev = fecha_revision || new Date().toISOString().split('T')[0];

    // Número de garantía compartido para toda la remisión (comenzando desde G1250)
    const numGarantia = await obtenerSiguienteNumeroGarantia(db);

    const insertedIds = [];

    for (const item of listaItems) {
      if (!item.referencia) continue;

      const result = await db.run(`
        INSERT INTO garantias (
          no_garantia, fecha_reporte, responsable, vendedor_distribuidor, memorando,
          op_pedido, cliente, nit_cliente, ciudad, remision, referencia, cantidad,
          tipo_solicitud, observaciones, fecha_revision, estado, lote_fecha,
          problema, quien_aprobo_rechazo, observacion_calidad, tipo_circuito, fecha_creacion
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `, [
        numGarantia, fechaRep,
        responsable || '', vendedor_distribuidor || '', '', '',
        cliente || '', nit_cliente, ciudad || '', remision || '', 
        item.referencia, item.cantidad || 1,
        item.tipo_solicitud || tipo_solicitud || 'GARANTIA', item.observaciones || observaciones_general || '',
        fechaRev, estado || 'Pendiente', item.lote_fecha || '', 
        item.problema || '', quien_aprobo_rechazo || usuarioLogeado, '', ''
      ]);
      insertedIds.push({ id: result.lastID, no_garantia: numGarantia });
    }

    res.json({ success: true, count: insertedIds.length, registros: insertedIds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/garantias/:id', validarToken, requerirPermiso('garantias.editar'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  const {
    estado, tipo_solicitud, cantidad, referencia, lote_fecha,
    problema, observaciones, remision, quien_aprobo_rechazo
  } = req.body;
  try {
    await db.run(`
      UPDATE garantias SET
        estado = ?, tipo_solicitud = ?, cantidad = ?, referencia = ?,
        lote_fecha = ?, problema = ?, observaciones = ?, remision = ?,
        quien_aprobo_rechazo = ?
      WHERE id = ?
    `, [
      estado || 'Pendiente', tipo_solicitud || 'GARANTIA', cantidad || 1, referencia || '',
      lote_fecha || '', problema || '', observaciones || '', remision || '',
      quien_aprobo_rechazo || '', id
    ]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/garantias/:id', validarToken, requerirPermiso('garantias.eliminar'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  try {
    await db.run('DELETE FROM garantias WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ======================== MÓDULO WHATSAPP BOT ========================
const whatsappService = require('./whatsapp_bot_service');
const whatsappConfig = require('./config_whatsapp');

app.get('/api/whatsapp/sesiones', validarToken, requerirPermiso('whatsapp.bot.ver'), async (req, res) => {
  try {
    const sesiones = await db.all('SELECT * FROM whatsapp_sesiones_activas');
    const resultado = sesiones.map(s => ({
      ...s,
      nombre: whatsappService.nombreDe(s.telefono)
    }));
    res.json({ sesiones: resultado });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/whatsapp/registros', validarToken, requerirPermiso('whatsapp.bot.ver'), async (req, res) => {
  try {
    const limite = parseInt(req.query.limite || '100', 10);
    const registros = await db.all('SELECT * FROM whatsapp_registros ORDER BY id DESC LIMIT ?', [limite]);
    const resultado = registros.map(r => ({
      ...r,
      nombre: whatsappService.nombreDe(r.telefono)
    }));
    res.json({ registros: resultado });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/whatsapp/cerrar-sesion', validarToken, requerirPermiso('whatsapp.bot.gestionar'), async (req, res) => {
  const { telefono } = req.body;
  if (!telefono) return res.status(400).json({ error: 'Teléfono requerido' });
  try {
    const r = await whatsappService.cerrarSesionPorAdmin(telefono);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/whatsapp/resumen', validarToken, requerirPermiso('whatsapp.bot.gestionar'), async (req, res) => {
  try {
    await whatsappService.enviarResumenAdmin();
    res.json({ success: true, message: 'Resumen enviado al administrador por WhatsApp' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/whatsapp/areas', validarToken, requerirPermiso('whatsapp.bot.ver'), (req, res) => {
  res.json({
    areas: whatsappConfig.AREAS,
    admin: whatsappConfig.ADMIN_NUMERO,
    timezone: whatsappConfig.TIMEZONE
  });
});

// ======================== IMPORTAR CSV METROLOGÍA ========================
async function unificarReferenciasDuplicadas() {
  try {
    const refs = await db.all('SELECT id, codigo_base FROM moldes_referencias ORDER BY id ASC');
    const map = new Map();

    for (const r of refs) {
      const norm = r.codigo_base.trim().toLowerCase();
      if (!map.has(norm)) {
        map.set(norm, r.id);
      } else {
        const primaryId = map.get(norm);
        const duplicateId = r.id;

        await db.run('UPDATE moldes_versiones SET referencia_id = ? WHERE referencia_id = ?', [primaryId, duplicateId]);
        await db.run('UPDATE moldes_cotas SET referencia_id = ? WHERE referencia_id = ?', [primaryId, duplicateId]);
        await db.run('UPDATE moldes_inspecciones SET referencia_id = ? WHERE referencia_id = ?', [primaryId, duplicateId]);
        await db.run('UPDATE moldes_seguimiento_cambios SET referencia_id = ? WHERE referencia_id = ?', [primaryId, duplicateId]);

        await db.run('DELETE FROM moldes_referencias WHERE id = ?', [duplicateId]);
        console.log(`🔗 Referencia duplicada unificada: ID ${duplicateId} (${r.codigo_base}) -> ID ${primaryId}`);
      }
    }
  } catch (e) {
    console.error('⚠️ Error unificando referencias duplicadas:', e.message);
  }
}

async function importarCsvMetrologia() {
  try {
    const adminUser = await db.get('SELECT id FROM usuarios WHERE usuario = ?', ['admin']);
    const adminId = adminUser ? adminUser.id : 1;

    // 1. Importar Rutas.csv
    const rutasPath = 'C:\\Users\\produ\\OneDrive\\Escritorio\\Rutas.csv';
    if (fs.existsSync(rutasPath)) {
      const contenido = fs.readFileSync(rutasPath, 'latin1');
      const lineas = contenido.split(/\r?\n/).filter(l => l.trim().length > 0);
      let countRutas = 0;
      for (let i = 1; i < lineas.length; i++) {
        const partes = lineas[i].split(';');
        if (partes.length >= 3) {
          const codigoBase = partes[1].trim();
          const rutaArchivo = partes[2].trim();
          if (!codigoBase) continue;

          let ref = await db.get('SELECT id FROM moldes_referencias WHERE LOWER(TRIM(codigo_base)) = LOWER(TRIM(?))', [codigoBase]);
          let refId;
          if (!ref) {
            const resRef = await db.run(
              'INSERT INTO moldes_referencias (codigo_base, creado_por, created_at) VALUES (?, ?, ?)',
              [codigoBase, adminId, ahoraISO()]
            );
            refId = resRef.lastID;
            await db.run(
              'INSERT INTO moldes_seguimiento_cambios (referencia_id, tipo_cambio, cambio, motivo, hecho_por, fecha_cambio) VALUES (?, ?, ?, ?, ?, ?)',
              [refId, 'creacion', JSON.stringify({ codigo_base: codigoBase }), 'Importación inicial desde Rutas.csv', adminId, ahoraISO()]
            );
          } else {
            refId = ref.id;
          }

          const verV1 = await db.get('SELECT id FROM moldes_versiones WHERE referencia_id = ? AND version = ?', [refId, 'V1']);
          if (!verV1) {
            await db.run(
              'INSERT INTO moldes_versiones (referencia_id, version, archivo_ruta, estado, creado_por, created_at) VALUES (?, ?, ?, ?, ?, ?)',
              [refId, 'V1', rutaArchivo, 'activa', adminId, ahoraISO()]
            );
            countRutas++;
          }
        }
      }
      console.log(`✅ Rutas.csv importado: ${countRutas} planos.`);
    }

    // 2. Importar cotas.csv
    const cotasPath = 'C:\\Users\\produ\\OneDrive\\Escritorio\\cotas.csv';
    if (fs.existsSync(cotasPath)) {
      const contenido = fs.readFileSync(cotasPath, 'latin1');
      const lineas = contenido.split(/\r?\n/).filter(l => l.trim().length > 0);
      let countCotas = 0;
      for (let i = 1; i < lineas.length; i++) {
        const partes = lineas[i].split(';');
        if (partes.length >= 4) {
          const codigoBase = partes[0].trim();
          const cota = partes[1].trim();
          const medidaEstandar = parseFloat(partes[2].trim().replace(',', '.')) || 0;
          const tolerancia = parseFloat(partes[3].trim().replace(',', '.')) || 0;
          const tolMax = medidaEstandar + tolerancia;
          const tolMin = medidaEstandar - tolerancia;

          if (!codigoBase || !cota) continue;

          let ref = await db.get('SELECT id FROM moldes_referencias WHERE LOWER(TRIM(codigo_base)) = LOWER(TRIM(?))', [codigoBase]);
          let refId;
          if (!ref) {
            const resRef = await db.run(
              'INSERT INTO moldes_referencias (codigo_base, creado_por, created_at) VALUES (?, ?, ?)',
              [codigoBase, adminId, ahoraISO()]
            );
            refId = resRef.lastID;
          } else {
            refId = ref.id;
          }

          const existeCota = await db.get('SELECT id FROM moldes_cotas WHERE referencia_id = ? AND cota = ?', [refId, cota]);
          if (!existeCota) {
            await db.run(
              'INSERT INTO moldes_cotas (referencia_id, cota, medida_estandar, tolerancia, tolerancia_maxima, tolerancia_minima) VALUES (?, ?, ?, ?, ?, ?)',
              [refId, cota, medidaEstandar, tolerancia, tolMax, tolMin]
            );
            countCotas++;
          }
        }
      }
      console.log(`✅ cotas.csv importado: ${countCotas} cotas.`);
    }

    // Unificar cualquier referencia duplicada existente
    await unificarReferenciasDuplicadas();
  } catch (e) {
    console.error('⚠️ Error en importarCsvMetrologia:', e.message);
  }
}

// ======================== MÓDULO METROLOGÍA Y PLANOS DE MOLDE ========================

app.post('/api/moldes/referencias', validarToken, requerirPermiso('metrologia.crear_referencia'), upload.single('archivo'), async (req, res) => {
  const { codigo_base, version, motivo, cotas } = req.body;
  const usuarioId = req.usuario.id;

  if (!codigo_base || !codigo_base.trim()) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'El código base de la referencia es obligatorio' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Debe subir el archivo del plano (PDF o imagen)' });
  }

  try {
    const existente = await db.get('SELECT id FROM moldes_referencias WHERE LOWER(TRIM(codigo_base)) = LOWER(TRIM(?))', [codigo_base.trim()]);
    if (existente) {
      fs.unlinkSync(req.file.path);
      return res.status(409).json({ error: 'Ya existe una referencia de molde con ese código' });
    }

    const resRef = await db.run(
      'INSERT INTO moldes_referencias (codigo_base, creado_por, created_at) VALUES (?, ?, ?)',
      [codigo_base.trim(), usuarioId, ahoraISO()]
    );
    const refId = resRef.lastID;

    const ver = version && version.trim() ? version.trim().toUpperCase() : 'V1';
    const ext = path.extname(req.file.originalname);
    const nombreArchivo = sanitizeFilename(codigo_base.trim().replace(/\//g, '_')) + '_' + ver + ext;
    const destinoFinal = path.join(TMP_DIR, nombreArchivo);
    fs.renameSync(req.file.path, destinoFinal);

    await db.run(
      'INSERT INTO moldes_versiones (referencia_id, version, archivo_ruta, estado, creado_por, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [refId, ver, destinoFinal, 'activa', usuarioId, ahoraISO()]
    );

    if (cotas) {
      let parsedCotas = [];
      try {
        parsedCotas = typeof cotas === 'string' ? JSON.parse(cotas) : cotas;
      } catch (e) {}

      for (const c of parsedCotas) {
        if (!c.cota || c.medida_estandar === undefined || c.tolerancia === undefined) continue;
        const est = parseFloat(c.medida_estandar) || 0;
        const tol = parseFloat(c.tolerancia) || 0;
        const tolMax = est + tol;
        const tolMin = est - tol;

        await db.run(`
          INSERT INTO moldes_cotas (referencia_id, cota, medida_estandar, tolerancia, tolerancia_maxima, tolerancia_minima)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [refId, c.cota.trim().toUpperCase(), est, tol, tolMax, tolMin]);
      }
    }

    await db.run(
      'INSERT INTO moldes_seguimiento_cambios (referencia_id, tipo_cambio, cambio, motivo, hecho_por, fecha_cambio) VALUES (?, ?, ?, ?, ?, ?)',
      [refId, 'creacion', JSON.stringify({ codigo_base: codigo_base.trim(), version: ver, archivo: destinoFinal }), motivo || 'Creación de referencia y cotas iniciales', usuarioId, ahoraISO()]
    );

    res.status(201).json({ success: true, referencia_id: refId, codigo_base: codigo_base.trim() });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/moldes/referencias', validarToken, requerirPermiso('metrologia.ver'), async (req, res) => {
  try {
    const refs = await db.all(`
      SELECT r.id, r.codigo_base, r.created_at,
             v.version as version_activa, v.archivo_ruta,
             (SELECT COUNT(*) FROM moldes_cotas c WHERE c.referencia_id = r.id) as total_cotas
      FROM moldes_referencias r
      LEFT JOIN moldes_versiones v ON r.id = v.referencia_id AND LOWER(v.estado) = 'activa'
      ORDER BY r.codigo_base ASC
    `);
    res.json({ referencias: refs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/moldes/ver-plano', (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  const sesiones = cargarSesiones();
  if (!sesiones[token]) return res.status(401).json({ error: 'Token inválido' });
  const usuario = sesiones[token];

  if (!tienePermiso(usuario.rol_id, 'metrologia.ver')) {
    return res.status(403).json({ error: 'No tienes permiso' });
  }

  const ruta = req.query.ruta;
  if (!ruta) return res.status(400).json({ error: 'Ruta requerida' });
  
  let filePath = path.resolve(ruta);
  if (!fs.existsSync(filePath)) {
    const basename = path.basename(ruta);
    const encontrada = buscarArchivoRecursivo(basename);
    if (encontrada && fs.existsSync(encontrada)) {
      filePath = encontrada;
    } else if (fs.existsSync(path.join(TMP_DIR, basename))) {
      filePath = path.join(TMP_DIR, basename);
    } else {
      return res.status(404).json({ error: 'Archivo no encontrado en disco: ' + ruta });
    }
  }
  res.sendFile(filePath);
});

app.get('/api/moldes/ver-evidencia', (req, res) => {
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  const sesiones = cargarSesiones();
  if (!sesiones[token]) return res.status(401).json({ error: 'Token inválido' });
  const usuario = sesiones[token];

  if (!tienePermiso(usuario.rol_id, 'metrologia.ver')) {
    return res.status(403).json({ error: 'No tienes permiso' });
  }

  const ruta = req.query.ruta;
  if (!ruta) return res.status(400).json({ error: 'Ruta requerida' });
  
  let filePath = path.resolve(ruta);
  if (!fs.existsSync(filePath)) {
    const basename = path.basename(ruta);
    if (fs.existsSync(path.join(EVIDENCIAS_DIR, basename))) {
      filePath = path.join(EVIDENCIAS_DIR, basename);
    } else {
      return res.status(404).json({ error: 'Evidencia no encontrada en disco' });
    }
  }
  res.sendFile(filePath);
});

app.post('/api/moldes/referencias/:codigo/cotas', validarToken, requerirPermiso('metrologia.editar'), async (req, res) => {
  const codigo = decodeURIComponent(req.params.codigo || '');
  const { cota, medida_estandar, tolerancia, motivo } = req.body;
  const usuarioId = req.usuario.id;

  if (!cota || medida_estandar === undefined || tolerancia === undefined) {
    return res.status(400).json({ error: 'Cota, medida estándar y tolerancia son requeridas' });
  }

  try {
    const ref = await db.get('SELECT id FROM moldes_referencias WHERE codigo_base = ?', [codigo]);
    if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });

    const est = parseFloat(medida_estandar) || 0;
    const tol = parseFloat(tolerancia) || 0;
    const tolMax = est + tol;
    const tolMin = est - tol;

    await db.run(`
      INSERT INTO moldes_cotas (referencia_id, cota, medida_estandar, tolerancia, tolerancia_maxima, tolerancia_minima)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [ref.id, cota.trim().toUpperCase(), est, tol, tolMax, tolMin]);

    await db.run(`
      INSERT INTO moldes_seguimiento_cambios (referencia_id, tipo_cambio, cambio, motivo, hecho_por, fecha_cambio)
      VALUES (?, 'creacion_cota', ?, ?, ?, ?)
    `, [ref.id, JSON.stringify({ cota: cota.trim().toUpperCase(), medida_estandar: est, tolerancia: tol }), motivo || 'Adición de nueva cota', usuarioId, ahoraISO()]);

    res.status(201).json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/moldes/referencias/:codigo', validarToken, requerirPermiso('metrologia.ver'), async (req, res) => {
  const codigo = decodeURIComponent(req.params.codigo || '');
  try {
    const ref = await db.get(`
      SELECT r.id, r.codigo_base, r.created_at, u.nombre as creado_por_nombre
      FROM moldes_referencias r
      LEFT JOIN usuarios u ON r.creado_por = u.id
      WHERE r.codigo_base = ?
    `, [codigo]);
    if (!ref) return res.status(404).json({ error: 'Referencia de molde no encontrada' });

    const versionActiva = await db.get('SELECT * FROM moldes_versiones WHERE referencia_id = ? AND LOWER(estado) = ? LIMIT 1', [ref.id, 'activa']);
    const versiones = await db.all('SELECT v.*, u.nombre as creado_por_nombre FROM moldes_versiones v LEFT JOIN usuarios u ON v.creado_por = u.id WHERE v.referencia_id = ? ORDER BY v.id DESC', [ref.id]);
    const cotas = await db.all('SELECT * FROM moldes_cotas WHERE referencia_id = ? ORDER BY cota ASC', [ref.id]);
    const inspecciones = await db.all('SELECT i.*, u.nombre as creado_por_nombre FROM moldes_inspecciones i LEFT JOIN usuarios u ON i.creado_por = u.id WHERE i.referencia_id = ? ORDER BY i.id DESC', [ref.id]);
    const seguimiento = await db.all("SELECT s.*, u.nombre as hecho_por_nombre FROM moldes_seguimiento_cambios s LEFT JOIN usuarios u ON s.hecho_por = u.id WHERE s.referencia_id = ? AND s.tipo_cambio != 'inspeccion' ORDER BY s.fecha_cambio DESC", [ref.id]);

    res.json({
      referencia: ref,
      version_activa: versionActiva || null,
      versiones,
      cotas,
      inspecciones,
      seguimiento
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/moldes/referencias/:codigo/medidas', validarToken, requerirPermiso('metrologia.inspeccionar'), upload.any(), async (req, res) => {
  const codigo = decodeURIComponent(req.params.codigo || '');
  const { fecha, responsable, lote, molde, medidas } = req.body;
  const usuarioId = req.usuario.id;

  if (!fecha || !responsable) {
    if (req.files) req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
    return res.status(400).json({ error: 'Fecha y responsable son obligatorios' });
  }

  let parsedMedidas = [];
  try {
    parsedMedidas = typeof medidas === 'string' ? JSON.parse(medidas) : medidas;
  } catch (e) {
    if (req.files) req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
    return res.status(400).json({ error: 'Formato de medidas inválido' });
  }

  try {
    const ref = await db.get('SELECT id FROM moldes_referencias WHERE codigo_base = ?', [codigo]);
    if (!ref) {
      if (req.files) req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
      return res.status(404).json({ error: 'Referencia no encontrada' });
    }

    const resInsp = await db.run(`
      INSERT INTO moldes_inspecciones (referencia_id, fecha, responsable, lote, molde, creado_por, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [ref.id, fecha, responsable, lote || '', molde || '', usuarioId, ahoraISO()]);

    const inspeccionId = resInsp.lastID;

    const fileMap = {};
    if (req.files) {
      req.files.forEach(f => {
        fileMap[f.fieldname] = f;
      });
    }

    for (const m of parsedMedidas) {
      const cotaId = parseInt(m.cota_id, 10);
      const medidaReal = parseFloat(m.medida_real);
      if (isNaN(cotaId) || isNaN(medidaReal)) continue;

      const cotaInfo = await db.get('SELECT * FROM moldes_cotas WHERE id = ?', [cotaId]);
      if (!cotaInfo) continue;

      const estadoMedida = (medidaReal >= cotaInfo.tolerancia_minima && medidaReal <= cotaInfo.tolerancia_maxima) ? 'CONFORME' : 'FUERA DE TOLERANCIA';

      let evidenciaPath = null;
      const fileKey = `evidencia_${cotaId}`;
      if (fileMap[fileKey]) {
        const f = fileMap[fileKey];
        const ext = path.extname(f.originalname);
        const nuevoNombre = `evid_cota_${cotaId}_${Date.now()}${ext}`;
        const destino = path.join(EVIDENCIAS_DIR, nuevoNombre);
        fs.renameSync(f.path, destino);
        evidenciaPath = destino;
      }

      await db.run(`
        INSERT INTO moldes_medidas_detalle (inspeccion_id, cota_id, medida_real, estado, imagen_evidencia)
        VALUES (?, ?, ?, ?, ?)
      `, [inspeccionId, cotaId, medidaReal, estadoMedida, evidenciaPath]);
    }

    res.status(201).json({ success: true, inspeccion_id: inspeccionId });
  } catch (e) {
    if (req.files) req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/moldes/referencias/:codigo/versiones', validarToken, requerirPermiso('metrologia.crear'), upload.single('archivo'), async (req, res) => {
  const codigo = decodeURIComponent(req.params.codigo || '');
  const { motivo, version: versionManual } = req.body;
  const usuarioId = req.usuario.id;

  if (!req.file) return res.status(400).json({ error: 'Debe subir el archivo del plano' });
  if (!motivo || !motivo.trim()) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'El motivo del cambio es obligatorio' });
  }

  try {
    const ref = await db.get('SELECT id FROM moldes_referencias WHERE codigo_base = ?', [codigo]);
    if (!ref) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Referencia no encontrada' });
    }

    const versionActiva = await db.get('SELECT * FROM moldes_versiones WHERE referencia_id = ? AND LOWER(estado) = ? ORDER BY id DESC LIMIT 1', [ref.id, 'activa']);

    let nuevaVersion = 'V1';
    if (versionManual && versionManual.trim()) {
      nuevaVersion = versionManual.trim().toUpperCase();
    } else if (versionActiva) {
      const match = versionActiva.version.match(/V(\d+)/);
      nuevaVersion = 'V' + ((match ? parseInt(match[1], 10) : 0) + 1);
    }

    if (versionActiva) {
      await db.run('UPDATE moldes_versiones SET estado = ? WHERE id = ?', ['obsoleta', versionActiva.id]);
    }

    const ext = path.extname(req.file.originalname);
    const nombreArchivo = sanitizeFilename(codigo.replace(/\//g, '_')) + '_' + nuevaVersion + ext;
    const destinoFinal = path.join(TMP_DIR, nombreArchivo);
    fs.renameSync(req.file.path, destinoFinal);

    await db.run(`
      INSERT INTO moldes_versiones (referencia_id, version, archivo_ruta, estado, creado_por, created_at)
      VALUES (?, ?, ?, 'activa', ?, ?)
    `, [ref.id, nuevaVersion, destinoFinal, usuarioId, ahoraISO()]);

    await db.run(`
      INSERT INTO moldes_seguimiento_cambios (referencia_id, tipo_cambio, cambio, motivo, hecho_por, fecha_cambio)
      VALUES (?, 'nueva_version', ?, ?, ?, ?)
    `, [ref.id, JSON.stringify({ version: nuevaVersion, archivo: destinoFinal }), motivo, usuarioId, ahoraISO()]);

    res.status(201).json({ success: true, version: nuevaVersion });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/moldes/cotas/:id', validarToken, requerirPermiso('metrologia.editar_cotas'), async (req, res) => {
  const cotaId = parseInt(req.params.id, 10);
  const { cota: nombreCota, medida_estandar, tolerancia, motivo } = req.body;
  const usuarioId = req.usuario.id;

  if (isNaN(cotaId)) return res.status(400).json({ error: 'ID de cota inválido' });
  if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'El motivo de la modificación es obligatorio' });

  try {
    const cotaActual = await db.get('SELECT * FROM moldes_cotas WHERE id = ?', [cotaId]);
    if (!cotaActual) return res.status(404).json({ error: 'Cota no encontrada' });

    const nombre = nombreCota !== undefined && nombreCota.trim() !== '' ? nombreCota.trim().toUpperCase() : cotaActual.cota;
    const est = medida_estandar !== undefined ? parseFloat(medida_estandar) : cotaActual.medida_estandar;
    const tol = tolerancia !== undefined ? parseFloat(tolerancia) : cotaActual.tolerancia;
    const tolMax = est + tol;
    const tolMin = est - tol;

    await db.run(`
      UPDATE moldes_cotas SET cota = ?, medida_estandar = ?, tolerancia = ?, tolerancia_maxima = ?, tolerancia_minima = ?
      WHERE id = ?
    `, [nombre, est, tol, tolMax, tolMin, cotaId]);

    await db.run(`
      INSERT INTO moldes_seguimiento_cambios (referencia_id, tipo_cambio, cambio, motivo, hecho_por, fecha_cambio)
      VALUES (?, 'modificacion_cota', ?, ?, ?, ?)
    `, [cotaActual.referencia_id, JSON.stringify({ cota: nombre, anterior: { cota: cotaActual.cota, estandar: cotaActual.medida_estandar, tolerancia: cotaActual.tolerancia }, nuevo: { cota: nombre, estandar: est, tolerancia: tol } }), motivo, usuarioId, ahoraISO()]);

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/moldes/cotas/:id', validarToken, requerirPermiso('metrologia.eliminar_cotas'), async (req, res) => {
  const cotaId = parseInt(req.params.id, 10);
  const usuarioId = req.usuario.id;
  const { motivo } = req.body;
  if (isNaN(cotaId)) return res.status(400).json({ error: 'ID de cota inválido' });
  if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'El motivo de la eliminación es obligatorio' });

  try {
    const cota = await db.get('SELECT * FROM moldes_cotas WHERE id = ?', [cotaId]);
    if (!cota) return res.status(404).json({ error: 'Cota no encontrada' });

    await db.run('DELETE FROM moldes_cotas WHERE id = ?', [cotaId]);

    await db.run(`
      INSERT INTO moldes_seguimiento_cambios (referencia_id, tipo_cambio, cambio, motivo, hecho_por, fecha_cambio)
      VALUES (?, 'eliminacion_cota', ?, ?, ?, ?)
    `, [cota.referencia_id, JSON.stringify({ cota: cota.cota }), motivo.trim(), usuarioId, ahoraISO()]);

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/moldes/inspeccion-detalle/:id', validarToken, requerirPermiso('metrologia.ver'), async (req, res) => {
  const inspId = parseInt(req.params.id, 10);
  if (isNaN(inspId)) return res.status(400).json({ error: 'ID inválido' });
  try {
    const inspeccion = await db.get('SELECT i.*, u.nombre as creado_por_nombre FROM moldes_inspecciones i LEFT JOIN usuarios u ON i.creado_por = u.id WHERE i.id = ?', [inspId]);
    if (!inspeccion) return res.status(404).json({ error: 'Inspección no encontrada' });
    const medidas = await db.all(`
      SELECT m.*, c.cota, c.medida_estandar, c.tolerancia, c.tolerancia_maxima, c.tolerancia_minima
      FROM moldes_medidas_detalle m
      JOIN moldes_cotas c ON m.cota_id = c.id
      WHERE m.inspeccion_id = ?
      ORDER BY c.cota ASC
    `, [inspId]);
    res.json({ inspeccion, medidas });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ======================== INICIAR SERVIDOR ========================
const PORT = process.env.PORT || 3000;
inicializarBaseDatos().then(() => {
  whatsappService.iniciarBotWhatsApp(db);
  app.listen(PORT, () => {
    console.log(`\n🚀 Servidor en http://localhost:${PORT}`);
    console.log(`📁 BD: ${DB_PATH}`);
    console.log(`📁 Carpetas activas:`);
    CARPETAS_FOTOS.forEach((c, i) => console.log(`   [${i}] ${c}`));
    console.log(`📁 Obsoletas: ${OBSOLETAS_DIR}\n`);
  });
});