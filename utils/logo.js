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

// Marca de agua con el logo + nombre del usuario que está viendo la foto,
// usada por /api/fotos/* en el módulo de Referencias.
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

module.exports = { obtenerLogoBase64, aplicarMarcaDeAgua };
