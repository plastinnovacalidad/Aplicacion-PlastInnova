const fs = require('fs');
const path = require('path');
const { CARPETAS_FOTOS, OBSOLETAS_DIR } = require('../settings/paths');

// ======================== HELPERS DE ARCHIVOS ========================
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
  // Antes existía una opción "ruta_personalizada": si venía en el body, se
  // usaba tal cual como carpeta destino con solo comprobar que existiera en
  // disco — sin pasar por CARPETAS_FOTOS. Ninguna pantalla del sistema
  // llegó a mandar ese campo (se buscó en todo Public/*.html y no aparece
  // en ningún formulario), así que en la práctica era una puerta abierta de
  // más: cualquiera con permiso para subir un plano/foto podía mandar esa
  // ruta apuntando a Public/ (u otra carpeta cualquiera del servidor) y
  // salirse de las carpetas permitidas. Se quita: solo queda la selección
  // por carpeta_idx, que sí está limitada a CARPETAS_FOTOS.
  const idx = parseInt(req.body.carpeta_idx || '1', 10);
  const carpeta = CARPETAS_FOTOS[idx] || CARPETAS_FOTOS[1];
  if (!carpeta || !fs.existsSync(carpeta)) throw new Error('Carpeta destino no disponible');
  return carpeta;
}

// Borra de uploads/obsoletas los archivos (fotos y planos reemplazados por
// una versión nueva) con más de `diasRetencion` días de antigüedad. Se llama
// una vez al arrancar el servidor y luego cada 24 horas (ver
// app_circuitos.js), así que puede correr muchas veces sin problema: cada
// vez solo borra lo que ya pasó el tiempo de retención, nunca más.
function limpiarObsoletas(diasRetencion = 90) {
  let borrados = 0;
  if (!fs.existsSync(OBSOLETAS_DIR)) return borrados;
  const limiteMs = diasRetencion * 24 * 60 * 60 * 1000;
  const ahora = Date.now();

  function recorrer(dir) {
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          recorrer(fullPath);
        } else if (ahora - stat.mtimeMs > limiteMs) {
          fs.unlinkSync(fullPath);
          borrados++;
        }
      } catch (e) {
        console.error(`⚠️ No se pudo revisar/borrar ${fullPath}:`, e.message);
      }
    }
  }

  recorrer(OBSOLETAS_DIR);
  return borrados;
}

module.exports = {
  buscarEnDir,
  buscarArchivoRecursivo,
  escanearRecursivo,
  moverArchivo,
  sanitizeFilename,
  nombreBaseParaArchivo,
  obtenerCarpetaDestino,
  limpiarObsoletas,
};
