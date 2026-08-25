const Iso2859Dashboard = {
  async render() {
    if (Iso2859App.modulo === 'Recepcion') return this.renderRecepcion();
    return this.renderProduccion();
  },

  async renderRecepcion() {
    const cont = document.getElementById('iso2859Content');
    try {
      const [resumen, tendencias, defectos] = await Promise.all([
        isoFetch('/api/iso2859/lotes/dashboard/resumen?modulo=Recepcion').then(r => r.json()),
        isoFetch('/api/iso2859/lotes/dashboard/tendencias').then(r => r.json()),
        isoFetch('/api/iso2859/lotes/dashboard/defectos-area').then(r => r.json()),
      ]);

      cont.innerHTML = `
        <div class="dashboard-grid">
          <div class="card metric"><h3>Lotes Hoy</h3><div class="big-number">${resumen.total_hoy || 0}</div></div>
          <div class="card metric alert"><h3>Rechazados</h3><div class="big-number">${resumen.rechazados || 0}</div></div>
          <div class="card metric warning"><h3>Con Obs.</h3><div class="big-number">${resumen.con_obs || 0}</div></div>
          <div class="card metric info"><h3>Pendientes</h3><div class="big-number">${resumen.pendientes || 0}</div></div>
        </div>
        <div class="card">
          <h3>📈 Tendencias (7 días)</h3>
          <canvas id="chart-tendencias-iso" height="80"></canvas>
        </div>
        <div class="card">
          <h3>🔥 Defectos por Área (30 días)</h3>
          <div id="defectos-chart-container-iso" style="height:220px;">
            ${defectos && defectos.length > 0 ? '' : '<p style="color:#718096;">Sin datos de defectos.</p>'}
          </div>
        </div>
      `;

      if (tendencias && tendencias.length > 0 && window.Chart) {
        new Chart(document.getElementById('chart-tendencias-iso'), {
          type: 'line',
          data: {
            labels: tendencias.map(t => t.fecha ? t.fecha.slice(5) : ''),
            datasets: [
              { label: 'Total', data: tendencias.map(t => t.total), borderColor: '#1B4FC4', fill: false },
              { label: 'Rechazados', data: tendencias.map(t => t.rechazados), borderColor: '#c53030', fill: false },
              { label: 'Aceptados', data: tendencias.map(t => t.aceptados), borderColor: '#38a169', fill: false },
            ],
          },
          options: { responsive: true, scales: { y: { beginAtZero: true } } },
        });
      }

      if (defectos && defectos.length > 0 && window.Chart) {
        const agrupado = {};
        defectos.forEach(d => { agrupado[d.area] = (agrupado[d.area] || 0) + d.cantidad; });
        new Chart(document.getElementById('defectos-chart-container-iso'), {
          type: 'bar',
          data: { labels: Object.keys(agrupado), datasets: [{ label: 'Defectos', data: Object.values(agrupado), backgroundColor: '#c53030' }] },
          options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
        });
      }
    } catch (err) {
      console.error('Error dashboard Recepción:', err);
      cont.innerHTML = `<div class="card"><p style="color:#c53030;">Error cargando el dashboard.</p></div>`;
    }
  },

  async renderProduccion() {
    const cont = document.getElementById('iso2859Content');
    try {
      const [activos, bitacora, alertas] = await Promise.all([
        isoFetch('/api/iso2859/lotes/dashboard/lotes-activos').then(r => r.json()),
        isoFetch('/api/iso2859/lotes/dashboard/bitacora').then(r => r.json()),
        isoFetch('/api/iso2859/lotes/dashboard/resumen?modulo=Produccion').then(r => r.json()),
      ]);

      cont.innerHTML = `
        <div class="dashboard-grid">
          <div class="card metric"><h3>Lotes Activos</h3><div class="big-number">${activos ? activos.length : 0}</div></div>
          <div class="card metric alert"><h3>Alertas (7 días)</h3><div class="big-number">${alertas && alertas.alertas_hoy ? alertas.alertas_hoy.length : 0}</div></div>
          <div class="card metric info"><h3>Muestreos Recientes</h3><div class="big-number">${bitacora ? bitacora.length : 0}</div></div>
        </div>

        <div class="card">
          <h3>📦 Lotes de Producción</h3>
          <div class="grid-cards">
            ${activos && activos.length > 0 ? activos.map(l => {
              let ind = 'indicador-ok';
              const alertasCount = l.alertas || 0;
              const estado = l.estado_final || 'Pendiente';
              if (alertasCount >= 2) ind = 'indicador-revision';
              else if (alertasCount >= 1) ind = 'indicador-alerta';
              else if (estado === 'Rechazado') ind = 'indicador-revision';
              else if (estado === 'Cerrado_sin_auditoria') ind = 'indicador-alerta';
              return `
                <div class="card-item" onclick="Iso2859Revision.verLoteExistente('${escapeHtml(l.id_lote)}')">
                  <h4><span class="indicador-lote ${ind}"></span>${escapeHtml(l.id_lote)}</h4>
                  <p>Ref: ${escapeHtml(l.referencia)} | Máquina: ${escapeHtml(l.maquina || '-')}</p>
                  <p>${l.total_muestreos || 0} muestreos | ${alertasCount} alertas</p>
                  <p>Estado: <span class="badge badge-${estado.toLowerCase().replace(/_/g, '')}">${estado.replace(/_/g, ' ')}</span></p>
                  <p style="font-size:0.8rem; color:#718096;">Última: ${l.ultima_actividad ? l.ultima_actividad.replace(' ', 'T').split('T')[1].slice(0, 5) : '-'}</p>
                </div>
              `;
            }).join('') : '<p style="padding:1rem; color:#718096;">No hay lotes de producción registrados.</p>'}
          </div>
        </div>

        <div class="card">
          <h3>📋 Bitácora de Muestreos</h3>
          <table>
            <thead><tr><th>Fecha</th><th>Lote</th><th>Tipo</th><th>Área</th><th>Inspector</th><th>Decisión</th></tr></thead>
            <tbody>
              ${bitacora && bitacora.length > 0 ? bitacora.map(m => {
                const fecha = m.fecha_hora ? (() => {
                  const partes = m.fecha_hora.replace(' ', 'T').split('T');
                  return partes[0] + ' ' + (partes[1] ? partes[1].slice(0, 5) : '');
                })() : '-';
                return `
                  <tr>
                    <td>${fecha}</td>
                    <td>${escapeHtml(m.id_lote)}</td>
                    <td>${m.tipo ? m.tipo.replace(/_/g, ' ') : '-'}</td>
                    <td>${escapeHtml(m.area || '-')}</td>
                    <td>${escapeHtml(m.analista)}</td>
                    <td><span class="badge badge-${m.decision ? m.decision.toLowerCase().replace(/_/g, '') : 'pendiente'}">${m.decision || 'Pendiente'}</span></td>
                  </tr>
                `;
              }).join('') : '<tr><td colspan="6" style="text-align:center; color:#718096;">Sin muestreos registrados.</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      console.error('Error dashboard Producción:', err);
      cont.innerHTML = `<div class="card"><p style="color:#c53030;">Error cargando el dashboard.</p></div>`;
    }
  },
};
