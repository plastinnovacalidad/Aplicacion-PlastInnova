// ========================================================================
// Muestreos ISO 2859-1 — namespace principal (navegación dentro de la
// página, sin cambiar la URL, igual que hacía la app independiente
// original). Todo queda bajo "Iso2859App"/"Iso2859*" en vez de nombres
// globales sueltos (antes era `app`, `dashboard`, `lote`, etc. directamente
// en window) para no chocar con nada de las demás páginas de este sistema.
// ========================================================================
// Pequeño helper para no repetir el header de autorización en cada fetch
// de los archivos de este módulo (a diferencia de la app original, aquí
// todas las rutas exigen sesión iniciada).
function isoFetch(url, opciones = {}) {
  const headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opciones.headers || {});
  return fetch(url, Object.assign({}, opciones, { headers }));
}
function isoFetchJSON(url, opciones = {}) {
  const headers = Object.assign({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, opciones.headers || {});
  return fetch(url, Object.assign({}, opciones, { headers }));
}

const Iso2859App = {
  modulo: null, // 'Recepcion' | 'Produccion'
  navigateParams: {},
  vistaActual: null,

  iniciar() {
    // El selector de módulo ya está visible por defecto en el HTML; solo
    // hace falta esto si se vuelve a llamar tras "Cambiar módulo".
    document.getElementById('selectorModuloArea').style.display = 'flex';
    document.getElementById('moduloArea').style.display = 'none';
  },

  seleccionarModulo(mod) {
    this.modulo = mod;
    document.getElementById('selectorModuloArea').style.display = 'none';
    document.getElementById('moduloArea').style.display = 'flex';
    const titulo = document.getElementById('isoSubnavTitulo');
    titulo.textContent = mod === 'Recepcion' ? '📦 Recepción' : '⚙️ Producción';
    this.renderSubnav();
    this.navigate('dashboard');
  },

  volverSelector() {
    this.modulo = null;
    document.getElementById('selectorModuloArea').style.display = 'flex';
    document.getElementById('moduloArea').style.display = 'none';
  },

  renderSubnav() {
    const puedeVer = tienePermiso('iso2859.ver') || tienePermiso('iso2859.gestion');
    const puedeCrearLote = tienePermiso('iso2859.crear_lote') || tienePermiso('iso2859.gestion');
    const puedeMuestrear = tienePermiso('iso2859.muestrear') || tienePermiso('iso2859.gestion');
    const puedeReportes = tienePermiso('iso2859.reportes') || tienePermiso('iso2859.gestion');

    const links = document.getElementById('isoSubnavLinks');
    let html = `<button data-vista="dashboard" onclick="Iso2859App.navigate('dashboard')">Dashboard</button>`;

    if (this.modulo === 'Recepcion') {
      if (puedeCrearLote) html += `<button data-vista="nuevo-lote" onclick="Iso2859App.navigate('nuevo-lote')">+ Nuevo Lote</button>`;
    } else if (puedeMuestrear || puedeCrearLote) {
      html += `<button data-vista="nuevo-muestreo" onclick="Iso2859App.navigate('nuevo-muestreo')">+ Nuevo Muestreo</button>`;
    }

    if (puedeVer) html += `<button data-vista="historial" onclick="Iso2859App.navigate('historial')">Historial</button>`;
    if (puedeReportes) html += `<button data-vista="reportes" onclick="Iso2859App.navigate('reportes')">Reportes</button>`;

    html += `<button class="cambiar-modulo" onclick="Iso2859App.volverSelector()">↩ Cambiar módulo</button>`;
    links.innerHTML = html;
  },

  marcarActivo(vista) {
    document.querySelectorAll('#isoSubnavLinks button[data-vista]').forEach(b => {
      b.classList.toggle('activo', b.dataset.vista === vista);
    });
  },

  navigate(vista, params = {}) {
    this.vistaActual = vista;
    this.navigateParams = params;
    this.marcarActivo(vista);
    const cont = document.getElementById('iso2859Content');
    cont.innerHTML = '';
    switch (vista) {
      case 'dashboard': Iso2859Dashboard.render(); break;
      case 'nuevo-lote': Iso2859Lote.renderNuevo(); break;
      case 'nuevo-muestreo': Iso2859Revision.renderNuevoMuestreo(); break;
      case 'muestreo': Iso2859Muestreo.render(params.idLote, params.tipo, params.idRevision, params); break;
      case 'historial': Iso2859Historial.render(); break;
      case 'reportes': Iso2859Reportes.render(); break;
      default: Iso2859Dashboard.render();
    }
  },
};
