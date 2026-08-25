// ======================== PDF del Resumen de Calidad (roadmap #2) ========================
// Genera el PDF que se manda por WhatsApp para los resúmenes periódicos de
// calidad (diario/quincenal/mensual), tanto los automáticos como los
// pedidos por comando. Reutiliza el mismo toolkit visual que ya usan los
// reportes de Auditoría/Lote/Trazabilidad (utils/pdfIso2859.js) — mismo
// azul institucional, mismas tarjetas e insignias — para que se vea como
// parte de la misma familia de reportes y no como algo aparte solo para
// WhatsApp. Antes este mismo resumen solo se mandaba como texto plano
// (ver formatearResumenCalidad en whatsapp_bot_service.js, que se conserva
// como respaldo por si el PDF no se puede generar).
//
// A diferencia de crearDocumento() en pdfIso2859.js (que asume que existe
// un `res` de Express para hacer streaming de la respuesta), aquí no hay
// petición HTTP — el PDF se escribe a un archivo temporal porque
// whatsapp-web.js necesita una ruta de archivo (o base64) para adjuntarlo
// con MessageMedia, no un stream. Quien llama a esta función es responsable
// de borrar el archivo después de enviarlo (ver enviarResumenPDF y
// responderResumenPDF en whatsapp_bot_service.js).
const fs = require('fs');
const path = require('path');
const os = require('os');
const PDFDocument = require('pdfkit');
const pdf = require('./pdfIso2859');

// dibujarTablaFila (pdfIso2859.js) dibuja cada celda en una sola línea con
// una altura de fila fija (20px) — si el texto es más largo de lo que cabe,
// PDFKit lo envuelve a una segunda línea que se sale de la fila y se monta
// sobre la siguiente. Los datos de garantías (cliente, problema) sí pueden
// ser más largos que la columna, así que se recortan antes de dibujarlos.
function truncarTexto(doc, texto, anchoMax) {
  texto = String(texto || '');
  if (doc.widthOfString(texto) <= anchoMax) return texto;
  let recortado = texto;
  while (recortado.length > 1 && doc.widthOfString(recortado + '…') > anchoMax) {
    recortado = recortado.slice(0, -1);
  }
  return recortado + '…';
}

function generarPdfResumenCalidad(etiquetaPeriodo, r) {
  return new Promise((resolve, reject) => {
    let rutaArchivo;
    try {
      const nombreArchivo = `resumen-calidad-${Date.now()}-${Math.round(Math.random() * 1e6)}.pdf`;
      rutaArchivo = path.join(os.tmpdir(), nombreArchivo);

      const doc = new PDFDocument({ margin: pdf.MARGEN, size: 'A4', bufferPages: true });
      const stream = fs.createWriteStream(rutaArchivo);
      doc.pipe(stream);
      stream.on('finish', () => resolve(rutaArchivo));
      stream.on('error', reject);
      doc.on('error', reject);

      const titulo = `Resumen de Calidad — ${etiquetaPeriodo}`;
      pdf.dibujarPie(doc);
      doc.on('pageAdded', () => pdf.dibujarPie(doc));

      let y = pdf.dibujarEncabezado(doc, titulo);

      const pp = {};
      (r.primeraPieza || []).forEach(x => { pp[x.decision] = x.total; });
      const fin = {};
      (r.final || []).forEach(x => { fin[x.decision] = x.total; });
      const trat = {};
      (r.lotesTratamiento || []).forEach(x => { trat[x.estado_final] = x.total; });
      const ep = r.enProceso || {};

      y = pdf.dibujarTarjetasResumen(doc, y, [
        { etiqueta: '1RA PIEZA RECHAZADA', valor: pp.Rechazar || 0, color: pdf.COLORES.rojo },
        { etiqueta: 'PARADAS EN PROCESO', valor: ep.paradas || 0, color: pdf.COLORES.naranja },
        { etiqueta: 'GARANTÍAS', valor: r.garantias || 0, color: pdf.COLORES.azul },
        { etiqueta: 'FUERA DE TOLERANCIA', valor: r.fueraTolerancia || 0, color: pdf.COLORES.azul },
      ]);

      y = pdf.dibujarTituloSeccion(doc, y, 'Primera Pieza');
      y = pdf.dibujarPanelInfo(doc, y, [
        { label: 'Liberadas', value: pp.Liberar || 0 },
        { label: 'Rechazadas', value: pp.Rechazar || 0 },
        { label: 'Reclasificadas', value: pp.Reclasificar || 0 },
      ]);

      y = pdf.saltoPaginaSiNecesario(doc, y, 110, (doc2) => pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`));
      y = pdf.dibujarTituloSeccion(doc, y, 'En Proceso');
      y = pdf.dibujarPanelInfo(doc, y, [
        { label: 'Muestreos realizados', value: ep.total || 0 },
        { label: 'Paradas ("Parar")', value: ep.paradas || 0 },
        { label: 'Alertas', value: ep.alertas || 0 },
        { label: 'Piezas reclasificadas', value: ep.piezas_reclasificadas || 0 },
        { label: 'Piezas reparadas', value: ep.piezas_reparadas || 0 },
      ]);

      y = pdf.saltoPaginaSiNecesario(doc, y, 130, (doc2) => pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`));
      y = pdf.dibujarTituloSeccion(doc, y, 'Auditoría Final');
      y = pdf.dibujarPanelInfo(doc, y, [
        { label: 'Aceptados', value: fin.Aceptado || 0 },
        { label: 'Aceptados con obs.', value: fin.Aceptado_con_obs || 0 },
        { label: 'Rechazados', value: fin.Rechazado || 0 },
        { label: 'Lotes reclasificados al cierre', value: trat.Reclasificado || 0 },
        { label: 'Lotes en reparación al cierre', value: trat.Reparacion || 0 },
      ]);

      // Top de referencias con más garantías del periodo, no el listado de
      // las más recientes — así, de un vistazo, se ve cuál referencia está
      // dando más problema en vez de solo las últimas que entraron. El
      // detalle completo (con cliente y motivo de cada una) vive en el
      // reporte aparte de garantías (ver utils/pdfReporteGarantias.js).
      const top = r.garantiasTop || [];
      if (top.length > 0) {
        y = pdf.saltoPaginaSiNecesario(doc, y, 110, (doc2) => pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`));
        y = pdf.dibujarTituloSeccion(doc, y, `Garantías Reportadas (${r.garantias || 0}) — Top ${top.length} referencias más frecuentes`);
        const columnasTop = [
          { label: '#', ancho: 30 },
          { label: 'Referencia', ancho: 285 },
          { label: 'Garantías', ancho: 100, align: 'right' },
          { label: '% del periodo', ancho: 100, align: 'right' },
        ];
        y = pdf.dibujarTablaEncabezado(doc, y, columnasTop);
        doc.font('Helvetica').fontSize(8.5);
        top.forEach((g, i) => {
          y = pdf.saltoPaginaSiNecesario(doc, y, 20, (doc2) => {
            const yy = pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`);
            return pdf.dibujarTablaEncabezado(doc2, yy, columnasTop);
          });
          const pct = (r.garantias || 0) > 0 ? `${Math.round((g.total / r.garantias) * 1000) / 10}%` : '-';
          y = pdf.dibujarTablaFila(doc, y, columnasTop, [
            String(i + 1),
            truncarTexto(doc, g.referencia || '-', columnasTop[1].ancho - 12),
            g.total,
            pct,
          ], i);
        });
      }

      y = pdf.saltoPaginaSiNecesario(doc, y, 70, (doc2) => pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`));
      y = pdf.dibujarTituloSeccion(doc, y, 'Metrología');
      y = pdf.dibujarPanelInfo(doc, y, [
        { label: 'Medidas fuera de tolerancia', value: r.fueraTolerancia || 0 },
      ]);

      // Detalle de cuáles referencias salieron fuera de tolerancia y por
      // cuánto (la desviación respecto al límite que incumplieron) — antes
      // solo se veía el conteo de arriba. La peor desviación va primero
      // (ver fueraToleranciaDetallePeriodo en data/calidad.js).
      const fueraDetalle = r.fueraToleranciaDetalle || [];
      if (fueraDetalle.length > 0) {
        y = pdf.saltoPaginaSiNecesario(doc, y, 110, (doc2) => pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`));
        y = pdf.dibujarTituloSeccion(doc, y, 'Detalle — Fuera de Tolerancia');
        const columnasTol = [
          { label: 'Referencia', ancho: 145 },
          { label: 'Cota', ancho: 80 },
          { label: 'Medida', ancho: 90, align: 'right' },
          { label: 'Tolerancia', ancho: 115, align: 'right' },
          { label: 'Desviación', ancho: 85, align: 'right' },
        ];
        y = pdf.dibujarTablaEncabezado(doc, y, columnasTol);
        doc.font('Helvetica').fontSize(8.5);
        fueraDetalle.forEach((m, i) => {
          y = pdf.saltoPaginaSiNecesario(doc, y, 20, (doc2) => {
            const yy = pdf.dibujarEncabezado(doc2, `${titulo} (continuación)`);
            return pdf.dibujarTablaEncabezado(doc2, yy, columnasTol);
          });
          const desv = m.desviacion || 0;
          const desvTxto = `${desv >= 0 ? '+' : ''}${desv.toFixed(3)}`;
          y = pdf.dibujarTablaFila(doc, y, columnasTol, [
            truncarTexto(doc, m.referencia || '-', columnasTol[0].ancho - 12),
            truncarTexto(doc, m.cota || '-', columnasTol[1].ancho - 12),
            Number(m.medida_real).toFixed(3),
            `${Number(m.tolerancia_minima).toFixed(3)}–${Number(m.tolerancia_maxima).toFixed(3)}`,
            desvTxto,
          ], i);
        });
        if ((r.fueraTolerancia || 0) > fueraDetalle.length) {
          doc.font('Helvetica').fontSize(8).fillColor(pdf.COLORES.gris)
            .text(`… y ${r.fueraTolerancia - fueraDetalle.length} más en el periodo.`, pdf.MARGEN, y + 6);
          y += 20;
        }
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { generarPdfResumenCalidad };
