// ======================== Reporte de Inspección (Metrología) como IMAGEN ========================
// Julio primero pidió PDF y luego cambió de opinión: quiere que el reporte
// que se manda por WhatsApp al guardar una inspección de un molde sea una
// sola IMAGEN compacta (una captura, no un PDF de varias páginas con mucho
// espacio en blanco). Este archivo solo arma el HTML del reporte — quien lo
// convierte a imagen es whatsapp_bot_service.js (generarImagenInspeccion),
// reutilizando el navegador que whatsapp-web.js ya tiene abierto para la
// sesión de WhatsApp (client.pupBrowser) en vez de agregar Puppeteer como
// dependencia aparte (whatsapp-web.js ya lo trae adentro, y en un
// node_modules anidado que este archivo no podría' require()'ar
// directamente sin ese atajo).
//
// A diferencia de utils/pdfInspeccionMetrologia.js (que ya no se usa desde
// que se cambió a imagen, pero se deja en el proyecto por si más adelante
// se quiere volver a ofrecer como opción), acá no hay que preocuparse por
// saltos de página: es una sola imagen tan alta como haga falta el
// contenido, así que el layout es un documento HTML normal de arriba a
// abajo, sin ninguna lógica de paginación.
const fs = require('fs');
const path = require('path');

const EXTENSIONES_IMAGEN = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

function esArchivoImagen(ruta) {
  if (!ruta) return false;
  return EXTENSIONES_IMAGEN.includes(path.extname(ruta).toLowerCase());
}

function mimeDeArchivo(ruta) {
  const ext = path.extname(ruta).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.bmp') return 'image/bmp';
  return 'image/jpeg';
}

// El plano y las fotos de evidencia se insertan como data URI (base64)
// directamente en el HTML en vez de como <img src="file://..."> — así el
// HTML queda autocontenido y no depende de que Chrome tenga permiso de
// leer rutas de archivo locales al renderizarlo.
function imagenComoDataUri(ruta) {
  if (!ruta || !esArchivoImagen(ruta) || !fs.existsSync(ruta)) return null;
  try {
    const buffer = fs.readFileSync(ruta);
    return `data:${mimeDeArchivo(ruta)};base64,${buffer.toString('base64')}`;
  } catch (e) {
    return null;
  }
}

function escapeHtml(texto) {
  return String(texto === null || texto === undefined ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Mismo motivo que en pdfInspeccionMetrologia.js: los valores vienen de
// columnas REAL de SQLite y traen ruido de punto flotante
// (82.80000000000001 en vez de 82.8) — se redondea a 3 decimales.
function formatearNumero(n) {
  if (n === null || n === undefined || n === '') return '-';
  const num = Number(n);
  if (isNaN(num)) return escapeHtml(n);
  return String(Math.round(num * 1000) / 1000);
}

function colorEstado(estado) {
  const v = (estado || '').toString().toUpperCase();
  if (v === 'CONFORME') return { bg: '#E9FBF0', color: '#22874C' };
  if (v === 'FUERA DE TOLERANCIA') return { bg: '#FFF0F0', color: '#C53030' };
  return { bg: '#EDF1F7', color: '#4A5568' };
}

function construirHtmlReporteInspeccion(codigo, inspeccion, medidas, planoRuta) {
  const todasConformes = medidas.length > 0 && medidas.every(m => (m.estado || '').toUpperCase() === 'CONFORME');
  const resultadoGeneral = medidas.length === 0 ? 'SIN MEDIDAS' : (todasConformes ? 'CONFORME' : 'FUERA DE TOLERANCIA');
  const colorGeneral = colorEstado(resultadoGeneral);

  const planoDataUri = imagenComoDataUri(planoRuta);
  let planoHtml;
  if (planoDataUri) {
    planoHtml = `<img src="${planoDataUri}" class="plano-img" alt="Plano">`;
  } else if (!planoRuta) {
    planoHtml = `<div class="nota">Esta referencia no tiene un plano activo cargado.</div>`;
  } else if (!esArchivoImagen(planoRuta)) {
    planoHtml = `<div class="nota">El plano de esta referencia está en formato PDF — consúltelo en el módulo de Metrología del sistema.</div>`;
  } else {
    planoHtml = `<div class="nota">El archivo del plano no se encontró en el servidor.</div>`;
  }

  const filasTabla = medidas.map(m => {
    const c = colorEstado(m.estado);
    return `
      <tr>
        <td>${escapeHtml(m.cota)}</td>
        <td class="num">${formatearNumero(m.medida_estandar)}</td>
        <td class="num">${formatearNumero(m.tolerancia_minima)} - ${formatearNumero(m.tolerancia_maxima)}</td>
        <td class="num">${formatearNumero(m.medida_real)}</td>
        <td><span class="badge" style="background:${c.bg};color:${c.color};">${escapeHtml(m.estado)}</span></td>
      </tr>`;
  }).join('');

  const conFoto = medidas
    .map(m => ({ m, dataUri: imagenComoDataUri(m.imagen_evidencia) }))
    .filter(x => x.dataUri);
  const fotosHtml = conFoto.length === 0 ? '' : `
    <div class="seccion-titulo">Fotos de evidencia (${conFoto.length})</div>
    <div class="fotos-grid">
      ${conFoto.map(({ m, dataUri }) => `
        <div class="foto-item">
          <div class="foto-label">${escapeHtml(m.cota)}</div>
          <img src="${dataUri}" class="foto-img" alt="Evidencia ${escapeHtml(m.cota)}">
        </div>
      `).join('')}
    </div>
  `;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; width: 620px; background: #ffffff; color: #1A202C; }
  .header { background: #1B4FC4; color: #fff; padding: 12px 16px; }
  .header h1 { margin: 0; font-size: 15px; font-weight: 700; }
  .header .fecha { font-size: 9px; color: #D7E3FB; margin-top: 2px; }
  .panel { padding: 10px 16px 6px; }
  .panel-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; font-size: 11px; }
  .panel-grid .label { color: #718096; font-weight: 700; }
  .resultado { display: inline-block; padding: 3px 10px; border-radius: 10px; font-weight: 700; font-size: 10px; margin-top: 6px; }
  .seccion-titulo { font-size: 12px; font-weight: 700; margin: 8px 16px 4px; padding-left: 8px; border-left: 3px solid #1B4FC4; }
  .plano-wrap { padding: 4px 16px 10px; text-align: center; }
  .plano-img { max-width: 100%; max-height: 260px; border: 1px solid #DCE3ED; border-radius: 4px; }
  .nota { font-size: 10px; color: #718096; padding: 0 16px 8px; }
  table { width: calc(100% - 32px); margin: 0 16px 10px; border-collapse: collapse; font-size: 10.5px; }
  th { background: #1B4FC4; color: #fff; padding: 5px 6px; text-align: left; font-size: 9.5px; }
  td { padding: 4px 6px; border-bottom: 1px solid #EDF1F7; }
  td.num { text-align: right; }
  .badge { padding: 2px 8px; border-radius: 8px; font-weight: 700; font-size: 9px; white-space: nowrap; }
  .fotos-grid { display: flex; flex-wrap: wrap; gap: 8px; padding: 4px 16px 12px; }
  .foto-item { width: 90px; }
  .foto-label { font-size: 9px; font-weight: 700; margin-bottom: 2px; }
  .foto-img { width: 90px; height: 90px; object-fit: cover; border-radius: 4px; border: 1px solid #DCE3ED; }
  .pie { padding: 8px 16px; font-size: 8.5px; color: #A0AEC0; border-top: 1px solid #EDF1F7; }
</style>
</head>
<body>
  <div class="header">
    <h1>PLAST INNOVA — Reporte de Inspección: ${escapeHtml(codigo)}</h1>
    <div class="fecha">Generado: ${new Date().toLocaleString('es-CO')}</div>
  </div>
  <div class="panel">
    <div class="panel-grid">
      <div><span class="label">Fecha:</span> ${escapeHtml(inspeccion.fecha)}</div>
      <div><span class="label">Responsable:</span> ${escapeHtml(inspeccion.responsable)}</div>
      <div><span class="label">Lote:</span> ${escapeHtml(inspeccion.lote || '-')}</div>
      <div><span class="label">Registrado por:</span> ${escapeHtml(inspeccion.creado_por_nombre || '-')}</div>
    </div>
    <div class="resultado" style="background:${colorGeneral.bg}; color:${colorGeneral.color};">Resultado general: ${resultadoGeneral}</div>
  </div>
  <div class="seccion-titulo">Plano de referencia</div>
  <div class="plano-wrap">${planoHtml}</div>
  <div class="seccion-titulo">Medidas registradas (${medidas.length})</div>
  <table>
    <thead><tr><th>Cota</th><th>Med. Est.</th><th>Tolerancia</th><th>Med. Real</th><th>Estado</th></tr></thead>
    <tbody>${filasTabla}</tbody>
  </table>
  ${fotosHtml}
  <div class="pie">Plast-Innova S.A. · Sistema de Calidad · Documento generado automáticamente</div>
</body>
</html>`;
}

module.exports = { construirHtmlReporteInspeccion, esArchivoImagen };
