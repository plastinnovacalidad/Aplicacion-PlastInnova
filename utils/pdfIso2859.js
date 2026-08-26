// ======================== Diseño compartido de los reportes PDF (ISO 2859-1) ========================
// Antes, el "Reporte de Muestreo" ya tenía una tabla con bordes, pero el
// "Informe de Lote" y la "Trazabilidad por Referencia" eran solo líneas de
// texto plano (doc.text(...) una tras otra), sin ningún formato. Este
// archivo junta en un solo lugar las piezas visuales que usan los tres
// reportes —encabezado con logo, panel de datos en forma de tarjeta,
// insignias de color para estados/decisiones, tarjetas de resumen y tablas
// con encabezado y franjas alternadas— para que los tres se vean como parte
// de un mismo documento institucional, y para no repetir el mismo código de
// dibujo tres veces.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const { RAIZ_PROYECTO } = require('../settings/paths');

const LOGO_PATH = path.join(RAIZ_PROYECTO, 'Public', 'img', 'logo.png');
const MARGEN = 40;

const COLORES = {
  azul: '#1B4FC4',
  azulOscuro: '#1642AA',
  azulClaro: '#EAF0FE',
  gris: '#718096',
  grisBorde: '#DCE3ED',
  grisFilaAlterna: '#F7F9FC',
  texto: '#1A202C',
  verde: '#22874C', verdeBg: '#E9FBF0',
  rojo: '#C53030', rojoBg: '#FFF0F0',
  naranja: '#DD6B20', naranjaBg: '#FFF7ED',
  grisEstado: '#4A5568', grisEstadoBg: '#EDF1F7',
};

function anchoUtil(doc) {
  return doc.page.width - MARGEN * 2;
}

// Mismo criterio de colores que usan las pantallas del módulo
// (badge-aceptado / badge-rechazado / badge-alerta / etc. en el navegador),
// para que un lote "Rechazado" se vea igual de rojo en la pantalla y en el PDF.
function coloresEstado(valor) {
  const v = (valor || '').toString().toLowerCase();
  // 'conforme'/'fuera de tolerancia' son los dos estados que usa el módulo
  // de Metrología (moldes_medidas_detalle.estado) — se agregan acá para que
  // el reporte de inspección (utils/pdfInspeccionMetrologia.js) salga con
  // el mismo verde/rojo que ya usan Auditoría/Lote/Trazabilidad, en vez de
  // caer en el gris por defecto por no reconocer el texto.
  if (['aceptado', 'seguir', 'aprobado', 'ninguna', 'conforme'].includes(v)) return { bg: COLORES.verdeBg, color: COLORES.verde };
  if (['rechazado', 'parar', 'critico', 'crítico', 'fuera de tolerancia'].includes(v)) return { bg: COLORES.rojoBg, color: COLORES.rojo };
  if (['alerta', 'aceptado_con_obs', 'mayor'].includes(v)) return { bg: COLORES.naranjaBg, color: COLORES.naranja };
  if (v === 'menor') return { bg: COLORES.azulClaro, color: COLORES.azul };
  return { bg: COLORES.grisEstadoBg, color: COLORES.grisEstado };
}

function crearDocumento(res, nombreArchivo) {
  const doc = new PDFDocument({ margin: MARGEN, size: 'A4', bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  doc.pipe(res);
  return doc;
}

// Encabezado azul institucional con el logo, el título del reporte y la
// fecha de generación. Se puede volver a llamar en cada página nueva —de
// ahí que siempre dibuje desde el margen superior en vez de asumir "y=0"—
// para que un reporte de varias páginas se vea igual de completo en todas.
function dibujarEncabezado(doc, subtitulo) {
  const ancho = anchoUtil(doc);
  const alto = 58;
  doc.roundedRect(MARGEN, MARGEN, ancho, alto, 8).fill(COLORES.azul);

  let logoDibujado = false;
  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, MARGEN + 16, MARGEN + 17, { height: 24 });
      logoDibujado = true;
    } catch (e) { /* si el logo no se puede leer, seguimos solo con texto */ }
  }
  if (!logoDibujado) {
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(15).text('PLAST INNOVA', MARGEN + 16, MARGEN + 20);
  }

  doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(12)
    .text(subtitulo, MARGEN + 16, MARGEN + 15, { width: ancho - 32, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor('#D7E3FB')
    .text(`Generado: ${new Date().toLocaleString('es-CO')}`, MARGEN + 16, MARGEN + 33, { width: ancho - 32, align: 'right' });

  return MARGEN + alto + 20;
}

function dibujarPie(doc) {
  const ancho = anchoUtil(doc);
  const y = doc.page.height - 46;

  // El pie vive deliberadamente por debajo del margen inferior normal de la
  // página. PDFKit inserta una página nueva en blanco cada vez que un
  // doc.text() cae más abajo del margen inferior (piensa que el texto no
  // cupo y sigue "escribiendo" en la siguiente hoja) — por eso, mientras se
  // dibuja el pie, se baja el margen a 0 y se restaura enseguida.
  const margenInferiorOriginal = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.moveTo(MARGEN, y).lineTo(MARGEN + ancho, y).strokeColor(COLORES.grisBorde).lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(COLORES.gris);
  doc.text('Plast-Innova S.A.  ·  Sistema de Calidad  ·  Muestreos ISO 2859-1', MARGEN, y + 8, { width: ancho / 2, lineBreak: false });
  doc.text('Documento generado automáticamente', MARGEN + ancho / 2, y + 8, { width: ancho / 2, align: 'right', lineBreak: false });
  doc.page.margins.bottom = margenInferiorOriginal;
}

// Insignia de color (una "píldora" redondeada), igual que las que se ven
// en las pantallas del módulo para decisiones y estados.
function dibujarInsignia(doc, x, y, valor) {
  const { bg, color } = coloresEstado(valor);
  const texto = String(valor || '-').replace(/_/g, ' ').toUpperCase();
  doc.font('Helvetica-Bold').fontSize(8);
  const anchoTexto = doc.widthOfString(texto);
  const anchoInsignia = anchoTexto + 16;
  doc.roundedRect(x, y, anchoInsignia, 15, 7.5).fill(bg);
  doc.fillColor(color).text(texto, x + 8, y + 4, { width: anchoTexto + 2, lineBreak: false });
  return anchoInsignia;
}

// Panel de datos en forma de tarjeta: una fila por dato, columna de
// etiqueta con fondo azul suave y columna de valor en blanco, todo dentro
// de un único borde — en vez de la tabla de celdas con líneas gruesas que
// se veía antes, más parecida a una hoja de cálculo que a un reporte.
function dibujarPanelInfo(doc, y, filas) {
  const ancho = anchoUtil(doc);
  const anchoEtiqueta = 150;
  const alturas = filas.map(f => f.alturaExtra || 22);
  const alturaTotal = alturas.reduce((a, b) => a + b, 0);

  let yActual = y;
  filas.forEach((fila, i) => {
    const altura = alturas[i];
    doc.rect(MARGEN, yActual, anchoEtiqueta, altura).fill(COLORES.azulClaro);
    doc.rect(MARGEN + anchoEtiqueta, yActual, ancho - anchoEtiqueta, altura).fill('#FFFFFF');

    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORES.azulOscuro)
      .text(fila.label, MARGEN + 10, yActual + 7, { width: anchoEtiqueta - 16 });

    if (fila.badge) {
      dibujarInsignia(doc, MARGEN + anchoEtiqueta + 10, yActual + (altura - 15) / 2, fila.value);
    } else {
      const valor = (fila.value === undefined || fila.value === null || fila.value === '') ? '-' : String(fila.value);
      doc.font('Helvetica').fontSize(9).fillColor(COLORES.texto)
        .text(valor, MARGEN + anchoEtiqueta + 10, yActual + 7, { width: ancho - anchoEtiqueta - 20 });
    }
    yActual += altura;
  });

  doc.strokeColor(COLORES.grisBorde).lineWidth(1).rect(MARGEN, y, ancho, alturaTotal).stroke();
  doc.lineWidth(0.5);
  doc.moveTo(MARGEN + anchoEtiqueta, y).lineTo(MARGEN + anchoEtiqueta, y + alturaTotal).stroke();
  let acumulado = y;
  alturas.slice(0, -1).forEach((altura) => {
    acumulado += altura;
    doc.moveTo(MARGEN, acumulado).lineTo(MARGEN + ancho, acumulado).stroke();
  });

  return y + alturaTotal + 18;
}

// Fila de tarjetas de resumen (como los "metric tiles" del tablero web):
// útil para números destacados (total de lotes, aceptados, rechazados...).
function dibujarTarjetasResumen(doc, y, tarjetas) {
  const ancho = anchoUtil(doc);
  const espacio = 10;
  const anchoTarjeta = (ancho - espacio * (tarjetas.length - 1)) / tarjetas.length;
  const alto = 48;

  tarjetas.forEach((t, i) => {
    const x = MARGEN + i * (anchoTarjeta + espacio);
    doc.roundedRect(x, y, anchoTarjeta, alto, 6).fillAndStroke('#FFFFFF', COLORES.grisBorde);
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORES.gris)
      .text(t.etiqueta, x + 12, y + 11, { width: anchoTarjeta - 20 });
    doc.font('Helvetica-Bold').fontSize(17).fillColor(t.color)
      .text(String(t.valor), x + 12, y + 23, { width: anchoTarjeta - 20 });
  });

  return y + alto + 18;
}

// Título de sección con una barra de acento a la izquierda (como los <h4>
// con borde de color que ya se usan en las pantallas del módulo).
function dibujarTituloSeccion(doc, y, texto) {
  doc.rect(MARGEN, y, 4, 16).fill(COLORES.azul);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORES.texto)
    .text(texto, MARGEN + 10, y + 2);
  return y + 24;
}

function dibujarTablaEncabezado(doc, y, columnas) {
  const ancho = anchoUtil(doc);
  doc.rect(MARGEN, y, ancho, 20).fill(COLORES.azul);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
  let x = MARGEN;
  columnas.forEach((col) => {
    doc.text(col.label, x + 6, y + 6, { width: col.ancho - 10, align: col.align || 'left' });
    x += col.ancho;
  });
  return y + 20;
}

function dibujarTablaFila(doc, y, columnas, valores, indice) {
  const ancho = anchoUtil(doc);
  const altura = 20;
  doc.rect(MARGEN, y, ancho, altura).fill(indice % 2 === 0 ? '#FFFFFF' : COLORES.grisFilaAlterna);

  let x = MARGEN;
  columnas.forEach((col, i) => {
    const valor = valores[i];
    if (col.badge) {
      dibujarInsignia(doc, x + 6, y + 2.5, valor);
    } else {
      const texto = (valor === undefined || valor === null || valor === '') ? '-' : String(valor);
      doc.font('Helvetica').fontSize(8.5).fillColor(COLORES.texto)
        .text(texto, x + 6, y + 6, { width: col.ancho - 10, align: col.align || 'left' });
    }
    x += col.ancho;
  });

  doc.strokeColor(COLORES.grisBorde).lineWidth(0.5)
    .moveTo(MARGEN, y + altura).lineTo(MARGEN + ancho, y + altura).stroke();
  return y + altura;
}

// Antes de dibujar algo que necesita "minimoRestante" px de espacio, revisa
// si ya no cabe en la página actual; si no cabe, abre una página nueva y
// vuelve a dibujar lo que 'redibujarFn' indique (típicamente: el encabezado
// del reporte y, si se estaba en medio de una tabla, su fila de columnas).
function saltoPaginaSiNecesario(doc, y, minimoRestante, redibujarFn) {
  if (y + minimoRestante > doc.page.height - 60) {
    doc.addPage();
    return redibujarFn ? redibujarFn(doc) : MARGEN;
  }
  return y;
}

module.exports = {
  MARGEN,
  COLORES,
  anchoUtil,
  coloresEstado,
  crearDocumento,
  dibujarEncabezado,
  dibujarPie,
  dibujarInsignia,
  dibujarPanelInfo,
  dibujarTarjetasResumen,
  dibujarTituloSeccion,
  dibujarTablaEncabezado,
  dibujarTablaFila,
  saltoPaginaSiNecesario,
};
