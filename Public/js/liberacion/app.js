// ========================================================================
// Liberación de producto (MIGRACIÓN #56, 23/11/2026, pedido por Julio).
//
// Pestaña Registrar: encabezado (responsable = usuario de la sesión, fecha,
// turno, área) + productos con foto, referencia (sugerida desde el maestro
// de Caja roja), lote, cantidad, estado y descripción corta. Al guardar se
// mandan primero los datos y después cada foto por separado, tal cual se
// tomó (sin achicarla), para que el PDF las lleve con toda su calidad.
//
// Pestaña Liberados: lista con filtros, detalle con fotos (zoom sobre la
// foto original), PDF y edición. Solo quien creó una liberación la puede
// editar; eliminar requiere liberacion.gestion. El servidor vuelve a
// revisar todo esto (routes/liberaciones.js): ocultar un botón aquí es solo
// comodidad, no la regla.
// ========================================================================

let token = localStorage.getItem('token');
let permisosUsuario = [];
let usuarioActual = null;

(function () {
  'use strict';

  const K_MAESTRO = 'liberacion.maestro';
  const K_AREA = 'liberacion.area';
  const MAX_FOTO_MB = 20;

  // ---------------------------------------------------------------- estado
  let catalogos = { areas: [], turnos: ['Mañana', 'Tarde', 'Noche'], tipos: ['Liberación', 'Rechazo'], estados: ['Liberado', 'Rechazado'], maxProductos: 20, maxDescripcion: 150 };
  let maestroItems = [];          // [[id, ref, desc]]
  let maestroMapa = new Map();    // ref -> desc
  let maestroVersion = null;

  let form = null;                // ver formularioVacio()
  let sucio = false;              // hay cambios sin guardar
  let siguienteClave = 1;
  let fotoParaClave = null;       // producto que está eligiendo foto
  let guardando = false;

  let detalleActual = null;
  let vistaLiberados = 'documento'; // 'documento' | 'referencia'
  let filtroTipo = '';               // '' | 'Liberación' | 'Rechazo'
  let busquedaActual = 0;            // descarta respuestas de búsquedas viejas
  let ultimoGuardado = null;      // { id, consecutivo, fallidas: [{ i, pid, file }] }
  const cacheImagenes = new Map(); // url -> objectURL

  const $ = (id) => document.getElementById(id);
  const esc = (t) => escapeHtml(t == null ? '' : String(t));

  // ------------------------------------------------------------ utilidades
  function hoy(desplazamientoDias = 0) {
    const d = new Date();
    d.setDate(d.getDate() + desplazamientoDias);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function turnoSegunHora() {
    const h = new Date().getHours();
    if (h >= 6 && h < 14) return 'Mañana';
    if (h >= 14 && h < 22) return 'Tarde';
    return 'Noche';
  }
  function fechaCorta(iso) {
    if (!iso) return '';
    const [a, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  }
  function fechaHora(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  }
  function numero(n) { return Number(n || 0).toLocaleString('es-CO'); }
  function tamano(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toLocaleString('es-CO', { maximumFractionDigits: 1 }) + ' MB';
    return Math.round(bytes / 1024).toLocaleString('es-CO') + ' KB';
  }

  let toastTimer = null;
  function toast(texto, tipo) {
    const t = $('lbToast');
    t.className = 'lb-toast visible ' + (tipo || '');
    t.textContent = texto;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'lb-toast'; }, 3200);
  }

  async function api(url, opciones = {}) {
    const headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opciones.headers || {});
    const res = await fetch(url, Object.assign({}, opciones, { headers, cache: 'no-store' }));
    if (res.status === 401) { sesionVencida(); throw new Error('Tu sesión se cerró. Vuelve a iniciar sesión.'); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* respuesta sin JSON */ }
    return { res, data };
  }

  function sesionVencida() {
    sucio = false;
    alert('Tu sesión se cerró por inactividad. Vuelve a iniciar sesión.');
    localStorage.removeItem('token');
    location.reload();
  }

  // Las fotos y el PDF necesitan el token, así que se piden con fetch y se
  // muestran como blob (no se puede poner el token en un <img src>).
  async function urlBlob(url) {
    if (cacheImagenes.has(url)) return cacheImagenes.get(url);
    const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token } });
    if (res.status === 401) { sesionVencida(); throw new Error('Sesión cerrada'); }
    if (!res.ok) throw new Error('No se pudo cargar');
    const obj = URL.createObjectURL(await res.blob());
    cacheImagenes.set(url, obj);
    return obj;
  }
  function olvidarImagenesDe(liberacionId) {
    for (const [url, obj] of cacheImagenes) {
      if (url.startsWith(`/api/liberaciones/${liberacionId}/`)) { URL.revokeObjectURL(obj); cacheImagenes.delete(url); }
    }
  }
  async function cargarImagen(img) {
    const url = img.getAttribute('data-src');
    if (!url) return;
    img.removeAttribute('data-src');
    try { img.src = await urlBlob(url); }
    catch (e) { img.replaceWith(Object.assign(document.createElement('span'), { textContent: 'No se pudo cargar la foto' })); }
  }
  function cargarImagenesPendientes(contenedor) {
    contenedor.querySelectorAll('img[data-src]').forEach(cargarImagen);
  }
  // En la vista por referencia puede haber cientos de renglones: las
  // miniaturas se piden solo cuando el renglón aparece en pantalla.
  const observadorMiniaturas = ('IntersectionObserver' in window)
    ? new IntersectionObserver((entradas) => {
        entradas.forEach(e => { if (e.isIntersecting) { observadorMiniaturas.unobserve(e.target); cargarImagen(e.target); } });
      }, { rootMargin: '300px 0px' })
    : null;
  function cargarImagenesAlVer(contenedor) {
    if (!observadorMiniaturas) { cargarImagenesPendientes(contenedor); return; }
    contenedor.querySelectorAll('img[data-src]').forEach(img => observadorMiniaturas.observe(img));
  }

  // --------------------------------------------------------------- maestro
  function usarMaestro(datos) {
    maestroItems = Array.isArray(datos.items) ? datos.items : [];
    maestroMapa = new Map(maestroItems.map(it => [it[1], it[2]]));
    maestroVersion = datos.actualizado || null;
  }
  async function cargarMaestro() {
    try {
      const guardado = JSON.parse(localStorage.getItem(K_MAESTRO) || 'null');
      if (guardado && Array.isArray(guardado.items)) usarMaestro(guardado);
    } catch (e) { /* sin copia local */ }
    try {
      const q = maestroVersion ? '?version=' + encodeURIComponent(maestroVersion) : '';
      const { res, data } = await api('/api/liberaciones/maestro' + q);
      if (!res.ok || !data || data.sinCambios) return;
      usarMaestro(data);
      try { localStorage.setItem(K_MAESTRO, JSON.stringify(data)); } catch (e) { /* sin espacio: se usa solo en memoria */ }
    } catch (e) { /* sin maestro: la referencia se escribe a mano */ }
  }
  function buscarEnMaestro(texto) {
    const q = texto.trim().toUpperCase();
    if (q.length < 2) return [];
    const resultados = [];
    for (const it of maestroItems) {
      const ref = it[1];
      let puntos;
      if (ref.startsWith(q)) puntos = 0;
      else if (ref.includes('/' + q)) puntos = 1;
      else if (ref.includes(q)) puntos = 2;
      else continue;
      resultados.push([puntos, it]);
      if (resultados.length > 400) break;
    }
    resultados.sort((a, b) => a[0] - b[0] || a[1][1].localeCompare(b[1][1]));
    return resultados.slice(0, 8).map(r => r[1]);
  }

  // ------------------------------------------------------------ formulario
  function productoVacio() {
    return { clave: siguienteClave++, id: null, referencia: '', lote: '', cantidad: '', descripcion: '', file: null, previewUrl: null, tieneFoto: false };
  }
  function formularioVacio() {
    return {
      editId: null, consecutivo: null, revision: 0, tipo: '', responsable: usuarioActual ? usuarioActual.nombre : '—',
      fecha: hoy(), turno: turnoSegunHora(), area_id: localStorage.getItem(K_AREA) || '',
      productos: [productoVacio()],
    };
  }
  function liberarPreviews() {
    if (!form) return;
    form.productos.forEach(p => { if (p.previewUrl) URL.revokeObjectURL(p.previewUrl); });
  }
  function nuevoFormulario() {
    liberarPreviews();
    form = formularioVacio();
    sucio = false;
    pintarFormulario();
  }

  function pintarFormulario() {
    $('lbResponsable').textContent = form.responsable || '—';
    $('lbFecha').value = form.fecha;
    $('lbArea').value = form.area_id ? String(form.area_id) : '';
    pintarTurnos();
    const editando = !!form.editId;
    pintarTipos();
    $('lbEditando').style.display = editando ? 'flex' : 'none';
    if (editando) {
      $('lbEditandoCons').textContent = form.consecutivo;
      $('lbEditandoRev').textContent = `Rev. ${form.revision + 1}`;
    }
    $('lbGuardarTexto').textContent = editando ? 'Guardar cambios y generar PDF' : 'Guardar y generar PDF';
    $('lbErrorGuardar').textContent = '';
    pintarProductos();
  }

  // Tipo de documento: se elige una vez y aplica a todos los productos. Al
  // editar no se puede cambiar (el consecutivo LIB/REC depende de él).
  function pintarTipos() {
    const editando = !!form.editId;
    $('lbTipos').querySelectorAll('[data-tipo]').forEach(b => {
      const activo = form.tipo === b.getAttribute('data-tipo');
      b.classList.toggle('activo', activo);
      b.setAttribute('aria-checked', String(activo));
      b.disabled = editando && !activo;
    });
    $('lbTipoNota').textContent = editando ? '(no se cambia al editar)' : '';
  }

  function pintarTurnos() {
    $('lbTurnos').innerHTML = catalogos.turnos.map(t =>
      `<button type="button" class="lb-seg${form.turno === t ? ' activo' : ''}" role="radio" aria-checked="${form.turno === t}" data-turno="${esc(t)}">${esc(t)}</button>`
    ).join('');
  }

  function htmlFoto(p) {
    if (p.previewUrl) {
      return `<button type="button" class="lb-foto con-foto" data-acc="ver" aria-label="Ver foto en grande"><img src="${p.previewUrl}" alt="Foto del producto"></button>`;
    }
    if (p.tieneFoto && form.editId) {
      return `<button type="button" class="lb-foto con-foto" data-acc="ver" aria-label="Ver foto en grande"><img data-src="/api/liberaciones/${form.editId}/productos/${p.id}/foto?mini=1" alt="Foto del producto"></button>`;
    }
    return `<button type="button" class="lb-foto" data-acc="foto"><i class="fa-solid fa-camera"></i><span>Tomar o elegir foto</span></button>`;
  }

  function htmlProducto(p, i) {
    const tieneAlgunaFoto = !!(p.previewUrl || p.tieneFoto);
    const desc = descripcionReferencia(p.referencia);
    const max = catalogos.maxDescripcion;
    return `
      <div class="lb-card lb-producto" data-clave="${p.clave}">
        <div class="lb-prod-cabeza">
          <span class="lb-prod-num">Producto ${i + 1}</span>
          <button type="button" class="lb-btn-icono quitar" data-acc="quitar" aria-label="Quitar producto ${i + 1}" title="Quitar producto"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="lb-prod-cuerpo">
          <div>
            ${htmlFoto(p)}
            ${tieneAlgunaFoto ? `<div class="lb-foto-acciones">
              <button type="button" class="lb-btn-mini" data-acc="ver"><i class="fa-solid fa-magnifying-glass-plus"></i> Ver</button>
              <button type="button" class="lb-btn-mini" data-acc="foto"><i class="fa-solid fa-camera-rotate"></i> Cambiar</button>
            </div>` : ''}
            ${p.file ? `<div class="lb-foto-info" title="${esc(p.file.name)}">${esc(tamano(p.file.size))} · original</div>` : ''}
          </div>
          <div class="lb-prod-campos">
            <div class="lb-campo lb-ref">
              <span>Referencia <em>*</em></span>
              <input type="text" data-campo="referencia" value="${esc(p.referencia)}" placeholder="Escribe el número, p. ej. 1060" autocomplete="off" autocapitalize="characters" spellcheck="false">
              <div class="lb-ref-desc${desc.fuera ? ' fuera' : ''}">${esc(desc.texto)}</div>
              <div class="lb-sugerencias" style="display:none;"></div>
            </div>
            <div class="lb-fila-2">
              <label class="lb-campo">
                <span>Lote <em>*</em></span>
                <input type="text" class="lb-dato" data-campo="lote" value="${esc(p.lote)}" autocomplete="off" autocapitalize="characters" spellcheck="false">
              </label>
              <label class="lb-campo">
                <span>Cantidad <em>*</em></span>
                <input type="number" class="lb-dato" data-campo="cantidad" value="${esc(p.cantidad)}" min="1" step="1" inputmode="numeric">
              </label>
            </div>
            <label class="lb-campo">
              <span>Descripción del problema</span>
              <textarea data-campo="descripcion" maxlength="${max}" rows="2" placeholder="Corta y concreta, p. ej. Puente de soldadura en U4">${esc(p.descripcion)}</textarea>
              <span class="lb-contador-desc${p.descripcion.length >= max ? ' limite' : ''}">${p.descripcion.length}/${max}</span>
            </label>
          </div>
        </div>
      </div>`;
  }

  function pintarProductos() {
    const cont = $('lbProductos');
    cont.innerHTML = form.productos.map(htmlProducto).join('');
    cargarImagenesPendientes(cont);
    $('lbContadorProductos').textContent = `${form.productos.length} de ${catalogos.maxProductos}`;
    $('lbAgregar').disabled = form.productos.length >= catalogos.maxProductos;
  }

  function descripcionReferencia(ref) {
    const r = String(ref || '').trim().toUpperCase();
    if (!r) return { texto: '', fuera: false };
    if (maestroMapa.has(r)) return { texto: maestroMapa.get(r) || '', fuera: false };
    return { texto: maestroItems.length ? 'No está en el maestro (se guarda igual)' : '', fuera: true };
  }

  function productoDe(el) {
    const tarjeta = el.closest('.lb-producto');
    if (!tarjeta) return null;
    const clave = Number(tarjeta.getAttribute('data-clave'));
    return { tarjeta, p: form.productos.find(x => x.clave === clave) };
  }

  // ----------------------------------------------------------- sugerencias
  function mostrarSugerencias(tarjeta, p) {
    const caja = tarjeta.querySelector('.lb-sugerencias');
    const lista = buscarEnMaestro(p.referencia);
    if (!lista.length || maestroMapa.has(p.referencia.trim().toUpperCase())) { caja.style.display = 'none'; caja.innerHTML = ''; return; }
    // Mientras hay sugerencias no se muestra "No está en el maestro".
    const desc = tarjeta.querySelector('.lb-ref-desc');
    if (desc.classList.contains('fuera')) desc.textContent = '';
    caja.innerHTML = lista.map(it => `<button type="button" class="lb-sug" data-ref="${esc(it[1])}"><b>${esc(it[1])}</b><small>${esc(it[2])}</small></button>`).join('');
    caja.style.display = 'block';
  }
  function ocultarSugerencias(tarjeta) {
    const caja = tarjeta && tarjeta.querySelector('.lb-sugerencias');
    if (caja) { caja.style.display = 'none'; caja.innerHTML = ''; }
  }
  function elegirReferencia(tarjeta, p, ref) {
    p.referencia = ref;
    sucio = true;
    const input = tarjeta.querySelector('[data-campo="referencia"]');
    input.value = ref;
    actualizarDescRef(tarjeta, p);
    ocultarSugerencias(tarjeta);
    marcarValido(input.closest('.lb-campo'));
    const lote = tarjeta.querySelector('[data-campo="lote"]');
    if (lote && !lote.value) lote.focus();
  }
  function actualizarDescRef(tarjeta, p) {
    const d = descripcionReferencia(p.referencia);
    const el = tarjeta.querySelector('.lb-ref-desc');
    el.textContent = d.texto;
    el.classList.toggle('fuera', d.fuera);
  }

  // ------------------------------------------------------------ eventos form
  function enlazarFormulario() {
    $('lbFecha').addEventListener('change', (e) => { form.fecha = e.target.value; sucio = true; marcarValido(e.target.closest('.lb-campo')); });
    $('lbArea').addEventListener('change', (e) => {
      form.area_id = e.target.value; sucio = true;
      if (e.target.value) localStorage.setItem(K_AREA, e.target.value);
      marcarValido(e.target.closest('.lb-campo'));
    });
    $('lbTipos').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tipo]');
      if (!b || form.editId) return;
      form.tipo = b.getAttribute('data-tipo'); sucio = true;
      pintarTipos();
      marcarValido($('lbTipos').closest('.lb-campo'));
    });
    $('lbTurnos').addEventListener('click', (e) => {
      const b = e.target.closest('[data-turno]');
      if (!b) return;
      form.turno = b.getAttribute('data-turno'); sucio = true;
      pintarTurnos();
      marcarValido($('lbTurnos').closest('.lb-campo'));
    });
    $('lbAgregar').addEventListener('click', () => {
      if (form.productos.length >= catalogos.maxProductos) return;
      form.productos.push(productoVacio());
      sucio = true;
      pintarProductos();
      const ultima = $('lbProductos').lastElementChild;
      if (ultima) {
        ultima.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const ref = ultima.querySelector('[data-campo="referencia"]');
        if (ref) setTimeout(() => ref.focus(), 250);
      }
    });
    $('lbCancelarEdicion').addEventListener('click', () => {
      if (sucio && !confirm('¿Descartar los cambios de esta edición?')) return;
      nuevoFormulario();
    });
    $('lbGuardar').addEventListener('click', guardar);

    const cont = $('lbProductos');
    cont.addEventListener('input', (e) => {
      const campo = e.target.getAttribute('data-campo');
      if (!campo) return;
      const r = productoDe(e.target);
      if (!r || !r.p) return;
      sucio = true;
      r.p[campo] = e.target.value;
      marcarValido(e.target.closest('.lb-campo'));
      if (campo === 'referencia') { actualizarDescRef(r.tarjeta, r.p); mostrarSugerencias(r.tarjeta, r.p); }
      if (campo === 'descripcion') {
        const c = r.tarjeta.querySelector('.lb-contador-desc');
        c.textContent = `${e.target.value.length}/${catalogos.maxDescripcion}`;
        c.classList.toggle('limite', e.target.value.length >= catalogos.maxDescripcion);
      }
    });
    cont.addEventListener('focusout', (e) => {
      if (e.target.getAttribute('data-campo') === 'referencia') {
        const r = productoDe(e.target);
        setTimeout(() => ocultarSugerencias(r && r.tarjeta), 180);
        if (r && r.p) { r.p.referencia = r.p.referencia.trim().toUpperCase(); e.target.value = r.p.referencia; actualizarDescRef(r.tarjeta, r.p); }
      }
      if (e.target.getAttribute('data-campo') === 'lote') {
        const r = productoDe(e.target);
        if (r && r.p) { r.p.lote = r.p.lote.trim().toUpperCase(); e.target.value = r.p.lote; }
      }
    });
    cont.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.target.getAttribute('data-campo') !== 'referencia') return;
      const r = productoDe(e.target);
      const primera = r && r.tarjeta.querySelector('.lb-sug');
      if (primera) { e.preventDefault(); elegirReferencia(r.tarjeta, r.p, primera.getAttribute('data-ref')); }
    });
    // pointerdown (antes de que el campo pierda el foco) para que el toque
    // sobre una sugerencia no se pierda.
    cont.addEventListener('pointerdown', (e) => {
      const sug = e.target.closest('.lb-sug');
      if (!sug) return;
      e.preventDefault();
      const r = productoDe(sug);
      if (r && r.p) elegirReferencia(r.tarjeta, r.p, sug.getAttribute('data-ref'));
    });
    cont.addEventListener('click', (e) => {
      const r = productoDe(e.target);
      if (!r || !r.p) return;
      const accion = e.target.closest('[data-acc]');
      if (!accion) return;
      const acc = accion.getAttribute('data-acc');
      if (acc === 'foto') { fotoParaClave = r.p.clave; $('lbArchivoFoto').value = ''; $('lbArchivoFoto').click(); }
      else if (acc === 'ver') verFotoDeProducto(r.p, form.productos.indexOf(r.p));
      else if (acc === 'quitar') quitarProducto(r.p);
    });

    $('lbArchivoFoto').addEventListener('change', (e) => {
      const archivo = e.target.files && e.target.files[0];
      const p = form.productos.find(x => x.clave === fotoParaClave);
      fotoParaClave = null;
      if (!archivo || !p) return;
      const tipo = (archivo.type || '').toLowerCase();
      if (tipo.includes('heic') || tipo.includes('heif') || /\.hei[cf]$/i.test(archivo.name)) {
        toast('Esa foto está en formato HEIC. En la cámara elige "Más compatible" (JPG) y vuelve a tomarla.', 'error');
        return;
      }
      if (!/^image\/(jpeg|png|webp|gif|bmp)$/.test(tipo)) { toast('Elige una foto JPG o PNG.', 'error'); return; }
      if (archivo.size > MAX_FOTO_MB * 1024 * 1024) { toast(`La foto pesa ${tamano(archivo.size)}; el máximo es ${MAX_FOTO_MB} MB.`, 'error'); return; }
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      p.file = archivo;
      p.previewUrl = URL.createObjectURL(archivo);
      sucio = true;
      pintarProductos();
    });
  }

  function quitarProducto(p) {
    const tieneDatos = p.referencia || p.lote || p.cantidad || p.descripcion || p.file || p.tieneFoto;
    if (tieneDatos && !confirm('¿Quitar este producto de la liberación?')) return;
    if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    form.productos = form.productos.filter(x => x !== p);
    if (!form.productos.length) form.productos.push(productoVacio());
    sucio = true;
    pintarProductos();
  }

  function marcarValido(campo) { if (campo) campo.classList.remove('invalido'); }

  // -------------------------------------------------------------- validar
  function validar() {
    document.querySelectorAll('#lbPanelRegistrar .invalido').forEach(el => el.classList.remove('invalido'));
    const errores = [];
    const marcar = (el, mensaje) => { if (el) el.classList.add('invalido'); errores.push({ el, mensaje }); };

    if (!form.tipo) marcar($('lbTipos').closest('.lb-campo'), 'Elige si el documento es una liberación o un rechazo.');
    if (!form.fecha) marcar($('lbFecha').closest('.lb-campo'), 'Indica la fecha.');
    if (!form.turno) marcar($('lbTurnos').closest('.lb-campo'), 'Elige el turno.');
    if (!form.area_id) marcar($('lbArea').closest('.lb-campo'), 'Elige el área.');

    form.productos.forEach((p, i) => {
      const t = $('lbProductos').querySelector(`[data-clave="${p.clave}"]`);
      const n = i + 1;
      const campo = (nombre) => t && t.querySelector(`[data-campo="${nombre}"]`).closest('.lb-campo');
      if (!p.previewUrl && !p.tieneFoto) marcar(t && t.querySelector('.lb-foto'), `Producto ${n}: falta la foto.`);
      if (!p.referencia.trim()) marcar(campo('referencia'), `Producto ${n}: falta la referencia.`);
      if (!p.lote.trim()) marcar(campo('lote'), `Producto ${n}: falta el lote.`);
      const cant = Number(p.cantidad);
      if (!Number.isInteger(cant) || cant < 1) marcar(campo('cantidad'), `Producto ${n}: la cantidad debe ser un número entero mayor que 0.`);
      if (p.descripcion.length > catalogos.maxDescripcion) marcar(campo('descripcion'), `Producto ${n}: la descripción pasa de ${catalogos.maxDescripcion} caracteres.`);
    });
    return errores;
  }

  // -------------------------------------------------------------- guardar
  function subirFoto(liberacionId, productoId, archivo, alAvanzar) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/liberaciones/${liberacionId}/productos/${productoId}/foto`);
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) alAvanzar(e.loaded / e.total); };
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* sin JSON */ }
        resolve(xhr.status >= 200 && xhr.status < 300 ? { ok: true } : { ok: false, error: (data && data.error) || `Error ${xhr.status}` });
      };
      xhr.onerror = () => resolve({ ok: false, error: 'Sin conexión con el servidor' });
      const fd = new FormData();
      fd.append('foto', archivo, archivo.name);
      xhr.send(fd);
    });
  }

  function mostrarResultado({ icono, titulo, texto, progreso, botones, reintentar }) {
    $('lbResultado').style.display = 'flex';
    const ic = $('lbResIcono');
    ic.className = 'lb-res-icono ' + (icono === 'subiendo' ? 'subiendo' : icono === 'aviso' ? 'aviso' : '');
    ic.innerHTML = icono === 'subiendo' ? '<i class="fa-solid fa-cloud-arrow-up"></i>' : icono === 'aviso' ? '<i class="fa-solid fa-triangle-exclamation"></i>' : '<i class="fa-solid fa-circle-check"></i>';
    $('lbResTitulo').textContent = titulo;
    $('lbResTexto').textContent = texto;
    $('lbResProgreso').style.display = progreso == null ? 'none' : 'block';
    if (progreso != null) $('lbResBarra').style.width = Math.round(progreso * 100) + '%';
    $('lbResBotones').style.display = botones ? 'flex' : 'none';
    $('lbResNueva').innerHTML = reintentar ? '<i class="fa-solid fa-rotate"></i> Reintentar' : '<i class="fa-solid fa-plus"></i> Nueva liberación';
    $('lbResNueva').dataset.modo = reintentar ? 'reintentar' : 'nueva';
  }

  async function subirFotos(liberacionId, consecutivo, pendientes) {
    const fallidas = [];
    for (let k = 0; k < pendientes.length; k++) {
      const f = pendientes[k];
      const base = k / pendientes.length;
      mostrarResultado({ icono: 'subiendo', titulo: `${consecutivo} guardada`, texto: `Subiendo foto ${k + 1} de ${pendientes.length} (${tamano(f.file.size)})…`, progreso: base });
      const r = await subirFoto(liberacionId, f.pid, f.file, (x) => { $('lbResBarra').style.width = Math.round((base + x / pendientes.length) * 100) + '%'; });
      if (!r.ok) fallidas.push({ ...f, error: r.error });
    }
    return fallidas;
  }

  // Guarda (o reemplaza) la copia del PDF en la carpeta de formatos de
  // Calidad (subcarpeta Liberaciones o Rechazos). Se hace al final, cuando
  // ya subieron las fotos. Devuelve { ok, error }.
  async function archivarPdf(id, consecutivo) {
    mostrarResultado({ icono: 'subiendo', titulo: `${consecutivo} guardado`, texto: 'Guardando el PDF en la carpeta de formatos…', progreso: 1 });
    try {
      const { res, data } = await api(`/api/liberaciones/${id}/archivar`, { method: 'POST' });
      return res.ok ? { ok: true } : { ok: false, error: (data && data.error) || 'No se pudo guardar el PDF en la carpeta.' };
    } catch (e) {
      return { ok: false, error: e.message || 'Sin conexión con el servidor.' };
    }
  }

  async function terminarGuardado(id, consecutivo, tipo, fallidas, edicion) {
    olvidarImagenesDe(id);
    const archivo = fallidas.length ? { ok: false, pendiente: true } : await archivarPdf(id, consecutivo);
    ultimoGuardado = { id, consecutivo, tipo, fallidas, edicion, archivoOk: archivo.ok };
    const carpeta = tipo === 'Rechazo' ? 'Rechazos' : 'Liberaciones';
    if (fallidas.length) {
      mostrarResultado({
        icono: 'aviso', titulo: `${consecutivo} guardado, faltan fotos`,
        texto: `No se pudieron subir ${fallidas.length} foto(s) (producto ${fallidas.map(f => f.i + 1).join(', ')}): ${fallidas[0].error}. Reintenta para completar las fotos y guardar el PDF en la carpeta ${carpeta}.`,
        botones: true, reintentar: true,
      });
    } else if (!archivo.ok) {
      mostrarResultado({
        icono: 'aviso', titulo: `${consecutivo} guardado, falta la carpeta`,
        texto: `Los datos y las fotos quedaron guardados, pero el PDF no se pudo copiar a la carpeta ${carpeta}: ${archivo.error}`,
        botones: true, reintentar: true,
      });
    } else {
      mostrarResultado({
        icono: 'ok', titulo: edicion ? `${consecutivo} actualizado` : `${consecutivo} guardado`,
        texto: `El PDF quedó en la carpeta de formatos, en ${carpeta}${edicion ? ' (se reemplazó el anterior)' : ''}.`, botones: true,
      });
    }
  }

  async function guardar() {
    if (guardando) return;
    $('lbErrorGuardar').textContent = '';
    const errores = validar();
    if (errores.length) {
      $('lbErrorGuardar').textContent = errores.length === 1 ? errores[0].mensaje : `${errores[0].mensaje} (y ${errores.length - 1} campo(s) más por completar)`;
      if (errores[0].el) errores[0].el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    guardando = true;
    $('lbGuardar').disabled = true;
    const edicion = !!form.editId;
    const cuerpo = {
      tipo: form.tipo, fecha: form.fecha, turno: form.turno, area_id: Number(form.area_id),
      productos: form.productos.map(p => ({
        id: p.id, referencia: p.referencia.trim().toUpperCase(), lote: p.lote.trim().toUpperCase(),
        cantidad: Number(p.cantidad), descripcion: p.descripcion.trim(),
      })),
    };
    try {
      mostrarResultado({ icono: 'subiendo', titulo: 'Guardando…', texto: 'Guardando los datos del documento.', progreso: 0 });
      const { res, data } = await api(edicion ? `/api/liberaciones/${form.editId}` : '/api/liberaciones', {
        method: edicion ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
      });
      if (!res.ok) {
        $('lbResultado').style.display = 'none';
        $('lbErrorGuardar').textContent = (data && data.error) || 'No se pudo guardar. Intenta de nuevo.';
        return;
      }
      const id = data.id;
      const consecutivo = data.consecutivo;
      const tipo = form.tipo;
      const pendientes = [];
      form.productos.forEach((p, i) => { if (p.file) pendientes.push({ i, pid: data.productos[i], file: p.file }); });
      const fallidas = await subirFotos(id, consecutivo, pendientes);
      // El formulario queda limpio: los datos ya están guardados en el
      // servidor (las fotos que fallaron se pueden reintentar desde el aviso).
      sucio = false;
      const archivosFallidos = fallidas;
      nuevoFormulario();
      await terminarGuardado(id, consecutivo, tipo, archivosFallidos, edicion);
    } catch (e) {
      $('lbResultado').style.display = 'none';
      $('lbErrorGuardar').textContent = e.message || 'No se pudo conectar con el servidor.';
    } finally {
      guardando = false;
      $('lbGuardar').disabled = false;
    }
  }

  // Reintenta lo que haya quedado pendiente: fotos que no subieron y/o la
  // copia del PDF en la carpeta.
  async function reintentarFotos() {
    if (!ultimoGuardado) return;
    const { id, consecutivo, tipo, edicion } = ultimoGuardado;
    const fallidas = ultimoGuardado.fallidas.length ? await subirFotos(id, consecutivo, ultimoGuardado.fallidas) : [];
    await terminarGuardado(id, consecutivo, tipo, fallidas, edicion);
  }

  // ------------------------------------------------------------------ PDF
  async function abrirPdf(id) {
    // La ventana se abre en el mismo toque (si se abre después de esperar al
    // servidor, el navegador de la tablet la bloquea como ventana emergente).
    const ventana = window.open('', '_blank');
    if (ventana) {
      try { ventana.document.write('<p style="font-family:Segoe UI,sans-serif;padding:24px;color:#363D4A">Generando PDF…</p>'); } catch (e) { /* sin acceso */ }
    }
    try {
      const res = await fetch(`/api/liberaciones/${id}/pdf`, { headers: { 'Authorization': 'Bearer ' + token } });
      if (res.status === 401) { if (ventana) ventana.close(); sesionVencida(); return; }
      if (!res.ok) throw new Error('No se pudo generar el PDF');
      const nombre = ((res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'liberacion.pdf';
      const url = URL.createObjectURL(await res.blob());
      if (ventana && !ventana.closed) {
        ventana.location.href = url;
      } else {
        const a = document.createElement('a');
        a.href = url; a.download = nombre;
        document.body.appendChild(a); a.click(); a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    } catch (e) {
      if (ventana && !ventana.closed) ventana.close();
      toast(e.message || 'No se pudo generar el PDF', 'error');
    }
  }

  // ---------------------------------------------------------------- visor
  let zoom = null; // null = ajustado a la pantalla
  async function abrirVisor(titulo, obtenerUrl) {
    const img = $('lbVisorImg');
    const area = $('lbVisorArea');
    $('lbVisorTitulo').textContent = titulo;
    img.removeAttribute('src');
    img.style.width = '';
    zoom = null;
    area.classList.add('ajustado');
    $('lbVisor').style.display = 'flex';
    try { img.src = await obtenerUrl(); }
    catch (e) { toast('No se pudo cargar la foto', 'error'); cerrarVisor(); }
  }
  function cerrarVisor() { $('lbVisor').style.display = 'none'; }
  function aplicarZoom(nuevo) {
    const img = $('lbVisorImg');
    const area = $('lbVisorArea');
    if (!img.naturalWidth) return;
    if (nuevo == null) { zoom = null; area.classList.add('ajustado'); img.style.width = ''; return; }
    zoom = Math.max(0.1, Math.min(8, nuevo));
    area.classList.remove('ajustado');
    img.style.width = Math.round(img.naturalWidth * zoom) + 'px';
  }
  function zoomActual() {
    const img = $('lbVisorImg');
    return zoom != null ? zoom : (img.naturalWidth ? img.clientWidth / img.naturalWidth : 1);
  }
  function enlazarVisor() {
    $('lbVisorCerrar').addEventListener('click', cerrarVisor);
    $('lbZoomMas').addEventListener('click', () => aplicarZoom(zoomActual() * 1.5));
    $('lbZoomMenos').addEventListener('click', () => aplicarZoom(zoomActual() / 1.5));
    $('lbZoomAjustar').addEventListener('click', () => aplicarZoom(null));
    // Doble toque: alterna entre ajustada y tamaño real (100 %).
    $('lbVisorImg').addEventListener('dblclick', () => aplicarZoom(zoom == null ? 1 : null));
  }
  function verFotoDeProducto(p, i) {
    const titulo = `Producto ${i + 1}${p.referencia ? ' · ' + p.referencia : ''}`;
    if (p.previewUrl) abrirVisor(titulo, async () => p.previewUrl);
    else if (p.tieneFoto && form.editId) abrirVisor(titulo, () => urlBlob(`/api/liberaciones/${form.editId}/productos/${p.id}/foto`));
  }

  // ------------------------------------------------------------- liberados
  async function buscarLiberados() {
    const params = new URLSearchParams();
    const set = (k, v) => { if (v) params.set(k, v); };
    set('desde', $('lbDesde').value);
    set('hasta', $('lbHasta').value);
    set('turno', $('lbFiltroTurno').value);
    set('area_id', $('lbFiltroArea').value);
    set('tipo', filtroTipo);
    set('q', $('lbFiltroTexto').value.trim());
    const porReferencia = vistaLiberados === 'referencia';
    const cont = porReferencia ? $('lbListaRef') : $('lbLista');
    $('lbLista').style.display = porReferencia ? 'none' : '';
    $('lbListaRef').style.display = porReferencia ? '' : 'none';
    $('lbNotaLista').textContent = '';
    cont.innerHTML = '<div class="lb-vacio"><i class="fa-solid fa-spinner fa-spin"></i>Buscando…</div>';
    const turno = ++busquedaActual;
    try {
      const { res, data } = await api((porReferencia ? '/api/liberaciones/productos?' : '/api/liberaciones?') + params.toString());
      if (turno !== busquedaActual) return; // ya se pidió otra búsqueda
      if (!res.ok) throw new Error((data && data.error) || 'No se pudo consultar');
      if (porReferencia) pintarListaRef(data.productos || [], data.soloPropias);
      else pintarLista(data.liberaciones || [], data.soloPropias);
    } catch (e) {
      if (turno !== busquedaActual) return;
      cont.innerHTML = `<div class="lb-vacio"><i class="fa-solid fa-triangle-exclamation"></i>${esc(e.message)}</div>`;
    }
  }

  // Vista "Por referencia": un renglón por producto.
  function pintarListaRef(lista, soloPropias) {
    const n = lista.length;
    const piezas = lista.reduce((s, p) => s + (Number(p.cantidad) || 0), 0);
    const que = filtroTipo === 'Liberación' ? ' liberado' : filtroTipo === 'Rechazo' ? ' rechazado' : '';
    $('lbNotaLista').textContent = (soloPropias ? 'Ves solo lo que registraste tú. ' : '') +
      (n ? `${numero(n)} producto${n === 1 ? '' : 's'}${que}${n === 1 || !que ? '' : 's'} · ${numero(piezas)} pzs${n >= 1000 ? ' (se muestran los 1.000 más recientes; usa los filtros para acotar)' : ''}.` : '');
    if (!n) {
      $('lbListaRef').innerHTML = '<div class="lb-card lb-vacio"><i class="fa-solid fa-barcode"></i>No hay productos con estos filtros.</div>';
      return;
    }
    $('lbListaRef').innerHTML = lista.map(p => `
      <div class="lb-card lb-fila-ref" role="button" tabindex="0" data-lib="${p.liberacion_id}">
        <div class="lb-ref-mini">${p.tieneFoto
          ? `<img data-src="/api/liberaciones/${p.liberacion_id}/productos/${p.id}/foto?mini=1" alt="Foto de ${esc(p.referencia)}">`
          : '<i class="fa-regular fa-image" title="Sin foto"></i>'}</div>
        <div class="lb-ref-principal">
          <div class="lb-ref-codigo">${esc(p.referencia)}</div>
          ${p.descripcion_referencia ? `<div class="lb-ref-sub">${esc(p.descripcion_referencia)}</div>` : ''}
          ${p.descripcion ? `<div class="lb-ref-problema">${esc(p.descripcion)}</div>` : ''}
        </div>
        <div class="lb-ref-dato"><span>Lote</span><b>${esc(p.lote)}</b></div>
        <div class="lb-ref-dato lb-ref-num"><span>Cant.</span><b>${numero(p.cantidad)}</b></div>
        <div class="lb-ref-estado"><span class="lb-estado" data-estado="${esc(p.estado)}">${esc(p.estado)}</span></div>
        <div class="lb-ref-doc">
          <span class="lb-ref-lib${p.tipo === 'Rechazo' ? ' rechazo' : ''}">${esc(p.consecutivo)}</span>
          <span>${esc(fechaCorta(p.fecha))} · ${esc(p.turno)}</span>
          <span>${esc(p.area_nombre || '—')}</span>
        </div>
      </div>`).join('');
    cargarImagenesAlVer($('lbListaRef'));
  }

  function pintarLista(lista, soloPropias) {
    const n = lista.length;
    $('lbNotaLista').textContent = (soloPropias ? 'Ves solo los documentos que registraste tú. ' : '') +
      (n ? `${n} documento${n === 1 ? '' : 's'}${n >= 500 ? ' (se muestran los 500 más recientes; usa los filtros para acotar)' : ''}.` : '');
    if (!n) {
      $('lbLista').innerHTML = '<div class="lb-card lb-vacio"><i class="fa-solid fa-clipboard-check"></i>No hay documentos con estos filtros.</div>';
      return;
    }
    $('lbLista').innerHTML = lista.map(l => {
      const estadoTipo = l.tipo === 'Rechazo' ? 'Rechazado' : 'Liberado';
      const refs = (l.referencias || []).slice(0, 6).join(' · ') + ((l.referencias || []).length > 6 ? ' …' : '');
      return `
        <div class="lb-card lb-item" role="button" tabindex="0" data-id="${l.id}">
          <div class="lb-item-izq">
            <div class="lb-item-cons${l.tipo === 'Rechazo' ? ' rechazo' : ''}">${esc(l.consecutivo)}</div>
            <div class="lb-item-rev">${l.revision ? `Rev. ${l.revision}` : 'Original'}</div>
          </div>
          <div class="lb-item-datos">
            <div class="lb-item-linea">
              <span><i class="fa-regular fa-calendar"></i>${esc(fechaCorta(l.fecha))}</span>
              <span><i class="fa-regular fa-clock"></i>${esc(l.turno)}</span>
              <span><i class="fa-solid fa-industry"></i>${esc(l.area_nombre || '—')}</span>
              <span><i class="fa-regular fa-user"></i>${esc(l.responsable_nombre || '—')}</span>
            </div>
            <div class="lb-item-refs">${esc(refs)}</div>
            <div class="lb-item-estados"><span class="lb-estado" data-estado="${estadoTipo}">${esc(l.tipo || 'Liberación')}</span></div>
          </div>
          <div class="lb-item-der">
            <span class="lb-item-num">${numero(l.total)}</span>
            <span class="lb-item-num-et">producto${l.total === 1 ? '' : 's'} · ${numero(l.piezas)} pzs</span>
            ${l.sinFoto ? `<span class="lb-aviso-foto"><i class="fa-solid fa-triangle-exclamation"></i> ${l.sinFoto} sin foto</span>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  async function abrirDetalle(id) {
    try {
      const { res, data } = await api(`/api/liberaciones/${id}`);
      if (!res.ok) throw new Error((data && data.error) || 'No se pudo abrir');
      detalleActual = data;
      pintarDetalle(data);
      $('lbDetalle').style.display = 'flex';
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function pintarDetalle(d) {
    $('lbDetTitulo').textContent = `${d.consecutivo} · ${d.tipo || 'Liberación'}`;
    $('lbDetTitulo').classList.toggle('rechazo', d.tipo === 'Rechazo');
    $('lbDetSub').textContent = (d.revision ? `Rev. ${d.revision} · última modificación ${fechaHora(d.actualizado_en)}${d.actualizado_por_nombre ? ' por ' + d.actualizado_por_nombre : ''}` : `Creada ${fechaHora(d.creado_en)}`);
    const dato = (et, v) => `<div class="lb-det-dato"><span>${esc(et)}</span><strong title="${esc(v)}">${esc(v)}</strong></div>`;
    $('lbDetDatos').innerHTML = dato('Responsable', d.responsable_nombre || '—') + dato('Turno', d.turno) + dato('Área', d.area_nombre || '—') + dato('Fecha', fechaCorta(d.fecha));
    $('lbDetProductos').innerHTML = d.productos.map((p, i) => `
      <div class="lb-det-prod">
        ${p.tieneFoto
          ? `<button type="button" class="lb-det-foto" data-pid="${p.id}" data-i="${i}" aria-label="Ver foto del producto ${i + 1} en grande"><img data-src="/api/liberaciones/${d.id}/productos/${p.id}/foto?mini=1" alt="Foto del producto ${i + 1}"></button>`
          : '<div class="lb-det-foto sin">Sin foto</div>'}
        <div class="lb-det-fila">
          <span class="lb-det-ref" title="${esc(p.referencia)}">${i + 1}. ${esc(p.referencia)}</span>
          <span class="lb-estado" data-estado="${esc(p.estado)}">${esc(p.estado)}</span>
        </div>
        ${p.descripcion_referencia ? `<div class="lb-det-sub">${esc(p.descripcion_referencia)}</div>` : ''}
        <div class="lb-det-lote"><span class="lb-det-sub">Lote</span> <b>${esc(p.lote)}</b> &nbsp; <span class="lb-det-sub">Cantidad</span> <b>${numero(p.cantidad)}</b></div>
        <div class="lb-det-desc${p.descripcion ? '' : ' vacia'}">${esc(p.descripcion || 'Sin observaciones.')}</div>
      </div>`).join('');
    cargarImagenesPendientes($('lbDetProductos'));
    $('lbDetEditar').style.display = d.puedeEditar ? 'inline-flex' : 'none';
    $('lbDetEliminar').style.display = d.puedeEliminar ? 'inline-flex' : 'none';
  }

  function cerrarDetalle() { $('lbDetalle').style.display = 'none'; detalleActual = null; }

  function editarDesdeDetalle() {
    const d = detalleActual;
    if (!d) return;
    if (sucio && !confirm('Tienes una liberación sin guardar en Registrar. ¿Descartarla para editar esta?')) return;
    liberarPreviews();
    form = {
      editId: d.id, consecutivo: d.consecutivo, revision: Number(d.revision) || 0, tipo: d.tipo || 'Liberación',
      responsable: d.responsable_nombre, fecha: d.fecha, turno: d.turno, area_id: d.area_id != null ? String(d.area_id) : '',
      productos: d.productos.map(p => ({
        clave: siguienteClave++, id: p.id, referencia: p.referencia, lote: p.lote, cantidad: String(p.cantidad),
        descripcion: p.descripcion || '', file: null, previewUrl: null, tieneFoto: !!p.tieneFoto,
      })),
    };
    // Si el área de esta liberación ya no está activa, el campo queda vacío y
    // al guardar se pide elegir una activa (el servidor solo acepta activas).
    if (form.area_id && !catalogos.areas.some(a => String(a.id) === form.area_id)) form.area_id = '';
    sucio = false;
    cerrarDetalle();
    cambiarPestana('registrar');
    pintarFormulario();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function eliminarDesdeDetalle() {
    const d = detalleActual;
    if (!d) return;
    if (!confirm(`¿Eliminar la liberación ${d.consecutivo}? Ya no aparecerá en la lista y su consecutivo no se vuelve a usar.`)) return;
    try {
      const { res, data } = await api(`/api/liberaciones/${d.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((data && data.error) || 'No se pudo eliminar');
      cerrarDetalle();
      toast(`${d.consecutivo} eliminada`, 'ok');
      buscarLiberados();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function enlazarLiberados() {
    $('lbBtnBuscar').addEventListener('click', buscarLiberados);
    $('lbFiltroTexto').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarLiberados(); });
    ['lbDesde', 'lbHasta', 'lbFiltroTurno', 'lbFiltroArea'].forEach(id => $(id).addEventListener('change', buscarLiberados));
    const marcarGrupo = (grupo, boton) => grupo.querySelectorAll('.lb-seg').forEach(b => {
      const activo = b === boton;
      b.classList.toggle('activo', activo);
      b.setAttribute('aria-checked', String(activo));
    });
    $('lbVistas').addEventListener('click', (e) => {
      const b = e.target.closest('[data-vista]');
      if (!b || b.getAttribute('data-vista') === vistaLiberados) return;
      vistaLiberados = b.getAttribute('data-vista');
      marcarGrupo($('lbVistas'), b);
      buscarLiberados();
    });
    $('lbFiltroEstado').addEventListener('click', (e) => {
      const b = e.target.closest('[data-filtro-tipo]');
      if (!b) return;
      filtroTipo = b.getAttribute('data-filtro-tipo');
      marcarGrupo($('lbFiltroEstado'), b);
      buscarLiberados();
    });
    $('lbListaRef').addEventListener('click', (e) => {
      const fila = e.target.closest('.lb-fila-ref');
      if (fila) abrirDetalle(fila.getAttribute('data-lib'));
    });
    $('lbListaRef').addEventListener('keydown', (e) => {
      const fila = e.target.closest('.lb-fila-ref');
      if (fila && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirDetalle(fila.getAttribute('data-lib')); }
    });
    $('lbLista').addEventListener('click', (e) => {
      const item = e.target.closest('.lb-item');
      if (item) abrirDetalle(item.getAttribute('data-id'));
    });
    $('lbLista').addEventListener('keydown', (e) => {
      const item = e.target.closest('.lb-item');
      if (item && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirDetalle(item.getAttribute('data-id')); }
    });
    $('lbDetCerrar').addEventListener('click', cerrarDetalle);
    $('lbDetalle').addEventListener('click', (e) => { if (e.target === $('lbDetalle')) cerrarDetalle(); });
    $('lbDetPdf').addEventListener('click', () => { if (detalleActual) abrirPdf(detalleActual.id); });
    $('lbDetEditar').addEventListener('click', editarDesdeDetalle);
    $('lbDetEliminar').addEventListener('click', eliminarDesdeDetalle);
    $('lbDetProductos').addEventListener('click', (e) => {
      const b = e.target.closest('.lb-det-foto[data-pid]');
      if (!b || !detalleActual) return;
      const p = detalleActual.productos[Number(b.getAttribute('data-i'))];
      abrirVisor(`${detalleActual.consecutivo} · Producto ${Number(b.getAttribute('data-i')) + 1} · ${p.referencia}`,
        () => urlBlob(`/api/liberaciones/${detalleActual.id}/productos/${p.id}/foto`));
    });

    $('lbResPdf').addEventListener('click', () => { if (ultimoGuardado) abrirPdf(ultimoGuardado.id); });
    $('lbResNueva').addEventListener('click', () => {
      if ($('lbResNueva').dataset.modo === 'reintentar') { reintentarFotos(); return; }
      $('lbResultado').style.display = 'none';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ------------------------------------------------------------- pestañas
  function cambiarPestana(nombre) {
    document.querySelectorAll('.lb-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === nombre));
    $('lbPanelRegistrar').style.display = nombre === 'registrar' ? 'block' : 'none';
    $('lbPanelLiberados').style.display = nombre === 'liberados' ? 'block' : 'none';
    if (nombre === 'liberados') buscarLiberados();
  }

  // --------------------------------------------------------------- inicio
  function llenarSelect(sel, opciones, primera) {
    sel.innerHTML = `<option value="">${esc(primera)}</option>` + opciones.map(o => `<option value="${esc(o.valor)}">${esc(o.texto)}</option>`).join('');
  }

  async function iniciar() {
    try {
      const { res, data } = await api('/api/liberaciones/catalogos');
      if (res.ok && data) catalogos = Object.assign(catalogos, data);
    } catch (e) { toast('No se pudieron cargar las áreas', 'error'); }

    const areas = catalogos.areas.map(a => ({ valor: String(a.id), texto: a.nombre }));
    llenarSelect($('lbArea'), areas, 'Selecciona…');
    llenarSelect($('lbFiltroArea'), areas, 'Todas');
    llenarSelect($('lbFiltroTurno'), catalogos.turnos.map(t => ({ valor: t, texto: t })), 'Todos');
    $('lbDesde').value = hoy(-30);
    $('lbHasta').value = hoy();

    const puedeRegistrar = tienePermiso('liberacion.registrar');
    $('lbTabRegistrar').style.display = puedeRegistrar ? '' : 'none';
    document.querySelectorAll('.lb-tabs .tab-btn').forEach(b => b.addEventListener('click', () => cambiarPestana(b.getAttribute('data-tab'))));

    form = formularioVacio();
    if (form.area_id && !catalogos.areas.some(a => String(a.id) === String(form.area_id))) form.area_id = '';
    enlazarFormulario();
    enlazarLiberados();
    enlazarVisor();
    pintarFormulario();
    cambiarPestana(puedeRegistrar ? 'registrar' : 'liberados');

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('lbVisor').style.display !== 'none') cerrarVisor();
      else if ($('lbDetalle').style.display !== 'none') cerrarDetalle();
    });
    window.addEventListener('beforeunload', (e) => {
      if (!sucio && !guardando) return;
      e.preventDefault();
      e.returnValue = '';
    });

    cargarMaestro().then(() => {
      // Ya con el maestro, se actualizan las descripciones de lo que esté escrito.
      document.querySelectorAll('#lbProductos .lb-producto').forEach(t => {
        const p = form.productos.find(x => x.clave === Number(t.getAttribute('data-clave')));
        if (p) actualizarDescRef(t, p);
      });
    });
  }

  // ------------------------------------------------------------ sesión
  const PERMISOS_MODULO = ['liberacion.registrar', 'liberacion.ver', 'liberacion.gestion'];

  async function init() {
    token = localStorage.getItem('token');
    if (!token) { $('loginOverlay').style.display = 'flex'; return; }
    try {
      const res = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token } });
      const data = await res.json();
      if (!res.ok || !data) throw new Error('sin sesión');
      usuarioActual = { id: data.id, nombre: data.usuario, rol: data.rol };
    } catch (e) {
      localStorage.removeItem('token');
      token = null;
      $('loginOverlay').style.display = 'flex';
      return;
    }
    await cargarPermisosDelUsuario();
    if (!PERMISOS_MODULO.some(p => tienePermiso(p))) {
      alert('No tienes permiso para acceder al módulo Liberación de producto.');
      location.href = 'index.html';
      return;
    }
    $('userNameDisplay').textContent = `${usuarioActual.nombre} (${usuarioActual.rol || 'Usuario'})`;
    const btnVolver = $('btnVolverPortal');
    if (btnVolver) btnVolver.style.display = tienePermiso('portal.volver') ? 'inline-flex' : 'none';
    $('loginOverlay').style.display = 'none';
    $('appHeader').style.display = 'flex';
    $('appMain').style.display = 'block';
    iniciar();
  }

  window.doLogout = async function () {
    if (sucio && !confirm('Tienes una liberación sin guardar. ¿Cerrar sesión de todas formas?')) return;
    sucio = false;
    try { await fetch('/api/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }); } catch (e) { /* sin red */ }
    localStorage.removeItem('token');
    token = null;
    location.reload();
  };

  // doLogin viene de js/comun.js (al iniciar sesión siempre se vuelve al portal).
  document.addEventListener('DOMContentLoaded', () => {
    $('loginPass').addEventListener('keypress', (e) => { if (e.key === 'Enter') doLogin(); });
    $('loginUser').addEventListener('keypress', (e) => { if (e.key === 'Enter') doLogin(); });
    init();
  });
})();
