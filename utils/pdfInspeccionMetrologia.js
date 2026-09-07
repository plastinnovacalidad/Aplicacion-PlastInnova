// ======================== PDF del Reporte de Inspección (Metrología) ========================
// Julio pidió que, al guardar una inspección de un molde (Public/metrologia.html,
// guardarInspeccion()), se pueda generar y mandar por WhatsApp un reporte con
// el plano, los datos que se cargaron, si cada cota quedó conforme o no, y
// las fotos de evidencia que se hayan subido. Reutiliza el mismo toolkit
// visual que ya usan los demás reportes (utils/pdfIso2859.js) — mismo azul
// institucional, mismo panel de datos, misma tabla — para que se vea como
// parte de la misma familia (Auditoría/Lote/Trazabilidad/Resumen de
// Calidad/Reporte de Garantías), y el mismo patrón de "escribir a un
// archivo temporal" que utils/pdfResumenCalidad.js, porque quien manda esto
// por WhatsApp (whatsapp_bot_service.js, MessageMedia) necesita una ruta de
// archivo, no un stream de una respuesta HTTP.
//
// Por ahora este reporte NO incluye un campo de "observaciones" — el
// formulario de inspección (metrologia.html) no tiene ninguno hoy; Julio
// prefirió dejarlo así por ahora en vez de agregar un campo nuevo solo para
// esto (se puede agregar más adelante si hace falta).
const fs = require('fs');
const path = require('path');
const os = require('os');
const PDFDocument = require('pdfkit');
const pdf = require('./pdfIso2859');
const { sanitizeFilename } = require('./archivos');

const EXTENSIONES_IMAGEN = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

function esArchivoImagen(ruta) {
  if (!ruta) return false;
  return EXTENSIONES_IMAGEN.includes(path.extname(ruta).toLowerCase());
}

// Los valores de cotas/medidas vienen de columnas REAL de SQLite y suelen
// traer ruido de punto flotante (ej. 82.80000000000001 en vez de 82.8).
// Con la celda de tolerancia mostrando "mínimo - máximo" en una sola línea
// de una fila de altura fija (dibujarTablaFila, 20px), ese ruido hace que
// el texto no quepa y se monte sobre la fila siguiente. Redondear a 3
// decimales (más que suficiente para las tolerancias de este módulo) y
// quitar los ceros sobrantes resuelve el desborde sin cambiar el valor real.
function formatearNumero(n) {
  if (n === null || n === undefined || n === '') return '-';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  return String(Math.round(num * 1000) / 1000);
}

// El plano de una referencia (moldes_versiones.archivo_ruta) puede ser un
// PDF en vez de una imagen (metrologia.html acepta subir cualquiera de los
// dos) — PDFKit no puede insertar la página de OTRO pdf como si fuera una
// imagen, así que en ese caso se deja una nota en texto en vez de intentar
// embeberlo (y fallar o verse cortado).
//
// Julio pidió compactar el reporte: la primera versión siempre reservaba
// 270px para el plano sin importar su tamaño real (para "caber" en el peor
// caso), lo que dejaba un hueco en blanco grande cuando el plano quedaba
// más corto que eso (planos horizontales, por ejemplo). Ahora se mide el
// tamaño real con el que PDFKit lo va a dibujar (doc.openImage da el ancho/
// alto real del archivo) y se avanza "y" exactamente esa altura, no una
// reservada de más — igual de nítido, pero sin espacio desperdiciado.
const ALTO_MAX_PLANO = 220;

function dibujarPlano(doc, y, tituloReporte, planoRuta) {
  y = pdf.dibujarTituloSeccion(doc, y, 'Plano de Referencia');

  if (planoRuta && esArchivoImagen(planoRuta) && fs.existsSync(planoRuta)) {
    y = pdf.saltoPaginaSiNecesario(doc, y, ALTO_MAX_PLANO + 20, (doc2) => {
      let yy = pdf.dibujarEncabezado(doc2, `${tituloReporte} (continuación)`);
      return pdf.dibujarTituloSeccion(doc2, yy, 'Plano de Referencia (continuación)');
    });
    try {
      const anchoMax = pdf.anchoUtil(doc);
      const img = doc.openImage(planoRuta);
      const escala = Math.min(anchoMax / img.width, ALTO_MAX_PLANO / img.height);
      const anchoFinal = img.width * escala;
      const altoFinal = img.height * escala;
      const xCentrado = pdf.MARGEN + (anchoMax - anchoFinal) / 2;
      doc.image(img, xCentrado, y, { width: anchoFinal, height: altoFinal });
      y += altoFinal + 8;
    } catch (e) {
      doc.font('Helvetica').fontSize(9).fillColor(pdf.COLORES.gris)
        .text('No se pudo insertar la imagen del plano en el reporte.', pdf.MARGEN, y, { width: pdf.anchoUtil(doc) });
      y += 16;
    }
  } else {
    const mensaje = !planoRuta
      ? 'Esta referencia no tiene un plano activo cargado.'
      : (esArchivoImagen(planoRuta)
        ? 'El archivo del plano no se encontró en el servidor.'
        : 'El plano de esta referencia está en formato PDF — consúltelo directamente en el módulo de Metrología del sistema.');
    doc.font('Helvetica').fontSize(9).fillColor(pdf.COLORES.gris)
      .text(mensaje, pdf.MARGEN, y, { width: pdf.anchoUtil(doc) });
    y += 16;
  }

  return y + 6;
}

function generarPdfInspeccionMetrologia(codigo, inspeccion, medidas, planoRuta) {
  return new Promise((resolve, reject) => {
    let rutaArchivo;
    try {
      // whatsapp-web.js usa el nombre de ESTE archivo temporal como nombre
      // del adjunto que le llega a quien lo recibe (MessageMedia.fromFilePath
      // lee path.basename(...) — ver whatsapp_bot_service.js) — por eso, a
      // pedido de Julio, ya no es un nombre interno cualquiera sino
      // "ReporteInspeccion-<id de la inspección>-<referencia>.pdf".
      const idInspeccion = inspeccion && inspeccion.id ? inspeccion.id : Date.now();
      const referenciaArchivo = sanitizeFilename(codigo || 'SinReferencia');
      const nombreArchivo = `ReporteInspeccion-${idInspeccion}-${referenciaArchivo}.pdf`;
      rutaArchivo = path.join(os.tmpdir(), nombreArchivo);

      const doc = new PDFDocument({ margin: pdf.MARGEN, size: 'A4', bufferPages: true });
      const stream = fs.createWriteStream(rutaArchivo);
      doc.pipe(stream);
      stream.on('finish', () => resolve(rutaArchivo));
      stream.on('error', reject);
      doc.on('error', reject);

      const titulo = `Reporte de Inspección — ${codigo}`;
      pdf.dibujarPie(doc);
      doc.on('pageAdded', () => pdf.dibujarPie(doc));

      let y = pdf.dibujarEncabezado(doc, titulo);

      const todasConformes = medidas.length > 0 && medidas.every(m => (m.estado || '').toUpperCase() === 'CONFORME');
      const resultadoGeneral = medidas.length === 0 ? 'SIN MEDIDAS' : (todasConformes ? 'CONFORME' : 'FUERA DE TOLERANCIA');

      // Julio pidió quitar "Registrado por": con "Responsable" ya presente
      // en el mismo panel, le pareció información repetida (en la práctica
      // ambos suelen ser la misma persona).
      y = pdf.dibujarPanelInfo(doc, y, [
        { label: 'Referencia / Molde', value: codigo, alturaExtra: 18 },
        { label: 'Fecha de inspección', value: inspeccion.fecha, alturaExtra: 18 },
        { label: 'Responsable', value: inspeccion.responsable, alturaExtra: 18 },
        { label: 'Lote', value: inspeccion.lote || '-', alturaExtra: 18 },
        { label: 'Resultado general', value: resultadoGeneral, badge: true, alturaExtra: 18 },
      ]);

      y = dibujarPlano(doc, y, titulo, planoRuta);

      y = pdf.saltoPaginaSiNecesario(doc, y, 60, (doc2) => pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`));
      y = pdf.dibujarTituloSeccion(doc, y, `Medidas registradas (${medidas.length})`);

      const columnas = [
        { label: 'Cota', ancho: 155 },
        { label: 'Medida Est.', ancho: 70, align: 'right' },
        { label: 'Tolerancia', ancho: 110, align: 'right' },
        { label: 'Medida Real', ancho: 80, align: 'right' },
        { label: 'Estado', ancho: 100, badge: true },
      ];
      const redibujarEncabezadoTabla = (doc2) => {
        const yy = pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`);
        return pdf.dibujarTablaEncabezado(doc2, yy, columnas);
      };
      y = pdf.dibujarTablaEncabezado(doc, y, columnas);
      medidas.forEach((m, i) => {
        y = pdf.saltoPaginaSiNecesario(doc, y, 20, redibujarEncabezadoTabla);
        y = pdf.dibujarTablaFila(doc, y, columnas, [
          m.cota,
          formatearNumero(m.medida_estandar),
          `${formatearNumero(m.tolerancia_minima)} - ${formatearNumero(m.tolerancia_maxima)}`,
          formatearNumero(m.medida_real),
          m.estado,
        ], i);
      });
      y += 18;

      // Fotos de evidencia: solo las cotas que tengan una foto subida y que
      // sea realmente una imagen (la evidencia también puede llegar como
      // PDF — mismo caso que el plano — aunque en la práctica casi siempre
      // es una foto tomada con el celular).
      const conFoto = medidas.filter(m => m.imagen_evidencia && esArchivoImagen(m.imagen_evidencia) && fs.existsSync(m.imagen_evidencia));
      if (conFoto.length > 0) {
        y = pdf.saltoPaginaSiNecesario(doc, y, 60, (doc2) => pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`));
        y = pdf.dibujarTituloSeccion(doc, y, `Fotos de evidencia (${conFoto.length})`);

        const anchoFoto = 110;
        const altoFoto = 110;
        const espacio = 12;
        const porFila = Math.max(1, Math.floor((pdf.anchoUtil(doc) + espacio) / (anchoFoto + espacio)));
        let col = 0;
        let xInicioFila = pdf.MARGEN;

        conFoto.forEach((m) => {
          if (col === 0) {
            y = pdf.saltoPaginaSiNecesario(doc, y, altoFoto + 30, (doc2) => pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`));
          }
          const x = xInicioFila + col * (anchoFoto + espacio);
          doc.font('Helvetica-Bold').fontSize(8).fillColor(pdf.COLORES.texto)
            .text(m.cota, x, y, { width: anchoFoto, lineBreak: false });
          try {
            doc.image(m.imagen_evidencia, x, y + 12, { fit: [anchoFoto, altoFoto], align: 'center' });
          } catch (e) {
            doc.font('Helvetica').fontSize(8).fillColor(pdf.COLORES.gris)
              .text('No se pudo cargar la imagen.', x, y + 12, { width: anchoFoto });
          }
          col++;
          if (col >= porFila) {
            col = 0;
            y += altoFoto + 20;
          }
        });
        if (col !== 0) y += altoFoto + 28;
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// Versión corta para WhatsApp: el destinatario debe poder saber en segundos
// si libera o no la referencia. El plano, las fotos y la tabla de cotas
// completas siguen disponibles en el módulo; aquí solo se enumeran las
// desviaciones con el estándar, la tolerancia, la medida y la diferencia.
function estadoReporteRapido(medidas) {
  if (!medidas || medidas.length === 0) return 'REQUIERE SEGUIMIENTO';
  return medidas.every(m => (m.estado || '').toUpperCase() === 'CONFORME')
    ? 'CONFORME'
    : 'NO CONFORME';
}

function estiloEstadoRapido(estado) {
  if (estado === 'CONFORME') return { color: pdf.COLORES.verde, fondo: pdf.COLORES.verdeBg };
  if (estado === 'NO CONFORME') return { color: pdf.COLORES.rojo, fondo: pdf.COLORES.rojoBg };
  return { color: pdf.COLORES.naranja, fondo: pdf.COLORES.naranjaBg };
}

function diferenciaFueraDeTolerancia(medida) {
  const real = Number(medida.medida_real);
  const minimo = Number(medida.tolerancia_minima);
  const maximo = Number(medida.tolerancia_maxima);
  if ([real, minimo, maximo].some(Number.isNaN)) return '-';
  if (real > maximo) return `+${formatearNumero(real - maximo)}`;
  if (real < minimo) return `-${formatearNumero(minimo - real)}`;
  return '0';
}

function dibujarResultadoRapido(doc, y, estado, detalle) {
  const ancho = pdf.anchoUtil(doc);
  const estilo = estiloEstadoRapido(estado);
  const alto = 64;
  doc.roundedRect(pdf.MARGEN, y, ancho, alto, 7).fill(estilo.fondo);
  doc.rect(pdf.MARGEN, y, 6, alto).fill(estilo.color);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(pdf.COLORES.gris)
    .text('DECISIÓN DE INSPECCIÓN', pdf.MARGEN + 18, y + 12);
  doc.font('Helvetica-Bold').fontSize(22).fillColor(estilo.color)
    .text(estado, pdf.MARGEN + 18, y + 24, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(pdf.COLORES.texto)
    .text(detalle, pdf.MARGEN + 220, y + 28, { width: ancho - 238, align: 'right' });
  return y + alto + 14;
}

function dibujarAccionRapida(doc, y, texto) {
  const ancho = pdf.anchoUtil(doc);
  const alto = 34;
  doc.roundedRect(pdf.MARGEN, y, ancho, alto, 6).fill('#F5F9FC');
  doc.font('Helvetica-Bold').fontSize(9).fillColor(pdf.COLORES.azul)
    .text('ACCIÓN:', pdf.MARGEN + 12, y + 12, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(pdf.COLORES.texto)
    .text(texto, pdf.MARGEN + 58, y + 12, { width: ancho - 70, lineBreak: false });
  return y + alto + 16;
}

function dibujarPieMetrologiaRapido(doc) {
  const ancho = pdf.anchoUtil(doc);
  const y = doc.page.height - 46;
  const margenInferiorOriginal = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  doc.moveTo(pdf.MARGEN, y).lineTo(pdf.MARGEN + ancho, y).strokeColor(pdf.COLORES.grisBorde).lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(8).fillColor(pdf.COLORES.gris);
  doc.text('Plast-Innova S.A.  ·  Sistema de Calidad  ·  Metrología', pdf.MARGEN, y + 8, { width: ancho / 2, lineBreak: false });
  doc.text('Documento generado automáticamente', pdf.MARGEN + ancho / 2, y + 8, { width: ancho / 2, align: 'right', lineBreak: false });
  doc.page.margins.bottom = margenInferiorOriginal;
}

function generarPdfInspeccionMetrologiaRapido(codigo, inspeccion, medidas, planoRuta) {
  return new Promise((resolve, reject) => {
    try {
      const idInspeccion = inspeccion && inspeccion.id ? inspeccion.id : Date.now();
      const referenciaArchivo = sanitizeFilename(codigo || 'SinReferencia');
      const rutaArchivo = path.join(os.tmpdir(), `ReporteInspeccion-${idInspeccion}-${referenciaArchivo}.pdf`);
      const doc = new PDFDocument({ margin: pdf.MARGEN, size: 'A4', bufferPages: true });
      const stream = fs.createWriteStream(rutaArchivo);
      doc.pipe(stream);
      stream.on('finish', () => resolve(rutaArchivo));
      stream.on('error', reject);
      doc.on('error', reject);

      const titulo = `Reporte rápido de inspección — ${codigo}`;
      dibujarPieMetrologiaRapido(doc);
      doc.on('pageAdded', () => dibujarPieMetrologiaRapido(doc));
      let y = pdf.dibujarEncabezado(doc, titulo);

      const noConformes = (medidas || []).filter(m => (m.estado || '').toUpperCase() !== 'CONFORME');
      const estado = estadoReporteRapido(medidas);
      const detalleEstado = estado === 'CONFORME'
        ? `Las ${medidas.length} medidas cumplen el plano vigente.`
        : estado === 'NO CONFORME'
          ? `${noConformes.length} cota(s) requieren corrección antes de liberar producción.`
          : 'No hay medidas registradas para tomar una decisión de liberación.';
      y = dibujarResultadoRapido(doc, y, estado, detalleEstado);

      y = pdf.dibujarPanelInfo(doc, y, [
        { label: 'Referencia / Molde', value: codigo, alturaExtra: 20 },
        { label: 'Fecha de inspección', value: inspeccion.fecha, alturaExtra: 20 },
        { label: 'Inspector', value: inspeccion.responsable, alturaExtra: 20 },
        { label: 'Lote', value: inspeccion.lote || '-', alturaExtra: 20 },
      ]);

      const conformes = Math.max(0, (medidas || []).length - noConformes.length);
      y = pdf.dibujarTarjetasResumen(doc, y, [
        { etiqueta: 'MEDIDAS', valor: medidas.length, color: pdf.COLORES.azul },
        { etiqueta: 'CONFORMES', valor: conformes, color: pdf.COLORES.verde },
        { etiqueta: 'DESVIACIONES', valor: noConformes.length, color: noConformes.length ? pdf.COLORES.rojo : pdf.COLORES.verde },
      ]);

      const accion = estado === 'CONFORME'
        ? 'Liberar la referencia y conservar este reporte como evidencia de inspección.'
        : estado === 'NO CONFORME'
          ? 'No liberar producción. Ajustar el molde y repetir las medidas señaladas.'
          : 'Registrar las medidas para definir si la referencia se puede liberar.';
      y = dibujarAccionRapida(doc, y, accion);

      if (noConformes.length > 0) {
        y = pdf.dibujarTituloSeccion(doc, y, `Desviaciones (${noConformes.length})`);
        const columnas = [
          { label: 'Cota', ancho: 75 },
          { label: 'Estándar', ancho: 92, align: 'right' },
          { label: 'Tolerancia', ancho: 120, align: 'right' },
          { label: 'Medida', ancho: 90, align: 'right' },
          { label: 'Diferencia', ancho: 95, align: 'right' },
        ];
        y = pdf.dibujarTablaEncabezado(doc, y, columnas);
        noConformes.forEach((m, indice) => {
          y = pdf.saltoPaginaSiNecesario(doc, y, 20, (doc2) => {
            const yy = pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`);
            return pdf.dibujarTablaEncabezado(doc2, yy, columnas);
          });
          y = pdf.dibujarTablaFila(doc, y, columnas, [
            m.cota,
            formatearNumero(m.medida_estandar),
            `${formatearNumero(m.tolerancia_minima)} a ${formatearNumero(m.tolerancia_maxima)}`,
            formatearNumero(m.medida_real),
            diferenciaFueraDeTolerancia(m),
          ], indice);
        });
        y += 12;
      }

      const fotos = (medidas || []).filter(m => m.imagen_evidencia).length;
      const plano = planoRuta ? 'Plano activo disponible' : 'Sin plano activo';
      doc.font('Helvetica').fontSize(8.5).fillColor(pdf.COLORES.gris)
        .text(`Evidencia en el sistema: ${plano} · ${fotos} archivo(s) de evidencia.`, pdf.MARGEN, y, { width: pdf.anchoUtil(doc) });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generarPdfInspeccionMetrologia: generarPdfInspeccionMetrologiaRapido };
