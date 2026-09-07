// Prueba del FRONTEND del botón "Borrar causas sin problema asignado" en
// Seguimiento de Producción -> pestaña Catálogo (Public/seguimiento_produccion.html),
// pedido por Julio (07/09) como limpieza de una sola vez del backlog de
// causas que quedaron sin "problema" (defecto) asignado de antes de que
// existiera Reportes por Áreas.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PROJECT = '/tmp/valtest_project';
let html = fs.readFileSync(path.join(PROJECT, 'Public/seguimiento_produccion.html'), 'utf8');
const comunJs = fs.readFileSync(path.join(PROJECT, 'Public/js/comun.js'), 'utf8');
html = html.replace('<script src="js/comun.js"></script>', `<script>${comunJs}</script>`);

let ok = 0, fail = 0;
function check(nombre, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + nombre);
  if (cond) ok++; else fail++;
}

const CATALOGO_TODO_CON_DEFECTO = [
  { id: 1, texto: 'Causa con defecto A', defecto_id: 100, activo: 'Activo', medidas: [] },
  { id: 2, texto: 'Causa con defecto B', defecto_id: 101, activo: 'Activo', medidas: [] },
];
const CATALOGO_MIXTO = [
  { id: 1, texto: 'Causa con defecto A', defecto_id: 100, activo: 'Activo', medidas: [] },
  { id: 2, texto: 'Causa sin defecto 1', defecto_id: null, activo: 'Activo', medidas: [] },
  { id: 3, texto: 'Causa sin defecto 2', defecto_id: null, activo: 'Activo', medidas: [] },
  { id: 4, texto: 'Causa sin defecto 3', defecto_id: null, activo: 'Inactivo', medidas: [] },
];

async function main() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/seguimiento_produccion.html', pretendToBeVisual: true });
  const { window } = dom;
  await new Promise(r => setTimeout(r, 20));

  window.eval(`token = 'token-prueba';`);

  // ======================== 1) Sin permiso de gestionar: el botón nunca aparece, aunque haya causas sin defecto ========================
  window.eval(`tienePermiso = () => false; catalogoTrazCache = ${JSON.stringify(CATALOGO_MIXTO)}; renderizarCatalogoTraz();`);
  check('sin catalogos.gestionar, el botón de limpieza queda oculto aunque haya causas sin defecto', window.document.getElementById('catLimpiezaBox').style.display === 'none');

  // ======================== 2) Con permiso, pero SIN ninguna causa sin defecto: el botón queda oculto ========================
  window.eval(`tienePermiso = () => true; catalogoTrazCache = ${JSON.stringify(CATALOGO_TODO_CON_DEFECTO)}; renderizarCatalogoTraz();`);
  check('con catalogos.gestionar pero sin causas sin defecto, el botón queda oculto (nada que limpiar)', window.document.getElementById('catLimpiezaBox').style.display === 'none');

  // ======================== 3) Con permiso Y causas sin defecto: el botón aparece con el conteo correcto ========================
  window.eval(`catalogoTrazCache = ${JSON.stringify(CATALOGO_MIXTO)}; renderizarCatalogoTraz();`);
  check('con catalogos.gestionar y causas sin defecto, el botón queda visible', window.document.getElementById('catLimpiezaBox').style.display === 'block');
  check('el texto del botón trae el conteo correcto (3 causas sin defecto, incluyendo la Inactiva)', window.document.getElementById('catBtnLimpiar').textContent.includes('3'));

  // ======================== 4) Confirmar cancela -> no llama al DELETE ========================
  window.confirm = () => false;
  let fetchLlamadas = [];
  window.fetch = async (url, opts) => { fetchLlamadas.push({ url: String(url), opts }); return { ok: true, json: async () => ({}) }; };
  await window.eval(`borrarCausasSinProblema()`);
  check('si se cancela el confirm(), no se llama al DELETE', fetchLlamadas.length === 0);

  // ======================== 5) Confirmar acepta -> DELETE, alert de resultado, y refresca el catálogo (forzado) ========================
  window.confirm = () => true;
  let alertaMostrada = null;
  window.alert = (msg) => { alertaMostrada = msg; };
  fetchLlamadas = [];
  const catalogoTrasLimpieza = CATALOGO_TODO_CON_DEFECTO; // simula que ya se limpiaron las 3 sin defecto
  window.fetch = async (url, opts) => {
    fetchLlamadas.push({ url: String(url), opts });
    if (String(url).includes('/produccion/trazabilidad/catalogo/causas-sin-defecto') && opts && opts.method === 'DELETE') {
      return { ok: true, json: async () => ({ causasEliminadas: 3, medidasEliminadas: 1, referenciasDesvinculadas: 2 }) };
    }
    if (String(url).includes('/produccion/trazabilidad/catalogo') && (!opts || !opts.method)) {
      return { ok: true, json: async () => catalogoTrasLimpieza };
    }
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`borrarCausasSinProblema()`);
  await new Promise(r => setTimeout(r, 20));

  const llamadaDelete = fetchLlamadas.find(f => f.opts && f.opts.method === 'DELETE');
  check('al confirmar, se hizo DELETE /produccion/trazabilidad/catalogo/causas-sin-defecto', !!llamadaDelete);
  check('el DELETE llevó el token de autorización', !!llamadaDelete && llamadaDelete.opts.headers.Authorization === 'Bearer token-prueba');
  check('se mostró un alert con el resumen del resultado (3 causas, 1 medida, 2 referencias)', !!alertaMostrada && alertaMostrada.includes('3') && alertaMostrada.includes('1') && alertaMostrada.includes('2'));

  const llamadaRecargaForzada = fetchLlamadas.find(f => f.url.includes('/produccion/trazabilidad/catalogo') && !f.url.includes('causas-sin-defecto'));
  check('después del DELETE se volvió a pedir el catálogo (refresco forzado -- soluciona también la caché vieja)', !!llamadaRecargaForzada);
  check('tras el refresco, el botón de limpieza ya no aparece (ya no quedan causas sin defecto)', window.document.getElementById('catLimpiezaBox').style.display === 'none');

  // ======================== 6) Si el DELETE falla, se avisa con alert y no revienta ========================
  window.eval(`catalogoTrazCache = ${JSON.stringify(CATALOGO_MIXTO)}; renderizarCatalogoTraz();`);
  window.confirm = () => true;
  alertaMostrada = null;
  window.fetch = async (url, opts) => {
    if (opts && opts.method === 'DELETE') return { ok: false, json: async () => ({ error: 'Error simulado de prueba' }) };
    return { ok: true, json: async () => ({}) };
  };
  await window.eval(`borrarCausasSinProblema()`);
  await new Promise(r => setTimeout(r, 20));
  check('si el DELETE falla, se avisa el error con alert en vez de romper la página', !!alertaMostrada && alertaMostrada.includes('Error simulado de prueba'));

  console.log(`\n${ok} OK, ${fail} FAIL`);
  console.log('\n=== Prueba frontend limpieza de catálogo completa ===');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('ERROR INESPERADO:', e); process.exit(1); });
