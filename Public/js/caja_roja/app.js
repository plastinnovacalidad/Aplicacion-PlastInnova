// ========================================================================
// Caja roja (MIGRACIÓN #53) — registro de piezas por referencia y lote.
//
// Funciona sin conexión: el maestro de referencias se guarda en la tablet
// (localStorage) y cada registro se guarda primero en la tablet y luego se
// envía al servidor. Si no hay red, queda "pendiente" y se reenvía solo
// cuando vuelve la conexión (cada 20 s, al recuperar la red y al abrir la
// página). Cada registro lleva un identificador propio (uid) para que un
// reenvío nunca lo duplique en el servidor.
//
// Abrir sin señal (23/11/2026): con la app en https://, la tablet guarda
// una copia de esta página (Public/sw-caja-roja.js) la primera vez que la
// abre con conexión; desde ahí, recargarla o abrirla sin red funciona.
// Mientras la app siga en http:// (o en una tablet que nunca la abrió con
// conexión), la limitación de antes sigue: si se recarga sin red, no abre
// hasta que vuelva. Para ese caso, la página pide confirmación antes de
// recargar o salir sin red, y Caja roja tiene apagado el gesto de deslizar
// hacia abajo para recargar (css/caja_roja.css).
// ========================================================================

let token = localStorage.getItem('token');
let permisosUsuario = [];
let usuarioActual = null;

(function () {
  'use strict';

  // ---------------------------------------------------------------- claves
  const K_MAESTRO = 'cajaRoja.maestro';
  const K_PENDIENTES = 'cajaRoja.pendientes';
  const K_RECIENTES = 'cajaRoja.recientes';
  const K_AREA = 'cajaRoja.area';
  const K_USUARIO = 'cajaRoja.usuario';

  const ORDEN_TIPOS = ['LAM', 'CIR', 'SUP', 'INY'];
  const NOMBRE_TIPOS = { LAM: 'Lámpara', CIR: 'Circuito', SUP: 'Sin cablear', INY: 'Inyección' };
  const VOLTAJES = ['24', '12', 'MUL'];
  const SIN_VOLTAJE = 'Sin voltaje';
  const SIN_COLOR = 'Sin color';
  // AH, RS y PC están pendientes de confirmar: se muestran solo con su código.
  const COLORES = { AM: 'Amarillo', RO: 'Rojo', AZ: 'Azul', BL: 'Blanco', VE: 'Verde', MO: 'Morado', HU: 'Humo', CR: 'Cristal' };
  const MAX_LISTA = 200;
  const LOTE_ENVIO = 100;

  // ---------------------------------------------------------------- estado
  let items = [];          // [{ id, ref, desc, tipo, modelo, numero, color, voltaje }]
  let maestroVersion = null;
  let pendientes = [];     // registros aún no confirmados por el servidor
  let recientes = [];      // últimos 10 registros hechos en esta tablet
  let seleccion = {};      // { tipo, modelo, color, voltaje }
  let enLinea = navigator.onLine;
  let sesionVencida = false;
  let enviando = false;
  let registrosServidor = [];
  let saliendo = false;    // true cuando la salida es a propósito (Cerrar Sesión)

  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------- almacenamiento
  function leer(clave, porDefecto) {
    try { const v = localStorage.getItem(clave); return v ? JSON.parse(v) : porDefecto; }
    catch (e) { return porDefecto; }
  }
  function guardar(clave, valor) {
    try { localStorage.setItem(clave, JSON.stringify(valor)); return true; }
    catch (e) { return false; }
  }

  // ------------------------------------------------------------ utilidades
  function hoy() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function horaActual() {
    const d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
  }
  // crypto.randomUUID solo existe en https/localhost; getRandomValues sí
  // funciona por http en la red local.
  function nuevoUid() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  function fechaCorta(iso) {
    if (!iso) return '';
    const [a, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  }
  function numero(n) { return Number(n || 0).toLocaleString('es-CO'); }
  function esc(t) { return escapeHtml(t == null ? '' : String(t)); }

  let toastTimer = null;
  function toast(texto, tipo) {
    const t = $('crToast');
    t.className = 'cr-toast visible ' + (tipo || '');
    t.innerHTML = texto;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'cr-toast'; }, 2800);
  }

  async function api(url, opciones = {}) {
    const headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opciones.headers || {});
    const res = await fetch(url, Object.assign({}, opciones, { headers, cache: 'no-store' }));
    let data = null;
    try { data = await res.json(); } catch (e) { /* respuesta sin JSON */ }
    return { res, data };
  }

  // -------------------------------------------------------- referencias
  // TIPO/MODELO/COLOR(es)/VOLTAJE. Modelo = primer segmento con número
  // (en INY puede tener prefijo: REP/1060). Voltaje = último segmento si es
  // 12, 24 o MUL. Color = lo que queda entre los dos.
  function interpretar(ref) {
    const seg = ref.split('/');
    const tipo = seg[0];
    let iModelo = seg.findIndex((s, i) => i > 0 && /\d/.test(s));
    if (iModelo === -1) iModelo = Math.min(1, seg.length - 1);
    const numeroModelo = seg[iModelo] || '';
    const modelo = seg.slice(1, iModelo + 1).join('/');
    let fin = seg.length;
    let voltaje = SIN_VOLTAJE;
    if (seg.length - 1 > iModelo && VOLTAJES.includes(seg[seg.length - 1])) {
      voltaje = seg[seg.length - 1];
      fin = seg.length - 1;
    }
    const color = seg.slice(iModelo + 1, fin).join('/') || SIN_COLOR;
    return { tipo, modelo, numero: numeroModelo, color, voltaje };
  }

  function nombreColor(codigo) {
    if (codigo === SIN_COLOR) return '';
    const partes = [];
    for (const parte of codigo.split('/')) {
      if (COLORES[parte]) { partes.push(COLORES[parte]); continue; }
      // AMRO -> Amarillo · Rojo (si todos los pedazos de 2 letras se conocen)
      const trozos = parte.match(/.{1,2}/g) || [];
      if (parte.length % 2 === 0 && trozos.every(t => COLORES[t])) partes.push(...trozos.map(t => COLORES[t]));
      else partes.push(parte);
    }
    return partes.join(' · ');
  }

  function cargarItems(lista) {
    items = (lista || []).map(([id, ref, desc]) => Object.assign({ id, ref, desc }, interpretar(ref)));
    $('crMaestroVacio').style.display = items.length ? 'none' : 'block';
  }

  // ----------------------------------------------------------- maestro
  async function actualizarMaestro() {
    try {
      const v = maestroVersion ? '?version=' + encodeURIComponent(maestroVersion) : '';
      const { res, data } = await api('/api/caja-roja/maestro' + v);
      marcarConexion(true);
      if (res.status === 401) { marcarSesionVencida(); return; }
      if (!res.ok || !data) return;
      if (!data.sinCambios) {
        maestroVersion = data.actualizado;
        cargarItems(data.items);
        if (!guardar(K_MAESTRO, { actualizado: data.actualizado, total: data.total, items: data.items })) {
          console.warn('No se pudo guardar el maestro en la tablet (sin espacio).');
        }
        buscar();
      }
      mostrarInfoMaestro(data.actualizado, data.total);
    } catch (e) {
      marcarConexion(false);
    }
  }

  function mostrarInfoMaestro(actualizado, total) {
    $('crMaestroInfo').textContent = actualizado
      ? ` · ${numero(total)} referencias · actualizado el ${fechaCorta(actualizado.slice(0, 10))}`
      : ' · sin cargar';
  }

  // ---------------------------------------------------------- búsqueda
  function candidatos() {
    const q = $('crBuscar').value.trim().toUpperCase().replace(/\s+/g, '');
    if (!q) return [];
    let lista = items.filter(it => it.numero.startsWith(q) || it.modelo.startsWith(q));
    if (!lista.length) lista = items.filter(it => it.ref.includes(q));
    return lista;
  }

  const PASOS = [
    { clave: 'tipo', titulo: 'Tipo' },
    { clave: 'modelo', titulo: 'Variante / modelo' },
    { clave: 'color', titulo: 'Color' },
    { clave: 'voltaje', titulo: 'Voltaje' },
  ];

  function ordenarOpciones(clave, opciones, q) {
    if (clave === 'tipo') {
      const pos = (t) => { const k = ORDEN_TIPOS.indexOf(t); return k === -1 ? 99 : k; };
      return opciones.sort((a, b) => pos(a) - pos(b) || a.localeCompare(b));
    }
    if (clave === 'voltaje') {
      const orden = [...VOLTAJES, SIN_VOLTAJE];
      return opciones.sort((a, b) => orden.indexOf(a) - orden.indexOf(b));
    }
    if (clave === 'modelo') {
      return opciones.sort((a, b) => {
        const ea = a.split('/').pop() === q ? 0 : 1;
        const eb = b.split('/').pop() === q ? 0 : 1;
        return ea - eb || a.length - b.length || a.localeCompare(b);
      });
    }
    return opciones.sort((a, b) => (a === SIN_COLOR ? -1 : 0) - (b === SIN_COLOR ? -1 : 0) || a.localeCompare(b));
  }

  function etiquetaOpcion(clave, valor) {
    if (clave === 'tipo') return `<b>${esc(valor)}</b><small>${esc(NOMBRE_TIPOS[valor] || '')}</small>`;
    if (clave === 'color') {
      const nombre = nombreColor(valor);
      return `<b>${esc(valor)}</b>${nombre && nombre !== valor ? `<small>${esc(nombre)}</small>` : ''}`;
    }
    if (clave === 'voltaje') return `<b>${esc(valor === 'MUL' ? 'MUL' : valor === SIN_VOLTAJE ? valor : valor + ' V')}</b>${valor === 'MUL' ? '<small>Multivoltaje</small>' : ''}`;
    return `<b>${esc(valor)}</b>`;
  }

  // Recorre los pasos en orden: cada paso filtra por lo ya elegido; si un
  // paso tiene una sola opción se elige solo.
  function buscar() {
    const q = $('crBuscar').value.trim().toUpperCase().replace(/\s+/g, '');
    let lista = candidatos();
    let html = '';
    for (const paso of PASOS) {
      if (!lista.length) break;
      const opciones = ordenarOpciones(paso.clave, [...new Set(lista.map(it => it[paso.clave]))], q);
      if (seleccion[paso.clave] && !opciones.includes(seleccion[paso.clave])) delete seleccion[paso.clave];
      if (opciones.length === 1) seleccion[paso.clave] = opciones[0];
      const elegido = seleccion[paso.clave];
      html += `<div class="cr-paso${elegido ? ' hecho' : ''}">
        <div class="cr-paso-titulo">${esc(paso.titulo)}${opciones.length === 1 ? ' <span class="cr-auto">única opción</span>' : ''}</div>
        <div class="cr-opciones">${opciones.map(o =>
          `<button type="button" class="cr-opcion${o === elegido ? ' activa' : ''}" data-clave="${paso.clave}" data-valor="${esc(o)}">${etiquetaOpcion(paso.clave, o)}</button>`
        ).join('')}</div>
      </div>`;
      if (!elegido) break;
      lista = lista.filter(it => it[paso.clave] === elegido);
    }
    $('crPasos').innerHTML = html;
    pintarLista(lista);

    const unico = lista.length === 1 && PASOS.every(p => seleccion[p.clave]) ? lista[0] : null;
    mostrarFinal(unico);
  }

  function pintarLista(lista) {
    $('crContador').textContent = numero(lista.length);
    if (!$('crBuscar').value.trim()) {
      $('crLista').innerHTML = '<div class="cr-lista-vacia">Escribe un número para ver las referencias.</div>';
      return;
    }
    if (!lista.length) {
      $('crLista').innerHTML = '<div class="cr-lista-vacia">No hay referencias con ese número.</div>';
      return;
    }
    const visibles = lista.slice(0, MAX_LISTA);
    $('crLista').innerHTML = visibles.map(it =>
      `<button type="button" class="cr-item" data-ref="${esc(it.ref)}"><span class="cr-item-ref">${esc(it.ref)}</span><span class="cr-item-desc">${esc(it.desc)}</span></button>`
    ).join('') + (lista.length > MAX_LISTA ? `<div class="cr-lista-vacia">y ${numero(lista.length - MAX_LISTA)} más… sigue eligiendo arriba.</div>` : '');
  }

  let itemFinal = null;
  function mostrarFinal(it) {
    const cambio = (it && it.ref) !== (itemFinal && itemFinal.ref);
    itemFinal = it;
    $('crFinal').style.display = it ? 'flex' : 'none';
    if (!it) return;
    $('crFinalRef').textContent = it.ref;
    if (cambio) {
      $('crErrorRegistro').textContent = '';
      setTimeout(() => $('crLote').focus(), 30);
    }
  }

  function limpiarBusqueda() {
    $('crBuscar').value = '';
    seleccion = {};
    $('crLote').value = '';
    $('crCantidad').value = '';
    buscar();
    $('crBuscar').focus();
  }

  // ---------------------------------------------------------- registrar
  function registrar() {
    const err = $('crErrorRegistro');
    err.textContent = '';
    if (!itemFinal) return;
    const fecha = $('crFecha').value;
    const area = $('crArea').value;
    const lote = $('crLote').value.trim().toUpperCase();
    const cantidad = Number($('crCantidad').value);
    if (!fecha) { err.textContent = 'Elige la fecha.'; $('crFecha').focus(); return; }
    if (!area) { err.textContent = 'Elige el área.'; $('crArea').focus(); return; }
    if (!lote) { err.textContent = 'El lote es obligatorio.'; $('crLote').focus(); return; }
    if (!Number.isInteger(cantidad) || cantidad < 1) { err.textContent = 'Escribe una cantidad entera mayor que 0.'; $('crCantidad').focus(); return; }

    // Evita el doble toque: misma referencia, lote, área y fecha hace menos de 2 minutos.
    const hace2min = Date.now() - 2 * 60 * 1000;
    const repetido = recientes.find(r => r.referencia === itemFinal.ref && r.lote === lote && r.area === area && r.fecha === fecha && r.creadoMs > hace2min);
    if (repetido && !confirm(`Ya registraste ${itemFinal.ref} lote ${lote} hace un momento (${repetido.cantidad} und). ¿Registrar otra vez?`)) return;

    const registro = {
      uid: nuevoUid(),
      fecha, hora_registro: horaActual(), area,
      f120_id: itemFinal.id, referencia: itemFinal.ref, descripcion: itemFinal.desc,
      lote, cantidad,
      usuario_nombre: usuarioActual ? usuarioActual.nombre : '',
      sin_conexion: !enLinea,
      creadoMs: Date.now(),
      estado: 'pendiente',
    };
    pendientes.push(registro);
    const guardado = guardar(K_PENDIENTES, pendientes);
    recientes.unshift(Object.assign({}, registro));
    recientes = recientes.slice(0, 10);
    guardar(K_RECIENTES, recientes);

    toast(`<i class="fa-solid fa-check"></i> ${esc(registro.referencia)} · Lote ${esc(lote)} · ${numero(cantidad)} und`, 'ok');
    if (!guardado) toast('<i class="fa-solid fa-triangle-exclamation"></i> No se pudo guardar en la tablet. No cierres la página hasta que se envíe.', 'error');
    limpiarBusqueda();
    pintarRecientes();
    enviarPendientes();
  }

  // ------------------------------------------------- envío al servidor
  async function enviarPendientes() {
    const porEnviar = pendientes.filter(p => p.estado === 'pendiente');
    if (enviando || !porEnviar.length || sesionVencida) { actualizarAviso(); return; }
    enviando = true;
    try {
      for (let i = 0; i < porEnviar.length; i += LOTE_ENVIO) {
        const tanda = porEnviar.slice(i, i + LOTE_ENVIO).map(p => ({
          uid: p.uid, fecha: p.fecha, hora_registro: p.hora_registro, area: p.area,
          f120_id: p.f120_id, referencia: p.referencia, descripcion: p.descripcion,
          lote: p.lote, cantidad: p.cantidad, sin_conexion: p.sin_conexion,
        }));
        let r;
        try {
          r = await api('/api/caja-roja/registros', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registros: tanda }),
          });
        } catch (e) { marcarConexion(false); break; }
        marcarConexion(true);
        if (r.res.status === 401) { marcarSesionVencida(); break; }
        if (!r.res.ok || !r.data || !Array.isArray(r.data.resultados)) {
          mostrarAviso((r.data && r.data.error) || 'El servidor no aceptó los registros.', false);
          break;
        }
        for (const resultado of r.data.resultados) {
          const p = pendientes.find(x => x.uid === resultado.uid);
          if (!p) continue;
          if (resultado.estado === 'rechazado') { p.estado = 'rechazado'; p.error = resultado.error; }
          else p.estado = 'enviado';
          const rec = recientes.find(x => x.uid === resultado.uid);
          if (rec) { rec.estado = p.estado; rec.error = p.error; }
        }
        pendientes = pendientes.filter(p => p.estado !== 'enviado');
        guardar(K_PENDIENTES, pendientes);
        guardar(K_RECIENTES, recientes);
      }
    } finally {
      enviando = false;
      pintarRecientes();
      actualizarAviso();
    }
  }

  function descartarRechazado(uid) {
    if (!confirm('¿Descartar este registro? No se enviará al servidor.')) return;
    pendientes = pendientes.filter(p => p.uid !== uid);
    recientes = recientes.filter(p => p.uid !== uid);
    guardar(K_PENDIENTES, pendientes);
    guardar(K_RECIENTES, recientes);
    pintarRecientes();
    actualizarAviso();
  }

  // ---------------------------------------------------- estado conexión
  function marcarConexion(ok) {
    enLinea = ok;
    const el = $('crConexion');
    el.classList.toggle('sin', !ok);
    actualizarAviso();
  }

  function marcarSesionVencida() {
    sesionVencida = true;
    actualizarAviso();
  }

  function mostrarAviso(texto, conBoton) {
    $('crAviso').style.display = 'flex';
    $('crAvisoTexto').textContent = texto;
    $('crBtnEnviarAhora').style.display = conBoton ? '' : 'none';
  }

  function actualizarAviso() {
    const nPend = pendientes.filter(p => p.estado === 'pendiente').length;
    const nRech = pendientes.filter(p => p.estado === 'rechazado').length;
    const txt = $('crConexionTexto');
    txt.textContent = enLinea ? (nPend ? `En línea · ${nPend} por enviar` : 'En línea') : `Sin conexión${nPend ? ' · ' + nPend + ' por enviar' : ''}`;

    if (sesionVencida && nPend) {
      mostrarAviso(`Tu sesión se cerró. Hay ${nPend} registro(s) guardados en esta tablet: inicia sesión de nuevo y vuelve a entrar a Caja roja para enviarlos.`, false);
    } else if (nRech) {
      mostrarAviso(`${nRech} registro(s) no fueron aceptados por el servidor. Revísalos en "Últimos registros".`, false);
    } else if (nPend && !enLinea) {
      mostrarAviso(`Sin conexión con el servidor. ${nPend} registro(s) guardados en esta tablet; se enviarán solos cuando vuelva la conexión.`, true);
    } else if (nPend) {
      mostrarAviso(`${nPend} registro(s) por enviar.`, true);
    } else {
      $('crAviso').style.display = 'none';
    }
  }

  function pintarRecientes() {
    if (!recientes.length) {
      $('crRecientes').innerHTML = '<div class="cr-lista-vacia">Aún no hay registros.</div>';
      return;
    }
    const etiquetas = {
      enviado: '<span class="cr-estado ok"><i class="fa-solid fa-check"></i> Enviado</span>',
      pendiente: '<span class="cr-estado pend"><i class="fa-solid fa-clock"></i> Por enviar</span>',
      rechazado: '<span class="cr-estado err"><i class="fa-solid fa-xmark"></i> Rechazado</span>',
    };
    $('crRecientes').innerHTML = recientes.map(r => `
      <div class="cr-reciente">
        <span class="cr-rec-hora">${esc(r.hora_registro.slice(0, 5))}</span>
        <span class="cr-rec-ref">${esc(r.referencia)}</span>
        <span class="cr-rec-lote">Lote ${esc(r.lote)}</span>
        <span class="cr-rec-cant">${numero(r.cantidad)} und</span>
        <span class="cr-rec-area">${esc(r.area)}</span>
        ${etiquetas[r.estado] || ''}
        ${r.estado === 'rechazado' ? `<span class="cr-rec-error">${esc(r.error || '')}</span><button type="button" class="cr-btn-mini" data-descartar="${esc(r.uid)}">Descartar</button>` : ''}
      </div>`).join('');
  }

  // ---------------------------------------------------------- consultar
  async function consultar() {
    const params = new URLSearchParams();
    if ($('crDesde').value) params.set('desde', $('crDesde').value);
    if ($('crHasta').value) params.set('hasta', $('crHasta').value);
    if ($('crFiltroArea').value) params.set('area', $('crFiltroArea').value);
    $('crTablaCuerpo').innerHTML = '<tr><td colspan="11" class="cr-cargando">Cargando…</td></tr>';
    try {
      const { res, data } = await api('/api/caja-roja/registros?' + params.toString());
      marcarConexion(true);
      if (res.status === 401) { marcarSesionVencida(); registrosServidor = []; }
      else if (!res.ok) { toast(esc((data && data.error) || 'No se pudo consultar'), 'error'); registrosServidor = []; }
      else {
        registrosServidor = data.registros || [];
        $('crNotaConsulta').textContent = data.soloPropios ? 'Solo ves los registros que hiciste tú.' : '';
      }
    } catch (e) {
      marcarConexion(false);
      registrosServidor = [];
      toast('<i class="fa-solid fa-wifi"></i> Sin conexión: solo se muestran los registros por enviar de esta tablet.', 'error');
    }
    pintarTabla();
  }

  function filasVisibles() {
    const desde = $('crDesde').value, hasta = $('crHasta').value, area = $('crFiltroArea').value;
    const locales = pendientes
      .filter(p => (!desde || p.fecha >= desde) && (!hasta || p.fecha <= hasta) && (!area || p.area === area))
      .map(p => Object.assign({ local: true }, p));
    const q = $('crFiltroTexto').value.trim().toUpperCase();
    return [...locales, ...registrosServidor].filter(r => !q ||
      [r.referencia, r.lote, r.usuario_nombre, r.descripcion, r.f120_id, r.area].some(v => String(v || '').toUpperCase().includes(q)));
  }

  function pintarTabla() {
    const filas = filasVisibles();
    const puedeEliminar = tienePermiso('caja_roja.gestion');
    document.querySelectorAll('.cr-col-acc').forEach(c => { c.style.display = puedeEliminar ? '' : 'none'; });
    if (!filas.length) {
      $('crTablaCuerpo').innerHTML = '<tr><td colspan="11" class="cr-cargando">No hay registros con esos filtros.</td></tr>';
    } else {
      $('crTablaCuerpo').innerHTML = filas.map((r, i) => `
        <tr class="${r.local ? 'cr-fila-local' : ''}">
          <td class="num">${i + 1}</td>
          <td>${esc(fechaCorta(r.fecha))}</td>
          <td>${esc((r.hora_registro || '').slice(0, 5))}</td>
          <td>${esc(r.area)}</td>
          <td class="desc">${esc(r.usuario_nombre)}</td>
          <td class="dato">${esc(r.f120_id)}</td>
          <td class="dato">${esc(r.referencia)}${r.local ? ` <span class="cr-estado ${r.estado === 'rechazado' ? 'err' : 'pend'}">${r.estado === 'rechazado' ? 'Rechazado' : 'Por enviar'}</span>` : ''}</td>
          <td class="desc">${esc(r.descripcion)}</td>
          <td class="dato">${esc(r.lote)}</td>
          <td class="num">${numero(r.cantidad)}</td>
          <td class="cr-col-acc"${puedeEliminar ? '' : ' style="display:none"'}>${!r.local && puedeEliminar ? `<button type="button" class="cr-btn-icono" data-eliminar="${r.id}" title="Eliminar registro" aria-label="Eliminar registro"><i class="fa-solid fa-trash"></i></button>` : ''}</td>
        </tr>`).join('');
    }
    const total = filas.reduce((s, r) => s + Number(r.cantidad || 0), 0);
    $('crTotalTexto').textContent = `${numero(filas.length)} registro(s)`;
    $('crTotalCant').textContent = numero(total);
  }

  async function eliminar(id) {
    const r = registrosServidor.find(x => String(x.id) === String(id));
    if (!r) return;
    if (!confirm(`¿Eliminar el registro de ${r.referencia}, lote ${r.lote} (${r.cantidad} und)?`)) return;
    try {
      const { res, data } = await api('/api/caja-roja/registros/' + encodeURIComponent(id), { method: 'DELETE' });
      if (!res.ok) { toast(esc((data && data.error) || 'No se pudo eliminar'), 'error'); return; }
      registrosServidor = registrosServidor.filter(x => String(x.id) !== String(id));
      pintarTabla();
      toast('<i class="fa-solid fa-trash"></i> Registro eliminado', 'ok');
    } catch (e) {
      marcarConexion(false);
      toast('Sin conexión: no se puede eliminar ahora.', 'error');
    }
  }

  function exportarCsv() {
    const filas = filasVisibles().filter(r => !r.local);
    if (!filas.length) { toast('No hay registros enviados para exportar.', 'error'); return; }
    const campo = (v) => {
      const s = String(v == null ? '' : v);
      return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lineas = [['fecha', 'hora_registro', 'area', 'nombre', 'f120_id', 'f120_referencia', 'f120_descripcion', 'lote', 'cantidad'].join(';')];
    for (const r of filas) {
      lineas.push([r.fecha, r.hora_registro, r.area, r.usuario_nombre, r.f120_id, r.referencia, r.descripcion, r.lote, r.cantidad].map(campo).join(';'));
    }
    const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `caja_roja_${$('crDesde').value || 'inicio'}_${$('crHasta').value || hoy()}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  async function subirMaestro(archivo) {
    if (!archivo) return;
    // El ERP suele exportar en Windows-1252; si el texto no es UTF-8 válido
    // se vuelve a leer con esa codificación para no dañar las tildes.
    const buf = await archivo.arrayBuffer();
    let texto;
    try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { texto = new TextDecoder('windows-1252').decode(buf); }
    try {
      const { res, data } = await api('/api/caja-roja/maestro', {
        method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: texto,
      });
      if (!res.ok) { toast(esc((data && data.error) || 'No se pudo cargar el maestro'), 'error'); return; }
      toast(`<i class="fa-solid fa-check"></i> Maestro actualizado: ${numero(data.total)} referencias`, 'ok');
      await actualizarMaestro();
    } catch (e) {
      marcarConexion(false);
      toast('Sin conexión: no se puede cargar el maestro ahora.', 'error');
    } finally {
      $('crArchivoMaestro').value = '';
    }
  }


  // ------------------------------------------------------ reporte semanal
  // Semana de lunes a domingo. Los datos los calcula el servidor
  // (/api/caja-roja/resumen); sin conexión el reporte no se puede armar.
  const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const FABRICAS = ['Fábrica 1', 'Fábrica 2', 'Fábrica 3', 'Fábrica 4'];
  const TOP_INICIAL = 15;
  let repLunes = null;
  let repDatos = null;
  let repVerTodas = false;
  let repPeticion = 0;

  function lunesDe(fecha) {
    const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }
  function sumarDias(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function textoDia(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // Número de semana ISO (la que usa normalmente producción).
  function semanaIso(d) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const inicio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - inicio) / 86400000 + 1) / 7);
  }
  function textoRango(ini, fin) {
    if (ini.getMonth() === fin.getMonth()) return `${ini.getDate()} al ${fin.getDate()} de ${MESES[fin.getMonth()]} de ${fin.getFullYear()}`;
    if (ini.getFullYear() === fin.getFullYear()) return `${ini.getDate()} de ${MESES[ini.getMonth()]} al ${fin.getDate()} de ${MESES[fin.getMonth()]} de ${fin.getFullYear()}`;
    return `${ini.getDate()} de ${MESES[ini.getMonth()]} de ${ini.getFullYear()} al ${fin.getDate()} de ${MESES[fin.getMonth()]} de ${fin.getFullYear()}`;
  }
  function porcentaje(parte, total) {
    if (!total) return '0 %';
    const v = (parte / total) * 100;
    return (v < 10 ? v.toFixed(1) : Math.round(v)).toString().replace('.', ',') + ' %';
  }

  function moverSemana(n) {
    repLunes = sumarDias(repLunes, 7 * n);
    cargarReporte();
  }

  function pintarEncabezadoSemana() {
    const fin = sumarDias(repLunes, 6);
    const esActual = textoDia(repLunes) === textoDia(lunesDe(new Date()));
    $('crSemTitulo').textContent = `Semana ${semanaIso(repLunes)}${esActual ? ' · esta semana' : ''}`;
    $('crSemRango').textContent = textoRango(repLunes, fin);
    $('crSemSiguiente').disabled = esActual;
    $('crSemActual').style.display = esActual ? 'none' : '';
    const ahora = new Date();
    $('crRepImpresionSub').textContent = `Semana ${semanaIso(repLunes)} · ${textoRango(repLunes, fin)} · ${$('crRepArea').value || 'Todas las fábricas'} · Generado el ${fechaCorta(textoDia(ahora))} ${horaActual().slice(0, 5)}${usuarioActual ? ' por ' + usuarioActual.nombre : ''}`;
  }

  async function cargarReporte() {
    if (!repLunes) repLunes = lunesDe(new Date());
    pintarEncabezadoSemana();
    const params = new URLSearchParams({ desde: textoDia(repLunes), hasta: textoDia(sumarDias(repLunes, 6)) });
    if ($('crRepArea').value) params.set('area', $('crRepArea').value);
    const peticion = ++repPeticion;
    $('crReporte').classList.add('cargando');
    try {
      const { res, data } = await api('/api/caja-roja/resumen?' + params.toString());
      if (peticion !== repPeticion) return; // ya se pidió otra semana
      marcarConexion(true);
      if (res.status === 401) { marcarSesionVencida(); return; }
      if (!res.ok || !data) { toast(esc((data && data.error) || 'No se pudo armar el reporte'), 'error'); return; }
      repDatos = data;
      repVerTodas = false;
      pintarReporte();
    } catch (e) {
      if (peticion !== repPeticion) return;
      marcarConexion(false);
      toast('<i class="fa-solid fa-wifi"></i> Sin conexión: el reporte necesita el servidor.', 'error');
    } finally {
      if (peticion === repPeticion) $('crReporte').classList.remove('cargando');
    }
  }

  function pintarReporte() {
    const d = repDatos;
    const t = d.totales;
    $('crKpiPiezas').textContent = numero(t.piezas);
    const ant = d.anterior ? d.anterior.piezas : 0;
    let comp = '';
    if (!ant && !t.piezas) comp = 'Sin registros esta semana ni la anterior';
    else if (!ant) comp = 'La semana anterior no hubo registros';
    else {
      const dif = t.piezas - ant;
      const icono = dif > 0 ? 'fa-arrow-up' : dif < 0 ? 'fa-arrow-down' : 'fa-equals';
      const palabra = dif > 0 ? 'más' : dif < 0 ? 'menos' : 'igual';
      comp = dif === 0
        ? `<i class="fa-solid ${icono}"></i> Igual que la semana anterior (${numero(ant)})`
        : `<i class="fa-solid ${icono}"></i> ${porcentaje(Math.abs(dif), ant)} ${palabra} que la semana anterior (${numero(ant)})`;
    }
    $('crKpiComparacion').innerHTML = comp;
    $('crKpiRegistros').textContent = numero(t.registros);
    $('crKpiLotes').textContent = t.lotes === 1 ? '1 lote' : `${numero(t.lotes)} lotes`;
    $('crKpiRefs').textContent = numero(t.referencias);
    const top = d.porReferencia[0];
    $('crKpiTopRef').textContent = top ? `La que más: ${top.referencia} (${numero(top.piezas)})` : '';
    const fab = [...d.porArea].sort((a, b) => b.piezas - a.piezas)[0];
    $('crKpiFabrica').textContent = fab ? fab.area : '—';
    $('crKpiFabricaSub').textContent = fab ? `${numero(fab.piezas)} piezas · ${porcentaje(fab.piezas, t.piezas)} del total` : '';

    pintarGraficaDias();
    pintarGraficaFabricas();
    pintarTopReferencias();
    pintarMatriz();
  }

  function diasSemana() {
    return Array.from({ length: 7 }, (_, i) => sumarDias(repLunes, i));
  }

  function pintarGraficaDias() {
    const totales = {};
    for (const r of repDatos.porFechaArea) totales[r.fecha] = (totales[r.fecha] || 0) + r.piezas;
    const dias = diasSemana();
    const max = Math.max(1, ...dias.map(dd => totales[textoDia(dd)] || 0));
    $('crGrafDias').innerHTML = dias.map((dd, i) => {
      const v = totales[textoDia(dd)] || 0;
      const alto = v ? Math.max(2, Math.round((v / max) * 100)) : 0;
      return `<div class="cr-bv" title="${DIAS_CORTOS[i]} ${dd.getDate()}: ${numero(v)} piezas">
        <span class="cr-bv-valor">${v ? numero(v) : ''}</span>
        <div class="cr-bv-pista"><div class="cr-bv-barra" style="height:${alto}%"></div></div>
        <span class="cr-bv-dia">${DIAS_CORTOS[i]} ${dd.getDate()}</span>
      </div>`;
    }).join('');
  }

  function pintarGraficaFabricas() {
    const area = $('crRepArea').value;
    const lista = (area ? [area] : FABRICAS).map(f => {
      const fila = repDatos.porArea.find(r => r.area === f);
      return { area: f, piezas: fila ? fila.piezas : 0, registros: fila ? fila.registros : 0 };
    });
    const max = Math.max(1, ...lista.map(f => f.piezas));
    const total = repDatos.totales.piezas;
    $('crGrafFabricas').innerHTML = lista.map(f => `
      <div class="cr-bh" title="${esc(f.area)}: ${numero(f.piezas)} piezas en ${numero(f.registros)} registro(s)">
        <span class="cr-bh-nombre">${esc(f.area)}</span>
        <div class="cr-bh-pista"><div class="cr-bh-barra" style="width:${f.piezas ? Math.max(1, (f.piezas / max) * 100) : 0}%"></div></div>
        <span class="cr-bh-valor">${numero(f.piezas)}<small>${porcentaje(f.piezas, total)}</small></span>
      </div>`).join('');
  }

  function pintarTopReferencias() {
    const lista = repDatos.porReferencia;
    const total = repDatos.totales.piezas;
    const visibles = repVerTodas ? lista : lista.slice(0, TOP_INICIAL);
    const max = Math.max(1, ...lista.map(r => r.piezas));
    const btn = $('crRepVerTodas');
    btn.style.display = lista.length > TOP_INICIAL ? '' : 'none';
    btn.textContent = repVerTodas ? `Ver solo las ${TOP_INICIAL} primeras` : `Ver todas (${numero(lista.length)})`;
    $('crRepTopCuerpo').innerHTML = visibles.length ? visibles.map((r, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td class="dato">${esc(r.referencia)}</td>
        <td class="desc">${esc(r.descripcion)}</td>
        <td class="cr-col-barra"><div class="cr-celda-barra"><div class="cr-celda-barra-pista"><div style="width:${Math.max(1, (r.piezas / max) * 100)}%"></div></div><span>${numero(r.piezas)}</span></div></td>
        <td class="num">${porcentaje(r.piezas, total)}</td>
        <td class="num">${numero(r.registros)}</td>
        <td class="num">${numero(r.lotes)}</td>
      </tr>`).join('')
      : '<tr><td colspan="7" class="cr-cargando">No hubo registros en esta semana.</td></tr>';
  }

  function pintarMatriz() {
    const area = $('crRepArea').value;
    const columnas = area ? [area] : FABRICAS;
    const mapa = {};
    for (const r of repDatos.porFechaArea) mapa[r.fecha + '|' + r.area] = r.piezas;
    $('crRepMatrizCabeza').innerHTML = `<tr><th>Día</th>${columnas.map(c => `<th class="num">${esc(c)}</th>`).join('')}${columnas.length > 1 ? '<th class="num">Total</th>' : ''}</tr>`;
    const totCol = columnas.map(() => 0);
    const filas = diasSemana().map((dd, i) => {
      const f = textoDia(dd);
      const vals = columnas.map((c, k) => { const v = mapa[f + '|' + c] || 0; totCol[k] += v; return v; });
      const tot = vals.reduce((a, b) => a + b, 0);
      return `<tr><td>${DIAS_CORTOS[i]} ${fechaCorta(f)}</td>${vals.map(v => `<td class="num${v ? '' : ' cero'}">${v ? numero(v) : '—'}</td>`).join('')}${columnas.length > 1 ? `<td class="num total">${tot ? numero(tot) : '—'}</td>` : ''}</tr>`;
    });
    const granTotal = totCol.reduce((a, b) => a + b, 0);
    filas.push(`<tr class="cr-fila-total"><td>Total semana</td>${totCol.map(v => `<td class="num">${numero(v)}</td>`).join('')}${columnas.length > 1 ? `<td class="num">${numero(granTotal)}</td>` : ''}</tr>`);
    $('crRepMatrizCuerpo').innerHTML = filas.join('');
  }

  // ------------------------------------------------------------- pestañas
  function cambiarPestana(tab) {
    document.querySelectorAll('.cr-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('crPanelCargar').style.display = tab === 'cargar' ? '' : 'none';
    $('crPanelConsultar').style.display = tab === 'consultar' ? '' : 'none';
    $('crPanelReporte').style.display = tab === 'reporte' ? '' : 'none';
    if (tab === 'consultar') consultar();
    if (tab === 'reporte') cargarReporte();
  }

  // -------------------------------------------------------------- eventos
  function enlazarEventos() {
    $('crBuscar').addEventListener('input', () => { seleccion = {}; buscar(); });
    $('crLimpiar').addEventListener('click', limpiarBusqueda);
    $('crPasos').addEventListener('click', (e) => {
      const b = e.target.closest('.cr-opcion');
      if (!b) return;
      const clave = b.dataset.clave;
      const idx = PASOS.findIndex(p => p.clave === clave);
      // Cambiar un paso borra lo elegido en los siguientes.
      PASOS.slice(idx).forEach(p => delete seleccion[p.clave]);
      seleccion[clave] = b.dataset.valor;
      buscar();
    });
    $('crLista').addEventListener('click', (e) => {
      const b = e.target.closest('.cr-item');
      if (!b) return;
      const it = items.find(x => x.ref === b.dataset.ref);
      if (!it) return;
      seleccion = { tipo: it.tipo, modelo: it.modelo, color: it.color, voltaje: it.voltaje };
      buscar();
    });
    $('crBtnRegistrar').addEventListener('click', registrar);
    $('crLote').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('crCantidad').focus(); } });
    $('crCantidad').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); registrar(); } });
    $('crArea').addEventListener('change', () => guardar(K_AREA, $('crArea').value));
    $('crBtnEnviarAhora').addEventListener('click', () => enviarPendientes());
    $('crRecientes').addEventListener('click', (e) => {
      const b = e.target.closest('[data-descartar]');
      if (b) descartarRechazado(b.dataset.descartar);
    });

    document.querySelectorAll('.cr-tabs .tab-btn').forEach(b => b.addEventListener('click', () => cambiarPestana(b.dataset.tab)));
    $('crBtnConsultar').addEventListener('click', consultar);
    $('crFiltroTexto').addEventListener('input', pintarTabla);
    $('crBtnExportar').addEventListener('click', exportarCsv);
    $('crTablaCuerpo').addEventListener('click', (e) => {
      const b = e.target.closest('[data-eliminar]');
      if (b) eliminar(b.dataset.eliminar);
    });
    $('crBtnMaestro').addEventListener('click', () => $('crArchivoMaestro').click());
    $('crArchivoMaestro').addEventListener('change', (e) => subirMaestro(e.target.files[0]));
    $('crSemAnterior').addEventListener('click', () => moverSemana(-1));
    $('crSemSiguiente').addEventListener('click', () => moverSemana(1));
    $('crSemActual').addEventListener('click', () => { repLunes = lunesDe(new Date()); cargarReporte(); });
    $('crRepArea').addEventListener('change', cargarReporte);
    $('crBtnImprimir').addEventListener('click', () => window.print());
    $('crRepVerTodas').addEventListener('click', () => { repVerTodas = !repVerTodas; pintarTopReferencias(); });

    window.addEventListener('online', () => { marcarConexion(true); enviarPendientes(); actualizarMaestro(); });
    window.addEventListener('offline', () => marcarConexion(false));
    // Sin red y sin copia guardada de la página, recargar o salir deja la
    // tablet sin poder volver a abrir Caja roja hasta que vuelva la señal:
    // el navegador pide confirmación antes. Con la copia guardada (service
    // worker activo) recargar es seguro y no se pregunta nada.
    window.addEventListener('beforeunload', (e) => {
      if (saliendo) return;
      const sinRed = !navigator.onLine || !enLinea;
      const paginaGuardada = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
      if (sinRed && !paginaGuardada) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    setInterval(() => { if (pendientes.some(p => p.estado === 'pendiente')) enviarPendientes(); }, 20000);
  }

  // -------------------------------------------------------------- arranque
  function iniciar() {
    $('crNombre').textContent = usuarioActual ? usuarioActual.nombre : '—';
    $('crFecha').value = hoy();
    $('crDesde').value = hoy();
    $('crHasta').value = hoy();
    const area = leer(K_AREA, '');
    if (area) $('crArea').value = area;

    const puedeRegistrar = tienePermiso('caja_roja.registrar');
    $('crTabCargar').style.display = puedeRegistrar ? '' : 'none';
    $('crMaestroGestion').style.display = tienePermiso('caja_roja.gestion') ? 'flex' : 'none';
    // El reporte muestra lo de todas las personas: solo con ver/gestión.
    $('crTabReporte').style.display = (tienePermiso('caja_roja.ver') || tienePermiso('caja_roja.gestion')) ? '' : 'none';
    repLunes = lunesDe(new Date());

    const cache = leer(K_MAESTRO, null);
    if (cache && Array.isArray(cache.items)) {
      maestroVersion = cache.actualizado;
      cargarItems(cache.items);
      mostrarInfoMaestro(cache.actualizado, cache.total);
    } else {
      cargarItems([]);
    }
    pendientes = leer(K_PENDIENTES, []);
    recientes = leer(K_RECIENTES, []);

    enlazarEventos();
    pintarRecientes();
    buscar();
    marcarConexion(enLinea);
    cambiarPestana(puedeRegistrar ? 'cargar' : 'consultar');
    actualizarMaestro();
    enviarPendientes();
    if (puedeRegistrar) $('crBuscar').focus();
  }

  // ------------------------------------------------------------ sesión
  const PERMISOS_MODULO = ['caja_roja.registrar', 'caja_roja.ver', 'caja_roja.gestion'];

  async function comprobarSesion() {
    let res, data;
    try {
      res = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token } });
      data = await res.json();
    } catch (e) {
      // Sin red justo al abrir: si esta tablet ya había entrado antes con
      // este mismo token, se sigue con lo guardado para poder registrar.
      const guardado = leer(K_USUARIO, null);
      if (guardado && guardado.token === token) {
        usuarioActual = guardado.usuario;
        permisosUsuario = guardado.permisos || [];
        enLinea = false;
        return true;
      }
      return false;
    }
    if (!(res.ok && data)) {
      localStorage.removeItem('token');
      token = null;
      return false;
    }
    usuarioActual = { id: data.id, nombre: data.usuario, rol: data.rol };
    await cargarPermisosDelUsuario();
    guardar(K_USUARIO, { token, usuario: usuarioActual, permisos: permisosUsuario });
    return true;
  }

  async function init() {
    token = localStorage.getItem('token');
    if (!token) { $('loginOverlay').style.display = 'flex'; return; }
    const ok = await comprobarSesion();
    if (!ok) { $('loginOverlay').style.display = 'flex'; return; }
    if (!PERMISOS_MODULO.some(p => tienePermiso(p))) {
      alert('No tienes permiso para acceder al módulo Caja roja.');
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
    const nPend = pendientes.filter(p => p.estado === 'pendiente').length;
    if (nPend && !confirm(`Hay ${nPend} registro(s) sin enviar. Quedan guardados en esta tablet y se enviarán cuando alguien vuelva a entrar a Caja roja. ¿Cerrar sesión?`)) return;
    try { await fetch('/api/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } }); } catch (e) { /* sin red */ }
    localStorage.removeItem('token');
    token = null;
    saliendo = true;
    location.reload();
  };

  // Copia de la página en la tablet para abrir sin señal. El navegador solo
  // lo permite en https:// (isSecureContext); en http:// no hace nada y todo
  // sigue como antes. El alcance './caja_roja' hace que solo afecte a esta
  // página: los demás módulos no se enteran.
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw-caja-roja.js', { scope: './caja_roja' })
        .catch((e) => console.warn('Caja roja: no se pudo guardar la página para uso sin señal:', e.message));
    });
  }

  // doLogin viene de js/comun.js (al iniciar sesión siempre se vuelve al portal).
  document.addEventListener('DOMContentLoaded', () => {
    $('loginPass').addEventListener('keypress', (e) => { if (e.key === 'Enter') doLogin(); });
    $('loginUser').addEventListener('keypress', (e) => { if (e.key === 'Enter') doLogin(); });
    init();
  });
})();
