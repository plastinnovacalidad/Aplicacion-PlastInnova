const Iso2859Lote = {
  renderNuevo() {
    const cont = document.getElementById('iso2859Content');
    cont.innerHTML = `
      <div class="card" style="max-width:640px; margin:0 auto; width:100%;">
        <h2>📦 Nuevo Lote - Recepción</h2>
        <form id="form-lote-iso">
          <div class="form-group">
            <label>Número de Lote *</label>
            <input type="text" id="li-id-lote" required placeholder="Ej: i2021000318">
          </div>
          <div class="form-group" style="position:relative;">
            <label>Referencia *</label>
            <input type="text" id="li-referencia" required placeholder="Escriba para buscar..." autocomplete="off" oninput="Iso2859Lote.buscarReferencias(this.value)">
            <div id="li-ref-lista" class="autocomplete-list" style="display:none;"></div>
          </div>
          <div class="form-group">
            <label>Cantidad Total (N) *</label>
            <input type="number" id="li-cantidad" required min="1">
          </div>
          <div class="form-group">
            <label>Proveedor</label>
            <input type="text" id="li-proveedor" placeholder="Ej: Plásticos del Norte S.A.">
          </div>
          <div class="form-group">
            <label>OC / Factura</label>
            <input type="text" id="li-oc" placeholder="Ej: OC-4521">
          </div>
          <div class="alert alert-info" id="li-preview-iso" style="display:none;"></div>
          <button type="submit" class="btn-primary" style="width:100%;">Iniciar Auditoría</button>
        </form>
      </div>
    `;

    let debounceCant;
    document.getElementById('li-cantidad').addEventListener('input', () => {
      clearTimeout(debounceCant);
      debounceCant = setTimeout(async () => {
        const cant = parseInt(document.getElementById('li-cantidad').value, 10);
        if (!cant) return;
        const res = await isoFetchJSON('/api/iso2859/muestreos/calcular-iso', { method: 'POST', body: JSON.stringify({ cantidad_lote: cant }) });
        if (!res.ok) return;
        const iso = await res.json();
        const preview = document.getElementById('li-preview-iso');
        preview.style.display = 'block';
        preview.innerHTML = `<strong>Plan que se aplicará:</strong><br>Nivel II | Letra ${iso.letra} | Muestra: ${iso.n}<br>Críticos: Ac ${iso.ac.critico}/Re ${iso.re.critico} | Mayores: Ac ${iso.ac.mayor}/Re ${iso.re.mayor} | Menores: Ac ${iso.ac.menor}/Re ${iso.re.menor}`;
      }, 300);
    });

    document.getElementById('form-lote-iso').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        id_lote: document.getElementById('li-id-lote').value.trim(),
        referencia: document.getElementById('li-referencia').value.trim(),
        modulo: 'Recepcion',
        cantidad_total: parseInt(document.getElementById('li-cantidad').value, 10),
        proveedor: document.getElementById('li-proveedor').value || null,
        oc_factura: document.getElementById('li-oc').value || null,
      };
      const res = await isoFetchJSON('/api/iso2859/lotes', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (res.ok) {
        alert(`Lote guardado. Plan: ${data.plan_actual || 'Normal'}`);
        Iso2859App.navigate('muestreo', { idLote: body.id_lote, tipo: 'Final' });
      } else {
        alert('Error: ' + (data.error || 'Desconocido'));
      }
    });
  },

  buscarReferencias(valor) {
    clearTimeout(this._debounce);
    const val = valor.trim();
    const lista = document.getElementById('li-ref-lista');
    if (val.length < 2) { lista.style.display = 'none'; return; }
    this._debounce = setTimeout(async () => {
      const res = await isoFetch(`/api/iso2859/catalogos/referencias?q=${encodeURIComponent(val)}`);
      const refs = await res.json();
      if (!refs || refs.length === 0) { lista.style.display = 'none'; return; }
      lista.innerHTML = refs.map(r => `
        <div class="autocomplete-item" onclick="Iso2859Lote.seleccionarReferencia('${escapeHtml(r.nombre)}')">
          <strong>${escapeHtml(r.nombre)}</strong><br><small>${escapeHtml(r.tipo_producto)}</small>
        </div>
      `).join('');
      lista.style.display = 'block';
    }, 250);
  },

  seleccionarReferencia(nombre) {
    document.getElementById('li-referencia').value = nombre;
    document.getElementById('li-ref-lista').style.display = 'none';
  },
};

document.addEventListener('click', (e) => {
  const lista = document.getElementById('li-ref-lista');
  if (lista && e.target.id !== 'li-referencia') lista.style.display = 'none';
});
