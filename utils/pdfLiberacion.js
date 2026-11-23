const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const { LOGO_PATH } = require('../settings/paths');

// ======================== PDF DEL FORMATO DE LIBERACIÓN (MIGRACIÓN #56) ========================
// Hoja carta, 4 productos por hoja en tarjetas (2 x 2), encabezado en todas
// las hojas y firma del responsable al final.
//
// Calidad de las fotos (pedido por Julio): las fotos JPG y PNG se meten al
// PDF tal como se subieron -- PDFKit copia el JPG sin volver a comprimirlo
// y el PNG sin pérdida --, así que al hacer zoom en el PDF se ve la foto
// original completa, por pequeña que se vea en la tarjeta. Los formatos que
// PDFKit no lee (WEBP, GIF, BMP) se convierten a PNG, que es sin pérdida.

const CARTA = { w: 612, h: 792 };
const M = 32;                       // margen
const ANCHO = CARTA.w - M * 2;      // 548
const AZUL = '#2C43A2';
const TITULO = '#111B43';
const TEXTO = '#363D4A';
const MUTED = '#6E7787';
const BORDE = '#DFE3EA';
const FONDO = '#F7F8FA';

// Solo Liberado y Rechazado (23/11/2026). Un estado que no esté aquí sale en gris.
const COLORES_ESTADO = {
  'Liberado':      { fuerte: '#009245', suave: '#E0F2E8' },
  'Rechazado':     { fuerte: '#DF0000', suave: '#FFECEC' },
};

// Zona de tarjetas
const Y_TARJETAS = 136;
const ALTO_FIRMA = 54;
const ALTO_PIE = 18;
const GAP = 10;
const ANCHO_TARJETA = (ANCHO - GAP) / 2;
const ALTO_TARJETA = (CARTA.h - M - ALTO_PIE - ALTO_FIRMA - Y_TARJETAS - GAP) / 2;
const ALTO_FOTO = 160;
const POR_HOJA = 4;

// Textos según el tipo de documento (23/11/2026: cada documento es una
// liberación o un rechazo, nunca mezclados).
function textosTipo(l) {
  const rechazo = l.tipo === 'Rechazo';
  return {
    titulo: rechazo ? 'Formato de rechazo de producto' : 'Formato de liberación de producto',
    responsable: rechazo ? 'Responsable del rechazo' : 'Responsable de liberación',
    firma: rechazo ? 'Firma responsable del rechazo' : 'Firma responsable de liberación',
    caja: rechazo ? { fondo: '#FFECEC', borde: '#FFA3A3', texto: '#DF0000' } : { fondo: '#EEF1FA', borde: '#B0BCE6', texto: AZUL },
  };
}

function fechaCorta(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function fechaHora(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const partes = new Intl.DateTimeFormat('es-CO', {
      timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(d);
    const v = (t) => (partes.find(p => p.type === t) || {}).value || '';
    return `${v('day')}/${v('month')}/${v('year')} ${v('hour')}:${v('minute')}`;
  } catch (e) {
    return String(iso).slice(0, 16).replace('T', ' ');
  }
}

function numero(n) {
  return Number(n || 0).toLocaleString('es-CO');
}

// Devuelve lo que se le pasa a doc.image(): la ruta del archivo original
// (JPG/PNG) o un PNG sin pérdida en memoria (otros formatos). null si no hay
// foto o no se puede leer.
async function prepararFoto(carpeta, archivo) {
  if (!archivo) return null;
  const ruta = path.join(carpeta, archivo);
  if (!fs.existsSync(ruta)) return null;
  const ext = path.extname(archivo).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') return ruta;
  try {
    return await sharp(ruta).rotate().png().toBuffer();
  } catch (e) {
    console.error('⚠️ PDF liberación: no se pudo convertir la foto', archivo, e.message);
    return null;
  }
}

// Plan B si PDFKit no acepta el archivo (por ejemplo, un PNG de 16 bits):
// convertirlo a PNG de 8 bits sin pérdida de resolución.
async function fotoAlternativa(fuente) {
  try {
    return await sharp(fuente).rotate().png().toBuffer();
  } catch (e) {
    return null;
  }
}

function caja(doc, x, y, w, h, { fondo, borde, radio = 6, punteado = false } = {}) {
  doc.save();
  doc.roundedRect(x, y, w, h, radio);
  if (punteado) doc.dash(3, { space: 3 });
  if (fondo && borde) doc.fillAndStroke(fondo, borde);
  else if (fondo) doc.fill(fondo);
  else if (borde) doc.stroke(borde);
  doc.undash();
  doc.restore();
}

function texto(doc, t, x, y, opciones = {}) {
  const { fuente = 'Helvetica', tam = 9, color = TEXTO, ...resto } = opciones;
  doc.font(fuente).fontSize(tam).fillColor(color).text(t == null ? '' : String(t), x, y, { lineBreak: false, ...resto });
}

function dibujarEncabezado(doc, l, totalProductos) {
  // Logo oficial (assets del manual de marca), nunca dibujado a mano.
  if (fs.existsSync(LOGO_PATH)) {
    try { doc.image(LOGO_PATH, M, M - 2, { fit: [118, 40], valign: 'center' }); } catch (e) { /* sin logo */ }
  } else {
    texto(doc, 'Plast Innova', M, M + 8, { fuente: 'Helvetica-Bold', tam: 14, color: AZUL });
  }

  const tt = textosTipo(l);
  texto(doc, tt.titulo, M + 132, M + 6, { fuente: 'Helvetica-Bold', tam: 15, color: TITULO });
  texto(doc, 'Aseguramiento de calidad | Plast Innova S.A.', M + 132, M + 25, { tam: 8.5, color: MUTED });

  // Consecutivo
  const wC = 150;
  const xC = M + ANCHO - wC;
  caja(doc, xC, M - 2, wC, 44, { fondo: tt.caja.fondo, borde: tt.caja.borde, radio: 6 });
  texto(doc, 'CONSECUTIVO', xC + 10, M + 4, { fuente: 'Helvetica-Bold', tam: 6.5, color: MUTED, characterSpacing: 0.4 });
  texto(doc, l.consecutivo, xC + 10, M + 14, { fuente: 'Helvetica-Bold', tam: 14, color: tt.caja.texto });
  texto(doc, l.revision ? `Rev. ${l.revision}` : 'Original', xC + 10, M + 31, { tam: 7, color: MUTED });

  doc.save().moveTo(M, M + 52).lineTo(M + ANCHO, M + 52).lineWidth(1.5).stroke(AZUL).restore();

  // Datos del encabezado
  const campos = [
    [tt.responsable, l.responsable_nombre || '—', 176],
    ['Turno', l.turno, 72],
    ['Área', l.area_nombre || '—', 150],
    ['Fecha', fechaCorta(l.fecha), 70],
    ['Productos', String(totalProductos), 56],
  ];
  let x = M;
  const y = M + 60;
  const gap = (ANCHO - campos.reduce((s, c) => s + c[2], 0)) / (campos.length - 1);
  for (const [etiqueta, valor, w] of campos) {
    caja(doc, x, y, w, 34, { fondo: FONDO, borde: BORDE, radio: 5 });
    texto(doc, etiqueta.toUpperCase(), x + 7, y + 6, { fuente: 'Helvetica-Bold', tam: 6, color: MUTED, characterSpacing: 0.3, width: w - 14, ellipsis: true });
    texto(doc, valor, x + 7, y + 17, { fuente: 'Helvetica-Bold', tam: 9.5, color: TITULO, width: w - 14, ellipsis: true });
    x += w + gap;
  }
}

async function dibujarTarjeta(doc, p, numeroProducto, foto, x, y) {
  const w = ANCHO_TARJETA;
  const h = ALTO_TARJETA;
  caja(doc, x, y, w, h, { fondo: '#FFFFFF', borde: BORDE, radio: 8 });

  // Foto (original, ajustada al recuadro sin deformarla)
  const fx = x + 8;
  const fy = y + 8;
  const fw = w - 16;
  const fh = ALTO_FOTO;
  caja(doc, fx, fy, fw, fh, { fondo: FONDO, radio: 5 });
  let dibujada = false;
  if (foto) {
    try {
      doc.image(foto, fx, fy, { fit: [fw, fh], align: 'center', valign: 'center' });
      dibujada = true;
    } catch (e) {
      const alterna = await fotoAlternativa(foto);
      if (alterna) {
        try { doc.image(alterna, fx, fy, { fit: [fw, fh], align: 'center', valign: 'center' }); dibujada = true; } catch (e2) { /* se deja el aviso */ }
      }
    }
  }
  if (!dibujada) {
    caja(doc, fx, fy, fw, fh, { borde: '#C6CCD8', radio: 5, punteado: true });
    texto(doc, foto ? 'No se pudo cargar la foto' : 'Sin foto', fx, fy + fh / 2 - 5, { tam: 9, color: MUTED, width: fw, align: 'center' });
  }

  // Referencia + estado
  const colores = COLORES_ESTADO[p.estado] || { fuerte: MUTED, suave: FONDO };
  doc.font('Helvetica-Bold').fontSize(7.5);
  const wChip = doc.widthOfString(p.estado) + 14;
  let ty = fy + fh + 9;
  caja(doc, x + w - 8 - wChip, ty - 2, wChip, 15, { fondo: colores.suave, radio: 7.5 });
  texto(doc, p.estado, x + w - 8 - wChip, ty + 2, { fuente: 'Helvetica-Bold', tam: 7.5, color: colores.fuerte, width: wChip, align: 'center' });
  texto(doc, `${numeroProducto}. ${p.referencia}`, x + 8, ty, { fuente: 'Helvetica-Bold', tam: 10.5, color: TITULO, width: w - 22 - wChip, ellipsis: true });

  ty += 16;
  texto(doc, p.descripcion_referencia || ' ', x + 8, ty, { tam: 7.5, color: MUTED, width: w - 16, ellipsis: true });

  ty += 12;
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Lote ', x + 8, ty, { lineBreak: false, continued: true })
    .font('Helvetica-Bold').fillColor(TEXTO).text(p.lote, { continued: true })
    .font('Helvetica').fillColor(MUTED).text('     Cantidad ', { continued: true })
    .font('Helvetica-Bold').fillColor(TEXTO).text(numero(p.cantidad), { continued: false });

  ty += 14;
  doc.save().moveTo(x + 8, ty).lineTo(x + w - 8, ty).lineWidth(0.5).stroke(BORDE).restore();
  ty += 5;
  const alto = y + h - 6 - ty;
  if (p.descripcion) {
    doc.font('Helvetica').fontSize(8.5).fillColor(TEXTO)
      .text(p.descripcion, x + 8, ty, { width: w - 16, height: alto, ellipsis: true });
  } else {
    texto(doc, 'Sin observaciones.', x + 8, ty, { fuente: 'Helvetica-Oblique', tam: 8.5, color: MUTED });
  }
}

function dibujarFirma(doc, l) {
  const y = CARTA.h - M - ALTO_PIE - ALTO_FIRMA + 8;
  const yLinea = y + 26;
  doc.save().moveTo(M, yLinea).lineTo(M + 230, yLinea).lineWidth(0.8).stroke(TEXTO).restore();
  texto(doc, textosTipo(l).firma, M, yLinea + 4, { tam: 7.5, color: MUTED });
  texto(doc, l.responsable_nombre || '', M, yLinea - 12, { fuente: 'Helvetica-Bold', tam: 9, color: TITULO, width: 230, ellipsis: true });

  const xd = M + 260;
  const wd = ANCHO - 260;
  texto(doc, `Creado: ${fechaHora(l.creado_en)}`, xd, y + 8, { tam: 7.5, color: MUTED, width: wd, align: 'right' });
  if (l.revision) {
    texto(doc, `Rev. ${l.revision} | última modificación: ${fechaHora(l.actualizado_en)}${l.actualizado_por_nombre ? ` por ${l.actualizado_por_nombre}` : ''}`,
      xd, y + 20, { tam: 7.5, color: MUTED, width: wd, align: 'right' });
  }
}

function dibujarPie(doc, l, pagina, total) {
  const y = CARTA.h - M - 8;
  texto(doc, `${l.consecutivo}${l.revision ? `  |  Rev. ${l.revision}` : ''}  |  ${textosTipo(l).titulo}`, M, y, { tam: 7, color: MUTED });
  texto(doc, `Página ${pagina} de ${total}`, M, y, { tam: 7, color: MUTED, width: ANCHO, align: 'right' });
}

// Escribe el PDF en `destino` (la respuesta HTTP o un archivo). Termina
// cuando el PDF quedó completo.
async function generarPdfLiberacion(l, carpetaFotos, destino) {
  const productos = l.productos || [];
  const fotos = [];
  for (const p of productos) fotos.push(await prepararFoto(carpetaFotos, p.foto_archivo));

  const doc = new PDFDocument({
    size: 'LETTER', margin: 0, bufferPages: true, autoFirstPage: false,
    info: { Title: `${textosTipo(l).titulo} ${l.consecutivo}`, Author: l.responsable_nombre || 'Plast Innova', Subject: textosTipo(l).titulo },
  });
  const terminado = new Promise((resolve, reject) => {
    destino.on('finish', resolve);
    destino.on('error', reject);
    doc.on('error', reject);
  });
  doc.pipe(destino);

  const paginas = Math.max(1, Math.ceil(productos.length / POR_HOJA));
  for (let pag = 0; pag < paginas; pag++) {
    doc.addPage({ size: 'LETTER', margin: 0 });
    dibujarEncabezado(doc, l, productos.length);
    for (let k = 0; k < POR_HOJA; k++) {
      const i = pag * POR_HOJA + k;
      if (i >= productos.length) break;
      const x = M + (k % 2) * (ANCHO_TARJETA + GAP);
      const y = Y_TARJETAS + Math.floor(k / 2) * (ALTO_TARJETA + GAP);
      await dibujarTarjeta(doc, productos[i], i + 1, fotos[i], x, y);
    }
    if (!productos.length) texto(doc, 'Esta liberación no tiene productos.', M, Y_TARJETAS + 20, { tam: 10, color: MUTED });
    if (pag === paginas - 1) dibujarFirma(doc, l);
  }

  const rango = doc.bufferedPageRange();
  for (let i = 0; i < rango.count; i++) {
    doc.switchToPage(rango.start + i);
    dibujarPie(doc, l, i + 1, rango.count);
  }
  doc.end();
  await terminado;
}

module.exports = { generarPdfLiberacion };
