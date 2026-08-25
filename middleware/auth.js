const fs = require('fs');
const { SESSIONS_FILE, SESSION_INACTIVITY_MS } = require('../settings/paths');
const { getDb } = require('../db/connection');

// ======================== CACHE DE PERMISOS ========================
let permisosCache = new Map();

async function recargarPermisos() {
  const db = getDb();
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

// Busca la sesión de un token, la invalida si lleva más de SESSION_INACTIVITY_MS
// sin uso, y si sigue viva le renueva la marca de actividad. Devuelve null si el
// token no existe o si la sesión ya expiró por inactividad.
function obtenerSesionActiva(token) {
  const sesiones = cargarSesiones();
  const sesion = sesiones[token];
  if (!sesion) return null;

  const ahora = Date.now();
  if (sesion.ultimaActividad && (ahora - sesion.ultimaActividad) > SESSION_INACTIVITY_MS) {
    delete sesiones[token];
    guardarSesiones(sesiones);
    return null;
  }

  sesion.ultimaActividad = ahora;
  sesiones[token] = sesion;
  guardarSesiones(sesiones);
  return sesion;
}

function validarToken(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  const sesion = obtenerSesionActiva(token);
  if (!sesion) return res.status(401).json({ error: 'Token inválido o sesión expirada' });

  req.usuario = sesion;
  next();
}

// Lee el token desde la cookie "token" (la manda el navegador solo, sin
// necesidad de JavaScript). Se usa en las rutas que se cargan como
// <img>/<iframe>/visor de PDF (ver-plano, ver-evidencia), donde antes el
// token viajaba visible en la URL. No requiere ninguna librería nueva:
// basta con leer el encabezado "Cookie" que ya manda el navegador.
function obtenerTokenDeCookie(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const parte of cookieHeader.split(';')) {
    const igual = parte.indexOf('=');
    if (igual === -1) continue;
    const nombre = parte.slice(0, igual).trim();
    if (nombre === 'token') return decodeURIComponent(parte.slice(igual + 1).trim());
  }
  return null;
}

module.exports = {
  recargarPermisos,
  tienePermiso,
  requerirPermiso,
  requerirPermisoAlternativo,
  cargarSesiones,
  guardarSesiones,
  generarToken,
  obtenerSesionActiva,
  validarToken,
  obtenerTokenDeCookie,
};
