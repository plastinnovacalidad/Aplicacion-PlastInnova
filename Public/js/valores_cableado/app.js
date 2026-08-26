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
      const nVersiones = new Set(productos.map(p => p.version).filter(Boolean)).size;

      const item = document.createElement('div');
      item.className = 'vc-ref-item' + (key === selectedKey ? ' active' : '');
      item.dataset.key = key;
      item.innerHTML = `
        <span class="vc-ref-name">${escapeHtml(key)}</span>
        ${nVersiones > 1 ? `<span class="vc-ref-versions">${nVersiones} v.</span>` : ''}
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
    const colorName = (COLOR_MAP[p.color] || { name: p.color || '' }).name;

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
    const CAMPOS_MEDIAS_BAJAS = ['amperaje_medias', 'potencia_medias', 'amperaje_min_medias', 'potencia_min_medias'];
    const CAMPOS_A_VALIDAR = [
      'voltaje_revision', 'amperaje_altas', 'potencia_altas',
      'voltaje_min', 'amperaje_min_altas', 'potencia_min_altas',
      'voltaje_max', 'amperaje_max', 'potencia_max',
      'cortar_puntas', 'posicion_punto', 'empujar_cables', 'forma_cableado', 'referencia_cable',
      ...(noAplicaMedias ? [] : CAMPOS_MEDIAS_BAJAS),
    ];
    const camposFaltantes = CAMPOS_A_VALIDAR.filter(c => p[c] === null || p[c] === undefined || p[c] === '').length;

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
    // Para las 4 líneas de "Medias (Bajas)" en los displays de abajo: si la
    // versión tiene marcado que no aplica, se muestra "N/A" en vez del
    // valor (que en ese caso siempre va a estar vacío) — así no se ve como
    // un dato que falta, sino como un campo que a propósito no corresponde
    // a esta referencia.
    const valMedias = (v, unidad) => noAplicaMedias
      ? `<span class="vc-val vc-na">N/A</span>`
      : `<span class="vc-val">${fmtNum(v)}</span><span class="vc-unit">${unidad}</span>`;

    main.innerHTML = `
      <div class="vc-ficha">
        <div class="vc-ficha-header">
          <div class="vc-ficha-header-top">
            <div>
              <h2>
                ⚡ ${escapeHtml(p.ref_base || '')}
                ${colorName ? `— ${escapeHtml(colorName)}` : ''}
                ${p.version ? `— ${escapeHtml(p.version)}` : ''}
              </h2>
              <div class="vc-sub">${escapeHtml(p.codigo_completo || '')}</div>
            </div>
          </div>
          ${versiones.length > 1 ? `
            <div class="vc-version-chips">
              ${versiones.map(v => `
                <button type="button" class="vc-version-chip ${v === selectedVersion ? 'active' : ''}" data-version="${escapeHtml(v)}">${escapeHtml(v)}</button>
              `).join('')}
            </div>
          ` : ''}
        </div>

        <!-- Alerta flotante de valores faltantes — mismo estilo que
             "⚠️ NECESITA PRUEBA" en Circuitos SMD. Vive fuera de
             .vc-ficha-scroll para quedar siempre visible aunque se
             desplace hacia abajo. -->
        <div class="vc-alerta-badge${camposFaltantes > 0 ? ' visible' : ''}">
          <span>⚠️ FALTAN ${camposFaltantes} VALOR${camposFaltantes === 1 ? '' : 'ES'}</span>
        </div>

        <div class="vc-ficha-scroll">
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
            <div class="vc-display-box green">
              <div class="vc-display-title">🔧 Revisión (14V)</div>
              <div class="vc-display-section">
                <div class="vc-display-section-label">═══ Medias (Bajas) ═══</div>
                <div class="vc-display-line"><span class="vc-lbl">Voltage</span><span><span class="vc-val">${fmtNum(p.voltaje_revision)}</span><span class="vc-unit">V</span></span></div>
                <div class="vc-display-line"><span class="vc-lbl">Current</span><span>${valMedias(p.amperaje_medias, 'A')}</span></div>
                <div class="vc-display-line"><span class="vc-lbl">Power</span><span>${valMedias(p.potencia_medias, 'W')}</span></div>
              </div>
              <div class="vc-display-section">
                <div class="vc-display-section-label">═══ Altas ═══</div>
                <div class="vc-display-line"><span class="vc-lbl">Voltage</span><span><span class="vc-val">${fmtNum(p.voltaje_revision)}</span><span class="vc-unit">V</span></span></div>
                <div class="vc-display-line"><span class="vc-lbl">Current</span><span><span class="vc-val">${fmtNum(p.amperaje_altas)}</span><span class="vc-unit">A</span></span></div>
                <div class="vc-display-line"><span class="vc-lbl">Power</span><span><span class="vc-val">${fmtNum(p.potencia_altas)}</span><span class="vc-unit">W</span></span></div>
              </div>
            </div>

            <div class="vc-display-box blue">
              <div class="vc-display-title">🔽 Prueba Mínimo</div>
              <div class="vc-display-section">
                <div class="vc-display-section-label">═══ Medias (Bajas) ═══</div>
                <div class="vc-display-line"><span class="vc-lbl">Voltage</span><span><span class="vc-val">${fmtNum(p.voltaje_min)}</span><span class="vc-unit">V</span></span></div>
                <div class="vc-display-line"><span class="vc-lbl">Current</span><span>${valMedias(p.amperaje_min_medias, 'A')}</span></div>
                <div class="vc-display-line"><span class="vc-lbl">Power</span><span>${valMedias(p.potencia_min_medias, 'W')}</span></div>
              </div>
              <div class="vc-display-section">
                <div class="vc-display-section-label">═══ Altas ═══</div>
                <div class="vc-display-line"><span class="vc-lbl">Voltage</span><span><span class="vc-val">${fmtNum(p.voltaje_min)}</span><span class="vc-unit">V</span></span></div>
                <div class="vc-display-line"><span class="vc-lbl">Current</span><span><span class="vc-val">${fmtNum(p.amperaje_min_altas)}</span><span class="vc-unit">A</span></span></div>
                <div class="vc-display-line"><span class="vc-lbl">Power</span><span><span class="vc-val">${fmtNum(p.potencia_min_altas)}</span><span class="vc-unit">W</span></span></div>
              </div>
            </div>

            <div class="vc-display-box orange">
              <div class="vc-display-title">🔼 Prueba Máximo</div>
              <div class="vc-display-section">
                <div class="vc-display-section-label">═══ Medias (Bajas) ═══</div>
                <div class="vc-display-line"><span class="vc-lbl">Voltage</span><span><span class="vc-val">${fmtNum(p.voltaje_max)}</span><span class="vc-unit">V</span></span></div>
                <div class="vc-display-line"><span class="vc-lbl">Current</span><span><span class="vc-val">${fmtNum(p.amperaje_max)}</span><span class="vc-unit">A</span></span></div>
                <div class="vc-display-line"><span class="vc-lbl">Power</span><span><span class="vc-val">${fmtNum(p.potencia_max)}</span><span class="vc-unit">W</span></span></div>
              </div>
              <div class="vc-display-section">
                <div class="vc-display-section-label">═══ Altas ═══</div>
                <div class="vc-display-line"><span class="vc-lbl">Voltage</span><span><span class="vc-val">${fmtNum(p.voltaje_max)}</span><span class="vc-unit">V</span></span></div>
                <div class="vc-display-line"><span class="vc-lbl">Current</span><span><span class="vc-val">${fmtNum(p.amperaje_max)}</span><span class="vc-unit">A</span></span></div>
                <div class="vc-display-line"><span class="vc-lbl">Power</span><span><span class="vc-val">${fmtNum(p.potencia_max)}</span><span class="vc-unit">W</span></span></div>
              </div>
            </div>
          </div>

          <div class="vc-specs-card">
            <div class="vc-specs-header">⚙️ Especificaciones de Cableado</div>
            <div class="vc-specs-grid">
              <div class="vc-cell"><label>Cortar Puntas</label><div class="vc-val">${boolVal(p.cortar_puntas)}</div></div>
              <div class="vc-cell"><label>Referencia Cable</label><div class="vc-val">${fmt(p.referencia_cable)}</div></div>
              <div class="vc-cell"><label>Posición Punto</label><div class="vc-val">${fmt(p.posicion_punto)}</div></div>
              <div class="vc-cell"><label>Empujar Cables</label><div class="vc-val">${boolVal(p.empujar_cables)}</div></div>
            </div>
          </div>

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
