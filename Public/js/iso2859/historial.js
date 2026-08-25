const Iso2859Historial = {
  lotes: [],

  async render() {
    const cont = document.getElementById('iso2859Content');
    const esProduccion = Iso2859App.modulo === 'Produccion';
    const titulo = esProduccion ? '⚙️ Historial de Producción' : '📦 Historial de Recepción';

    cont.innerHTML = `
      <div class="card">
        <h2>${titulo}</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.8rem; margin-bottom: 1.5rem;">
          <div class="form-group" style="margin-bottom:0">
            <label>Buscar</label>
            <input type="text" id="hi-q" placeholder="Lote o referencia..." oninput="Iso2859Historial.filtrar()">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label>Estado</label>
            <select id="hi-estado" onchange="Iso2859Historial.filtrar()">
              <option value="Todos">Todos</option>
              <option value="Pendiente">Pendiente</option>
              <option value="Aceptado">Aceptado</option>
              <option value="Aceptado_con_obs">Aceptado con Obs.</option>
              <option value="Rechazado">Rechazado</option>
              <option value="Reclasificado">Reclasificado</option>
              <option value="Reparacion">En reparación</option>
              <option value="Cerrado_sin_auditoria">Cerrado sin auditoría</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label>Desde</label>
            <input type="date" id="hi-desde" onchange="Iso2859Historial.filtrar()">
          </div>
          <div class="form-group" style="margin-bottom:0">
            <label>Hasta</label>
            <input type="date" id="hi-hasta" onchange="Iso2859Historial.filtrar()">
          </div>
          <div style="display: flex; align-items: flex-end; padding-bottom: 4px;">
            <button onclick="Iso2859Historial.exportarCSV()" class="btn-primary" style="width:100%">📥 Exportar CSV</button>
          </div>
        </div>
        <div id="hi-tabla-container"><p>Cargando...</p></div>
      </div>
      <div id="hi-detalle-lote-container"></div>
    `;

    const res = await isoFetch(`/api/iso2859/lotes?modulo=${Iso2859App.modulo}&limit=200`);
    this.lotes = await res.json();
    this.renderTabla(this.lotes);
  },

  renderTabla(lotes) {
    const container = document.getElementById('hi-tabla-container');
    const esProduccion = Iso2859App.modulo === 'Produccion';
    const puedeReportes = tienePermiso('iso2859.reportes') || tienePermiso('iso2859.gestion');
    const puedeCerrar = tienePermiso('iso2859.muestrear') || tienePermiso('iso2859.gestion');

    if (lotes.length === 0) {
      container.innerHTML = '<p style="color:#718096;">No se encontraron lotes con esos filtros.</p>';
      return;
    }

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Fecha</th><th>Lote</th><th>Referencia</th>
            ${esProduccion ? '<th>Máquina</th>' : '<th>Proveedor</th>'}
            <th>Cantidad</th><th>Plan</th><th>Estado</th><th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${lotes.map(l => `
            <tr>
              <td>${l.fecha_creacion ? l.fecha_creacion.split(' ')[0] : '-'}</td>
              <td><strong>${escapeHtml(l.id_lote)}</strong></td>
              <td>${escapeHtml(l.referencia)}</td>
              <td>${escapeHtml((esProduccion ? l.maquina : l.proveedor) || '-')}</td>
              <td>${l.cantidad_total}</td>
              <td>${l.plan_actual || 'Normal'}</td>
              <td><span class="badge badge-${(l.estado_final || 'pendiente').toLowerCase().replace(/_/g, '')}">${l.estado_final === 'Reparacion' ? 'En reparación' : (l.estado_final || 'Pendiente').replace(/_/g, ' ')}</span></td>
              <td>
                <button onclick="Iso2859Historial.verMuestreos('${escapeHtml(l.id_lote)}')">👁 Ver</button>
                ${puedeReportes ? `<button onclick="Iso2859Historial.descargarPdf('/api/iso2859/reportes/lote/${encodeURIComponent(l.id_lote)}')">PDF</button>` : ''}
                ${puedeCerrar && (!l.estado_final || l.estado_final === 'Pendiente') ? `<button onclick="Iso2859Historial.cerrarLote('${escapeHtml(l.id_lote)}')" title="Cerrar sin llegar a hacer la Auditoría Final">🔒 Cerrar</button>` : ''}
                ${puedeCerrar && l.estado_final === 'Rechazado' ? `<button onclick="Iso2859Historial.cambiarTratamiento('${escapeHtml(l.id_lote)}', 'Reclasificado')" title="Darle otro destino en vez de desecharlo">🔄 Reclasificar</button>` : ''}
                ${puedeCerrar && l.estado_final === 'Rechazado' ? `<button onclick="Iso2859Historial.cambiarTratamiento('${escapeHtml(l.id_lote)}', 'Reparacion')" title="Mandarlo a reparación en vez de desecharlo">🔧 Reparar</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p style="margin-top: 0.5rem; color: #718096; font-size: 0.85rem;">Mostrando ${lotes.length} lote(s)</p>
    `;
  },

  // Cierre manual: para cuando la producción de un lote ya terminó en la
  // práctica (se despachó, se cambió de referencia en la máquina, etc.) pero
  // nunca llegó a tener una Auditoría Final — sin esto, ese lote se quedaría
  // en "Pendiente" para siempre. Queda marcado como "Cerrado sin auditoría",
  // un estado aparte de Aceptado/Rechazado: dice que se dejó de trabajar en
  // él, no que haya pasado o no una inspección real. Los lotes que nadie
  // cierra a mano igual se cierran solos por inactividad (ver
  // cerrarLotesInactivos en data/iso2859.js, programado en app_circuitos.js).
  async cerrarLote(idLote) {
    const motivo = prompt(`¿Por qué se cierra el lote ${idLote} sin Auditoría Final? (opcional)`);
    if (motivo === null) return; // canceló el prompt
    const res = await isoFetchJSON(`/api/iso2859/lotes/${encodeURIComponent(idLote)}/cerrar`, {
      method: 'POST', body: JSON.stringify({ motivo: motivo || null }),
    });
    if (res.ok) {
      alert('Lote cerrado.');
      this.render();
    } else {
      const data = await res.json().catch(() => ({}));
      alert('No se pudo cerrar el lote: ' + (data.error || 'error desconocido'));
    }
  },

  // Disposición manual para un lote Rechazado: en vez de desecharlo, se le
  // da otro destino — reclasificarlo (otra referencia, otro uso) o mandarlo
  // a reparación. El motivo es obligatorio (a diferencia del cierre sin
  // auditoría) porque esto cambia el destino real de un lote que ya tiene
  // un veredicto formal de la Auditoría Final — ese veredicto no se borra
  // ni se recalcula, solo queda registrado qué se decidió hacer con el
  // lote después.
  async cambiarTratamiento(idLote, tratamiento) {
    const pregunta = tratamiento === 'Reparacion'
      ? `¿Qué reparación se le hace al lote ${idLote}? (obligatorio)`
      : `¿A qué referencia o uso se reclasifica el lote ${idLote}? (obligatorio)`;
    const motivo = prompt(pregunta);
    if (motivo === null) return; // canceló el prompt
    if (!motivo.trim()) { alert('El motivo es obligatorio.'); return; }
    const res = await isoFetchJSON(`/api/iso2859/lotes/${encodeURIComponent(idLote)}/tratamiento`, {
      method: 'POST', body: JSON.stringify({ tratamiento, motivo: motivo.trim() }),
    });
    if (res.ok) {
      alert(tratamiento === 'Reparacion' ? 'Lote marcado como En reparación.' : 'Lote reclasificado.');
      this.render();
    } else {
      const data = await res.json().catch(() => ({}));
      alert('No se pudo cambiar el tratamiento: ' + (data.error || 'error desconocido'));
    }
  },

  // Los reportes PDF/JSON exigen el header Authorization, así que no se
  // pueden simplemente abrir con window.open('/api/...') como en la app
  // original (ahí no había ninguna sesión que mandar). Se descargan por
  // fetch + blob, con el token, y se abren en una pestaña nueva.
  async descargarPdf(url) {
    try {
      const res = await isoFetch(url);
      if (!res.ok) { alert('No se pudo generar el reporte.'); return; }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank');
    } catch (e) {
      alert('No se pudo generar el reporte.');
    }
  },

  async verMuestreos(idLote) {
    const res = await isoFetch(`/api/iso2859/lotes/${encodeURIComponent(idLote)}`);
    const lote = await res.json();
    const container = document.getElementById('hi-detalle-lote-container');
    const puedeReportes = tienePermiso('iso2859.reportes') || tienePermiso('iso2859.gestion');

    let muestreosHtml = '';
    if (lote.muestreos && lote.muestreos.length > 0) {
      muestreosHtml = lote.muestreos.map(m => {
        const piezasHtml = (m.piezas_reclasificadas > 0 || m.piezas_reparadas > 0)
          ? `<br>${m.piezas_reclasificadas > 0 ? `🔄 ${m.piezas_reclasificadas} pieza(s) reclasificada(s)` : ''}${m.piezas_reclasificadas > 0 && m.piezas_reparadas > 0 ? ' | ' : ''}${m.piezas_reparadas > 0 ? `🔧 ${m.piezas_reparadas} pieza(s) reparada(s)` : ''}`
          : '';
        return `
        <div class="timeline-item ${['Alerta', 'Rechazado', 'Parar', 'Rechazar'].includes(m.decision) ? 'alerta' : (['Aceptado', 'Seguir', 'Aprobado', 'Liberar'].includes(m.decision) ? 'ok' : '')}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
            <div>
              <strong>${m.tipo.replace(/_/g, ' ')}</strong> — ${m.fecha_hora}<br>
              Inspector: ${escapeHtml(m.analista)} | Muestra: ${m.cantidad_muestreada} | <span class="badge badge-${(m.decision || '').toLowerCase().replace(/_/g, '')}">${m.decision}</span><br>
              ${m.area ? `Área: ${escapeHtml(m.area)} | ` : ''}${m.turno ? `Turno: ${escapeHtml(m.turno)} | ` : ''}${m.operario ? `Operario: ${escapeHtml(m.operario)}` : ''}
              ${m.observaciones ? `<br><em>Obs: ${escapeHtml(m.observaciones)}</em>` : ''}
              ${piezasHtml}
            </div>
            ${puedeReportes ? `<button onclick="Iso2859Reportes.verPreview(${m.id_muestreo})" class="btn-primary" style="font-size:0.8rem; padding:0.3rem 0.8rem; white-space:nowrap;">📄 Ver Reporte</button>` : ''}
          </div>
        </div>
      `;
      }).join('');
    } else {
      muestreosHtml = '<p style="color:#718096;">Sin muestreos registrados.</p>';
    }

    // Si la Primera Pieza más reciente de este lote quedó Rechazada (y no
    // hay ninguna posterior que la haya Liberado), se muestra un aviso
    // arriba del todo — es solo un recordatorio visual, el sistema no
    // bloquea nada, pero así no se pierde de vista que hay que repetirla.
    let avisoPrimeraPiezaHtml = '';
    const primerasPiezas = (lote.muestreos || []).filter(m => m.tipo === 'Primera_Pieza');
    if (primerasPiezas.length > 0) {
      const ultima = primerasPiezas[primerasPiezas.length - 1];
      if (ultima.decision === 'Rechazar' || ultima.decision === 'Rechazado') {
        avisoPrimeraPiezaHtml = `
          <div style="background:#fff5f5; border:1px solid #feb2b2; border-radius:8px; padding:0.8rem 1rem; margin:0.8rem 0; color:#c53030;">
            <strong>⚠️ Repetir Primera Pieza</strong> — la última Primera Pieza de este lote salió Rechazada. Hay que hacer otra hasta que salga Liberada antes de continuar.
          </div>
        `;
      }
    }

    let cierreHtml = '';
    if (lote.estado_final === 'Cerrado_sin_auditoria') {
      const esAutomatico = lote.cierre_tipo === 'automatico';
      cierreHtml = `
        <div style="background:#f7f9fc; border:1px solid #dce3ed; border-radius:8px; padding:0.8rem 1rem; margin:0.8rem 0;">
          <p style="margin:0 0 0.3rem 0;"><strong>🔒 Cerrado sin Auditoría Final</strong> — ${esAutomatico ? 'automáticamente por inactividad' : 'manualmente'}</p>
          <p style="margin:0; color:#4a5568; font-size:0.9rem;">
            ${!esAutomatico && lote.cerrado_por ? `Cerrado por: ${escapeHtml(lote.cerrado_por)}<br>` : ''}
            ${lote.fecha_cierre ? `Fecha de cierre: ${escapeHtml(lote.fecha_cierre)}<br>` : ''}
            ${lote.cierre_motivo ? `Motivo: ${escapeHtml(lote.cierre_motivo)}` : (esAutomatico ? '' : 'Sin motivo especificado.')}
          </p>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="card" style="margin-top:1rem; border:2px solid var(--brand-primary);">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h3>📋 Lote ${escapeHtml(lote.id_lote)}</h3>
          <button onclick="document.getElementById('hi-detalle-lote-container').innerHTML=''" style="background:none; border:none; font-size:1.4rem; cursor:pointer; color:#a0aec0;">&times;</button>
        </div>
        <p><strong>Ref:</strong> ${escapeHtml(lote.referencia)} | <strong>Cant:</strong> ${lote.cantidad_total} | <strong>Estado:</strong> ${lote.estado_final === 'Reparacion' ? 'En reparación' : (lote.estado_final || 'Pendiente').replace(/_/g, ' ')}</p>
        ${avisoPrimeraPiezaHtml}
        ${cierreHtml}
        <hr style="border:none; border-top:1px solid #e2e8f0; margin:1rem 0;">
        <h4>Muestreos (${lote.muestreos ? lote.muestreos.length : 0})</h4>
        ${muestreosHtml}
      </div>
    `;
  },

  _filtrados() {
    const q = document.getElementById('hi-q').value.toLowerCase();
    const estado = document.getElementById('hi-estado').value;
    const desde = document.getElementById('hi-desde').value;
    const hasta = document.getElementById('hi-hasta').value;
    return this.lotes.filter(l => {
      const matchQ = !q || l.id_lote.toLowerCase().includes(q) || l.referencia.toLowerCase().includes(q);
      const matchEstado = estado === 'Todos' || l.estado_final === estado;
      const fecha = l.fecha_creacion ? l.fecha_creacion.split(' ')[0] : '';
      const matchDesde = !desde || fecha >= desde;
      const matchHasta = !hasta || fecha <= hasta;
      return matchQ && matchEstado && matchDesde && matchHasta;
    });
  },

  filtrar() {
    this.renderTabla(this._filtrados());
  },

  exportarCSV() {
    const filtrados = this._filtrados();
    if (filtrados.length === 0) { alert('No hay datos para exportar'); return; }
    const esProduccion = Iso2859App.modulo === 'Produccion';

    const headers = ['Fecha', 'Lote', 'Referencia', esProduccion ? 'Maquina' : 'Proveedor', 'Cantidad', 'Plan', 'Estado'];
    const rows = filtrados.map(l => [
      l.fecha_creacion ? l.fecha_creacion.split(' ')[0] : '',
      l.id_lote, l.referencia, (esProduccion ? l.maquina : l.proveedor) || '',
      l.cantidad_total, l.plan_actual || 'Normal', l.estado_final,
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `historial_iso2859_${Iso2859App.modulo}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  },
};
