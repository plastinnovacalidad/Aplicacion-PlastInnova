const Iso2859Reportes = {
  // En la app original, el botón "Reportes" del menú llamaba a esta función
  // pero nunca se llegó a escribir — al hacer clic, la página se rompía con
  // un error de JavaScript. Los únicos reportes que sí funcionaban
  // (trazabilidad por referencia e informe de lote) no tenían ninguna
  // pantalla desde donde llegar a ellos; solo eran alcanzables escribiendo
  // la URL de la API a mano. Esta vista arma un punto de entrada real para
  // esos dos reportes, y deja el de "reporte por muestreo" donde ya
  // funcionaba (Historial → Ver → Ver Reporte).
  render() {
    const cont = document.getElementById('iso2859Content');
    cont.innerHTML = `
      <div class="card" style="max-width:700px; margin:0 auto; width:100%;">
        <h2>📄 Reportes</h2>
        <p style="color:#718096; margin-bottom:1.2rem;">Para el reporte de un muestreo puntual, use Historial → Ver → Ver Reporte.</p>

        <h4 style="margin-bottom:0.6rem;">Trazabilidad por Referencia</h4>
        <div style="display:flex; gap:0.6rem; margin-bottom:1.5rem; position:relative;">
          <input type="text" id="rp-referencia" placeholder="Escriba para buscar una referencia..." autocomplete="off" oninput="Iso2859Reportes.buscarReferencias(this.value)" style="flex:1; padding:0.6rem; border:1px solid #cbd5e0; border-radius:6px;">
          <button class="btn-primary" onclick="Iso2859Reportes.descargarTrazabilidad()">Generar PDF</button>
          <div id="rp-ref-lista" class="autocomplete-list" style="display:none; top:100%;"></div>
        </div>

        <h4 style="margin-bottom:0.6rem;">Informe de Lote</h4>
        <div style="display:flex; gap:0.6rem;">
          <input type="text" id="rp-lote" placeholder="Número de lote..." style="flex:1; padding:0.6rem; border:1px solid #cbd5e0; border-radius:6px;">
          <button class="btn-primary" onclick="Iso2859Reportes.descargarLote()">Generar PDF</button>
        </div>
      </div>
    `;
  },

  buscarReferencias(valor) {
    clearTimeout(this._debounce);
    const val = valor.trim();
    const lista = document.getElementById('rp-ref-lista');
    if (val.length < 2) { lista.style.display = 'none'; return; }
    this._debounce = setTimeout(async () => {
      const res = await isoFetch(`/api/iso2859/catalogos/referencias?q=${encodeURIComponent(val)}`);
      const refs = await res.json();
      if (!refs || refs.length === 0) { lista.style.display = 'none'; return; }
      lista.innerHTML = refs.map(r => `<div class="autocomplete-item" onclick="Iso2859Reportes.seleccionarReferencia('${escapeHtml(r.nombre)}')"><strong>${escapeHtml(r.nombre)}</strong></div>`).join('');
      lista.style.display = 'block';
    }, 250);
  },

  seleccionarReferencia(nombre) {
    document.getElementById('rp-referencia').value = nombre;
    document.getElementById('rp-ref-lista').style.display = 'none';
  },

  async _descargar(url, mensajeError) {
    try {
      const res = await isoFetch(url);
      if (!res.ok) { alert(mensajeError); return; }
      const blob = await res.blob();
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (e) {
      alert(mensajeError);
    }
  },

  descargarTrazabilidad() {
    const ref = document.getElementById('rp-referencia').value.trim();
    if (!ref) { alert('Escriba una referencia'); return; }
    this._descargar(`/api/iso2859/reportes/trazabilidad/${encodeURIComponent(ref)}`, 'No hay lotes registrados para esa referencia.');
  },

  descargarLote() {
    const idLote = document.getElementById('rp-lote').value.trim();
    if (!idLote) { alert('Escriba un número de lote'); return; }
    this._descargar(`/api/iso2859/reportes/lote/${encodeURIComponent(idLote)}`, 'Lote no encontrado.');
  },

  async verPreview(idMuestreo) {
    const cont = document.getElementById('iso2859Content');
    const res = await isoFetch(`/api/iso2859/reportes/preview/${idMuestreo}`);
    if (!res.ok) { alert('Error cargando la vista previa del reporte'); return; }
    const { muestreo, defectos, criticidad, totalDefectos, porcentaje } = await res.json();

    let critColor = '#38a169', critBg = '#f0fff4';
    if (criticidad === 'CRITICO' || criticidad === 'RECHAZADO') { critColor = '#c53030'; critBg = '#fff5f5'; }
    else if (criticidad === 'MAYOR') { critColor = '#dd6b20'; critBg = '#fffaf0'; }
    else if (criticidad === 'MENOR') { critColor = '#1B4FC4'; critBg = '#ebf8ff'; }

    const proveedor = muestreo.proveedor || muestreo.maquina || '-';

    let defectosHtml = '';
    if (defectos && defectos.length > 0) {
      defectosHtml = `
        <h3 style="margin-top:1.5rem; color:#1a4d8f; border-bottom:2px solid #1a4d8f; padding-bottom:0.3rem;">Defectos Encontrados</h3>
        <table style="width:100%; border-collapse:collapse; margin-top:0.5rem;">
          <thead>
            <tr style="background:#1a4d8f; color:white;">
              <th style="padding:8px; text-align:left; border:1px solid #999;">Código</th>
              <th style="padding:8px; text-align:left; border:1px solid #999;">Descripción</th>
              <th style="padding:8px; text-align:center; border:1px solid #999;">Severidad</th>
              <th style="padding:8px; text-align:center; border:1px solid #999;">Cantidad</th>
            </tr>
          </thead>
          <tbody>
            ${defectos.map((d, i) => `
              <tr style="background:${i % 2 === 0 ? '#f7fafc' : 'white'};">
                <td style="padding:8px; border:1px solid #ccc;">${escapeHtml(d.codigo_defecto)}</td>
                <td style="padding:8px; border:1px solid #ccc;">${escapeHtml(d.descripcion || '-')}</td>
                <td style="padding:8px; text-align:center; border:1px solid #ccc;"><span class="badge badge-${d.severidad.toLowerCase()}">${d.severidad}</span></td>
                <td style="padding:8px; text-align:center; border:1px solid #ccc;">${d.cantidad}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    const fila = (label, value) => `
      <div style="display:flex; border-bottom:1px solid #999;">
        <div style="width:160px; background:#dbe9f8; padding:10px 12px; font-weight:bold; font-size:0.9rem; border-right:1px solid #999;">${label}</div>
        <div style="flex:1; padding:10px 12px; font-size:0.9rem;">${value}</div>
      </div>
    `;

    cont.innerHTML = `
      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:10px;">
          <h2>👁 Vista Previa del Reporte</h2>
          <div>
            <button onclick="Iso2859Reportes._descargar('/api/iso2859/reportes/operativo/${idMuestreo}', 'No se pudo generar el PDF.')" class="btn-primary">📄 Descargar PDF</button>
            <button onclick="Iso2859App.navigate('historial')" class="btn-secondary">Volver</button>
          </div>
        </div>

        <div style="border:2px solid #1a4d8f; border-radius:4px; overflow:hidden; max-width:700px; margin:0 auto;">
          <div style="background:#1a4d8f; color:white; padding:12px 16px; display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:bold; font-size:1.1rem;">PLAST INNOVA</span>
            <span style="font-size:0.95rem;">Reporte Muestreo Calidad</span>
          </div>
          <div style="display:flex; border-bottom:1px solid #999;">
            <div style="width:160px; background:#dbe9f8; padding:10px 12px; font-weight:bold; font-size:0.9rem; border-right:1px solid #999;">Criticidad</div>
            <div style="flex:1; padding:10px 12px; font-size:0.9rem; background:${critBg}; color:${critColor}; font-weight:bold;">${criticidad}</div>
          </div>
          ${fila('Lote', escapeHtml(muestreo.id_lote))}
          ${fila('Referencia', escapeHtml(muestreo.referencia))}
          ${fila('Cantidad Lote', muestreo.cantidad_total)}
          ${fila('Cantidad Muestra', muestreo.cantidad_muestreada)}
          ${fila('Cantidad No Conforme', totalDefectos)}
          ${fila('% No Conforme', porcentaje)}
          ${fila('Proveedor', escapeHtml(proveedor))}
          ${fila('Inspector', escapeHtml(muestreo.analista))}
          ${fila('Decisión', `<span class="badge badge-${(muestreo.decision || '').toLowerCase().replace(/_/g, '')}">${muestreo.decision || 'Pendiente'}</span>`)}
          ${fila('Observación', escapeHtml(muestreo.observaciones || 'Sin observaciones'))}
        </div>

        ${defectosHtml}

        <div style="margin-top:1.5rem; text-align:center;">
          <button onclick="Iso2859Reportes._descargar('/api/iso2859/reportes/operativo/${idMuestreo}', 'No se pudo generar el PDF.')" class="btn-primary" style="font-size:1.05rem; padding:0.8rem 2rem;">📄 Descargar PDF</button>
        </div>
      </div>
    `;
  },
};
