const express = require('express');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const { LOGO_PATH } = require('../settings/paths');
const { validarToken, cargarSesiones, guardarSesiones, generarToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const { buscarUsuarioPorLogin, buscarNombreRol } = require('../data/auth');

const router = express.Router();

// Límite de intentos de inicio de sesión por IP, para frenar ataques de
// fuerza bruta (probar muchas contraseñas seguidas). Los intentos exitosos
// también cuentan contra el límite (más simple y sigue siendo generoso para
// el uso normal), y la ventana se reinicia sola cada 15 minutos.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de inicio de sesión desde este equipo. Espera unos minutos e inténtalo de nuevo.' },
});

// ======================== AUTENTICACIÓN ========================
router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const { usuario, contrasena } = req.body;
  if (!usuario || !contrasena) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  const u = await buscarUsuarioPorLogin(usuario);
  if (!u) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  const contrasenaValida = await bcrypt.compare(contrasena, u.contrasena);
  if (!contrasenaValida) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

  const token = generarToken();
  const sesiones = cargarSesiones();
  sesiones[token] = {
    id: u.id, nombre: u.nombre, usuario: u.usuario,
    rol_id: u.rol_id, rol: u.rol_nombre || 'sin_rol',
    ultimaActividad: Date.now()
  };
  guardarSesiones(sesiones);

  // Además de devolver el token en el JSON (como antes, para las
  // peticiones normales que lo mandan por header Authorization), lo
  // guardamos también en una cookie httpOnly. Esa cookie es la que usan
  // ahora /moldes/ver-plano y /moldes/ver-evidencia, para que el token
  // ya no tenga que ir visible en la URL.
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 días; la sesión igual expira antes por inactividad
  });

  res.json({ success: true, token, usuario: u.nombre, rol: u.rol_nombre });
}));

router.post('/logout', validarToken, (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const sesiones = cargarSesiones();
  delete sesiones[token];
  guardarSesiones(sesiones);
  res.clearCookie('token');
  res.json({ success: true });
});

router.get('/me', validarToken, asyncHandler(async (req, res) => {
  const rol = await buscarNombreRol(req.usuario.rol_id);
  res.json({
    id: req.usuario.id,
    usuario: req.usuario.nombre,
    rol: rol?.nombre || 'sin_rol',
    rol_id: req.usuario.rol_id
  });
}));

// Antes buscaba cualquier imagen dentro de config/ (una copia aparte del
// logo, solo para esto); ahora usa el mismo LOGO_PATH (settings/paths.js)
// que ya usan la marca de agua de fotos y el PDF de ISO 2859, para no
// mantener copias sueltas del logo. Nota: ninguna página del frontend llama
// a este endpoint actualmente (el logo del header y del login se cargan
// directo desde /marca, servido por app_circuitos.js desde "Plast Innova
// design system/assets"), se deja funcionando por si algo lo necesita más
// adelante.
router.get('/logo', validarToken, (req, res) => {
  try {
    if (!fs.existsSync(LOGO_PATH)) return res.json({ logo: null });
    res.json({ logo: `data:image/png;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}` });
  } catch (e) { res.json({ logo: null }); }
});

module.exports = router;
