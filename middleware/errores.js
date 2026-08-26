// ======================== MANEJO DE ERRORES CENTRALIZADO ========================
// Antes, casi cada ruta repetía el mismo patrón:
//   try { ... } catch (e) { res.status(500).json({ error: e.message }); }
// asyncHandler evita tener que escribir ese try/catch en cada una: envuelve
// la función de la ruta y, si lanza un error (o la promesa se rechaza), lo
// manda automáticamente a next(error) — que termina en el manejador de
// errores de abajo, el cual responde exactamente igual que antes
// (res.status(500).json({ error: ... })), pero desde un solo lugar.
//
// Las rutas que necesitan hacer algo especial al fallar (por ejemplo, borrar
// un archivo subido si algo sale mal) conservan su propio try/catch, porque
// ahí sí hay lógica real que no se puede resumir en "responder 500".
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Middleware de error de Express: se reconoce como tal porque recibe 4
// argumentos (err, req, res, next), y debe registrarse DESPUÉS de todas las
// rutas en app_circuitos.js.
function manejadorDeErrores(err, req, res, next) {
  console.error('❌ Error no controlado en', req.method, req.originalUrl, ':', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
}

module.exports = { asyncHandler, manejadorDeErrores };
