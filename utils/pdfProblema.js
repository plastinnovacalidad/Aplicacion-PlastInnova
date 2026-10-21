// ======================== Reporte PDF de "Problemas" (MIGRACIÓN #43) ========================
// Rediseño pedido por Julio a partir de la plantilla Excel que ya usaban en
// fábricas ("Reporte No Conformidades de fabricas") -- revisado con varios
// mockups antes de tocar el reporte real (ver conversación del 08/09).
// Reusa el encabezado azul institucional (con el logo) y el pie de página del
// diseño compartido (utils/pdfIso2859.js) para que se sienta parte del mismo
// sistema, pero el resto del layout (panel de información en dos columnas,
// franja de Tratamiento grande y centrada, causa raíz dentro del mismo
// cuadro de la descripción, lista de verificación compacta) es propio de
// este reporte -- Julio confirmó que el rediseño es SOLO para el reporte de
// Problemas por ahora ("por ahora probemos con este y si algo despues
// copiamos el estilo visual"), así que no se toca utils/pdfIso2859.js.
//
// Colores: tokens REALES del design system (Plast Innova design
// system/tokens/colors.css) -- utils/pdfIso2859.js usa valores aproximados
// para no romper los reportes ya existentes, pero este reporte es nuevo, así
// que usa los valores exactos desde el principio.
//
// GARANTÍA DE UNA SOLA HOJA (pedido explícito de Julio: "me gustaria que
// siempre comparta el reporte una sola hoja que nunca se pueda agrandar a
// dos"): antes de dibujar nada se mide, en seco, cuánto ocuparía todo el
// contenido a tamaño normal (escala=1); si no cabe, se reduce el tamaño de
// letra y los espaciados (nunca por debajo de un piso legible) hasta que
// quepa -- jamás se llama a doc.addPage() en este reporte. Como red de
// seguridad adicional para datos verdaderamente fuera de lo normal (un
// problema con muchísimas causas/medidas/fotos acumuladas), las listas que no
// tienen un límite natural se recortan a un máximo razonable (ver
// CAP_CAUSAS/CAP_MEDIDAS/CAP_ADJUNTOS) con una nota de cuántas quedaron
// fuera -- el detalle completo se sigue viendo siempre en pantalla, esto es
// solo el PDF.
const fs = require('fs');
const pdf = require('./pdfIso2859');
const problemasData = require('../data/problemas');

const PI = {
  blue900: '#111B43', blue700: '#233685', blue600: '#2C43A2', blue50: '#EEF1FA',
  red700: '#DF0000', red100: '#FFD1D1', red50: '#FFECEC',
  green600: '#009245', green100: '#E0F2E8',
  amber600: '#F7931E', amber100: '#FDEEDB',
  info600: '#0071BC',
  neutral900: '#12151A', neutral700: '#363D4A', neutral500: '#6E7787',
  neutral300: '#C6CCD8', neutral200: '#DFE3EA', neutral100: '#EEF0F4', neutral50: '#F7F8FA',
  white: '#FFFFFF',
};
const MARGEN = pdf.MARGEN;
const anchoUtil = pdf.anchoUtil;

// Topes de las listas sin límite natural (ver nota arriba) -- generosos para
// el uso normal del módulo (en la práctica casi nunca se llega a estos
// números), pero acotan el caso extremo para que la garantía de una sola
// hoja sea real y no solo "casi siempre".
const CAP_CAUSAS = 4;
const CAP_MEDIDAS = 6;
const CAP_ADJUNTOS = 6;

const ORIGEN_LABEL = { produccion: 'Producción', reporte: 'Reporte de área', general: 'General' };

// ======================== Encabezado propio: franja "Problema / Defecto" ========================
function medirBandaDefecto(problema, escala) {
  if (!problema.defecto_codigo) return 0;
  return Math.max(16, 22 * escala) + 10 * escala;
}
function dibujarBandaDefecto(doc, y, problema, escala) {
  if (!problema.defecto_codigo) return y;
  const ancho = anchoUtil(doc);
  const alto = Math.max(16, 22 * escala);
  const texto = `${problema.defecto_codigo} — ${problema.defecto_descripcion || ''}`;
  doc.roundedRect(MARGEN, y, ancho, alto, 5).fill(PI.blue900);
  const fsEtq = Math.max(6.5, 7.5 * escala), fsVal = Math.max(7.5, 9 * escala);
  doc.font('Helvetica-Bold').fontSize(fsEtq);
  const hEtq = doc.heightOfString('PROBLEMA / DEFECTO', { width: 140 });
  doc.fillColor(PI.white).text('PROBLEMA / DEFECTO', MARGEN + 10, y + (alto - hEtq) / 2, { width: 140 });
  doc.font('Helvetica-Bold').fontSize(fsVal);
  const hVal = doc.heightOfString(texto, { width: ancho - 12 });
  doc.fillColor(PI.white).text(texto, MARGEN, y + (alto - hVal) / 2, { width: ancho - 12, align: 'right' });
  return y + alto + 10 * escala;
}

// ======================== Panel de información en DOS COLUMNAS ========================
function calcularFilasInfo(doc, filas, wCol, escala) {
  const anchoEtiqueta = wCol * 0.4;
  const anchoValor = wCol - anchoEtiqueta - 12;
  const fs = Math.max(6.5, 8 * escala);
  let total = 0;
  const alturas = filas.map((f) => {
    // La etiqueta también puede envolver a más de una línea (p.ej. "Unidades
    // rechazadas inicial" en una columna angosta) -- si solo se mide el
    // valor, una etiqueta larga se sale de la fila y se monta sobre la
    // siguiente. Se mide con la MISMA fuente/tamaño con la que se dibuja
    // (ver el comentario de esta trampa de pdfkit en dibujarCausaConMedidas
        // /medirDescripcionConCausas): heightOfString ignora font/fontSize en
    // options, así que hay que fijarlos primero.
    doc.font('Helvetica-Bold').fontSize(fs);
    const hEtiqueta = doc.heightOfString(f.label || '', { width: anchoEtiqueta - 10 });
    if (f.badge) return { h: Math.max(Math.max(15, 16 * escala), hEtiqueta + 9 * escala) };
    doc.font('Helvetica').fontSize(fs);
    const valor = (f.value === undefined || f.value === null || f.value === '') ? '-' : String(f.value);
    const hValor = doc.heightOfString(valor, { width: anchoValor });
    return { h: Math.max(Math.max(13, 18 * escala), Math.max(hEtiqueta, hValor) + 9 * escala) };
  });
  alturas.forEach((a) => { total += a.h; });
  return { alturas: alturas.map((a) => a.h), total };
}
function dibujarColumnaInfo(doc, x, y, w, filas, escala) {
  const { alturas } = calcularFilasInfo(doc, filas, w, escala);
  const anchoEtiqueta = w * 0.4;
  const fs = Math.max(6.5, 8 * escala);
  let yy = y;
  filas.forEach((f, i) => {
    const altura = alturas[i];
    doc.rect(x, yy, anchoEtiqueta, altura).fill(PI.blue50);
    doc.rect(x + anchoEtiqueta, yy, w - anchoEtiqueta, altura).fill(f.bg || PI.white);
    doc.font('Helvetica-Bold').fontSize(fs).fillColor(PI.blue700)
      .text(f.label, x + 6, yy + 5 * escala, { width: anchoEtiqueta - 10 });
    if (f.badge) {
      pdf.dibujarInsignia(doc, x + anchoEtiqueta + 6, yy + (altura - 15) / 2, f.value);
    } else {
      const valor = (f.value === undefined || f.value === null || f.value === '') ? '-' : String(f.value);
      doc.font('Helvetica').fontSize(fs).fillColor(PI.neutral900)
        .text(valor, x + anchoEtiqueta + 6, yy + 5 * escala, { width: w - anchoEtiqueta - 12 });
    }
    yy += altura;
  });
  doc.strokeColor(PI.neutral200).lineWidth(1).rect(x, y, w, yy - y).stroke();
  return yy - y;
}
function medirPanelInfoDosColumnas(doc, filasIzq, filasDer, escala) {
  const ancho = anchoUtil(doc);
  const gap = 14 * escala;
  const wCol = (ancho - gap) / 2;
  const hIzq = calcularFilasInfo(doc, filasIzq, wCol, escala).total;
  const hDer = calcularFilasInfo(doc, filasDer, wCol, escala).total;
  return Math.max(hIzq, hDer) + 14 * escala;
}
function dibujarPanelInfoDosColumnas(doc, y, filasIzq, filasDer, escala) {
  const ancho = anchoUtil(doc);
  const gap = 14 * escala;
  const wCol = (ancho - gap) / 2;
  dibujarColumnaInfo(doc, MARGEN, y, wCol, filasIzq, escala);
  dibujarColumnaInfo(doc, MARGEN + wCol + gap, y, wCol, filasDer, escala);
  return y + medirPanelInfoDosColumnas(doc, filasIzq, filasDer, escala);
}

// ======================== Tratamiento: grande y CENTRADO ========================
function medirTratamientoBanner(problema, escala) {
  if (problema.origen === 'produccion' || !problema.tratamiento) return 0;
  return Math.max(26, 36 * escala) + 12 * escala;
}
function dibujarTratamientoBanner(doc, y, problema, escala) {
  if (problema.origen === 'produccion' || !problema.tratamiento) return y;
  const ancho = anchoUtil(doc);
  const alto = Math.max(26, 36 * escala);
  doc.roundedRect(MARGEN, y, ancho, alto, 8).fill(PI.red50);
  const fsEtq = Math.max(6.5, 7.5 * escala), fsVal = Math.max(11, 15 * escala);
  doc.font('Helvetica-Bold').fontSize(fsEtq).fillColor(PI.red700)
    .text('TRATAMIENTO', MARGEN, y + alto * 0.16, { width: ancho, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(fsVal).fillColor(PI.red700)
    .text(problema.tratamiento.toUpperCase(), MARGEN, y + alto * 0.42, { width: ancho, align: 'center' });
  return y + alto + 12 * escala;
}

// ======================== Descripción + causas raíz, dentro del MISMO cuadro ========================
function medirDescripcionConCausas(doc, descripcion, causasMostradas, escala) {
  const ancho = anchoUtil(doc);
  const fsDesc = Math.max(7, 8.5 * escala), fsCausa = Math.max(6.5, 8 * escala);
  doc.font('Helvetica').fontSize(fsDesc);
  const altoDesc = doc.heightOfString(descripcion, { width: ancho - 20 });
  let altoCausas = 0;
  const alturas = causasMostradas.map((c) => {
    doc.font('Helvetica').fontSize(fsCausa);
    const h = doc.heightOfString(c.texto || '', { width: ancho - 44 });
    altoCausas += h + 22 * escala;
    return h;
  });
  return { total: 10 * escala + altoDesc + 10 * escala + altoCausas + 8 * escala, altoDesc, alturas };
}
function dibujarDescripcionConCausas(doc, y, descripcion, causasMostradas, totalCausas, escala) {
  const ancho = anchoUtil(doc);
  const fsDesc = Math.max(7, 8.5 * escala), fsCausa = Math.max(6.5, 8 * escala);
  const m = medirDescripcionConCausas(doc, descripcion, causasMostradas, escala);
  doc.roundedRect(MARGEN, y, ancho, m.total, 6).fillAndStroke(PI.white, PI.neutral200);
  doc.font('Helvetica-Bold').fontSize(Math.max(5.5, 7 * escala)).fillColor(PI.neutral500)
    .text('DESCRIPCIÓN', MARGEN + 10, y + 6 * escala);
  doc.font('Helvetica').fontSize(fsDesc).fillColor(PI.neutral900)
    .text(descripcion, MARGEN + 10, y + 6 * escala + 11 * escala, { width: ancho - 20 });
  let yc = y + 10 * escala + m.altoDesc + 10 * escala;
  causasMostradas.forEach((c, i) => {
    const h = m.alturas[i];
    doc.rect(MARGEN + 10, yc, 3, h + 14 * escala).fill(PI.blue600);
    doc.font('Helvetica-Bold').fontSize(Math.max(5, 6.5 * escala)).fillColor(PI.blue700)
      .text(causasMostradas.length > 1 ? `CAUSA RAÍZ ${i + 1}` : 'CAUSA RAÍZ', MARGEN + 20, yc);
    doc.font('Helvetica').fontSize(fsCausa).fillColor(PI.neutral900)
      .text(c.texto || '', MARGEN + 20, yc + 9 * escala, { width: ancho - 44 });
    doc.font('Helvetica-Oblique').fontSize(Math.max(5, 6.5 * escala)).fillColor(PI.neutral500)
      .text(`${c.autor_nombre || c.responsable_nombre || 'Usuario'} — ${c.fecha || ''}`, MARGEN + 20, yc + 9 * escala + h + 2 * escala);
    yc += h + 22 * escala;
  });
  if (totalCausas > causasMostradas.length) {
    doc.font('Helvetica-Oblique').fontSize(Math.max(5, 6 * escala)).fillColor(PI.neutral500)
      .text(`+ ${totalCausas - causasMostradas.length} causa(s) raíz más registradas -- ver detalle completo en el sistema.`, MARGEN + 10, yc);
  }
  return y + m.total + 12 * escala;
}

// ======================== Título de sección ========================
function medirTituloSeccion(escala) { return Math.max(7, 9.5 * escala) + 10 * escala; }
function dibujarTituloSeccion(doc, y, texto, color, escala) {
  const fs = Math.max(7, 9.5 * escala);
  doc.rect(MARGEN, y, 3, fs + 4).fill(color || PI.blue600);
  doc.font('Helvetica-Bold').fontSize(fs).fillColor(PI.neutral900).text(texto, MARGEN + 9, y + 1);
  return y + fs + 10 * escala;
}

// ======================== Lista de verificación (checklist, siempre 4) ========================
function dibujarInsigniaChip(doc, x, y, texto, color, bg, fontSize) {
  doc.font('Helvetica-Bold').fontSize(fontSize);
  const anchoTexto = doc.widthOfString(texto);
  const w = anchoTexto + fontSize * 2;
  doc.roundedRect(x, y, w, fontSize + 6, (fontSize + 6) / 2).fill(bg);
  doc.fillColor(color).text(texto, x + fontSize, y + 3);
  return w;
}
function medirChecklist(escala) {
  const gap = Math.max(4, 6 * escala);
  const altoFila = Math.max(15, 20 * escala);
  const filas = Math.ceil(problemasData.CHECKLIST_PREGUNTAS.length / 2);
  return filas * (altoFila + gap * 0.7) + gap * 0.5;
}
function dibujarChecklist(doc, y, problema, escala) {
  const ancho = anchoUtil(doc);
  const gap = Math.max(4, 6 * escala);
  const wCol = (ancho - gap) / 2;
  const altoFila = Math.max(15, 20 * escala);
  const fs = Math.max(6, 7.5 * escala);
  problemasData.CHECKLIST_PREGUNTAS.forEach((item, i) => {
    const valor = problema[item.campo] || null;
    const col = i % 2, fila = Math.floor(i / 2);
    const x = MARGEN + col * (wCol + gap);
    const yy = y + fila * (altoFila + gap * 0.7);
    doc.roundedRect(x, yy, wCol, altoFila, 5).fillAndStroke(PI.neutral50, PI.neutral200);
    doc.font('Helvetica').fontSize(fs).fillColor(PI.neutral900)
      .text(item.pregunta, x + 8, yy + altoFila / 2 - fs * 0.55, { width: wCol - 44 });
    const texto = valor ? valor.toUpperCase() : '—';
    const color = valor === 'Si' ? PI.red700 : (valor === 'No' ? PI.green600 : PI.neutral500);
    const bg = valor === 'Si' ? PI.red100 : (valor === 'No' ? PI.green100 : PI.neutral100);
    dibujarInsigniaChip(doc, x + wCol - 30, yy + altoFila / 2 - (fs + 6) / 2, texto, color, bg, fs - 1);
  });
  return y + medirChecklist(escala);
}

// ======================== Evidencia gráfica (grid compacto) ========================
function medirEvidencia(adjuntosMostrados, escala) {
  if (!adjuntosMostrados.length) return 0;
  const cols = Math.min(3, adjuntosMostrados.length);
  const filas = Math.ceil(adjuntosMostrados.length / cols);
  const altoCelda = Math.max(55, 85 * escala);
  const gap = 8 * escala;
  return filas * (altoCelda + gap) + 4 * escala;
}
function dibujarEvidencia(doc, y, adjuntosMostrados, totalAdjuntos, escala) {
  if (!adjuntosMostrados.length) return y;
  const ancho = anchoUtil(doc);
  const cols = Math.min(3, adjuntosMostrados.length);
  const gap = 8 * escala;
  const anchoCelda = (ancho - gap * (cols - 1)) / cols;
  const altoCelda = Math.max(55, 85 * escala);
  adjuntosMostrados.forEach((a, i) => {
    const col = i % cols, fila = Math.floor(i / cols);
    const x = MARGEN + col * (anchoCelda + gap);
    const yy = y + fila * (altoCelda + gap);
    doc.roundedRect(x, yy, anchoCelda, altoCelda, 4).lineWidth(0.75).stroke(PI.neutral200);
    try {
      doc.image(a.ruta, x + 3, yy + 3, { fit: [anchoCelda - 6, altoCelda - 6], align: 'center', valign: 'center' });
    } catch (e) {
      doc.font('Helvetica-Oblique').fontSize(Math.max(6, 7.5 * escala)).fillColor(PI.neutral500)
        .text('No se pudo cargar esta imagen.', x + 6, yy + altoCelda / 2 - 4, { width: anchoCelda - 12, align: 'center' });
    }
  });
  let yFinal = y + medirEvidencia(adjuntosMostrados, escala);
  if (totalAdjuntos > adjuntosMostrados.length) {
    doc.font('Helvetica-Oblique').fontSize(Math.max(5, 6 * escala)).fillColor(PI.neutral500)
      .text(`+ ${totalAdjuntos - adjuntosMostrados.length} foto(s) más -- ver todas en el sistema.`, MARGEN, yFinal - 4 * escala);
  }
  return yFinal;
}

// ======================== Acciones propuestas (= medidas ya existentes) ========================
function medirAccionesPropuestas(doc, medidasMostradas, escala) {
  if (!medidasMostradas.length) return Math.max(14, 18 * escala) + 8 * escala;
  const ancho = anchoUtil(doc);
  const fs = Math.max(6.5, 8 * escala);
  let total = 0;
  medidasMostradas.forEach((m) => {
    doc.font('Helvetica').fontSize(fs);
    const h = doc.heightOfString(m.texto || '', { width: ancho - 100 });
    total += Math.max(h, 12 * escala) + 16 * escala + 6 * escala;
  });
  return total;
}
function dibujarAccionesPropuestas(doc, y, medidasMostradas, totalMedidas, escala) {
  const ancho = anchoUtil(doc);
  const fs = Math.max(6.5, 8 * escala);
  if (!medidasMostradas.length) {
    doc.font('Helvetica-Oblique').fontSize(fs).fillColor(PI.neutral500)
      .text('Todavía no hay acciones propuestas registradas.', MARGEN, y);
    return y + medirAccionesPropuestas(doc, medidasMostradas, escala);
  }
  let yy = y;
  medidasMostradas.forEach((m) => {
    doc.font('Helvetica').fontSize(fs);
    const h = doc.heightOfString(m.texto || '', { width: ancho - 100 });
    const alto = Math.max(h, 12 * escala) + 16 * escala;
    doc.roundedRect(MARGEN, yy, ancho, alto, 5).fillAndStroke(PI.amber100, PI.neutral200);
    doc.font('Helvetica').fontSize(fs).fillColor(PI.neutral900)
      .text(m.texto || '', MARGEN + 8, yy + 8 * escala, { width: ancho - 100 });
    pdf.dibujarInsignia(doc, MARGEN + ancho - 84, yy + alto / 2 - 7.5, m.estado);
    yy += alto + 6 * escala;
  });
  if (totalMedidas > medidasMostradas.length) {
    doc.font('Helvetica-Oblique').fontSize(Math.max(5, 6 * escala)).fillColor(PI.neutral500)
      .text(`+ ${totalMedidas - medidasMostradas.length} acción(es) más -- ver detalle completo en el sistema.`, MARGEN, yy);
    yy += 10 * escala;
  }
  return yy;
}

// ======================== ¿Qué se hizo para evitar que vuelva a pasar? ========================
// MIGRACIÓN #44 (08/09, Julio: "que esto... sean como tambien puntos y pueda
// agregar varias"): "¿qué se hizo para evitar que vuelva a pasar?" pasó de
// una sola frase a una lista de puntos -- sigue viviendo en la misma columna
// `prevencion` (TEXT), un punto por línea (separados por \n; ver
// leerPuntosPrevencion/poblarPuntosPrevencion en reportes.html, antes
// problemas.html -- MIGRACIÓN #50), así que acá
// solo hay que separarlos y dibujarlos como viñetas en vez de un párrafo
// centrado.
function prevencionPuntos(problema) {
  return String(problema.prevencion || '').split('\n').map((s) => s.trim()).filter(Boolean);
}
function medirPrevencion(doc, problema, escala) {
  const fs = Math.max(6.5, 8 * escala);
  const ancho = anchoUtil(doc);
  const puntos = prevencionPuntos(problema);
  doc.font('Helvetica').fontSize(fs);
  if (!puntos.length) return doc.heightOfString('Sin registrar.', { width: ancho - 16 }) + 18 * escala;
  const anchoTexto = ancho - 16 - 14 * escala;
  let total = 16 * escala;
  puntos.forEach((pt, i) => {
    total += doc.heightOfString(pt, { width: anchoTexto });
    if (i < puntos.length - 1) total += 4 * escala;
  });
  return total;
}
function dibujarPrevencion(doc, y, problema, escala) {
  const ancho = anchoUtil(doc);
  const fs = Math.max(6.5, 8 * escala);
  const puntos = prevencionPuntos(problema);
  const alto = medirPrevencion(doc, problema, escala);
  doc.roundedRect(MARGEN, y, ancho, alto, 6).fillAndStroke(PI.green100, PI.neutral200);
  if (!puntos.length) {
    doc.font('Helvetica-Oblique').fontSize(fs).fillColor(PI.neutral500)
      .text('Sin registrar.', MARGEN + 8, y + alto / 2 - (fs / 2), { width: ancho - 16, align: 'center' });
    return y + alto;
  }
  const anchoTexto = ancho - 16 - 14 * escala;
  let cursorY = y + 8 * escala;
  puntos.forEach((pt) => {
    doc.font('Helvetica-Bold').fontSize(fs).fillColor(PI.green600).text('•', MARGEN + 8, cursorY, { width: 12 * escala });
    doc.font('Helvetica').fontSize(fs).fillColor(PI.neutral900).text(pt, MARGEN + 8 + 14 * escala, cursorY, { width: anchoTexto });
    cursorY += doc.heightOfString(pt, { width: anchoTexto }) + 4 * escala;
  });
  return y + alto;
}

// ======================== Firmas (digitales) ========================
function medirFirmas(escala) { return Math.max(30, 42 * escala); }
function dibujarFirmas(doc, y, problema, escala) {
  const ancho = anchoUtil(doc);
  const alto = medirFirmas(escala);
  const mitad = ancho / 2 - 8;
  const fsEtq = Math.max(5, 6.5 * escala), fsNombre = Math.max(8, 10.5 * escala);
  doc.roundedRect(MARGEN, y, mitad, alto, 6).stroke(PI.neutral300);
  doc.font('Helvetica-Bold').fontSize(fsEtq).fillColor(PI.neutral500)
    .text('FIRMA CALIDAD (DIGITAL)', MARGEN, y + 5 * escala, { width: mitad, align: 'center' });
  doc.font('Helvetica-Oblique').fontSize(fsNombre).fillColor(PI.neutral900)
    .text(problema.autor_nombre || '—', MARGEN, y + alto * 0.42, { width: mitad, align: 'center' });

  doc.roundedRect(MARGEN + mitad + 16, y, mitad, alto, 6).stroke(PI.neutral300);
  doc.font('Helvetica-Bold').fontSize(fsEtq).fillColor(PI.neutral500)
    .text('FIRMA IMPLICADOS (DIGITAL)', MARGEN + mitad + 16, y + 5 * escala, { width: mitad, align: 'center' });
  if (problema.firma_implicados_nombre) {
    doc.font('Helvetica-Oblique').fontSize(fsNombre).fillColor(PI.neutral900)
      .text(problema.firma_implicados_nombre, MARGEN + mitad + 16, y + alto * 0.42, { width: mitad, align: 'center' });
  }
  return y + alto;
}

// ======================== Filas del panel de información (según origen) ========================
function construirFilasInfo(problema) {
  const filasIzq = [{ label: 'Origen', value: ORIGEN_LABEL[problema.origen] || problema.origen }];
  if (problema.origen === 'produccion') {
    filasIzq.push({ label: 'Fábrica', value: problema.fabrica });
    filasIzq.push({ label: problema.tipo_contexto === 'referencia' ? 'Referencia' : 'Motivo', value: problema.valor_contexto });
    if (problema.semana) filasIzq.push({ label: 'Semana', value: problema.semana });
  } else {
    if (problema.area_origen_nombre) filasIzq.push({ label: 'Área', value: problema.area_origen_nombre });
    if (problema.referencia) filasIzq.push({ label: 'Referencia', value: problema.referencia });
    if (problema.lote) filasIzq.push({ label: 'Lote', value: problema.lote });
  }

  const filasDer = [];
  if (problema.origen === 'produccion') {
    if (problema.pct_desperdicio_inicial != null) {
      filasDer.push({
        label: problema.tipo_contexto === 'referencia' ? '% Desperdicio inicial' : 'Unidades rechazadas inicial',
        value: `${problema.pct_desperdicio_inicial}${problema.tipo_contexto === 'referencia' ? '%' : ''}`,
      });
    }
  } else {
    if (problema.cantidad_total != null) filasDer.push({ label: 'Cantidad total', value: problema.cantidad_total });
    if (problema.cantidad_afectada != null) filasDer.push({ label: 'Cantidad afectada', value: problema.cantidad_afectada, bg: PI.red50 });
    if (problema.pct_desperdicio != null) filasDer.push({ label: '% Desperdicio', value: `${problema.pct_desperdicio}%`, bg: PI.red50 });
  }
  filasDer.push({ label: 'Criticidad', value: problema.criticidad, badge: true });

  return { filasIzq, filasDer };
}

// ======================== Medición total y escala óptima ========================
function calcularAlturaTotal(doc, problema, causasMostradas, medidasMostradas, adjuntosMostrados, escala) {
  const { filasIzq, filasDer } = construirFilasInfo(problema);
  const descripcionTexto = problema.descripcion || 'Sin descripción';
  let total = 0;
  total += 58 + 20; // encabezado azul institucional (fijo, con logo -- ver pdf.dibujarEncabezado)
  total += medirBandaDefecto(problema, escala);
  total += medirPanelInfoDosColumnas(doc, filasIzq, filasDer, escala);
  total += medirTratamientoBanner(problema, escala);
  total += medirDescripcionConCausas(doc, descripcionTexto, causasMostradas, escala).total + 12 * escala;
  total += medirTituloSeccion(escala);
  total += medirChecklist(escala) + 4 * escala;
  if (adjuntosMostrados.length) {
    total += medirTituloSeccion(escala);
    total += medirEvidencia(adjuntosMostrados, escala) + 8 * escala;
  }
  total += medirTituloSeccion(escala);
  total += medirAccionesPropuestas(doc, medidasMostradas, escala) + 10 * escala;
  total += medirTituloSeccion(escala);
  total += medirPrevencion(doc, problema, escala) + 14 * escala;
  total += medirTituloSeccion(escala);
  total += medirFirmas(escala);
  return total;
}
// Devuelve la escala más grande (más legible) en [0.55, 1] que hace caber
// todo -- o null si ni siquiera al piso de 0.55 cabe (ver
// resolverEscalaYListas, que en ese caso recorta las listas en vez de seguir
// achicando la letra más allá de lo legible).
function calcularEscalaOptima(doc, problema, causasMostradas, medidasMostradas, adjuntosMostrados) {
  // OJO: el límite real no es MARGEN inferior -- el pie de página
  // (pdf.dibujarPie) vive en doc.page.height - 46, y pdf.saltoPaginaSiNecesario
  // ya usa "doc.page.height - 60" como línea segura en el resto del sistema
  // (con margen de sobra para que nada quede pegado al pie). Se usa el mismo
  // límite acá -- contarlo desde MARGEN inferior en vez de este límite fue
  // justo lo que dejó la última fila de Firmas montada sobre el pie de
  // página la primera vez que se probó este cálculo con datos extremos.
  const disponible = (doc.page.height - 60) - MARGEN;
  for (let e = 100; e >= 55; e -= 1) {
    const escala = e / 100;
    if (calcularAlturaTotal(doc, problema, causasMostradas, medidasMostradas, adjuntosMostrados, escala) <= disponible) return escala;
  }
  return null;
}

// GARANTÍA DE UNA SOLA HOJA, segunda línea de defensa: si ni siquiera al piso
// de letra legible (escala 0.55) el contenido cabe -- un problema con
// muchísimas fotos/causas/medidas acumuladas, más de lo que CAP_CAUSAS/
// CAP_MEDIDAS/CAP_ADJUNTOS ya recortan -- se van soltando listas, en el orden
// de "menos crítico para el reporte" (fotos primero, después acciones,
// después causas), volviendo a intentar la escala óptima después de cada
// recorte, hasta que quepa. Casi nunca debería llegar a recortar nada -- los
// topes normales ya cubren el uso real del módulo -- pero así la promesa de
// "nunca dos páginas" es real también en el caso más extremo, no solo en el
// caso típico.
function resolverEscalaYListas(doc, problema, causas, medidas, adjuntos) {
  let causasMostradas = causas.slice(0, CAP_CAUSAS);
  let medidasMostradas = medidas.slice(0, CAP_MEDIDAS);
  let adjuntosMostrados = adjuntos.slice(0, CAP_ADJUNTOS);

  const intentos = [
    () => true, // intento inicial, con los topes normales
    () => { adjuntosMostrados = adjuntosMostrados.slice(0, 3); return true; },
    () => { adjuntosMostrados = []; return true; },
    () => { medidasMostradas = medidasMostradas.slice(0, 3); return true; },
    () => { medidasMostradas = medidasMostradas.slice(0, 1); return true; },
    () => { causasMostradas = causasMostradas.slice(0, 2); return true; },
    () => { causasMostradas = causasMostradas.slice(0, 1); return true; },
  ];
  for (const aplicarRecorte of intentos) {
    aplicarRecorte();
    const escala = calcularEscalaOptima(doc, problema, causasMostradas, medidasMostradas, adjuntosMostrados);
    if (escala != null) return { escala, causasMostradas, medidasMostradas, adjuntosMostrados };
  }
  // Última salida (no debería llegar nunca hasta acá): al piso de letra, con
  // el recorte más agresivo ya aplicado arriba.
  return { escala: 0.55, causasMostradas, medidasMostradas, adjuntosMostrados };
}

// ======================== Generación del reporte ========================
// `adjuntosConRuta`: [{ ruta, nombre_original, fecha }] -- ya resueltos a una
// ruta absoluta en disco (y filtrados a los que sí existen) por quien llama,
// para no acoplar este módulo a settings/paths.js.
function generarReportePdfProblema(res, problema, adjuntosConRuta) {
  const subtitulo = `Reporte de Problema #${problema.id}`;
  const doc = pdf.crearDocumento(res, `problema-${problema.id}.pdf`);
  pdf.dibujarPie(doc);
  doc.on('pageAdded', () => pdf.dibujarPie(doc));

  const causas = problema.causas || [];
  const medidas = problema.medidas || [];
  const adjuntos = adjuntosConRuta || [];
  const { escala, causasMostradas, medidasMostradas, adjuntosMostrados } =
    resolverEscalaYListas(doc, problema, causas, medidas, adjuntos);
  const descripcionTexto = problema.descripcion || 'Sin descripción';
  const { filasIzq, filasDer } = construirFilasInfo(problema);

  const DEBUG = !!process.env.PDF_PROBLEMA_DEBUG;
  const log = (etiqueta, y) => { if (DEBUG) console.error(`[pdfProblema] ${etiqueta}: y=${y.toFixed(1)} (limite=${(doc.page.height - 60).toFixed(1)}) escala=${escala}`); };

  let y = pdf.dibujarEncabezado(doc, subtitulo);
  log('tras encabezado', y);
  y = dibujarBandaDefecto(doc, y, problema, escala);
  log('tras banda defecto', y);
  y = dibujarPanelInfoDosColumnas(doc, y, filasIzq, filasDer, escala);
  log('tras panel info', y);
  y = dibujarTratamientoBanner(doc, y, problema, escala);
  log('tras tratamiento', y);
  y = dibujarDescripcionConCausas(doc, y, descripcionTexto, causasMostradas, causas.length, escala);
  log('tras descripcion+causas', y);

  y = dibujarTituloSeccion(doc, y, 'Lista de verificación', PI.info600, escala);
  y = dibujarChecklist(doc, y, problema, escala);
  y += 4 * escala;
  log('tras checklist', y);

  if (adjuntosMostrados.length) {
    y = dibujarTituloSeccion(doc, y, 'Evidencia gráfica', PI.info600, escala);
    y = dibujarEvidencia(doc, y, adjuntosMostrados, adjuntos.length, escala);
    y += 8 * escala;
    log('tras evidencia', y);
  }

  y = dibujarTituloSeccion(doc, y, 'Acciones propuestas', PI.amber600, escala);
  y = dibujarAccionesPropuestas(doc, y, medidasMostradas, medidas.length, escala);
  y += 10 * escala;
  log('tras acciones propuestas', y);

  y = dibujarTituloSeccion(doc, y, '¿Qué se hizo para evitar que vuelva a pasar?', PI.green600, escala);
  y = dibujarPrevencion(doc, y, problema, escala);
  y += 14 * escala;
  log('tras prevencion', y);

  y = dibujarTituloSeccion(doc, y, 'Firmas', PI.blue600, escala);
  dibujarFirmas(doc, y, problema, escala);
  log('tras firmas', y);

  doc.end();
}

module.exports = { generarReportePdfProblema };
