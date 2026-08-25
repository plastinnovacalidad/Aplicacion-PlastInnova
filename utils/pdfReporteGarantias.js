// ======================== PDF del Reporte de Garantías (roadmap #2) ========================
// Reporte aparte, dedicado solo a garantías, para un periodo (día/quincena/
// mes) — se pide con "garantias diario", "garantias quincenal [...]" o
// "garantias mensual [...]" por WhatsApp, igual que ya se puede pedir el
// resumen general con "diario"/"quincenal"/"mensual". El resumen general
// (utils/pdfResumenCalidad.js) sigue trayendo su propia sección de
// garantías (conteo + top 10 de referencias) sin cambios — este reporte es
// un complemento con más detalle del que cabría ahí: referencias y
// clientes distintos, motivos más frecuentes, y el detalle completo del
// periodo (hasta 40 registros).
const fs = require('fs');
const path = require('path');
const os = require('os');
const PDFDocument = require('pdfkit');
const pdf = require('./pdfIso2859');

// Mismo recorte que usa pdfResumenCalidad.js — dibujarTablaFila (pdfIso2859.js)
// dibuja cada celda en una sola línea con altura fija, así que un texto más
// largo de lo que cabe en la columna se sale de la fila si no se recorta antes.
function truncarTexto(doc, texto, anchoMax) {
  texto = String(texto || '');
  if (doc.widthOfString(texto) <= anchoMax) return texto;
  let recortado = texto;
  while (recortado.length > 1 && doc.widthOfString(recortado + '…') > anchoMax) {
    recortado = recortado.slice(0, -1);
  }
  return recortado + '…';
}

function generarPdfReporteGarantias(etiquetaPeriodo, g) {
  return new Promise((resolve, reject) => {
    let rutaArchivo;
    try {
      const nombreArchivo = `reporte-garantias-${Date.now()}-${Math.round(Math.random() * 1e6)}.pdf`;
      rutaArchivo = path.join(os.tmpdir(), nombreArchivo);

      const doc = new PDFDocument({ margin: pdf.MARGEN, size: 'A4', bufferPages: true });
      const stream = fs.createWriteStream(rutaArchivo);
      doc.pipe(stream);
      stream.on('finish', () => resolve(rutaArchivo));
      stream.on('error', reject);
      doc.on('error', reject);

      const titulo = `Reporte de Garantías — ${etiquetaPeriodo}`;
      pdf.dibujarPie(doc);
      doc.on('pageAdded', () => pdf.dibujarPie(doc));

      let y = pdf.dibujarEncabezado(doc, titulo);

      y = pdf.dibujarTarjetasResumen(doc, y, [
        { etiqueta: 'TOTAL GARANTÍAS', valor: g.total || 0, color: pdf.COLORES.azul },
        { etiqueta: 'REFERENCIAS DISTINTAS', valor: g.referenciasDistintas || 0, color: pdf.COLORES.azul },
        { etiqueta: 'CLIENTES DISTINTOS', valor: g.clientesDistintos || 0, color: pdf.COLORES.azul },
      ]);

      const topReferencias = g.topReferencias || [];
      if (topReferencias.length > 0) {
        y = pdf.dibujarTituloSeccion(doc, y, `Top ${topReferencias.length} Referencias Más Frecuentes`);
        const columnasRef = [
          { label: '#', ancho: 30 },
          { label: 'Referencia', ancho: 285 },
          { label: 'Garantías', ancho: 100, align: 'right' },
          { label: '% del periodo', ancho: 100, align: 'right' },
        ];
        y = pdf.dibujarTablaEncabezado(doc, y, columnasRef);
        doc.font('Helvetica').fontSize(8.5);
        topReferencias.forEach((r, i) => {
          y = pdf.saltoPaginaSiNecesario(doc, y, 20, (doc2) => {
            const yy = pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`);
            return pdf.dibujarTablaEncabezado(doc2, yy, columnasRef);
          });
          const pct = (g.total || 0) > 0 ? `${Math.round((r.total / g.total) * 1000) / 10}%` : '-';
          y = pdf.dibujarTablaFila(doc, y, columnasRef, [
            String(i + 1),
            truncarTexto(doc, r.referencia || '-', columnasRef[1].ancho - 12),
            r.total,
            pct,
          ], i);
        });
      }

      const topMotivos = g.topMotivos || [];
      if (topMotivos.length > 0) {
        y = pdf.saltoPaginaSiNecesario(doc, y, 110, (doc2) => pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`));
        y = pdf.dibujarTituloSeccion(doc, y, `Motivos Más Frecuentes`);
        const columnasMot = [
          { label: 'Motivo', ancho: 385 },
          { label: 'Garantías', ancho: 130, align: 'right' },
        ];
        y = pdf.dibujarTablaEncabezado(doc, y, columnasMot);
        doc.font('Helvetica').fontSize(8.5);
        topMotivos.forEach((m, i) => {
          y = pdf.saltoPaginaSiNecesario(doc, y, 20, (doc2) => {
            const yy = pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`);
            return pdf.dibujarTablaEncabezado(doc2, yy, columnasMot);
          });
          y = pdf.dibujarTablaFila(doc, y, columnasMot, [
            truncarTexto(doc, m.problema || '-', columnasMot[0].ancho - 12),
            m.total,
          ], i);
        });
      }

      const detalle = g.detalle || [];
      if (detalle.length > 0) {
        y = pdf.saltoPaginaSiNecesario(doc, y, 110, (doc2) => pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`));
        y = pdf.dibujarTituloSeccion(doc, y, `Detalle del Periodo (${detalle.length}${(g.total || 0) > detalle.length ? ` de ${g.total}` : ''})`);
        const columnasDet = [
          { label: 'Referencia', ancho: 155 },
          { label: 'Cliente', ancho: 155 },
          { label: 'Motivo', ancho: 130 },
          { label: 'Fecha', ancho: 75, align: 'right' },
        ];
        y = pdf.dibujarTablaEncabezado(doc, y, columnasDet);
        doc.font('Helvetica').fontSize(8.5);
        detalle.forEach((r, i) => {
          y = pdf.saltoPaginaSiNecesario(doc, y, 20, (doc2) => {
            const yy = pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`);
            return pdf.dibujarTablaEncabezado(doc2, yy, columnasDet);
          });
          y = pdf.dibujarTablaFila(doc, y, columnasDet, [
            truncarTexto(doc, r.referencia || '-', columnasDet[0].ancho - 12),
            truncarTexto(doc, r.cliente || '-', columnasDet[1].ancho - 12),
            truncarTexto(doc, r.problema || '-', columnasDet[2].ancho - 12),
            (r.fecha_creacion || '').slice(0, 10),
          ], i);
        });
        if ((g.total || 0) > detalle.length) {
          doc.font('Helvetica').fontSize(8).fillColor(pdf.COLORES.gris)
            .text(`… y ${g.total - detalle.length} más en el periodo (no se muestran para no alargar demasiado el PDF).`, pdf.MARGEN, y + 6);
          y += 20;
        }
      }

      if (topReferencias.length === 0 && topMotivos.length === 0 && detalle.length === 0) {
        doc.font('Helvetica').fontSize(10).fillColor(pdf.COLORES.gris)
          .text('No se reportaron garantías en este periodo.', pdf.MARGEN, y + 10);
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generarPdfReporteGarantias };
