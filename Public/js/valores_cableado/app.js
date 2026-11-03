// ========================================================================
// Módulo "Valores y Cableado" — ficha de valores eléctricos medidos y
// configuración de cableado por referencia/color/versión de Circuitos SMD.
// Adaptado de la app aparte "circuitos-app" que Julio ya tenía funcionando
// (mismo diseño de panel oscuro tipo instrumento), pero ahora usando el
// login y los permisos del portal, y leyendo el mismo catálogo de
// referencia/versión/foto de circuito que ya usa Circuitos SMD (no hay
// catálogo duplicado).
// ========================================================================
const ValoresCableadoApp = (() => {
  const API = '/api/valores-cableado';

  // Mapeo de colores conocido (igual que en circuitos-app). Un color que no
  // esté en esta lista simplemente se muestra con su propio código y un
  // punto gris — no es un error, solo un color sin nombre bonito todavía.
  const COLOR_MAP = {
    'AH': { name: 'Azul Hielo', hex: '#a5d8ff' },
    'AM': { name: 'Amarillo', hex: '#facc15' },
    'RO': { name: 'Rojo', hex: '#ef4444' },
    'AZ': { name: 'Azul', hex: '#3b82f6' },
    'BL': { name: 'Blanco', hex: '#f8fafc' },
    'MO': { name: 'Morado', hex: '#a855f7' },
    'RS': { name: 'Rosado', hex: '#ec4899' },
    'VE': { name: 'Verde', hex: '#22c55e' },
    'UNICA': { name: 'Única', hex: '#94a3b8' },
  };

  let allData = [];
  let refsData = {};
  let selectedKey = null;
  let selectedVersion = null;
  let searchText = '';
  // Pestaña activa del panel de Observaciones/Recomendaciones (ver más abajo,
  // sección OBSERVACIONES / RECOMENDACIONES). Se recuerda acá afuera para que
  // no se resetee a "obs" cada vez que se repinta la ficha (por ejemplo al
  // cambiar de versión con los chips).
  let tabObsRec = 'obs';

  async function iniciar() {
    await cargarDatos();
    setupEventos();
  }

  async function cargarDatos() {
    try {
      const res = await fetch(`${API}/productos`, { headers: { 'Authorization': 'Bearer ' + token } });
      const json = await res.json();
      allData = json.data || [];
      construirSidebar();
    } catch (err) {
      console.error('Error cargando datos de Valores y Cableado:', err);
    }
  }

  // ========== SIDEBAR ==========
  // Lista plana tipo Circuitos SMD: cada ítem es una referencia+color
  // completa (su codigo_completo, ej. "SUP/0111/AM/MUL"), igual que allá,
  // en vez del árbol referencia→color que tenía antes. Las distintas
  // versiones de una misma referencia+color se siguen eligiendo dentro de
  // la ficha (chips de versión), no en esta lista.
  function construirSidebar() {
    const list = document.getElementById('vc-ref-list');
    list.innerHTML = '';

    const grupos = {};
    allData.forEach(p => {
      const key = p.codigo_completo || `${p.ref_base || 'SIN_REF'}/${p.color || 'SIN_COLOR'}`;
      if (!grupos[key]) grupos[key] = [];
      grupos[key].push(p);
    });
    refsData = grupos;

    const claves = Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'es'));
    const countEl = document.getElementById('vc-ref-count');
    if (countEl) countEl.textContent = claves.length;

    const filtradas = claves.filter(k => !searchText || k.toLowerCase().includes(searchText.toLowerCase()));

    if (filtradas.length === 0) {
      list.innerHTML = '<div style="padding:1rem; color:#999; font-size:0.85rem;">No hay referencias que coincidan con la búsqueda.</div>';
      return;
    }

    filtradas.forEach(key => {
      const productos = grupos[key];

      // Punto rojo — mismo patrón que "necesita prueba" en Circuitos SMD
      // (Public/smd.html, .prueba-dot): en vez de calcular esto en el
      // servidor, se reusan los datos que ya trajo /productos y se revisa
      // la versión que se vería de entrada (misma que elige mostrarFicha)
      // con la misma regla de la alerta "FALTAN VALORES".
      const versionPorDefecto = elegirVersionPorDefecto(productos);
      const faltanValores = contarCamposFaltantes(versionPorDefecto) > 0;

      const item = document.createElement('div');
      item.className = 'vc-ref-item' + (key === selectedKey ? ' active' : '');
      item.dataset.key = key;
      // El "N v." que antes aparecía acá (cantidad de versiones) se quitó
      // por pedido de Julio — el nombre de la referencia queda solo, y el
      // punto rojo (cuando aplica) es la única marca aparte del nombre.
      item.innerHTML = `
        <span class="vc-ref-name">${escapeHtml(key)}</span>
        ${faltanValores ? `<span class="vc-ref-dot" title="Le faltan valores"></span>` : ''}
      `;
      item.addEventListener('click', () => seleccionarClave(key));
      list.appendChild(item);
    });
  }

  function seleccionarClave(key) {
    selectedKey = key;
    selectedVersion = null;
    construirSidebar();
    mostrarFicha();
  }

  // Elige qué versión mostrar de entrada al abrir una ficha (el usuario
  // siempre puede cambiarla con los chips de versión). Antes se tomaba
  // simplemente productos[0]/versiones[0], que viene ordenado alfabéticamente
  // ("V1" antes que "V3") — así que si Julio cambiaba la foto en Circuitos
  // SMD sobre la versión más reciente, acá se seguía viendo la versión vieja
  // con su foto vieja, dando la impresión de que "en Valores no cambió".
  // Además, algunas referencias importadas de la app vieja de Valores y
  // Cableado quedaron con dos versiones marcadas "activa" a la vez (una es
  // la real de Circuitos SMD, con su foto; la otra es la que trajo esa
  // importación, sin foto) — por eso el criterio no es solo "la activa",
  // sino primero preferir la(s) activa(s) que sí tengan foto de circuito
  // cargada, y entre las que queden, la de número de versión más alto.
  function elegirVersionPorDefecto(productos) {
    const numeroDe = (v) => {
      const m = /(\d+)/.exec(v || '');
      return m ? parseInt(m[1], 10) : -Infinity;
    };
    const tieneFotoCircuito = (p) => (p.imagenes || []).some(i => i.tipo === 'circuito');
    const masAlta = (lista) => lista.reduce((mejor, p) => numeroDe(p.version) > numeroDe(mejor.version) ? p : mejor, lista[0]);

    const activas = productos.filter(p => p.estado === 'activa');
    const base = activas.length > 0 ? activas : productos;
    const conFoto = base.filter(tieneFotoCircuito);
    return masAlta(conFoto.length > 0 ? conFoto : base);
  }

  // Cuántos campos de la ficha le faltan a una versión — misma regla que la
  // alerta "⚠️ FALTAN VALORES" de la ficha (ver mostrarFicha más abajo),
  // pero como función aparte para poder reusarla también en la lista de la
  // izquierda (el punto rojo, ver construirSidebar). Los 4 campos de
  // "Medias (Bajas)" no cuentan si la versión tiene marcado que no aplican.
  const CAMPOS_MEDIAS_BAJAS = ['amperaje_medias', 'potencia_medias', 'amperaje_min_medias', 'potencia_min_medias'];

  // ========== TIPO DE CIRCUITO (ver MIGRACIÓN #51 en db/init.js) ==========
  // Cada prueba es una combinación de cables: Bajas = blanco + azul, Altas =
  // se le suma el rojo, y cada variante agrega sus propios cables (amarillo
  // = cambio de color en bicolor / direccional en stop, negro = stop). La
  // variante principal ('p') usa los campos de siempre; las demás vienen
  // como "<variante>_<prueba>_<funcion>_<medida>" (ver data/valoresCableado.js).
  const VARIANTES_POR_TIPO_VC = {
    normal: [{ k: 'p', n: 'Principal', extra: [] }],
    bicolor: [{ k: 'p', n: 'Color 1', extra: [] }, { k: 'color2', n: 'Color 2', extra: ['amarillo'] }],
    stop: [{ k: 'p', n: 'Principal', extra: [] }, { k: 'stop', n: 'Stop', extra: ['negro'] }, { k: 'direccional', n: 'Direccional', extra: ['negro', 'amarillo'] }],
  };
  const CAMPO_PRINCIPAL_VC = {
    rev_bajas_amperaje: 'amperaje_medias', rev_bajas_potencia: 'potencia_medias',
    rev_altas_amperaje: 'amperaje_altas', rev_altas_potencia: 'potencia_altas',
    min_bajas_amperaje: 'amperaje_min_medias', min_bajas_potencia: 'potencia_min_medias',
    min_altas_amperaje: 'amperaje_min_altas', min_altas_potencia: 'potencia_min_altas',
    max_altas_amperaje: 'amperaje_max', max_altas_potencia: 'potencia_max',
  };
  const NOMBRES_CABLE_VC = { blanco: 'Blanco', azul: 'Azul', rojo: 'Rojo', amarillo: 'Amarillo', negro: 'Negro' };
  const variantesDe = (p) => VARIANTES_POR_TIPO_VC[p.tipo_circuito] || VARIANTES_POR_TIPO_VC.normal;
  const valorPrueba = (p, variante, prueba, funcion, medida) => {
    const k = `${prueba}_${funcion}_${medida}`;
    return variante === 'p' ? p[CAMPO_PRINCIPAL_VC[k]] : p[`${variante}_${k}`];
  };
  const cablesDePrueba = (funcion, va) => ['blanco', 'azul', ...(funcion === 'altas' ? ['rojo'] : []), ...va.extra];

  function contarCamposFaltantes(p) {
    const noAplicaMedias = (p.no_aplica_medias === 1 || p.no_aplica_medias === true || p.no_aplica_medias === '1');
    const campos = [
      'voltaje_revision', 'amperaje_altas', 'potencia_altas',
      'voltaje_min', 'amperaje_min_altas', 'potencia_min_altas',
      'voltaje_max', 'amperaje_max', 'potencia_max',
      'cortar_puntas', 'posicion_punto', 'empujar_cables', 'forma_cableado', 'referencia_cable',
      ...(noAplicaMedias ? [] : CAMPOS_MEDIAS_BAJAS),
    ];
    const vacio = (v) => v === null || v === undefined || v === '';
    let faltan = campos.filter(c => vacio(p[c])).length;
    // Variantes extra del tipo de circuito (Color 2, Stop, Direccional):
    // cuentan igual que las de la principal (Máximo solo Altas; Bajas no
    // cuenta si la versión no maneja medias).
    for (const va of variantesDe(p)) {
      if (va.k === 'p') continue;
      for (const prueba of ['rev', 'min', 'max']) {
        for (const funcion of ['bajas', 'altas']) {
          if (funcion === 'bajas' && (prueba === 'max' || noAplicaMedias)) continue;
          for (const medida of ['amperaje', 'potencia']) {
            if (vacio(valorPrueba(p, va.k, prueba, funcion, medida))) faltan++;
          }
        }
      }
    }
    return faltan;
  }

  // ========== FICHA ==========
  function mostrarFicha() {
    const main = document.getElementById('vc-main-panel');
    if (!selectedKey || !refsData[selectedKey]) {
      main.innerHTML = `
        <div class="vc-empty-state">
          <div class="vc-empty-icon">⚡</div>
          <h2>Selecciona una referencia</h2>
          <p>Elige una referencia del panel izquierdo para ver su ficha de valores y cableado</p>
        </div>`;
      return;
    }

    const productos = refsData[selectedKey];

    if (productos.length === 0) {
      main.innerHTML = `<div class="vc-empty-state"><h2>Sin datos para esta selección</h2></div>`;
      return;
    }

    const versiones = [...new Set(productos.map(p => p.version).filter(Boolean))];
    let currentProduct = productos[0];
    if (selectedVersion && versiones.includes(selectedVersion)) {
      const found = productos.find(p => p.version === selectedVersion);
      if (found) currentProduct = found;
    } else if (versiones.length > 0) {
      currentProduct = elegirVersionPorDefecto(productos);
      selectedVersion = currentProduct.version;
    }

    const p = currentProduct;

    // ==================== ALERTA DE VALORES FALTANTES ====================
    // Julio pidió una alerta roja flotante, mismo estilo que "⚠️ NECESITA
    // PRUEBA" en Circuitos SMD, cuando a esta ficha le falte cualquiera de
    // sus campos — así se nota de una vez que la referencia está incompleta,
    // sin tener que revisar campo por campo. Cuenta TODOS los campos de la
    // ficha (eléctricos y de cableado), no solo los eléctricos.
    //
    // Los 4 campos de "Medias (Bajas)" son la excepción: algunas referencias
    // no los manejan por diseño (solo Altas). Cuando la versión tiene
    // marcado "no_aplica_medias" (ver Editar Referencia), esos 4 campos se
    // sacan de la cuenta de faltantes y se muestran como "N/A" más abajo en
    // vez de contar como un campo sin llenar.
    const noAplicaMedias = (p.no_aplica_medias === 1 || p.no_aplica_medias === true || p.no_aplica_medias === '1');
    const camposFaltantes = contarCamposFaltantes(p);

    const imgs = p.imagenes || [];
    const imgCircuito = imgs.find(i => i.tipo === 'circuito');
    const imgCableado = imgs.find(i => i.tipo === 'cableado');

    const fmt = (v) => (v !== null && v !== undefined && v !== '' ? escapeHtml(String(v)) : '—');
    const fmtNum = (v) => {
      if (v === null || v === undefined || v === '') return '—';
      const str = String(v).trim();
      if (/^-?\d+(\.\d+)?$/.test(str)) {
        const n = parseFloat(str);
        return n.toFixed(n % 1 === 0 ? 0 : 2);
      }
      // Rango "min-max" guardado como texto (ej. "65-115", muy común en
      // amperaje/potencia). Antes esto caía al parseFloat de abajo, que
      // solo lee el primer número y descarta el resto en silencio —
      // "65-115" se mostraba como "65", perdiendo el máximo del rango.
      const rango = str.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
      if (rango) {
        const a = parseFloat(rango[1]);
        const b = parseFloat(rango[2]);
        return `${a.toFixed(a % 1 === 0 ? 0 : 2)}-${b.toFixed(b % 1 === 0 ? 0 : 2)}`;
      }
      return escapeHtml(str);
    };
    const boolVal = (v) => {
      // Antes null/undefined (campo nunca configurado) caía al mismo "NO ✗"
      // que un false real, dando a entender que alguien SÍ revisó ese campo
      // y decidió que era "no" — en vez de mostrar que todavía no se ha
      // definido.
      if (v === null || v === undefined || v === '') return '—';
      if (v === 1 || v === true || v === '1' || v === 'true') return `<span class="vc-val-yes">SÍ ✓</span>`;
      return `<span class="vc-val-no">NO <span class="vc-x-red">✗</span></span>`;
    };
    // ==================== CUADROS NEGROS (Revisión / Mínimo / Máximo) ====================
    // Julio escogió la "idea A" de la maqueta: los 3 cuadros de siempre, cada
    // uno con una tabla adentro — un renglón por prueba (variante + Bajas/
    // Altas) con los puntos de colores de los cables que hay que conectar.
    // Todo va en columnas fijas (nombre | corriente | potencia) para que los
    // números siempre queden en el mismo lugar, y los renglones salen en el
    // mismo orden en los 3 cuadros para compararlos en horizontal. Lo que no
    // aplica o no tiene valores queda en negro (oculto) pero conserva su
    // espacio, para que lo demás no se mueva:
    //  - Bajas no se muestra si la versión "no maneja medias".
    //  - Prueba Máximo solo se hace en Altas.
    //  - Un renglón sin corriente ni potencia queda en negro.
    const tieneValor = (v) => v !== null && v !== undefined && String(v).trim() !== '';
    const variantes = variantesDe(p);
    const variasVariantes = variantes.length > 1;
    const puntosCables = (cables) => `<span class="vc-cables">${cables.map(c => `<i class="vc-cable vc-cable-${c}" title="${NOMBRES_CABLE_VC[c]}"></i>`).join('')}</span>`;
    // Si un campo viejo trae dos rangos juntos (ej. "85-125 95-135"), cada
    // uno va en su propia línea en vez de partirse donde caiga.
    const valorCelda = (v) => {
      if (!tieneValor(v)) return '<span class="vc-val">—</span>';
      const partes = String(v).trim().split(/\s+/);
      if (partes.length === 1) return `<span class="vc-val">${fmtNum(partes[0])}</span>`;
      return `<span class="vc-val vc-val-varios">${partes.map(x => `<span>${fmtNum(x)}</span>`).join('')}</span>`;
    };
    const renglonPrueba = (prueba, funcion, va) => {
      const amp = valorPrueba(p, va.k, prueba, funcion, 'amperaje');
      const pot = valorPrueba(p, va.k, prueba, funcion, 'potencia');
      const oculto = (funcion === 'bajas' && (prueba === 'max' || noAplicaMedias)) || (!tieneValor(amp) && !tieneValor(pot));
      const nombre = variasVariantes ? va.n : (funcion === 'bajas' ? 'Bajas' : 'Altas');
      return `
                <div class="vc-prueba-ln"${oculto ? ' style="visibility:hidden" aria-hidden="true"' : ''}>
                  <span class="vc-prueba-tag">${puntosCables(cablesDePrueba(funcion, va))}<span class="vc-prueba-nombre">${escapeHtml(nombre)}</span></span>
                  ${valorCelda(amp)}
                  ${valorCelda(pot)}
                </div>`;
    };
    const cuadroDisplay = (clase, titulo, prueba, voltaje) => `
            <div class="vc-display-box ${clase}">
              <div class="vc-display-title">${titulo}</div>
              <div class="vc-display-volt"${tieneValor(voltaje) ? '' : ' style="visibility:hidden" aria-hidden="true"'}>
                <span class="vc-lbl">Voltage</span><span class="vc-val">${fmtNum(voltaje)}</span><span class="vc-unit">V</span>
              </div>
              <div class="vc-display-section">
                <div class="vc-prueba-cab"><span>Prueba</span><span>Current (mA)</span><span>Power (W)</span></div>
                ${['bajas', 'altas'].map(funcion => `
                <div class="vc-prueba-grupo">
                  ${variasVariantes ? `<div class="vc-display-section-label"${funcion === 'bajas' && (prueba === 'max' || noAplicaMedias) ? ' style="visibility:hidden"' : ''}>═══ ${funcion === 'bajas' ? 'Bajas' : 'Altas'} ═══</div>` : ''}
                  ${variantes.map(va => renglonPrueba(prueba, funcion, va)).join('')}
                </div>`).join('')}
              </div>
            </div>`;

    // ==================== OBSERVACIONES / RECOMENDACIONES ====================
    // Julio pidió lo mismo que ya existe en Circuitos SMD: una nota general
    // de la referencia (Observaciones, una sola por referencia, la puede
    // editar quien tenga el permiso) y un hilo de mensajes cortos
    // (Recomendaciones, cualquiera con permiso de crear puede enviar uno,
    // pero solo ve los que él mismo envió a menos que tenga el permiso de
    // "ver todas" — esa regla ya la aplica el backend, acá solo se respeta
    // el resultado). Usa los MISMOS permisos y los MISMOS endpoints que
    // Circuitos SMD (observaciones.ver/editar, recomendaciones.ver/crear/
    // eliminar) porque es la misma referencia (mismo codigo_base) — no hace
    // falta duplicar nada.
    const puedeVerObs = tienePermiso('observaciones.ver');
    const puedeEditarObs = tienePermiso('observaciones.editar');
    const puedeVerRec = tienePermiso('recomendaciones.ver') || tienePermiso('recomendaciones.crear');
    const puedeCrearRec = tienePermiso('recomendaciones.crear');
    const puedeEliminarRec = tienePermiso('recomendaciones.eliminar');
    const mostrarObsRec = puedeVerObs || puedeVerRec;
    // Si la pestaña recordada ya no aplica (por ejemplo el usuario perdió el
    // permiso, o nunca lo tuvo), cae a la primera pestaña disponible.
    if (tabObsRec === 'obs' && !puedeVerObs) tabObsRec = puedeVerRec ? 'rec' : 'obs';
    if (tabObsRec === 'rec' && !puedeVerRec) tabObsRec = puedeVerObs ? 'obs' : 'rec';

    const obsRecHtml = !mostrarObsRec ? '' : `
      <div class="vc-obsrec-card">
        <div class="vc-obsrec-tabs">
          ${puedeVerObs ? `<button type="button" class="vc-obsrec-tab${tabObsRec === 'obs' ? ' active' : ''}" data-vctab="obs">📋 Observaciones</button>` : ''}
          ${puedeVerRec ? `<button type="button" class="vc-obsrec-tab${tabObsRec === 'rec' ? ' active' : ''}" data-vctab="rec">📝 Recomendaciones</button>` : ''}
        </div>
        ${puedeVerObs ? `
        <div class="vc-obsrec-content${tabObsRec === 'obs' ? ' active' : ''}" id="vc-content-obs">
          <textarea class="vc-obs-textarea" id="vc-obs-textarea" placeholder="No hay observaciones para esta referencia..."${puedeEditarObs ? '' : ' readonly'}></textarea>
          <div class="vc-obs-meta" id="vc-obs-meta"></div>
          <div class="vc-obs-actions" id="vc-obs-actions">
            ${puedeEditarObs ? `<button type="button" class="vc-btn-enviar" id="vc-btn-guardar-obs">💾 Guardar observación</button>` : ''}
          </div>
        </div>` : ''}
        ${puedeVerRec ? `
        <div class="vc-obsrec-content${tabObsRec === 'rec' ? ' active' : ''}" id="vc-content-rec">
          <div class="vc-rec-lista" id="vc-rec-lista"><div class="vc-rec-empty">Cargando…</div></div>
          ${puedeCrearRec ? `
          <div class="vc-rec-form">
            <textarea class="vc-rec-textarea" id="vc-rec-input" placeholder="Escribe una recomendación..."></textarea>
            <div class="vc-rec-actions"><button type="button" class="vc-btn-enviar" id="vc-btn-enviar-rec">Enviar recomendación</button></div>
          </div>` : ''}
        </div>` : ''}
      </div>
    `;

    // Julio pidió quitar el título/subtítulo que repetía la referencia acá
    // arriba de las fotos ("⚡ 0111 — Am — V4" / "SUP/0111/Am/Mul") — es
    // redundante con la referencia que ya está seleccionada y resaltada en
    // el panel de la izquierda, y así se gana espacio en pantalla. Los
    // chips de versión SÍ se conservan (no son solo un encabezado, sirven
    // para cambiar de versión) — el bloque completo del header ahora solo
    // aparece cuando hay más de una versión que elegir.
    const fichaHeaderHtml = versiones.length <= 1 ? '' : `
      <div class="vc-ficha-header">
        <div class="vc-version-chips">
          ${versiones.map(v => `
            <button type="button" class="vc-version-chip ${v === selectedVersion ? 'active' : ''}" data-version="${escapeHtml(v)}">${escapeHtml(v)}</button>
          `).join('')}
        </div>
      </div>
    `;

    main.innerHTML = `
      <div class="vc-ficha">
        ${fichaHeaderHtml}

        <!-- Alerta flotante de valores faltantes — mismo estilo que
             "⚠️ NECESITA PRUEBA" en Circuitos SMD. Vive fuera de
             .vc-ficha-scroll para quedar siempre visible aunque se
             desplace hacia abajo. -->
        <div class="vc-alerta-badge${camposFaltantes > 0 ? ' visible' : ''}">
          <span>⚠️ FALTAN ${camposFaltantes} VALOR${camposFaltantes === 1 ? '' : 'ES'}</span>
        </div>

        <div class="vc-ficha-scroll">
          <!-- Orden pedido por Julio: primero las especificaciones de
               cableado, luego las fotos, luego los valores y al final
               observaciones/recomendaciones. -->
          <div class="vc-specs-card">
            <div class="vc-specs-header">⚙️ Especificaciones de Cableado</div>
            <div class="vc-specs-grid">
              <div class="vc-cell"><label>Cortar Puntas</label><div class="vc-val">${boolVal(p.cortar_puntas)}</div></div>
              <div class="vc-cell"><label>Referencia Cable</label><div class="vc-val">${fmt(p.referencia_cable)}</div></div>
              <div class="vc-cell"><label>Posición Punto</label><div class="vc-val">${fmt(p.posicion_punto)}</div></div>
              <div class="vc-cell"><label>Empujar Cables</label><div class="vc-val">${boolVal(p.empujar_cables)}</div></div>
            </div>
          </div>

          <div class="vc-fotos-row">
            <div class="vc-foto-box" id="vc-foto-circuito">
              <div class="vc-foto-content" id="vc-foto-circuito-content">
                ${imgCircuito ? `<span class="vc-foto-placeholder">Cargando…</span>` : '<span class="vc-foto-placeholder">Sin imagen de circuito</span>'}
              </div>
            </div>
            <div class="vc-foto-box" id="vc-foto-cableado">
              <div class="vc-foto-content" id="vc-foto-cableado-content">
                ${imgCableado ? `<span class="vc-foto-placeholder">Cargando…</span>` : '<span class="vc-foto-placeholder">Sin imagen de cableado</span>'}
              </div>
            </div>
          </div>

          <div class="vc-displays-row">
            ${cuadroDisplay('green', '🔧 Revisión (14V)', 'rev', p.voltaje_revision)}
            ${cuadroDisplay('blue', '🔽 Prueba Mínimo', 'min', p.voltaje_min)}
            ${cuadroDisplay('orange', '🔼 Prueba Máximo', 'max', p.voltaje_max)}
          </div>

          ${obsRecHtml}

          <!-- La tarjeta de Auditoría de Cambios que estuvo acá brevemente
               se quitó: Julio pidió que ese historial se vea centralizado en
               "Crear Referencia" (Public/referencias.html, que ya sirve a
               Circuitos SMD y a Valores y Cableado), no repetido en cada
               pantalla de trabajo del día a día. -->
        </div>
      </div>
    `;

    main.querySelectorAll('.vc-version-chip').forEach(btn => {
      btn.addEventListener('click', () => cambiarVersion(btn.dataset.version));
    });

    if (imgCircuito) cargarFotoCircuito(imgCircuito.version_id);
    if (imgCableado) cargarFotoCableado(imgCableado.forma_cableado);

    if (mostrarObsRec) {
      wireObsRecPanel();
      if (puedeVerObs) cargarObservacionesVC();
      if (puedeVerRec) cargarRecomendacionesVC(puedeEliminarRec);
    }
  }

  // ========== OBSERVACIONES / RECOMENDACIONES ==========
  // Igual que en Circuitos SMD (Public/smd.html), pero apuntando a
  // "selectedKey" (que es el mismo codigo_completo === codigo_base de la
  // referencia) en vez de "referenciaActiva". No cambian al cambiar de
  // versión (chips) porque Observaciones/Recomendaciones son por referencia
  // completa, no por versión — por eso mostrarFicha() las vuelve a pedir
  // cada vez que se repinta (cambio de versión incluido), pero siempre
  // devuelven lo mismo mientras "selectedKey" no cambie.
  function irATabObsRec(tab) {
    tabObsRec = tab;
    document.querySelectorAll('.vc-obsrec-tab').forEach(b => b.classList.toggle('active', b.dataset.vctab === tab));
    document.querySelectorAll('.vc-obsrec-content').forEach(c => c.classList.remove('active'));
    const content = document.getElementById(tab === 'obs' ? 'vc-content-obs' : 'vc-content-rec');
    if (content) content.classList.add('active');
  }

  function wireObsRecPanel() {
    document.querySelectorAll('.vc-obsrec-tab').forEach(btn => {
      btn.addEventListener('click', () => irATabObsRec(btn.dataset.vctab));
    });
    const btnGuardarObs = document.getElementById('vc-btn-guardar-obs');
    if (btnGuardarObs) btnGuardarObs.addEventListener('click', guardarObservacionVC);
    const btnEnviarRec = document.getElementById('vc-btn-enviar-rec');
    if (btnEnviarRec) btnEnviarRec.addEventListener('click', enviarRecomendacionVC);
  }

  async function cargarObservacionesVC() {
    if (!selectedKey) return;
    const claveEnCurso = selectedKey;
    const textarea = document.getElementById('vc-obs-textarea');
    const meta = document.getElementById('vc-obs-meta');
    if (!textarea) return;
    try {
      const res = await fetch('/api/observaciones/' + encodeURIComponent(selectedKey), {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      // Si el usuario ya cambió de referencia mientras esperábamos esta
      // respuesta, no la pintamos — igual que en smd.html.
      if (selectedKey !== claveEnCurso) return;
      if (res.status === 403) { textarea.value = ''; if (meta) meta.textContent = ''; return; }
      const data = await res.json();
      if (selectedKey !== claveEnCurso) return;
      if (data.observacion) {
        textarea.value = data.observacion.observacion || '';
        const fecha = data.observacion.actualizado_en
          ? new Date(data.observacion.actualizado_en).toLocaleString('es-ES')
          : '';
        const autor = data.observacion.actualizado_por_nombre || '';
        if (meta) meta.textContent = fecha ? `Última actualización: ${fecha}${autor ? ' por ' + autor : ''}` : '';
      } else {
        textarea.value = '';
        if (meta) meta.textContent = '';
      }
    } catch (e) {
      if (selectedKey !== claveEnCurso) return;
      textarea.value = '';
      if (meta) meta.textContent = '';
    }
  }

  async function guardarObservacionVC() {
    if (!selectedKey) return;
    const textarea = document.getElementById('vc-obs-textarea');
    const btn = document.getElementById('vc-btn-guardar-obs');
    if (!textarea || !btn) return;
    const texto = textarea.value;
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      const res = await fetch('/api/observaciones/' + encodeURIComponent(selectedKey), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ observacion: texto })
      });
      if (res.ok) {
        await cargarObservacionesVC();
      } else {
        const err = await res.json().catch(() => ({}));
        alert('Error: ' + (err.error || 'No se pudo guardar'));
      }
    } catch (e) {
      alert('Error de conexión: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = '💾 Guardar observación';
    }
  }

  async function cargarRecomendacionesVC(puedeEliminarRec) {
    if (!selectedKey) return;
    const claveEnCurso = selectedKey;
    const listaContainer = document.getElementById('vc-rec-lista');
    if (!listaContainer) return;
    try {
      const res = await fetch('/api/recomendaciones/' + encodeURIComponent(selectedKey), {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (selectedKey !== claveEnCurso) return;
      if (res.status === 403) { listaContainer.innerHTML = '<div class="vc-rec-empty">No tienes permiso para ver recomendaciones.</div>'; return; }
      const data = await res.json();
      if (selectedKey !== claveEnCurso) return;
      const lista = data.recomendaciones || [];
      if (lista.length === 0) { listaContainer.innerHTML = '<div class="vc-rec-empty">No hay recomendaciones para esta referencia.</div>'; return; }
      let html = '<div class="vc-rec-list">';
      lista.forEach(rec => {
        const fecha = new Date(rec.fecha).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const deleteBtn = puedeEliminarRec ? `<button type="button" class="vc-rec-bubble-delete" title="Eliminar">×</button>` : '';
        html += `<div class="vc-rec-bubble" data-recid="${rec.id}">${deleteBtn}<div class="vc-rec-bubble-header"><span class="vc-rec-bubble-author">${escapeHtml(rec.autor)}</span><span class="vc-rec-bubble-date">${fecha}</span></div><div class="vc-rec-bubble-text">${escapeHtml(rec.recomendacion)}</div></div>`;
      });
      html += '</div>';
      listaContainer.innerHTML = html;
      if (puedeEliminarRec) {
        listaContainer.querySelectorAll('.vc-rec-bubble-delete').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const bubble = btn.closest('.vc-rec-bubble');
            borrarRecomendacionVC(parseInt(bubble.dataset.recid, 10));
          });
        });
      }
    } catch (e) {
      if (selectedKey !== claveEnCurso) return;
      listaContainer.innerHTML = '<div class="vc-rec-empty">Error al cargar recomendaciones.</div>';
    }
  }

  async function enviarRecomendacionVC() {
    if (!selectedKey) return;
    const input = document.getElementById('vc-rec-input');
    const btn = document.getElementById('vc-btn-enviar-rec');
    if (!input || !btn) return;
    const texto = input.value.trim();
    if (!texto) { alert('Escribe una recomendación'); return; }
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
      const res = await fetch('/api/recomendacion', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ referencia: selectedKey, recomendacion: texto })
      });
      if (res.ok) {
        input.value = '';
        await cargarRecomendacionesVC(tienePermiso('recomendaciones.eliminar'));
      } else {
        const err = await res.json().catch(() => ({}));
        alert('Error: ' + (err.error || 'Error al guardar'));
      }
    } catch (e) {
      alert('Error de conexión: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Enviar recomendación';
    }
  }

  async function borrarRecomendacionVC(id) {
    if (!confirm('¿Seguro que quieres eliminar esta recomendación?')) return;
    try {
      const res = await fetch('/api/recomendacion/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
      if (res.ok) await cargarRecomendacionesVC(true);
      else { const err = await res.json().catch(() => ({})); alert('Error: ' + (err.error || 'No se pudo eliminar')); }
    } catch (e) { alert('Error de conexión'); }
  }

  // La foto de circuito viene protegida (con marca de agua del nombre de
  // quien la ve), igual que en Circuitos SMD — no es un <img src> directo,
  // hay que pedirla autenticado y el servidor devuelve un data: URL. Solo se
  // toca el "content" interno de la caja, para no perder el botón de editar
  // (Crear Referencia) que va al lado.
  async function cargarFotoCircuito(versionId) {
    const content = document.getElementById('vc-foto-circuito-content');
    if (!content) return;
    try {
      const res = await fetch(`${API}/foto-circuito/${versionId}`, { headers: { 'Authorization': 'Bearer ' + token } });
      const data = await res.json();
      if (res.ok && data.fotos && data.fotos.length > 0) {
        const foto = data.fotos[0];
        content.innerHTML = `<img src="${foto.data}" alt="Circuito" onclick="ValoresCableadoApp.verImagen('${foto.data}')"><div class="vc-foto-label">CIRCUITO</div>`;
      } else {
        content.innerHTML = '<span class="vc-foto-placeholder">Sin imagen de circuito</span>';
      }
    } catch (e) {
      content.innerHTML = '<span class="vc-foto-placeholder">Sin imagen de circuito</span>';
    }
  }

  // Foto de "forma de cableado": antes era siempre un <img> directo a un
  // link público de Drive; ahora puede ser un archivo real subido por Julio
  // (servido autenticado, como la de circuito) o, mientras no se haya
  // vuelto a subir, el link de Drive de siempre — el backend decide cuál de
  // los dos hay y este código solo pinta lo que le llegue.
  async function cargarFotoCableado(formaCableado) {
    const content = document.getElementById('vc-foto-cableado-content');
    if (!content) return;
    try {
      const res = await fetch(`${API}/foto-cableado/${encodeURIComponent(formaCableado)}`, { headers: { 'Authorization': 'Bearer ' + token } });
      const data = await res.json();
      if (res.ok && data && (data.data || data.url)) {
        const src = data.tipo === 'archivo' ? data.data : data.url;
        // data.url es el link de Google Drive "legacy" guardado en la BD
        // (texto libre de cuando la app usaba solo links, ver comentario
        // más arriba) — antes se interpolaba sin escapar dentro de
        // innerHTML y de un onclick="...('...')" inline, el mismo patrón
        // inseguro que se corrigió arriba para el botón de subir foto. Acá
        // se construye el <img> con el DOM directamente (src como propiedad,
        // no como texto HTML) y el clic se conecta con addEventListener, así
        // el valor nunca pasa por un parser de HTML ni se compila como JS.
        content.innerHTML = '';
        const img = document.createElement('img');
        img.src = src;
        img.alt = 'Cableado';
        img.addEventListener('click', () => verImagen(src));
        img.addEventListener('error', () => {
          content.innerHTML = '<span class="vc-foto-placeholder">Sin imagen de cableado</span>';
        });
        const label = document.createElement('div');
        label.className = 'vc-foto-label';
        label.textContent = 'CABLEADO';
        content.appendChild(img);
        content.appendChild(label);
      } else {
        content.innerHTML = '<span class="vc-foto-placeholder">Sin imagen de cableado</span>';
      }
    } catch (e) {
      content.innerHTML = '<span class="vc-foto-placeholder">Sin imagen de cableado</span>';
    }
  }

  // ========== SUBIR FOTO DE CABLEADO ==========
  let pendingUploadForma = null;

  function subirFotoCableado(formaCableado) {
    pendingUploadForma = formaCableado;
    document.getElementById('vc-hidden-file-input').click();
  }

  async function onArchivoCableadoSeleccionado(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !pendingUploadForma) return;
    const formaCableado = pendingUploadForma;
    pendingUploadForma = null;

    const formData = new FormData();
    formData.append('imagen', file);
    try {
      const res = await fetch(`${API}/fotos-cableado/${encodeURIComponent(formaCableado)}`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token },
        body: formData
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await cargarFotoCableado(formaCableado);
      } else {
        alert(data.error || 'No se pudo subir la foto de cableado');
      }
    } catch (err) {
      alert('Error de conexión al subir la foto');
    }
  }

  function cambiarVersion(v) {
    selectedVersion = v;
    mostrarFicha();
  }

  function verImagen(src) {
    if (!src) return;
    const modal = document.getElementById('vc-img-modal');
    const img = document.getElementById('vc-img-modal-img');
    img.src = src;
    modal.classList.add('active');
  }

  // La edición de valores eléctricos y especificaciones de cableado ya no
  // vive acá — se hace desde el módulo "Crear Referencia" del portal
  // (pestaña "⚡ Valores y Cableado" al editar una referencia), para que
  // solo haya un único lugar donde se modifican estos datos.

  function setupEventos() {
    const searchInput = document.getElementById('vc-search-ref');
    searchInput.addEventListener('input', (e) => { searchText = e.target.value.trim(); construirSidebar(); });

    document.querySelector('.vc-img-modal-close').addEventListener('click', () => {
      document.getElementById('vc-img-modal').classList.remove('active');
    });
    document.getElementById('vc-img-modal').addEventListener('click', (e) => {
      if (e.target.id === 'vc-img-modal') document.getElementById('vc-img-modal').classList.remove('active');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      document.getElementById('vc-img-modal').classList.remove('active');
    });

    const hiddenInput = document.getElementById('vc-hidden-file-input');
    if (hiddenInput) hiddenInput.addEventListener('change', onArchivoCableadoSeleccionado);
  }

  return { iniciar, verImagen, subirFotoCableado };
})();
