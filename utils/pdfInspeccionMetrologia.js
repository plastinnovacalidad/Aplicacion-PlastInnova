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
function dibujarPlano(doc, y, tituloReporte, planoRuta) {
  y = pdf.dibujarTituloSeccion(doc, y, 'Plano de Referencia');

  if (planoRuta && esArchivoImagen(planoRuta) && fs.existsSync(planoRuta)) {
    y = pdf.saltoPaginaSiNecesario(doc, y, 230, (doc2) => {
      let yy = pdf.dibujarEncabezado(doc2, `${tituloReporte} (continuación)`);
      return pdf.dibujarTituloSeccion(doc2, yy, 'Plano de Referencia (continuación)');
    });
    try {
      const anchoMax = pdf.anchoUtil(doc);
      doc.image(planoRuta, pdf.MARGEN, y, { fit: [anchoMax, 260], align: 'center' });
      y += 270;
    } catch (e) {
      doc.font('Helvetica').fontSize(9).fillColor(pdf.COLORES.gris)
        .text('No se pudo insertar la imagen del plano en el reporte.', pdf.MARGEN, y, { width: pdf.anchoUtil(doc) });
      y += 22;
    }
  } else {
    const mensaje = !planoRuta
      ? 'Esta referencia no tiene un plano activo cargado.'
      : (esArchivoImagen(planoRuta)
        ? 'El archivo del plano no se encontró en el servidor.'
        : 'El plano de esta referencia está en formato PDF — consúltelo directamente en el módulo de Metrología del sistema.');
    doc.font('Helvetica').fontSize(9).fillColor(pdf.COLORES.gris)
      .text(mensaje, pdf.MARGEN, y, { width: pdf.anchoUtil(doc) });
    y += 22;
  }

  return y + 10;
}

function generarPdfInspeccionMetrologia(codigo, inspeccion, medidas, planoRuta) {
  return new Promise((resolve, reject) => {
    let rutaArchivo;
    try {
      const nombreArchivo = `inspeccion-metrologia-${Date.now()}-${Math.round(Math.random() * 1e6)}.pdf`;
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

      y = pdf.dibujarPanelInfo(doc, y, [
        { label: 'Referencia / Molde', value: codigo },
        { label: 'Fecha de inspección', value: inspeccion.fecha },
        { label: 'Responsable', value: inspeccion.responsable },
        { label: 'Lote', value: inspeccion.lote || '-' },
        { label: 'Registrado por', value: inspeccion.creado_por_nombre || '-' },
        { label: 'Resultado general', value: resultadoGeneral, badge: true },
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

        const anchoFoto = 160;
        const altoFoto = 160;
        const espacio = 15;
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
            y += altoFoto + 28;
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

module.exports = { generarPdfInspeccionMetrologia };
