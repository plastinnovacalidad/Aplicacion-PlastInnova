const Iso2859Revision = {
  async renderNuevoMuestreo() {
    const cont = document.getElementById('iso2859Content');
    const areas = await isoFetch('/api/iso2859/areas?modulo=Produccion').then(r => r.json());

    cont.innerHTML = `
      <div class="card" style="max-width:720px; margin:0 auto; width:100%;">
        <h2>⚙️ Nuevo Muestreo</h2>
        <p style="color:#718096; margin-bottom:1rem;">El consecutivo de inspección se genera automáticamente. Escriba el número de lote de producción.</p>

        <form id="form-muestreo-prod">
          <div class="form-group" style="position:relative;">
            <label>Número de Lote *</label>
            <input type="text" id="rv-lote-input" required placeholder="Ej: i2021000318" autocomplete="off">
            <div id="rv-autocomplete-list" class="autocomplete-list" style="display:none;"></div>
          </div>

          <div id="rv-resumen-lote" style="display:none; margin-bottom:1rem;"></div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem;">
            <div class="form-group" style="position:relative;">
              <label>Referencia *</label>
              <input type="text" id="rv-referencia" required placeholder="Escriba para buscar..." autocomplete="off" oninput="Iso2859Revision.buscarReferencias(this.value)">
              <div id="rv-ref-lista" class="autocomplete-list" style="display:none;"></div>
            </div>
            <div class="form-group">
              <label>Cantidad Total *</label>
              <input type="number" id="rv-cantidad" required min="1">
            </div>
          </div>

          <div class="form-group">
            <label>Máquina *</label>
            <input type="text" id="rv-maquina" required placeholder="Ej: M3">
          </div>

          <hr style="border:none; border-top:1px solid #e2e8f0; margin:1.5rem 0;">

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:1rem;">
            <div class="form-group">
              <label>Tipo de Muestreo *</label>
              <select id="rv-tipo" required>
                <option value="">Seleccione...</option>
                <option value="Primera_Pieza">1. Primera Pieza</option>
                <option value="En_Proceso">2. En Proceso</option>
                <option value="Final">3. Auditoría Final</option>
              </select>
            </div>
            <div class="form-group">
              <label>Área *</label>
              <select id="rv-area" required>
                <option value="">Seleccione...</option>
                ${areas.map(a => `<option value="${escapeHtml(a.nombre)}">${escapeHtml(a.nombre)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:1rem;">
            <div class="form-group">
              <label>Turno *</label>
              <select id="rv-turno" required>
                <option value="Manana">Mañana</option>
                <option value="Tarde">Tarde</option>
                <option value="Noche">Noche</option>
              </select>
            </div>
            <div class="form-group">
              <label>Inspector</label>
              <input type="text" id="rv-analista" value="${escapeHtml(usuarioActual.nombre)}" readonly>
            </div>
            <div class="form-group">
              <label>Operario</label>
              <input type="text" id="rv-operario" placeholder="Ej: Juan Pérez">
            </div>
          </div>

          <div id="rv-preview-tipo" class="alert alert-info" style="display:none;"></div>

          <button type="submit" class="btn-primary" style="width:100%; margin-top:1rem; font-size:1.05rem;">CREAR MUESTREO</button>
        </form>
      </div>
    `;

    // Autocompletar lote
    const input = document.getElementById('rv-lote-input');
    const list = document.getElementById('rv-autocomplete-list');
    let debounceLote;
    input.addEventListener('input', () => {
      clearTimeout(debounceLote);
      debounceLote = setTimeout(async () => {
        const val = input.value.trim();
        if (val.length < 2) { list.style.display = 'none'; return; }
        const res = await isoFetch(`/api/iso2859/lotes/buscar?q=${encodeURIComponent(val)}&modulo=Produccion`);
        const lotes = await res.json();
        if (!lotes || lotes.length === 0) { list.style.display = 'none'; return; }
        list.innerHTML = lotes.map(l => `
          <div class="autocomplete-item" onclick="Iso2859Revision.seleccionarLote('${escapeHtml(l.id_lote)}', '${escapeHtml(l.referencia)}', ${l.cantidad_total}, '${escapeHtml(l.maquina || '')}')">
            <strong>${escapeHtml(l.id_lote)}</strong><br>
            <small>${escapeHtml(l.referencia)} | Cant: ${l.cantidad_total} | Máq: ${escapeHtml(l.maquina || '-')}</small>
          </div>
        `).join('');
        list.style.display = 'block';
      }, 300);
    });
    document.addEventListener('click', (e) => { if (e.target !== input) list.style.display = 'none'; });

    document.getElementById('rv-tipo').addEventListener('change', (e) => {
      const preview = document.getElementById('rv-preview-tipo');
      const tipo = e.target.value;
      if (!tipo) { preview.style.display = 'none'; return; }
      let texto = '';
      if (tipo === 'Primera_Pieza') texto = '<strong>Primera Pieza:</strong> 3 unidades. Checklist rápido. No aplica ISO 2859.';
      if (tipo === 'En_Proceso') texto = '<strong>En Proceso:</strong> 5 unidades. Decisión: Seguir / Alerta / Parar máquina.';
      if (tipo === 'Final') texto = '<strong>Auditoría Final:</strong> ISO 2859 pura. Cálculo automático de n, Ac, Re.';
      preview.style.display = 'block';
      preview.innerHTML = texto;
    });

    document.getElementById('form-muestreo-prod').addEventListener('submit', async (e) => {
      e.preventDefault();
      const loteId = document.getElementById('rv-lote-input').value.trim();
      const tipo = document.getElementById('rv-tipo').value;
      const referencia = document.getElementById('rv-referencia').value.trim();
      const cantidad = parseInt(document.getElementById('rv-cantidad').value, 10);
      const maquina = document.getElementById('rv-maquina').value.trim();

      const resRev = await isoFetchJSON('/api/iso2859/revisiones', { method: 'POST', body: JSON.stringify({ referencia, cantidad_programada: cantidad, maquina }) });
      const dataRev = await resRev.json();
      if (!resRev.ok) { alert('Error creando revisión: ' + (dataRev.error || 'Desconocido')); return; }

      await isoFetchJSON('/api/iso2859/lotes', {
        method: 'POST',
        body: JSON.stringify({ id_lote: loteId, referencia, modulo: 'Produccion', cantidad_total: cantidad, id_revision: dataRev.id_revision, maquina }),
      });

      Iso2859App.navigate('muestreo', {
        idLote: loteId,
        tipo,
        idRevision: dataRev.id_revision,
        turno: document.getElementById('rv-turno').value,
        area: document.getElementById('rv-area').value,
        operario: document.getElementById('rv-operario').value,
      });
    });

    if (Iso2859App.navigateParams && Iso2859App.navigateParams.idLote) {
      setTimeout(async () => {
        const id = Iso2859App.navigateParams.idLote;
        document.getElementById('rv-lote-input').value = id;
        await this.cargarResumenLote(id);
        const res = await isoFetch(`/api/iso2859/lotes/${encodeURIComponent(id)}`);
        if (res.ok) {
          const lote = await res.json();
          document.getElementById('rv-referencia').value = lote.referencia;
          document.getElementById('rv-cantidad').value = lote.cantidad_total;
          document.getElementById('rv-maquina').value = lote.maquina || '';
        }
      }, 100);
    }
  },

  buscarReferencias(valor) {
    clearTimeout(this._debounce);
    const val = valor.trim();
    const lista = document.getElementById('rv-ref-lista');
    if (val.length < 2) { lista.style.display = 'none'; return; }
    this._debounce = setTimeout(async () => {
      const res = await isoFetch(`/api/iso2859/catalogos/referencias?q=${encodeURIComponent(val)}`);
      const refs = await res.json();
      if (!refs || refs.length === 0) { lista.style.display = 'none'; return; }
      lista.innerHTML = refs.map(r => `
        <div class="autocomplete-item" onclick="Iso2859Revision.seleccionarReferencia('${escapeHtml(r.nombre)}')">
          <strong>${escapeHtml(r.nombre)}</strong><br><small>${escapeHtml(r.tipo_producto)}</small>
        </div>
      `).join('');
      lista.style.display = 'block';
    }, 250);
  },

  seleccionarReferencia(nombre) {
    document.getElementById('rv-referencia').value = nombre;
    document.getElementById('rv-ref-lista').style.display = 'none';
  },

  seleccionarLote(id, ref, cant, maq) {
    document.getElementById('rv-lote-input').value = id;
    document.getElementById('rv-referencia').value = ref;
    document.getElementById('rv-cantidad').value = cant;
    document.getElementById('rv-maquina').value = maq;
    document.getElementById('rv-autocomplete-list').style.display = 'none';
    this.cargarResumenLote(id);
  },

  async cargarResumenLote(idLote) {
    const res = await isoFetch(`/api/iso2859/lotes/${encodeURIComponent(idLote)}`);
    if (!res.ok) return;
    const lote = await res.json();

    const alertas = lote.muestreos.filter(m => m.decision === 'Alerta').length;
    const total = lote.muestreos.length;
    let html = `<div class="alert alert-info"><strong>Este lote ya existe.</strong><br>Total muestreos: ${total}`;
    if (alertas > 0) html += ` | <span style="color:#c53030">Alertas: ${alertas}</span>`;
    if (total > 0) {
      const ultimo = lote.muestreos[total - 1];
      html += `<br>Último: ${ultimo.tipo.replace(/_/g, ' ')} en ${escapeHtml(ultimo.area || '-')} por ${escapeHtml(ultimo.analista)} (${ultimo.decision})`;
    }
    html += '</div>';

    const div = document.getElementById('rv-resumen-lote');
    div.innerHTML = html;
    div.style.display = 'block';
  },

  verLoteExistente(idLote) {
    if (Iso2859App.modulo !== 'Produccion') Iso2859App.seleccionarModulo('Produccion');
    Iso2859App.navigate('nuevo-muestreo', { idLote });
  },
};
