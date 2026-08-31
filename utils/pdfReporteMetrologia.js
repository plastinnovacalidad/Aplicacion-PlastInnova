// ======================== PDF del Reporte de Metrología (comando "reportes", 31/08) ========================
// Reporte aparte de Metrología por periodo (mensual/quincenal/general),
// mismo patrón que utils/pdfReporteGarantias.js — reusa el mismo toolkit
// visual institucional (utils/pdfIso2859.js) para que se vea como parte de
// la misma familia de reportes. A diferencia de la sección chiquita de
// Metrología que ya trae el Resumen de Calidad (solo el conteo de fuera de
// tolerancia), este reporte trae el detalle completo: total de
// inspecciones y medidas del periodo, cuántas conformes/fuera de
// tolerancia, el top de referencias con más problemas, y el detalle de
// cada medida fuera de tolerancia (con su desviación).
//
// No existía ningún reporte periódico de Metrología antes de esto (solo el
// de una inspección individual, ver utils/pdfInspeccionMetrologia.js) — se
// construyó a partir de la misma consulta que ya usaba el dashboard web
// (data/calidad.js#obtenerResumenMetrologia), agregándole el filtro de
// periodo (data/calidad.js#obtenerMetrologiaReportePeriodo).
const fs = require('fs');
const path = require('path');
const os = require('os');
const PDFDocument = require('pdfkit');
const pdf = require('./pdfIso2859');

// Mismo recorte que usan pdfResumenCalidad.js/pdfReporteGarantias.js —
// dibujarTablaFila (pdfIso2859.js) dibuja cada celda en una sola línea con
// altura fija, así que un texto más largo de lo que cabe en la columna se
// sale de la fila si no se recorta antes.
function truncarTexto(doc, texto, anchoMax) {
  texto = String(texto || '');
  if (doc.widthOfString(texto) <= anchoMax) return texto;
  let recortado = texto;
  while (recortado.length > 1 && doc.widthOfString(recortado + '…') > anchoMax) {
    recortado = recortado.slice(0, -1);
  }
  return recortado + '…';
}

function generarPdfReporteMetrologia(etiquetaPeriodo, m) {
  return new Promise((resolve, reject) => {
    let rutaArchivo;
    try {
      const nombreArchivo = `reporte-metrologia-${Date.now()}-${Math.round(Math.random() * 1e6)}.pdf`;
      rutaArchivo = path.join(os.tmpdir(), nombreArchivo);

      const doc = new PDFDocument({ margin: pdf.MARGEN, size: 'A4', bufferPages: true });
      const stream = fs.createWriteStream(rutaArchivo);
      doc.pipe(stream);
      stream.on('finish', () => resolve(rutaArchivo));
      stream.on('error', reject);
      doc.on('error', reject);

      const titulo = `Reporte de Metrología — ${etiquetaPeriodo}`;
      pdf.dibujarPie(doc);
      doc.on('pageAdded', () => pdf.dibujarPie(doc));

      let y = pdf.dibujarEncabezado(doc, titulo);

      // Conteos neutrales (inspecciones/medidas totales) en azul, igual que
      // TOTAL GARANTÍAS/REFERENCIAS DISTINTAS en el reporte de garantías;
      // conformes/fuera de tolerancia sí tienen un resultado bueno/malo, así
      // que usan el mismo verde/rojo que las insignias de estado (ver
      // coloresEstado en pdfIso2859.js) en vez de azul neutral.
      y = pdf.dibujarTarjetasResumen(doc, y, [
        { etiqueta: 'INSPECCIONES', valor: m.totalInspecciones || 0, color: pdf.COLORES.azul },
        { etiqueta: 'MEDIDAS TOMADAS', valor: m.totalMedidas || 0, color: pdf.COLORES.azul },
        { etiqueta: 'CONFORMES', valor: m.conformes || 0, color: pdf.COLORES.verde },
        { etiqueta: 'FUERA DE TOLERANCIA', valor: m.fueraTolerancia || 0, color: pdf.COLORES.rojo },
      ]);

      if (m.pctFueraTolerancia !== null && m.pctFueraTolerancia !== undefined && (m.totalMedidas || 0) > 0) {
        doc.font('Helvetica').fontSize(9).fillColor(pdf.COLORES.gris)
          .text(`${m.pctFueraTolerancia}% de las medidas del periodo quedaron fuera de tolerancia.`, pdf.MARGEN, y);
        y += 18;
      }

      const topReferencias = m.topReferenciasProblema || [];
      if (topReferencias.length > 0) {
        y = pdf.saltoPaginaSiNecesario(doc, y, 110, (doc2) => pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`));
        y = pdf.dibujarTituloSeccion(doc, y, `Top ${topReferencias.length} Referencias con Más Medidas Fuera de Tolerancia`);
        const columnasRef = [
          { label: '#', ancho: 30 },
          { label: 'Referencia', ancho: 285 },
          { label: 'Medidas fuera', ancho: 100, align: 'right' },
          { label: '% del total fuera', ancho: 100, align: 'right' },
        ];
        y = pdf.dibujarTablaEncabezado(doc, y, columnasRef);
        doc.font('Helvetica').fontSize(8.5);
        topReferencias.forEach((r, i) => {
          y = pdf.saltoPaginaSiNecesario(doc, y, 20, (doc2) => {
            const yy = pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`);
            return pdf.dibujarTablaEncabezado(doc2, yy, columnasRef);
          });
          const pct = (m.fueraTolerancia || 0) > 0 ? `${Math.round((r.medidas_fuera_tolerancia / m.fueraTolerancia) * 1000) / 10}%` : '-';
          y = pdf.dibujarTablaFila(doc, y, columnasRef, [
            String(i + 1),
            truncarTexto(doc, r.referencia || '-', columnasRef[1].ancho - 12),
            r.medidas_fuera_tolerancia,
            pct,
          ], i);
        });
      }

      const detalle = m.detalle || [];
      if (detalle.length > 0) {
        y = pdf.saltoPaginaSiNecesario(doc, y, 110, (doc2) => pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`));
        y = pdf.dibujarTituloSeccion(doc, y, `Detalle — Fuera de Tolerancia (${detalle.length}${(m.fueraTolerancia || 0) > detalle.length ? ` de ${m.fueraTolerancia}` : ''})`);
        const columnasDet = [
          { label: 'Referencia', ancho: 145 },
          { label: 'Cota', ancho: 80 },
          { label: 'Medida', ancho: 90, align: 'right' },
          { label: 'Tolerancia', ancho: 115, align: 'right' },
          { label: 'Desviación', ancho: 85, align: 'right' },
        ];
        y = pdf.dibujarTablaEncabezado(doc, y, columnasDet);
        doc.font('Helvetica').fontSize(8.5);
        detalle.forEach((med, i) => {
          y = pdf.saltoPaginaSiNecesario(doc, y, 20, (doc2) => {
            const yy = pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`);
            return pdf.dibujarTablaEncabezado(doc2, yy, columnasDet);
          });
          const desv = med.desviacion || 0;
          const desvTxto = `${desv >= 0 ? '+' : ''}${desv.toFixed(3)}`;
          y = pdf.dibujarTablaFila(doc, y, columnasDet, [
            truncarTexto(doc, med.referencia || '-', columnasDet[0].ancho - 12),
            truncarTexto(doc, med.cota || '-', columnasDet[1].ancho - 12),
            Number(med.medida_real).toFixed(3),
            `${Number(med.tolerancia_minima).toFixed(3)}–${Number(med.tolerancia_maxima).toFixed(3)}`,
            desvTxto,
          ], i);
        });
        if ((m.fueraTolerancia || 0) > detalle.length) {
          doc.font('Helvetica').fontSize(8).fillColor(pdf.COLORES.gris)
            .text(`… y ${m.fueraTolerancia - detalle.length} más en el periodo (no se muestran para no alargar demasiado el PDF).`, pdf.MARGEN, y + 6);
          y += 20;
        }
      }

      if ((m.totalInspecciones || 0) === 0) {
        doc.font('Helvetica').fontSize(10).fillColor(pdf.COLORES.gris)
          .text('No se registraron inspecciones de Metrología en este periodo.', pdf.MARGEN, y + 10);
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generarPdfReporteMetrologia };
