// Lógica de "cuál es la siguiente versión" compartida entre el módulo SMD
// (routes/referencias.js) y el módulo de Metrología (routes/metrologia.js):
// ambos, al crear una nueva versión sin que el usuario escriba una versión
// manual, calculan la siguiente subiendo en 1 el número de la versión activa
// actual (V3 -> V4), o empiezan en V1 si todavía no hay ninguna versión.
// Antes esta misma cuenta de 4 líneas estaba copiada en los dos archivos;
// se extrae aquí para que un futuro cambio en la regla (por ejemplo, si se
// decide usar V01, V02...) se haga en un solo lugar.
function siguienteVersionAutomatica(versionActiva) {
  if (!versionActiva) return 'V1';
  const match = versionActiva.version.match(/V(\d+)/);
  return 'V' + ((match ? parseInt(match[1], 10) : 0) + 1);
}

module.exports = { siguienteVersionAutomatica };
