// Tarjeta-imagen de resumen de un reporte del módulo "Reportes por Áreas"
// (pedido por Julio, 07/09): al terminar de crear un Rápido, se elige a qué
// usuarios avisar y se les manda esta tarjeta por WhatsApp -- mismo criterio
// visual/técnico que ya usa Metrología con utils/imagenReporteMetrologia.js
// (HTML autocontenido, convertido a PNG por whatsapp_bot_service.js
// reusando el navegador del propio bot).
//
// Ampliado el mismo día para el botón "Compartir" del detalle: la misma
// tarjeta ahora se puede reenviar en cualquier momento, y también sirve
// para un Reporte Completo (no solo Rápido) -- por eso el título de la
// barra y, si ya tiene causa raíz, una caja extra con la primera se arman
// según reporte.tipo. El nombre de la función se queda igual
// (construirHtmlResumenReporteRapido) para no tocar todos los sitios que ya
// la llaman, aunque ahora sirve para ambos tipos.
//
// Solo construye el HTML -- la captura de pantalla (Puppeteer) y el envío
// por WhatsApp viven en whatsapp_bot_service.js, igual que con el reporte de
// inspección de Metrología.

function escaparHtml(texto) {
  return String(texto == null ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const COLOR_URGENCIA = {
  Baja: '#718096',
  Media: '#1B4FC4',
  Alta: '#b7791f',
  Critica: '#c53030',
};
const TEXTO_URGENCIA = {
  Baja: 'Urgencia Baja',
  Media: 'Urgencia Media',
  Alta: 'Urgencia Alta',
  Critica: 'Urgencia Crítica',
};
const ETIQUETA_TIPO = {
  rapido: 'Reporte Rápido',
  completo: 'Reporte de Problema Completo',
};

function construirHtmlResumenReporteRapido(reporte) {
  const colorUrgencia = COLOR_URGENCIA[reporte.urgencia] || '#718096';
  const textoUrgencia = TEXTO_URGENCIA[reporte.urgencia] || (reporte.urgencia || 'Sin urgencia');
  const etiquetaTipo = ETIQUETA_TIPO[reporte.tipo] || 'Reporte';

  const filas = [
    ['Área', reporte.area_origen_nombre || '—'],
    ['Referencia', reporte.referencia || '—'],
    ['Lote', reporte.lote || '—'],
  ].map(([etiqueta, valor]) => `
      <tr>
        <td style="padding:6px 0; font-size:12px; color:#a0aec0; font-weight:700; text-transform:uppercase; width:110px; vertical-align:top;">${escaparHtml(etiqueta)}</td>
        <td style="padding:6px 0; font-size:15px; color:#2d3748; vertical-align:top;">${escaparHtml(valor)}</td>
      </tr>`).join('');

  // Si ya es un Reporte Completo con causa(s) raíz registrada(s), se agrega
  // una caja extra con la primera -- útil para quien recibe la tarjeta sin
  // tener que abrir el sistema.
  const causas = reporte.causas || [];
  const cajaCausa = causas.length ? `
      <div class="descripcion-caja">
        <div class="etiqueta">Causa raíz${causas.length > 1 ? ` (1 de ${causas.length})` : ''}</div>
        <div class="texto">${escaparHtml(causas[0].texto)}</div>
      </div>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', Tahoma, Verdana, sans-serif; background: #ffffff; }
  .tarjeta { width: 640px; padding: 0 0 22px; }
  .barra { background: ${colorUrgencia}; color: #ffffff; padding: 16px 24px; }
  .barra .etiqueta { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; opacity: 0.85; }
  .barra .titulo { font-size: 20px; font-weight: 800; margin-top: 2px; }
  .cuerpo { padding: 20px 24px 0; }
  .descripcion-caja { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin-top: 14px; }
  .descripcion-caja .etiqueta { font-size: 11px; color: #a0aec0; font-weight: 700; text-transform: uppercase; margin-bottom: 6px; }
  .descripcion-caja .texto { font-size: 14.5px; color: #2d3748; line-height: 1.5; white-space: pre-wrap; }
  .pie { margin-top: 16px; font-size: 11.5px; color: #a0aec0; }
  .pie b { color: #718096; }
</style></head>
<body>
  <div class="tarjeta">
    <div class="barra">
      <div class="etiqueta">${escaparHtml(etiquetaTipo)} — Plast-Innova S.A.</div>
      <div class="titulo">${escaparHtml(textoUrgencia)}</div>
    </div>
    <div class="cuerpo">
      <table style="width:100%; border-collapse:collapse;">${filas}</table>
      <div class="descripcion-caja">
        <div class="etiqueta">Descripción / Síntoma</div>
        <div class="texto">${escaparHtml(reporte.descripcion || '')}</div>
      </div>
      ${cajaCausa}
      <div class="pie">Registrado por <b>${escaparHtml(reporte.autor_nombre || 'Usuario')}</b> · ${escaparHtml(reporte.created_at || '')}</div>
    </div>
  </div>
</body></html>`;
}

module.exports = { construirHtmlResumenReporteRapido };
