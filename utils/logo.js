const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { LOGO_PATH } = require('../settings/paths');

// ======================== LOGO ========================
// Antes esto buscaba cualquier imagen dentro de config/ (una copia aparte
// del logo, solo para esto); ahora usa directamente el mismo logo.png que ya
// se muestra en el encabezado de las páginas, para no mantener dos copias
// del mismo archivo. Si el archivo no está, sigue devolviendo null igual que
// antes (la marca de agua se ve sin logo, solo con el nombre).
async function obtenerLogoBase64() {
  try {
    if (!fs.existsSync(LOGO_PATH)) return null;
    const logoBuffer = await sharp(LOGO_PATH)
      .resize(300, 120, { fit: 'inside' }).png().toBuffer();
    return { dataUrl: `data:image/png;base64,${logoBuffer.toString('base64')}` };
  } catch (e) { return null; }
}

// 04/11/2026 (pedido por Julio, las fotos se demoraban al ir pasando de una
// referencia a otra). Tres mejoras que NO cambian la foto (misma resolución
// y misma calidad JPEG 80 de siempre):
//  1. El logo se prepara una sola vez (antes se volvía a procesar en cada
//     foto). Si cambia el archivo del logo, se vuelve a leer.
//  2. La foto se lee sin bloquear el servidor (antes readFileSync: mientras
//     leía una foto de 15 MB desde P: por la red, no atendía nada más).
//  3. Las fotos ya preparadas se guardan en memoria (las últimas
//     MAX_CACHE_FOTOS, por archivo + fecha de modificación + usuario): al
//     volver a una referencia que ya se abrió, la foto sale de inmediato. Si
//     el archivo cambia en disco, su fecha cambia y se vuelve a preparar.
//  Además, si quien la pidió ya cambió de referencia (la pantalla canceló la
//  petición), no se sigue procesando esa foto.
let logoCache = null; // { mtimeMs, info }
async function obtenerLogoCacheado() {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(LOGO_PATH).mtimeMs; } catch (e) { /* sin logo */ }
  if (!logoCache || logoCache.mtimeMs !== mtimeMs) logoCache = { mtimeMs, info: await obtenerLogoBase64() };
  return logoCache.info;
}

const MAX_CACHE_FOTOS = 40;
const cacheFotos = new Map(); // clave -> respuesta ya armada (Map conserva el orden: la primera es la más vieja)
function guardarEnCache(clave, respuesta) {
  if (cacheFotos.has(clave)) cacheFotos.delete(clave);
  cacheFotos.set(clave, respuesta);
  while (cacheFotos.size > MAX_CACHE_FOTOS) cacheFotos.delete(cacheFotos.keys().next().value);
}

// Marca de agua con el logo + nombre del usuario que está viendo la foto,
// usada por /api/fotos/* en el módulo de Referencias.
async function aplicarMarcaDeAgua(filePath, nombreUsuario, res) {
  // Si la pantalla cancela la petición (cambió de referencia), se deja de
  // trabajar en esta foto.
  let cancelada = false;
  if (res && typeof res.on === 'function') res.on('close', () => { if (!res.writableEnded) cancelada = true; });

  const st = await fs.promises.stat(filePath);
  const clave = `${filePath}|${st.mtimeMs}|${st.size}|${nombreUsuario}`;
  const enCache = cacheFotos.get(clave);
  if (enCache) {
    guardarEnCache(clave, enCache); // queda como la más reciente
    return res.json(enCache);
  }

  const logoInfo = await obtenerLogoCacheado();
  // Leer imagen a buffer primero para liberar el handle del archivo en disco
  const imgBuffer = await fs.promises.readFile(filePath);
  if (cancelada) return;
  const meta = await sharp(imgBuffer).metadata();
  const w = meta.width || 1200, h = meta.height || 800;
  const pw = 500, ph = 350, cx = pw/2, cy = ph/2;
  const lw = 220, lh = 90, lx = cx - lw/2, gap = 10, fsz = 26;
  const gh = lh + gap + fsz, sy = (ph - gh)/2, ty = sy + lh + gap + 20;

  const svgLogo = logoInfo ? `<image xlink:href="${logoInfo.dataUrl}" x="${lx}" y="${sy}" width="${lw}" height="${lh}" opacity="0.22" preserveAspectRatio="xMidYMid meet"/>` : '';
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><pattern id="g" width="${pw}" height="${ph}" patternUnits="userSpaceOnUse"><g transform="rotate(-25 ${cx} ${cy})">${svgLogo}<text x="${cx}" y="${ty}" fill="rgba(0,0,0,0.22)" font-size="${fsz}" font-family="sans-serif" font-weight="bold" text-anchor="middle">${nombreUsuario}</text></g></pattern></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;

  if (cancelada) return;
  const buf = await sharp(imgBuffer).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 80 }).toBuffer();
  const b64 = buf.toString('base64');
  const respuesta = { fotos: [{ nombre: path.basename(filePath), data: `data:image/jpeg;base64,${b64}` }], referencia: path.basename(filePath, path.extname(filePath)) };
  guardarEnCache(clave, respuesta);
  if (cancelada) return;
  res.json(respuesta);
}

module.exports = { obtenerLogoBase64, aplicarMarcaDeAgua };
