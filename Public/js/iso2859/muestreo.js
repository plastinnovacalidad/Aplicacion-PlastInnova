const Iso2859Muestreo = {
  async render(idLote, tipo, idRevision, prefill = {}) {
    if (tipo === 'Primera_Pieza') return this.renderPrimeraPieza(idLote, idRevision, prefill);
    if (tipo === 'En_Proceso') return this.renderEnProceso(idLote, idRevision, prefill);
    return this.renderFinal(idLote, idRevision, prefill);
  },

  // Búsqueda en vivo del catálogo de defectos (303 códigos, tabla pequeña:
  // se consulta al servidor en cada tecleo en vez de precargar todo el
  // catálogo de una sola vez, igual que se hace con referencias).
  //
  // Al elegir una sugerencia, el campo se llena con "CÓDIGO - descripción"
  // completo (no solo el código), para que quede claro qué se está
  // reportando sin tener que ir a buscarlo aparte. La severidad ya no se
  // muestra aquí (antes decía "(Menor)", etc.): en la Auditoría Final esa
  // severidad la calcula el sistema solo, como una "marca" aparte una vez
  // que se elige el código (ver actualizarMarca), en vez de pedirle al
  // inspector que la lea aquí y la clasifique él mismo a mano.
  //
  // _catalogoCache guarda lo que ya se consultó (codigo -> fila del
  // catálogo) para no volver a pedirlo al servidor si el código ya apareció
  // en una búsqueda anterior durante esta misma sesión de la página.
  buscarDefectos(input) {
    clearTimeout(this._debounceDef);
    const val = input.value.trim();
    if (val.length < 1) return;
    this._debounceDef = setTimeout(async () => {
      const res = await isoFetch(`/api/iso2859/catalogos/defectos?q=${encodeURIComponent(val)}`);
      const defs = await res.json();
      this._catalogoCache = this._catalogoCache || {};
      defs.forEach(d => { this._catalogoCache[d.codigo] = d; });
      const dl = document.getElementById('lista-defectos');
      if (dl) dl.innerHTML = defs.map(d => `<option value="${escapeHtml(this._etiquetaDefecto(d))}"></option>`).join('');
    }, 250);
  },

  // Arma "CÓDIGO - descripción" para mostrar en el buscador y para llenar
  // el campo al elegir una sugerencia. Algunos códigos del catálogo ya
  // traen el código repetido al inicio de la descripción (dato heredado de
  // la app original); en ese caso no se repite dos veces.
  _etiquetaDefecto(d) {
    const desc = (d.descripcion || d.area || '').trim();
    const yaTraeCodigo = desc.toUpperCase().startsWith(String(d.codigo).toUpperCase());
    return yaTraeCodigo ? desc : `${d.codigo} - ${desc}`;
  },

  // El campo puede tener solo el código (si lo escribieron a mano) o
  // "CÓDIGO - descripción" completo (si lo autocompletaron): en ambos casos
  // esto devuelve solo la parte del código, que es lo único que se manda al
  // servidor y lo único que existe como tal en el catálogo.
  _extraerCodigo(valor) {
    if (!valor) return '';
    const idx = valor.indexOf(' - ');
    return (idx === -1 ? valor : valor.slice(0, idx)).trim();
  },

  // Busca (con caché) la fila del catálogo para un código exacto, para
  // saber su severidad. Se usa al confirmar un código en un hallazgo de la
  // Auditoría Final.
  async _obtenerDelCatalogo(codigo) {
    this._catalogoCache = this._catalogoCache || {};
    if (this._catalogoCache[codigo]) return this._catalogoCache[codigo];
    const res = await isoFetch(`/api/iso2859/catalogos/defectos?q=${encodeURIComponent(codigo)}`);
    const defs = await res.json();
    defs.forEach(d => { this._catalogoCache[d.codigo] = d; });
    return this._catalogoCache[codigo] || null;
  },

  async renderPrimeraPieza(idLote, idRevision, prefill) {
    const cont = document.getElementById('iso2859Content');
    cont.innerHTML = `
      <div class="card" style="max-width:680px; margin:0 auto; width:100%;">
        <h2>✅ Primera Pieza</h2>
        <p><strong>Lote:</strong> ${escapeHtml(idLote)}</p>
        <p style="color:#718096;">Muestra: 3 unidades. Verifique dimensiones, aspecto visual y funcionalidad.</p>
        <form id="form-primera-iso">
          <div class="form-group">
            <label>Inspector</label>
            <input type="text" value="${escapeHtml(usuarioActual.nombre)}" readonly>
          </div>
          ${[1, 2, 3].map(i => `
            <div class="checklist-pieza">
              <h5>Pieza ${i}</h5>
              <label style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">
                <input type="checkbox" class="chk-dim" checked> Dimensiones OK
              </label>
              <label style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">
                <input type="checkbox" class="chk-asp" checked> Aspecto visual OK
              </label>
              <label style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">
                <input type="checkbox" class="chk-fun" checked> Funcionalidad OK
              </label>
              <div class="form-group" style="margin-bottom:0;">
                <input type="text" class="def-obs" placeholder="Observación (si aplica)" style="width:100%">
              </div>
            </div>
          `).join('')}
          <div class="form-group">
            <label>Observaciones generales</label>
            <textarea id="pp-obs"></textarea>
          </div>
          <div style="display:flex; gap:1rem;">
            <button type="submit" name="decision" value="Liberar" class="btn-success" style="flex:1; font-size:1.05rem;">LIBERAR</button>
            <button type="submit" name="decision" value="Rechazar" class="btn-danger" style="flex:1; font-size:1.05rem;">RECHAZAR</button>
            <button type="submit" name="decision" value="Reclasificar" class="btn-warning" style="flex:1; font-size:1.05rem;">RECLASIFICAR</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('form-primera-iso').addEventListener('submit', async (e) => {
      e.preventDefault();
      // Evita que dar clic varias veces seguidas al botón (o un doble clic
      // sin querer) mande el mismo muestreo dos o más veces al servidor —
      // antes nada bloqueaba un segundo envío mientras el primero todavía
      // estaba en camino. Un guardado exitoso deja los botones
      // deshabilitados a propósito (ya se navega a otra pantalla); solo se
      // reactivan si algo impidió guardar, para poder reintentar.
      const form = e.target;
      if (form.dataset.enviando === '1') return;
      form.dataset.enviando = '1';
      const botones = form.querySelectorAll('button[type="submit"]');
      botones.forEach(b => b.disabled = true);
      const reactivar = () => { form.dataset.enviando = '0'; botones.forEach(b => b.disabled = false); };

      const decision = e.submitter.value;
      const observaciones = document.getElementById('pp-obs').value || null;
      // Reclasificar cambia el destino de la pieza (por ejemplo, pasa a otra
      // referencia o uso en vez de liberarse o desecharse tal cual) — a
      // diferencia de Liberar/Rechazar, aquí sí hace falta explicar por qué,
      // así que se reutiliza el mismo campo de observaciones generales pero
      // se vuelve obligatorio solo en este caso.
      if (decision === 'Reclasificar' && !observaciones) {
        alert('Para reclasificar, escribe en "Observaciones generales" el motivo (a qué referencia o uso se reclasifica).');
        reactivar();
        return;
      }
      const body = {
        id_lote: idLote, tipo: 'Primera_Pieza', decision,
        cantidad_muestreada: 3,
        observaciones,
        turno: prefill.turno || null, area: prefill.area || null, operario: prefill.operario || null,
        defectos: [],
      };
      try {
        const res = await isoFetchJSON('/api/iso2859/muestreos', { method: 'POST', body: JSON.stringify(body) });
        if (res.ok) {
          // Rechazar Primera Pieza no es un veredicto final del lote (no hay
          // "estado" que cambiar, a diferencia de la Auditoría Final): lo
          // único que hace falta es dejarle muy claro al inspector que tiene
          // que repetir la Primera Pieza hasta que salga Liberada antes de
          // seguir adelante con este lote. No se bloquea nada en el sistema
          // (el inspector puede seguir registrando muestreos si hace falta),
          // es un recordatorio, no una traba.
          if (decision === 'Rechazar') {
            alert(`⚠️ Primera Pieza RECHAZADA.\n\nHay que repetir la Primera Pieza de este lote (${idLote}) hasta que salga Liberada antes de continuar.`);
          } else {
            alert(`Primera pieza: ${decision}`);
          }
          Iso2859App.navigate('dashboard');
        } else {
          alert('Error al guardar');
          reactivar();
        }
      } catch (err) {
        alert('No se pudo guardar (revisa tu conexión). Puedes intentar de nuevo.');
        reactivar();
      }
    });
  },

  async renderEnProceso(idLote, idRevision, prefill) {
    const cont = document.getElementById('iso2859Content');
    cont.innerHTML = `
      <div class="card" style="max-width:680px; margin:0 auto; width:100%;">
        <h2>⚠️ En Proceso</h2>
        <p><strong>Lote:</strong> ${escapeHtml(idLote)}</p>
        <p style="color:#718096;">Muestra: 5 unidades. Registre hallazgos y decida la acción.</p>
        <form id="form-proceso-iso">
          <div class="form-group">
            <label>Inspector</label>
            <input type="text" value="${escapeHtml(usuarioActual.nombre)}" readonly>
          </div>
          <div class="form-group">
            <label>Cantidad Muestreada</label>
            <input type="number" id="ep-cantidad" value="5" readonly>
          </div>
          <h4>Hallazgos</h4>
          <div id="ep-defectos-lista">
            <div class="form-group" style="display:flex;gap:0.5rem">
              <input type="text" class="def-codigo" placeholder="Escriba código de defecto..." list="lista-defectos" style="flex:1" oninput="Iso2859Muestreo.buscarDefectos(this)">
              <input type="number" class="def-cantidad" value="1" min="1" style="width:80px">
              <button type="button" onclick="this.parentElement.remove()">✕</button>
            </div>
          </div>
          <datalist id="lista-defectos"></datalist>
          <button type="button" onclick="Iso2859Muestreo.agregarDefecto('ep-defectos-lista')" class="btn-secondary" style="margin-bottom:1rem">+ Agregar defecto</button>

          <!-- Esto es aparte de la decisión sobre la máquina (Seguir/Alerta/
               Parar, más abajo): si hay hallazgos, aquí se anota qué se hizo
               con las piezas defectuosas en sí — separarlas para otro uso
               (reclasificar) o corregirlas (reparar). Se puede tener de las
               dos, o ninguna si no aplica. -->
          <h4>Piezas defectuosas: ¿qué se hizo con ellas?</h4>
          <div style="display:flex; gap:1rem; margin-bottom:1rem;">
            <div class="form-group" style="flex:1; margin-bottom:0;">
              <label>Piezas reclasificadas</label>
              <input type="number" id="ep-piezas-reclasificadas" value="0" min="0">
            </div>
            <div class="form-group" style="flex:1; margin-bottom:0;">
              <label>Piezas reparadas</label>
              <input type="number" id="ep-piezas-reparadas" value="0" min="0">
            </div>
          </div>

          <div class="form-group">
            <label>Observaciones</label>
            <textarea id="ep-obs"></textarea>
          </div>
          <div style="display:flex; gap:1rem;">
            <button type="submit" name="decision" value="Seguir" class="btn-success" style="flex:1">SEGUIR</button>
            <button type="submit" name="decision" value="Alerta" class="btn-warning" style="flex:1">ALERTA</button>
            <button type="submit" name="decision" value="Parar" class="btn-danger" style="flex:1">PARAR MÁQUINA</button>
          </div>
        </form>
      </div>
    `;

    document.getElementById('form-proceso-iso').addEventListener('submit', async (e) => {
      e.preventDefault();
      // Mismo resguardo contra doble envío que en Primera Pieza/Auditoría
      // Final (ver los comentarios allá): sin esto, dar clic varias veces
      // seguidas a "SEGUIR"/"ALERTA"/"PARAR MÁQUINA" mandaba el mismo
      // muestreo repetido al servidor.
      const form = e.target;
      if (form.dataset.enviando === '1') return;
      form.dataset.enviando = '1';
      const botones = form.querySelectorAll('button[type="submit"]');
      botones.forEach(b => b.disabled = true);
      const reactivar = () => { form.dataset.enviando = '0'; botones.forEach(b => b.disabled = false); };

      const decision = e.submitter ? e.submitter.value : 'Seguir';
      const defectos = [];
      document.querySelectorAll('#ep-defectos-lista > div').forEach(div => {
        const cod = this._extraerCodigo(div.querySelector('.def-codigo').value.trim());
        const cant = parseInt(div.querySelector('.def-cantidad').value, 10);
        if (cod) defectos.push({ codigo: cod, cantidad: cant });
      });

      const body = {
        id_lote: idLote, tipo: 'En_Proceso', decision,
        cantidad_muestreada: parseInt(document.getElementById('ep-cantidad').value, 10),
        observaciones: document.getElementById('ep-obs').value || null,
        turno: prefill.turno || null, area: prefill.area || null, operario: prefill.operario || null,
        defectos,
        piezas_reclasificadas: parseInt(document.getElementById('ep-piezas-reclasificadas').value, 10) || 0,
        piezas_reparadas: parseInt(document.getElementById('ep-piezas-reparadas').value, 10) || 0,
      };
      try {
        const res = await isoFetchJSON('/api/iso2859/muestreos', { method: 'POST', body: JSON.stringify(body) });
        if (res.ok) { alert('Muestreo guardado: ' + decision); Iso2859App.navigate('dashboard'); }
        else { alert('Error al guardar'); reactivar(); }
      } catch (err) {
        alert('No se pudo guardar (revisa tu conexión). Puedes intentar de nuevo.');
        reactivar();
      }
    });
  },

  async renderFinal(idLote, idRevision, prefill) {
    const cont = document.getElementById('iso2859Content');
    const resLote = await isoFetch(`/api/iso2859/lotes/${encodeURIComponent(idLote)}`);
    if (!resLote.ok) { cont.innerHTML = `<div class="card"><p style="color:#c53030;">Lote no encontrado.</p></div>`; return; }
    const lote = await resLote.json();
    const isoRes = await isoFetchJSON('/api/iso2859/muestreos/calcular-iso', { method: 'POST', body: JSON.stringify({ cantidad_lote: lote.cantidad_total }) });
    const plan = await isoRes.json();

    cont.innerHTML = `
      <div class="card" style="max-width:820px; margin:0 auto; width:100%;">
        <h2>📋 Auditoría Final ISO 2859</h2>
        <p><strong>Lote:</strong> ${escapeHtml(idLote)} | <strong>Ref:</strong> ${escapeHtml(lote.referencia)}</p>

        <div class="alert alert-info">
          <strong>ISO 2859-1</strong><br>
          Cantidad lote (N): ${lote.cantidad_total}<br>
          Nivel II | Letra código: <strong>${plan.letra}</strong><br>
          Tamaño muestra (n): <strong>${plan.n}</strong><br>
          <hr style="margin:0.5rem 0; border:none; border-top:1px solid #bee3f8;">
          CRÍTICOS: Ac ${plan.ac.critico} | Re ${plan.re.critico}<br>
          MAYORES: Ac ${plan.ac.mayor} | Re ${plan.re.mayor}<br>
          MENORES: Ac ${plan.ac.menor} | Re ${plan.re.menor}
        </div>

        <form id="form-final-iso"
              data-ac-crit="${plan.ac.critico}" data-re-crit="${plan.re.critico}"
              data-ac-may="${plan.ac.mayor}" data-re-may="${plan.re.mayor}"
              data-ac-men="${plan.ac.menor}" data-re-men="${plan.re.menor}">
          <div class="form-group">
            <label>Inspector</label>
            <input type="text" value="${escapeHtml(usuarioActual.nombre)}" readonly>
          </div>
          <div class="form-group">
            <label>Cantidad Muestreada</label>
            <input type="number" id="fi-cantidad" value="${plan.n}" readonly>
          </div>

          <h4>Hallazgos</h4>
          <p style="color:#718096; font-size:0.85rem; margin-top:-0.3rem;">Agrega el código del problema que sea; el sistema te marca al lado si es crítico, mayor o menor según el catálogo.</p>
          <div id="fi-hallazgos-lista"></div>
          <button type="button" onclick="Iso2859Muestreo.agregarHallazgo()" class="btn-secondary" style="width:100%; margin-top:0.3rem; margin-bottom:1rem;">+ Agregar hallazgo</button>

          <datalist id="lista-defectos"></datalist>

          <h4 style="margin-bottom:0.5rem;">Resultados del Muestreo</h4>
          <div style="display:flex; gap:0.6rem; margin-bottom:1rem;">
            <div id="fi-tile-crit" class="resultado-tile">
              <span class="resultado-num">0</span>
              <span class="resultado-label">Críticos</span>
            </div>
            <div id="fi-tile-may" class="resultado-tile">
              <span class="resultado-num">0</span>
              <span class="resultado-label">Mayores</span>
            </div>
            <div id="fi-tile-men" class="resultado-tile">
              <span class="resultado-num">0</span>
              <span class="resultado-label">Menores</span>
            </div>
          </div>
          <input type="hidden" id="fi-res-crit" value="0">
          <input type="hidden" id="fi-res-may" value="0">
          <input type="hidden" id="fi-res-men" value="0">

          <div class="form-group">
            <label>Observaciones generales</label>
            <textarea id="fi-obs"></textarea>
          </div>

          <div id="fi-veredicto-preview" class="veredicto-box aceptado" style="display:none;"></div>

          <button type="button" onclick="Iso2859Muestreo.calcularVeredicto()" class="btn-secondary" style="margin-bottom:1rem; width:100%;">Calcular Veredicto (vista previa)</button>
          <button type="submit" class="btn-primary" style="width:100%; font-size:1.05rem;">CONFIRMAR Y GUARDAR</button>
        </form>

        <div id="fi-cambio-plan" style="display:none; margin-top:1rem;"></div>
      </div>
    `;

    this.agregarHallazgo();

    document.getElementById('form-final-iso').addEventListener('submit', async (e) => {
      e.preventDefault();
      // Antes, dar clic varias veces seguidas a "CONFIRMAR Y GUARDAR"
      // (por ejemplo por la demora de la respuesta, o un doble clic sin
      // querer) mandaba el mismo veredicto dos o más veces al servidor,
      // creando auditorías duplicadas para el mismo lote. Ahora el botón se
      // deshabilita apenas se envía y, si el guardado sale bien, se queda
      // deshabilitado a propósito (el veredicto ya quedó guardado — de aquí
      // en adelante el inspector sigue con el cuadro de tratamiento o
      // navega a otra pantalla, nunca vuelve a enviar este mismo formulario).
      // Solo se reactiva si algo impidió guardar, para poder reintentar.
      const form = e.target;
      if (form.dataset.enviando === '1') return;
      form.dataset.enviando = '1';
      const btnGuardar = form.querySelector('button[type="submit"]');
      if (btnGuardar) btnGuardar.disabled = true;
      const reactivar = () => { form.dataset.enviando = '0'; if (btnGuardar) btnGuardar.disabled = false; };

      const defectos = [];
      // Cada hallazgo manda la severidad que el sistema le puso según el
      // catálogo de tipificación de defectos (la "marca" que aparece al
      // lado del código). El servidor usa esa severidad —y solo vuelve a
      // consultar el catálogo si por algún motivo llegara sin ella— para
      // calcular la decisión, así que mantener el catálogo bien clasificado
      // es lo que garantiza que la decisión sea correcta.
      let codigoSinClasificar = null;
      document.querySelectorAll('#fi-hallazgos-lista > .form-group').forEach(div => {
        const cod = div.querySelector('.h-codigo').value.trim();
        if (!cod) return;
        const cant = parseInt(div.querySelector('.h-cantidad').value, 10) || 1;
        const marca = div.querySelector('.h-marca');
        const severidad = marca ? marca.dataset.severidad : '';
        // Se manda el código tal como lo resolvió la marca (el código "puro"
        // del catálogo), no lo que esté escrito en el campo — que puede
        // traer también la descripción ("I1 - RAYADO").
        const codigoReal = (marca && marca.dataset.codigo) || this._extraerCodigo(cod);
        if (!severidad) { codigoSinClasificar = cod; return; }
        defectos.push({ codigo: codigoReal, cantidad: cant, severidad });
      });
      if (codigoSinClasificar) {
        alert(`El código "${codigoSinClasificar}" no está en el catálogo de defectos (o no tiene severidad asignada). Corrígelo o quítalo antes de guardar.`);
        reactivar();
        return;
      }

      const body = {
        id_lote: idLote, tipo: 'Final',
        cantidad_muestreada: parseInt(document.getElementById('fi-cantidad').value, 10),
        observaciones: document.getElementById('fi-obs').value || null,
        turno: prefill.turno || null, area: prefill.area || null, operario: prefill.operario || null,
        defectos,
      };
      try {
        // La decisión final la calcula siempre el servidor a partir de los
        // defectos (no se manda desde aquí): así nadie puede alterar el
        // veredicto de aceptación/rechazo manipulando el formulario.
        const res = await isoFetchJSON('/api/iso2859/muestreos', { method: 'POST', body: JSON.stringify(body) });
        const data = await res.json();
        if (res.ok) {
          if (data.decision === 'Rechazado') {
            // El veredicto de la fórmula de AQL no cambia (ya quedó guardado
            // tal cual se calculó), pero de inmediato se le pregunta a
            // Calidad qué destino le va a dar al lote, en vez de que tenga
            // que ir aparte al Historial a buscarlo.
            await this.preguntarTratamientoRechazo(idLote, lote.referencia, lote.plan_actual || 'Normal');
            return;
          }
          alert(`Auditoría final guardada. Decisión: ${data.decision}`);
          const cambiar = confirm('¿Desea cambiar el plan de muestreo para esta referencia?');
          if (cambiar) { this.mostrarCambioPlan(lote.referencia, lote.plan_actual || 'Normal'); return; }
          Iso2859App.navigate('dashboard');
        } else {
          alert('Error: ' + (data.error || 'Desconocido'));
          reactivar();
        }
      } catch (err) {
        alert('No se pudo guardar (revisa tu conexión). Puedes intentar de nuevo.');
        reactivar();
      }
    });
  },

  // Se muestra justo después de guardar una Auditoría Final que salió
  // Rechazada: en vez de mandar al inspector al Historial a buscar el lote
  // para reclasificarlo o repararlo, se pregunta ahí mismo. "Dejarlo
  // Rechazado tal cual" es una opción válida — no todo lote rechazado
  // necesita un tratamiento distinto, a veces simplemente se desecha.
  async preguntarTratamientoRechazo(idLote, referencia, planActual) {
    const cont = document.getElementById('iso2859Content');
    const card = document.createElement('div');
    card.className = 'card';
    card.style = 'max-width:680px; margin:1rem auto 0; width:100%; border:2px solid #c53030;';
    card.innerHTML = `
      <h3 style="color:#c53030;">❌ Lote ${escapeHtml(idLote)} RECHAZADO</h3>
      <p style="color:#718096;">El veredicto ya quedó guardado. ¿Qué se va a hacer con este lote?</p>
      <div style="display:flex; gap:1rem; margin-top:1rem;">
        <button type="button" class="btn-warning" style="flex:1;" id="btn-trat-reclasificar">🔄 Reclasificar</button>
        <button type="button" class="btn-secondary" style="flex:1; background:#e9d8fd; color:#553c9a;" id="btn-trat-reparar">🔧 Reparar</button>
        <button type="button" class="btn-secondary" style="flex:1;" id="btn-trat-dejar">Dejarlo Rechazado</button>
      </div>
    `;
    // Antes se ponía con cont.prepend(card) — quedaba arriba de todo el
    // formulario de Auditoría Final, así que si la pantalla estaba larga
    // (o ya se había hecho scroll hacia abajo, hacia el botón "CONFIRMAR Y
    // GUARDAR"), había que subir a buscarlo y no era obvio que ya había
    // aparecido. Ahora se agrega después del formulario (más cerca de
    // donde estaba el clic) y además se hace scroll hasta él, para que
    // salga a la vista sin que Calidad tenga que ir a buscarlo.
    cont.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const continuar = () => {
      card.remove();
      const cambiar = confirm('¿Desea cambiar el plan de muestreo para esta referencia?');
      if (cambiar) { this.mostrarCambioPlan(referencia, planActual); return; }
      Iso2859App.navigate('dashboard');
    };

    const aplicarTratamiento = async (tratamiento, etiqueta) => {
      const motivo = prompt(`¿A qué referencia, uso, o reparación se manda el lote ${idLote}? (obligatorio)`);
      if (motivo === null) return; // canceló, se queda en la misma pantalla
      if (!motivo.trim()) { alert('El motivo es obligatorio.'); return; }
      const res = await isoFetchJSON(`/api/iso2859/lotes/${encodeURIComponent(idLote)}/tratamiento`, {
        method: 'POST', body: JSON.stringify({ tratamiento, motivo: motivo.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { alert(`Lote marcado como ${etiqueta}.`); continuar(); }
      else alert('No se pudo cambiar el tratamiento: ' + (data.error || 'error desconocido'));
    };

    document.getElementById('btn-trat-reclasificar').addEventListener('click', () => aplicarTratamiento('Reclasificado', 'Reclasificado'));
    document.getElementById('btn-trat-reparar').addEventListener('click', () => aplicarTratamiento('Reparacion', 'En reparación'));
    document.getElementById('btn-trat-dejar').addEventListener('click', continuar);
  },

  agregarHallazgo() {
    const container = document.getElementById('fi-hallazgos-lista');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'form-group';
    div.style = 'display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem;';
    div.innerHTML = `
      <input type="text" class="h-codigo" placeholder="Código o descripción del problema..." list="lista-defectos"
             style="flex:2; font-size:0.9rem;" oninput="Iso2859Muestreo.buscarDefectos(this)" onchange="Iso2859Muestreo.actualizarMarca(this)">
      <input type="number" class="h-cantidad" value="1" min="1" style="width:65px; font-size:0.9rem;" onchange="Iso2859Muestreo.actualizarResumenFinal()">
      <span class="h-marca" style="min-width:112px; text-align:center; font-size:0.75rem; font-weight:700; padding:0.25rem 0.4rem; border-radius:4px; color:#a0aec0;">sin código</span>
      <button type="button" onclick="this.parentElement.remove(); Iso2859Muestreo.actualizarResumenFinal()" style="font-size:0.8rem; padding:0.2rem 0.5rem;">✕</button>
    `;
    container.appendChild(div);
  },

  // Se llama cuando se confirma un código en un hallazgo de la Auditoría
  // Final (al elegirlo de la lista o al salir del campo). Busca su
  // severidad en el catálogo y la muestra como una "marca" de color al
  // lado — el inspector ya no tiene que clasificar el hallazgo a mano.
  async actualizarMarca(input) {
    const fila = input.closest('.form-group');
    const marcaEl = fila ? fila.querySelector('.h-marca') : null;
    if (!marcaEl) return;
    const cod = this._extraerCodigo(input.value.trim());
    if (!cod) {
      marcaEl.textContent = 'sin código';
      marcaEl.style.color = '#a0aec0'; marcaEl.style.background = 'transparent';
      delete marcaEl.dataset.severidad;
      delete marcaEl.dataset.codigo;
      this.actualizarResumenFinal();
      return;
    }
    marcaEl.textContent = 'buscando...';
    marcaEl.style.color = '#a0aec0'; marcaEl.style.background = 'transparent';
    const info = await this._obtenerDelCatalogo(cod);
    const ESTILOS = {
      'Crítico': { color: '#c53030', background: '#fff5f5', texto: '🔴 CRÍTICO' },
      'Mayor': { color: '#dd6b20', background: '#fffaf0', texto: '🟠 MAYOR' },
      'Menor': { color: '#2b6cb0', background: '#ebf8ff', texto: '🔵 MENOR' },
    };
    const estilo = info && ESTILOS[info.severidad];
    if (estilo) {
      marcaEl.textContent = estilo.texto;
      marcaEl.style.color = estilo.color;
      marcaEl.style.background = estilo.background;
      marcaEl.dataset.severidad = info.severidad;
      marcaEl.dataset.codigo = info.codigo;
      // Si el inspector escribió solo el código a mano (sin autocompletar),
      // completamos el campo con "CÓDIGO - descripción" igual que si
      // hubiera elegido la sugerencia, para que siempre quede claro qué
      // defecto es sin tener que ir a buscarlo aparte.
      input.value = this._etiquetaDefecto(info);
    } else {
      delete marcaEl.dataset.codigo;
      marcaEl.textContent = '⚠ no encontrado';
      marcaEl.style.color = '#c53030';
      marcaEl.style.background = 'transparent';
      delete marcaEl.dataset.severidad;
    }
    this.actualizarResumenFinal();
  },

  // Suma, según la marca (severidad) de cada hallazgo agregado, los
  // "encontrados" por columna — reemplaza lo que antes el inspector
  // escribía a mano en esos 3 campos. También pinta las tarjetas de
  // "Resultados del Muestreo": en gris mientras el conteo es 0, y con el
  // color de su severidad (rojo para críticos, naranja mayores, azul
  // menores) en cuanto aparece al menos un hallazgo de ese tipo — para que
  // un crítico salte a la vista de inmediato.
  actualizarResumenFinal() {
    const container = document.getElementById('fi-hallazgos-lista');
    if (!container) return;
    const totales = { 'Crítico': 0, 'Mayor': 0, 'Menor': 0 };
    container.querySelectorAll('.form-group').forEach(div => {
      const marca = div.querySelector('.h-marca');
      const sev = marca ? marca.dataset.severidad : null;
      const cant = parseInt(div.querySelector('.h-cantidad').value, 10) || 0;
      if (sev && totales[sev] !== undefined) totales[sev] += cant;
    });

    const TILES = {
      crit: { total: totales['Crítico'], color: '#c53030', background: '#fff5f5', borde: '#feb2b2' },
      may: { total: totales['Mayor'], color: '#dd6b20', background: '#fffaf0', borde: '#fbd38d' },
      men: { total: totales['Menor'], color: '#2b6cb0', background: '#ebf8ff', borde: '#90cdf4' },
    };
    Object.keys(TILES).forEach(clave => {
      const { total, color, background, borde } = TILES[clave];
      const tile = document.getElementById(`fi-tile-${clave}`);
      if (!tile) return;
      tile.querySelector('.resultado-num').textContent = total;
      if (total > 0) {
        tile.style.background = background;
        tile.style.borderColor = borde;
        tile.querySelector('.resultado-num').style.color = color;
      } else {
        tile.style.background = '#f7fafc';
        tile.style.borderColor = '#e2e8f0';
        tile.querySelector('.resultado-num').style.color = '#a0aec0';
      }
      const hidden = document.getElementById(`fi-res-${clave}`);
      if (hidden) hidden.value = total;
    });
  },

  agregarDefecto(containerId) {
    const div = document.createElement('div');
    div.className = 'form-group';
    div.style = 'display:flex;gap:0.5rem';
    div.innerHTML = `
      <input type="text" class="def-codigo" placeholder="Escriba código de defecto..." list="lista-defectos" style="flex:1" oninput="Iso2859Muestreo.buscarDefectos(this)">
      <input type="number" class="def-cantidad" value="1" min="1" style="width:80px">
      <button type="button" onclick="this.parentElement.remove()">✕</button>
    `;
    document.getElementById(containerId).appendChild(div);
  },

  calcularVeredicto() {
    const form = document.getElementById('form-final-iso');
    if (!form) return;
    const acCrit = parseInt(form.dataset.acCrit, 10), reCrit = parseInt(form.dataset.reCrit, 10);
    const acMay = parseInt(form.dataset.acMay, 10), reMay = parseInt(form.dataset.reMay, 10);
    const acMen = parseInt(form.dataset.acMen, 10), reMen = parseInt(form.dataset.reMen, 10);
    const crit = parseInt(document.getElementById('fi-res-crit').value, 10) || 0;
    const may = parseInt(document.getElementById('fi-res-may').value, 10) || 0;
    const men = parseInt(document.getElementById('fi-res-men').value, 10) || 0;

    let decision = 'Aceptado', html = '';
    if (crit >= reCrit) { decision = 'Rechazado'; html = `❌ LOTE RECHAZADO<br>Críticos: ${crit} ≥ ${reCrit} (Re)`; }
    else if (may >= reMay) { decision = 'Rechazado'; html = `❌ LOTE RECHAZADO<br>Mayores: ${may} ≥ ${reMay} (Re)`; }
    else if (men >= reMen) { decision = 'Rechazado'; html = `❌ LOTE RECHAZADO<br>Menores: ${men} ≥ ${reMen} (Re)`; }
    else {
      html = `✅ LOTE ACEPTADO<br>Críticos: ${crit} ≤ ${acCrit} (Ac)<br>Mayores: ${may} ≤ ${acMay} (Ac)<br>Menores: ${men} ≤ ${acMen} (Ac)`;
    }

    const box = document.getElementById('fi-veredicto-preview');
    box.style.display = 'block';
    box.className = 'veredicto-box ' + (decision === 'Aceptado' ? 'aceptado' : 'rechazado');
    box.innerHTML = html + '<p style="font-size:0.75rem; font-weight:400; margin-top:0.5rem; opacity:0.8;">Vista previa: el servidor recalcula el veredicto final a partir de los defectos guardados.</p>';
  },

  async mostrarCambioPlan(referencia, planActual) {
    const container = document.getElementById('fi-cambio-plan');
    if (!container) return;
    container.style.display = 'block';

    const res = await isoFetch(`/api/iso2859/muestreos/sugerencia-plan/${encodeURIComponent(referencia)}?plan_actual=${encodeURIComponent(planActual)}`);
    const sugerencia = await res.json();

    container.innerHTML = `
      <div class="card" style="border:2px solid var(--brand-primary);">
        <h4>🔄 Cambiar Plan de Muestreo</h4>
        <p><strong>Referencia:</strong> ${escapeHtml(referencia)}</p>
        <p><strong>Plan actual:</strong> ${escapeHtml(planActual)}</p>
        <div class="alert alert-info">
          <strong>Sugerencia del sistema:</strong> ${escapeHtml(sugerencia.sugerencia)}<br>
          <em>${escapeHtml(sugerencia.motivo)}</em>
        </div>
        <div class="form-group">
          <label>Nuevo plan</label>
          <select id="cp-plan-nuevo">
            <option value="Normal" ${sugerencia.sugerencia === 'Normal' ? 'selected' : ''}>Normal</option>
            <option value="Reforzada" ${sugerencia.sugerencia === 'Reforzada' ? 'selected' : ''}>Reforzada</option>
            <option value="Reducida" ${sugerencia.sugerencia === 'Reducida' ? 'selected' : ''}>Reducida</option>
          </select>
        </div>
        <div class="form-group">
          <label>Justificación *</label>
          <textarea id="cp-justificacion" required placeholder="¿Por qué cambia el plan?"></textarea>
        </div>
        <button onclick="Iso2859Muestreo.guardarCambioPlan('${escapeHtml(referencia)}')" class="btn-primary">Guardar Cambio</button>
        <button onclick="document.getElementById('fi-cambio-plan').style.display='none'; Iso2859App.navigate('dashboard')" class="btn-secondary">Omitir</button>
      </div>
    `;
  },

  async guardarCambioPlan(referencia) {
    const planNuevo = document.getElementById('cp-plan-nuevo').value;
    const justificacion = document.getElementById('cp-justificacion').value.trim();
    if (!justificacion) { alert('La justificación es obligatoria'); return; }

    const res = await isoFetchJSON('/api/iso2859/muestreos/cambiar-plan', {
      method: 'POST', body: JSON.stringify({ referencia, plan_nuevo: planNuevo, justificacion }),
    });
    if (res.ok) { alert('Plan actualizado correctamente'); Iso2859App.navigate('dashboard'); }
    else alert('Error al cambiar el plan');
  },
};
