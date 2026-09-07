// Prueba del FRONTEND de "Editar" y "Compartir" en el detalle de un reporte
// (Public/reportes_areas.html), pedido por Julio (07/09):
//   - "Editar": botón visible en el detalle (solo con reportes.gestionar),
//     arma un formulario distinto según el tipo (informativo vs rapido/completo)
//     y guarda con PUT /reportes/:id. En un Rápido/Completo también deja
//     elegir/cambiar "el problema" (segunda vuelta, 07/09).
//   - "Compartir": botón en el detalle de un Rápido o Completo (NO en un
//     Informativo) que carga /reportes/destinatarios, deja elegir con
//     checkboxes y envía con POST /reportes/:id/compartir.
//   - "Escalar a Reporte Completo" (botón rápido del detalle) y "Agregar
//     causa raíz" (segunda vuelta, 07/09): ahora también dejan elegir "el
//     problema" / reusar una causa ya registrada para ese problema, igual
//     que el asistente "Reporte Problema" -- antes solo pedían texto libre,
//     y por eso esas causas nunca quedaban ligadas a ningún defecto.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PROJECT = '/tmp/valtest_project';
let html = fs.readFileSync(path.join(PROJECT, 'Public/reportes_areas.html'), 'utf8');
const comunJs = fs.readFileSync(path.join(PROJECT, 'Public/js/comun.js'), 'utf8');
html = html.replace('<script src="js/comun.js"></script>', `<script>${comunJs}</script>`);

let ok = 0, fail = 0;
function check(nombre, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + nombre);
  if (cond) ok++; else fail++;
}

const AREAS = [
  { id: 10, nombre: 'Inyección' },
  { id: 11, nombre: 'Ensamble' },
];
const DEFECTOS = [
  { id: 100, codigo: 'DEF-100', descripcion: 'Rayón superficial' },
  { id: 101, codigo: 'DEF-101', descripcion: 'Falta de material' },
];
const DESTINATARIOS = [
  { id: 5, nombre: 'Julio Lopez', telefono: '573000000001' },
  { id: 6, nombre: 'Ana Calidad', telefono: '573000000002' },
];

const REPORTE_RAPIDO = {
  id: 501, tipo: 'rapido', estado: 'Pendiente', area_origen_id: 11, area_origen_nombre: 'Ensamble',
  referencia: 'REF-1', lote: 'LOTE-1', urgencia: 'Alta', descripcion: 'Descripción original del rápido.',
  autor_nombre: 'Julio', created_at: '2026-09-07 10:00:00', causas: [], medidas: [], adjuntos: [],
};
const REPORTE_COMPLETO = {
  id: 502, tipo: 'completo', estado: 'Pendiente', area_origen_id: 11, area_origen_nombre: 'Ensamble',
  referencia: 'REF-2', lote: 'LOTE-2', urgencia: 'Media', descripcion: 'Descripción del completo.', defecto_id: 100,
  autor_nombre: 'Julio', created_at: '2026-09-07 10:00:00',
  causas: [{ id: 1, texto: 'Causa uno', autor_nombre: 'Julio' }], medidas: [], adjuntos: [],
};
const REPORTE_COMPLETO_SIN_DEFECTO = {
  id: 504, tipo: 'completo', estado: 'Pendiente', area_origen_id: 11, area_origen_nombre: 'Ensamble',
  referencia: 'REF-4', lote: 'LOTE-4', urgencia: 'Media', descripcion: 'Completo sin problema asignado.', defecto_id: null,
  autor_nombre: 'Julio', created_at: '2026-09-07 10:00:00',
  causas: [{ id: 9, texto: 'Causa suelta', autor_nombre: 'Julio' }], medidas: [], adjuntos: [],
};
const REPORTE_INFORMATIVO = {
  id: 503, tipo: 'informativo', area_origen_id: 10, area_origen_nombre: 'Inyección',
  titulo: 'Comunicado original', descripcion: 'Contenido original', fecha_vigencia: '2026-10-01',
  autor_nombre: 'Julio', created_at: '2026-09-07 10:00:00', destinos: [{ id: 11, nombre: 'Ensamble' }],
  causas: [], medidas: [], adjuntos: [],
};

async function main() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/reportes_areas.html', pretendToBeVisual: true });
  const { window } = dom;
  await new Promise(r => setTimeout(r, 20));

  window.eval(`
    token = 'token-prueba';
    repAreasCache = ${JSON.stringify(AREAS)};
  `);

  // ======================== 1) BOTÓN "EDITAR": visible solo con reportes.gestionar ========================
  window.eval(`tienePermiso = () => false;`);
  window.eval(`repReporteActual = ${JSON.stringify(REPORTE_RAPIDO)}; renderizarDetalleReporte();`);
  check('sin reportes.gestionar, el botón Editar NO aparece', !window.document.querySelector('[onclick="mostrarFormularioEditarReporte()"]'));

  window.eval(`tienePermiso = () => true;`);
  window.eval(`renderizarDetalleReporte();`);
  check('con reportes.gestionar, el botón Editar SÍ aparece', !!window.document.querySelector('[onclick="mostrarFormularioEditarReporte()"]'));

  // ======================== 2) EDITAR: RÁPIDO/COMPLETO -- formulario (ahora async: pide /reportes/defectos), guardado y "el problema" ========================
  let fetchLlamadas = [];
  window.fetch = async (url) => {
    fetchLlamadas.push({ url: String(url) });
    if (String(url).includes('/reportes/defectos')) return { ok: true, json: async () => DEFECTOS };
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`mostrarFormularioEditarReporte();`);
  await new Promise(r => setTimeout(r, 20));
  check('al abrir Editar en un Rápido/Completo se pidió GET /reportes/defectos', fetchLlamadas.some(f => f.url.includes('/reportes/defectos')));
  const formRapido = window.document.getElementById('repEditarForm');
  check('el formulario de editar un Rápido queda visible', formRapido.style.display === 'block');
  check('trae el área actual preseleccionada', window.document.getElementById('editArea').value === '11');
  check('trae la urgencia actual preseleccionada', window.document.getElementById('editUrgencia').value === 'Alta');
  check('trae la referencia/lote/descripción actuales', window.document.getElementById('editReferencia').value === 'REF-1' && window.document.getElementById('editLote').value === 'LOTE-1' && window.document.getElementById('editDescripcion').value === 'Descripción original del rápido.');
  check('trae un selector de "el problema" con las opciones del catálogo de defectos', window.document.getElementById('editDefecto') !== null && window.document.getElementById('editDefecto').querySelectorAll('option').length === 3); // placeholder + 2
  check('sin problema asignado (Rápido nuevo), el selector queda en "Sin problema asignado"', window.document.getElementById('editDefecto').value === '');
  check('NO hay campos de Informativo (título/contenido) en el formulario de un Rápido', window.document.getElementById('editTitulo') === null);

  window.document.getElementById('editArea').value = '10';
  window.document.getElementById('editUrgencia').value = 'Critica';
  window.document.getElementById('editReferencia').value = 'REF-EDITADA';
  window.document.getElementById('editDescripcion').value = 'Descripción editada desde el formulario.';
  window.document.getElementById('editDefecto').value = '100';

  fetchLlamadas = [];
  window.fetch = async (url, opts) => {
    fetchLlamadas.push({ url: String(url), opts });
    if (String(url).match(/\/reportes\/501$/) && (!opts || opts.method !== 'PUT')) {
      return { ok: true, json: async () => REPORTE_RAPIDO };
    }
    if (String(url).match(/\/reportes\/501$/) && opts && opts.method === 'PUT') {
      return { ok: true, json: async () => ({ ...REPORTE_RAPIDO, area_origen_id: 10, urgencia: 'Critica', referencia: 'REF-EDITADA', descripcion: 'Descripción editada desde el formulario.', defecto_id: 100 }) };
    }
    if (String(url).includes('/reportes?')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`guardarEdicionReporte(501)`);
  await new Promise(r => setTimeout(r, 20));
  const llamadaPut = fetchLlamadas.find(f => f.opts && f.opts.method === 'PUT');
  check('guardar la edición hizo PUT /reportes/501', !!llamadaPut);
  const payloadPut = llamadaPut ? JSON.parse(llamadaPut.opts.body) : {};
  check('el PUT lleva los campos editados del formulario', payloadPut.area_origen_id === '10' && payloadPut.urgencia === 'Critica' && payloadPut.referencia === 'REF-EDITADA' && payloadPut.descripcion === 'Descripción editada desde el formulario.');
  check('el PUT lleva "el problema" elegido (defecto_id=100)', String(payloadPut.defecto_id) === '100');
  check('tras guardar, el detalle se refresca con los datos nuevos', window.eval('repReporteActual.urgencia') === 'Critica');

  // Validación: sin descripción no debe mandar el PUT.
  fetchLlamadas = [];
  window.fetch = async (url) => {
    fetchLlamadas.push({ url: String(url) });
    if (String(url).includes('/reportes/defectos')) return { ok: true, json: async () => DEFECTOS };
    return { ok: true, json: async () => ({}) };
  };
  window.eval(`repReporteActual = ${JSON.stringify(REPORTE_RAPIDO)}; renderizarDetalleReporte();`);
  await window.eval(`mostrarFormularioEditarReporte();`);
  await new Promise(r => setTimeout(r, 20));
  window.document.getElementById('editDescripcion').value = '   ';
  let alertaMostrada = null;
  window.alert = (msg) => { alertaMostrada = msg; };
  fetchLlamadas = [];
  window.fetch = async (url, opts) => { fetchLlamadas.push({ url: String(url), opts }); return { ok: true, json: async () => ({}) }; };
  await window.eval(`guardarEdicionReporte(501)`);
  check('con la descripción vacía, se avisa con alert y NO se manda el PUT', !!alertaMostrada && !fetchLlamadas.some(f => f.opts && f.opts.method === 'PUT'));

  // ======================== 3) EDITAR: INFORMATIVO -- formulario distinto (sin pedir defectos) ========================
  fetchLlamadas = [];
  window.fetch = async (url) => { fetchLlamadas.push({ url: String(url) }); return { ok: true, json: async () => ({}) }; };
  window.eval(`repReporteActual = ${JSON.stringify(REPORTE_INFORMATIVO)}; renderizarDetalleReporte();`);
  window.eval(`mostrarFormularioEditarReporte();`); // el camino informativo es síncrono -- no hace fetch
  check('editar un Informativo NO pide el catálogo de defectos (no aplica)', !fetchLlamadas.some(f => f.url.includes('/reportes/defectos')));
  check('el formulario de editar un Informativo SÍ trae título/contenido', window.document.getElementById('editTitulo') !== null && window.document.getElementById('editContenido') !== null);
  check('NO trae "el problema" ni urgencia/referencia/lote (esos son de rapido/completo)', window.document.getElementById('editDefecto') === null && window.document.getElementById('editUrgencia') === null);
  check('trae el título/contenido/vigencia actuales', window.document.getElementById('editTitulo').value === 'Comunicado original' && window.document.getElementById('editContenido').value === 'Contenido original' && window.document.getElementById('editVigencia').value === '2026-10-01');
  check('el área destino actual (Ensamble, id 11) queda marcada', window.document.querySelector('#editAreasDestino input[value="11"]').checked === true);

  window.document.getElementById('editTitulo').value = 'Comunicado editado';
  window.document.getElementById('editContenido').value = 'Contenido editado';
  window.document.querySelector('#editAreasDestino input[value="11"]').checked = false;
  window.document.querySelector('#editAreasDestino input[value="10"]').checked = true;

  fetchLlamadas = [];
  window.fetch = async (url, opts) => {
    fetchLlamadas.push({ url: String(url), opts });
    if (String(url).match(/\/reportes\/503$/) && opts && opts.method === 'PUT') {
      return { ok: true, json: async () => ({ ...REPORTE_INFORMATIVO, titulo: 'Comunicado editado', descripcion: 'Contenido editado', destinos: [{ id: 10, nombre: 'Inyección' }] }) };
    }
    if (String(url).includes('/reportes?')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`guardarEdicionReporte(503)`);
  await new Promise(r => setTimeout(r, 20));
  const llamadaPutInformativo = fetchLlamadas.find(f => f.opts && f.opts.method === 'PUT');
  check('editar el Informativo hizo PUT /reportes/503', !!llamadaPutInformativo);
  const payloadPutInformativo = llamadaPutInformativo ? JSON.parse(llamadaPutInformativo.opts.body) : {};
  check('el PUT lleva título/contenido editados y las nuevas áreas destino (id 10, ya no 11)', payloadPutInformativo.titulo === 'Comunicado editado' && payloadPutInformativo.contenido === 'Contenido editado' && JSON.stringify(payloadPutInformativo.areas_destino) === JSON.stringify([10]));

  // ======================== 4) COMPARTIR: aparece en Rápido/Completo, no en Informativo ========================
  window.eval(`repReporteActual = ${JSON.stringify(REPORTE_RAPIDO)}; renderizarDetalleReporte();`);
  check('el botón Compartir aparece en el detalle de un Rápido', !!window.document.querySelector('[onclick="mostrarFormularioCompartir(501)"]'));

  window.eval(`repReporteActual = ${JSON.stringify(REPORTE_COMPLETO)}; renderizarDetalleReporte();`);
  check('el botón Compartir aparece en el detalle de un Completo', !!window.document.querySelector('[onclick="mostrarFormularioCompartir(502)"]'));

  window.eval(`repReporteActual = ${JSON.stringify(REPORTE_INFORMATIVO)}; renderizarDetalleReporte();`);
  check('el botón Compartir NO aparece en el detalle de un Informativo', !window.document.querySelector('[onclick^="mostrarFormularioCompartir"]'));

  // ======================== 5) COMPARTIR: flujo completo (cargar destinatarios, elegir, enviar) ========================
  window.eval(`repReporteActual = ${JSON.stringify(REPORTE_RAPIDO)}; renderizarDetalleReporte();`);
  fetchLlamadas = [];
  window.fetch = async (url) => {
    fetchLlamadas.push({ url: String(url) });
    if (String(url).includes('/reportes/destinatarios')) return { ok: true, json: async () => DESTINATARIOS };
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`mostrarFormularioCompartir(501)`);
  await new Promise(r => setTimeout(r, 20));
  check('al abrir "Compartir" se pidió GET /reportes/destinatarios', fetchLlamadas.some(f => f.url.includes('/reportes/destinatarios')));
  check('se muestra un checkbox por cada destinatario con teléfono', window.document.querySelectorAll('#repCompartirLista-501 input[type=checkbox]').length === 2);

  window.document.querySelectorAll('#repCompartirLista-501 input[type=checkbox]')[1].checked = true; // Ana Calidad (id 6)
  alertaMostrada = null;
  fetchLlamadas = [];
  window.fetch = async (url, opts) => {
    fetchLlamadas.push({ url: String(url), opts });
    if (String(url).match(/\/reportes\/501\/compartir$/) && opts && opts.method === 'POST') {
      return { ok: true, json: async () => ({ envio: { enviado: true, fallos: [] } }) };
    }
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`enviarCompartirReporte(501)`);
  await new Promise(r => setTimeout(r, 20));
  const llamadaCompartir = fetchLlamadas.find(f => f.url.includes('/compartir'));
  check('al enviar se hizo POST /reportes/501/compartir', !!llamadaCompartir);
  const payloadCompartir = llamadaCompartir ? JSON.parse(llamadaCompartir.opts.body) : {};
  check('el POST lleva el destinatario elegido (id 6, Ana Calidad)', Array.isArray(payloadCompartir.destinatarios) && payloadCompartir.destinatarios.length === 1 && payloadCompartir.destinatarios[0] === 6);

  // Validación: sin elegir a nadie, no debe mandar el POST.
  window.eval(`repReporteActual = ${JSON.stringify(REPORTE_RAPIDO)}; renderizarDetalleReporte();`);
  fetchLlamadas = [];
  window.fetch = async (url) => {
    fetchLlamadas.push({ url: String(url) });
    if (String(url).includes('/reportes/destinatarios')) return { ok: true, json: async () => DESTINATARIOS };
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`mostrarFormularioCompartir(501)`);
  await new Promise(r => setTimeout(r, 20));
  alertaMostrada = null;
  fetchLlamadas = [];
  window.fetch = async (url, opts) => { fetchLlamadas.push({ url: String(url), opts }); return { ok: true, json: async () => ({}) }; };
  await window.eval(`enviarCompartirReporte(501)`);
  check('sin elegir ningún destinatario, se avisa con alert y NO se manda el POST', !!alertaMostrada && !fetchLlamadas.some(f => f.opts && f.opts.method === 'POST'));

  // ======================== 6) ESCALAR (botón rápido del detalle): ahora también pregunta "el problema" ========================
  window.eval(`repReporteActual = ${JSON.stringify(REPORTE_RAPIDO)}; renderizarDetalleReporte();`);
  fetchLlamadas = [];
  window.fetch = async (url) => {
    fetchLlamadas.push({ url: String(url) });
    if (String(url).includes('/reportes/defectos')) return { ok: true, json: async () => DEFECTOS };
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`mostrarFormularioEscalar()`);
  await new Promise(r => setTimeout(r, 20));
  check('al abrir "Escalar" se pidió GET /reportes/defectos', fetchLlamadas.some(f => f.url.includes('/reportes/defectos')));
  check('trae un selector de "el problema" (opcional)', window.document.getElementById('repEscalarDefecto') !== null);
  check('sin elegir problema, sigue habiendo un textarea de causa libre (compatibilidad de siempre)', window.document.getElementById('repEscalarCausa') !== null && window.document.getElementById('repEscalarCausa').tagName === 'TEXTAREA');

  // Elegir un problema sin causas previas -> entra directo en modo "agregar nueva".
  fetchLlamadas = [];
  window.fetch = async (url) => {
    fetchLlamadas.push({ url: String(url) });
    if (String(url).includes('/reportes/catalogo-causas')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({}) };
  };
  window.document.getElementById('repEscalarDefecto').value = '100';
  await window.eval(`repEscalarCambiarDefecto()`);
  await new Promise(r => setTimeout(r, 20));
  check('al elegir el problema se pidió el catálogo de causas filtrado por ese defecto', fetchLlamadas.some(f => f.url.includes('defecto_id=100')));
  check('sin causas previas para ese problema, sigue habiendo dónde escribir una nueva', window.document.getElementById('repEscalarCausa') !== null);

  window.document.getElementById('repEscalarCausa').value = 'Molde con rebaba (vía Escalar).';
  fetchLlamadas = [];
  window.fetch = async (url, opts) => {
    fetchLlamadas.push({ url: String(url), opts });
    if (String(url).match(/\/reportes\/501\/escalar$/) && opts && opts.method === 'POST') {
      return { ok: true, json: async () => ({ id: 501, tipo: 'completo' }) };
    }
    if (String(url).includes('/reportes?')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`escalarReporte(501)`);
  await new Promise(r => setTimeout(r, 20));
  const llamadaEscalar = fetchLlamadas.find(f => f.url.includes('/escalar'));
  check('escalar con problema elegido y causa nueva -> POST /reportes/501/escalar', !!llamadaEscalar);
  const payloadEscalar = llamadaEscalar ? JSON.parse(llamadaEscalar.opts.body) : {};
  check('el escalar lleva la causa nueva Y el defecto_id elegido (antes esto se perdía)', payloadEscalar.causa_raiz === 'Molde con rebaba (vía Escalar).' && String(payloadEscalar.defecto_id) === '100');

  // Elegir un problema CON causas ya existentes -> se muestran como opciones para reusar.
  window.eval(`repReporteActual = ${JSON.stringify(REPORTE_RAPIDO)}; renderizarDetalleReporte();`);
  fetchLlamadas = [];
  window.fetch = async (url) => {
    fetchLlamadas.push({ url: String(url) });
    if (String(url).includes('/reportes/defectos')) return { ok: true, json: async () => DEFECTOS };
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`mostrarFormularioEscalar()`);
  await new Promise(r => setTimeout(r, 20));
  fetchLlamadas = [];
  window.fetch = async (url) => {
    fetchLlamadas.push({ url: String(url) });
    if (String(url).includes('/reportes/catalogo-causas')) return { ok: true, json: async () => [{ id: 77, texto: 'Boquilla obstruida' }] };
    return { ok: true, json: async () => ({}) };
  };
  window.document.getElementById('repEscalarDefecto').value = '101';
  await window.eval(`repEscalarCambiarDefecto()`);
  await new Promise(r => setTimeout(r, 20));
  check('con causas ya existentes para ese problema, se muestran como opciones para reusar', window.document.querySelectorAll('input[name="repEscalarCausaRadio"]').length === 2); // 1 causa + "Otra"
  check('la opción "Otra" NO queda marcada por defecto cuando SÍ hay causas', window.document.querySelector('input[name="repEscalarCausaRadio"][value="__otra__"]').checked === false);

  window.document.querySelector('input[name="repEscalarCausaRadio"][value="77"]').checked = true;
  fetchLlamadas = [];
  window.fetch = async (url, opts) => {
    fetchLlamadas.push({ url: String(url), opts });
    if (String(url).match(/\/reportes\/501\/escalar$/) && opts && opts.method === 'POST') return { ok: true, json: async () => ({ id: 501, tipo: 'completo' }) };
    if (String(url).includes('/reportes?')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`escalarReporte(501)`);
  await new Promise(r => setTimeout(r, 20));
  const llamadaEscalar2 = fetchLlamadas.find(f => f.url.includes('/escalar'));
  const payloadEscalar2 = llamadaEscalar2 ? JSON.parse(llamadaEscalar2.opts.body) : {};
  check('reusando una causa existente -> se manda causa_catalogo_id=77 y el defecto_id=101', payloadEscalar2.causa_catalogo_id === 77 && String(payloadEscalar2.defecto_id) === '101');

  // ======================== 7) AGREGAR CAUSA RAÍZ a un Completo ya existente ========================
  // Si el reporte YA tiene "el problema" asignado, se ofrecen las causas ya
  // registradas para reusar (además de "Otra"). Si NO tiene problema
  // asignado, sigue siendo solo texto libre (para asignarle uno hay que
  // usar "Editar").
  window.eval(`repReporteActual = ${JSON.stringify(REPORTE_COMPLETO)}; renderizarDetalleReporte();`); // defecto_id=100
  fetchLlamadas = [];
  window.fetch = async (url) => {
    fetchLlamadas.push({ url: String(url) });
    if (String(url).includes('/reportes/catalogo-causas')) return { ok: true, json: async () => [{ id: 88, texto: 'Causa ya conocida del problema' }] };
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`mostrarFormularioCausa()`);
  await new Promise(r => setTimeout(r, 20));
  check('con problema asignado, "Agregar causa raíz" pide el catálogo filtrado por ese defecto', fetchLlamadas.some(f => f.url.includes('defecto_id=100')));
  check('se muestran la causa existente y "Otra" para reusar/agregar', window.document.querySelectorAll('input[name="repNuevaCausaRadio"]').length === 2);

  window.document.querySelector('input[name="repNuevaCausaRadio"][value="88"]').checked = true;
  fetchLlamadas = [];
  window.fetch = async (url, opts) => {
    fetchLlamadas.push({ url: String(url), opts });
    if (String(url).match(/\/reportes\/502\/causas$/) && opts && opts.method === 'POST') return { ok: true, json: async () => ({ id: 502, tipo: 'completo', causas: [], medidas: [], adjuntos: [] }) };
    if (String(url).includes('/reportes?')) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`agregarCausaReporte(502)`);
  await new Promise(r => setTimeout(r, 20));
  const llamadaCausa = fetchLlamadas.find(f => f.url.includes('/causas') && f.opts && f.opts.method === 'POST');
  check('agregar causa reusando la existente -> POST /reportes/502/causas con causa_catalogo_id=88', !!llamadaCausa && JSON.parse(llamadaCausa.opts.body).causa_catalogo_id === 88);

  // Reporte Completo SIN problema asignado -> sigue siendo solo texto libre, sin pedir el catálogo.
  window.eval(`repReporteActual = ${JSON.stringify(REPORTE_COMPLETO_SIN_DEFECTO)}; renderizarDetalleReporte();`);
  fetchLlamadas = [];
  window.fetch = async (url) => { fetchLlamadas.push({ url: String(url) }); return { ok: true, json: async () => ({}) }; };
  await window.eval(`mostrarFormularioCausa()`);
  check('sin problema asignado, NO se pide el catálogo de causas', !fetchLlamadas.some(f => f.url.includes('/reportes/catalogo-causas')));
  check('sin problema asignado, sigue siendo un textarea de texto libre (sin radios)', window.document.getElementById('repNuevaCausaTexto') !== null && window.document.querySelectorAll('input[name="repNuevaCausaRadio"]').length === 0);

  console.log(`\n${ok} OK, ${fail} FAIL`);
  console.log('\n=== Prueba frontend Editar/Compartir/Escalar/Agregar-causa completa ===');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('ERROR INESPERADO:', e); process.exit(1); });
