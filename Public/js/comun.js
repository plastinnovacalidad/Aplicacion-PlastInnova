// ========================================================================
// Funciones compartidas entre las páginas del sistema.
// Contiene ÚNICAMENTE funciones que eran idénticas, carácter por carácter,
// en varias páginas. Cada página sigue declarando sus propias variables
// globales (token, permisosUsuario, usuarioActual, etc.) tal como antes;
// este archivo solo evita repetir la lógica que ya era igual en todas.
// ========================================================================

// Usada por: index.html, gestion.html, referencias.html, smd.html,
// garantias.html, metrologia.html
function tienePermiso(codigo) {
  return permisosUsuario.includes(codigo);
}

// Usada por: gestion.html, smd.html, garantias.html, dashboard_garantias.html,
// metrologia.html, whatsapp_bot.html — para que ningún texto que la gente
// escribe (nombre de cliente, motivo, nombre de cota, nombre de WhatsApp,
// etc.) se pueda insertar como código en la página.
//
// El truco de "div.textContent = text; devolver div.innerHTML" convierte
// los caracteres peligrosos en texto (&, <, >), pero NO convierte las
// comillas simples ni dobles — y varias páginas usan el resultado también
// dentro de atributos HTML (id="...", alt="...", data-algo="..."), donde
// una comilla sin convertir sí permite "escaparse" del atributo. Por eso
// se agregan esos dos reemplazos extra: son inofensivos para el texto
// normal (una comilla convertida se sigue viendo igual en pantalla) y
// hacen que la misma función sirva para ambos casos.
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ========================================================================
// Login/logout — segunda variante (idéntica carácter por carácter en
// garantias.html, metrologia.html y whatsapp_bot.html, pero distinta de la
// de auth-comun.js: aquí, al iniciar sesión, se llama a `init()` en vez de
// `initApp()`, y `usuarioActual` lo termina llenando esa misma `init()`
// -no doLogin- así que NO se puede compartir con auth-comun.js).
// index.html tiene su propia versión con diferencias reales (valida campos
// vacíos antes de llamar al servidor, usa checkSession() en vez de init())
// y no usa ninguna de las dos.
// Requiere que la página ya haya declarado la variable global `token` y
// la función `init()`.
// ========================================================================
function mostrarLogin() {
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('appHeader').style.display = 'none';
  document.getElementById('appMain').style.display = 'none';
}

async function doLogin() {
  const user = document.getElementById('loginUser').value.trim();
  const pass = document.getElementById('loginPass').value.trim();
  const err = document.getElementById('loginError');
  err.style.display = 'none';
  try {
    const res = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: user, contrasena: pass })
    });
    const data = await res.json();
    if (data.success) {
      token = data.token;
      localStorage.setItem('token', token);
      await init();
    } else {
      err.textContent = data.error || 'Error al iniciar sesión';
      err.style.display = 'block';
    }
  } catch (e) {
    err.textContent = 'No se pudo conectar al servidor';
    err.style.display = 'block';
  }
}

// ========================================================================
// Carga de permisos del usuario — dos variantes que existían repetidas:
//
// cargarPermisosDelUsuario(): usada por garantias.html, index.html y
// metrologia.html. Estas 3 vuelven a consultar /api/me para obtener el rol
// (en vez de confiar en la variable global usuarioActual), así que la
// lógica se puede compartir tal cual. Dejan el resultado en la variable
// global `permisosUsuario`, igual que antes. Devuelve true/false según si
// la consulta tuvo éxito: metrologia.html solo llama a su propia
// aplicarPermisosUI() cuando es true, igual que en el código original
// (donde esa llamada estaba dentro del mismo try, después de calcular
// permisosUsuario).
//
// cargarPermisosConUsuarioActual(): usada por gestion.html, referencias.html
// y smd.html. Estas 3 SÍ confían en que usuarioActual.rol ya está disponible
// (no vuelven a consultar /api/me). Devuelve la lista de roles obtenida (o
// null si falló la consulta) para que gestion.html/smd.html, que la guardan
// en su propia variable global `rolesCache` para usarla después en la
// administración de roles, puedan seguir haciéndolo exactamente igual que
// antes -si la consulta falla, rolesCache se queda como estaba, igual que
// en el código original-.
// ========================================================================
async function cargarPermisosDelUsuario() {
  try {
    const res = await fetch('/api/roles', { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json();
    const rolesCache = data.roles || [];
    const me = await fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token } }).then(r => r.json());
    const miRol = rolesCache.find(r => r.nombre === me.rol);
    permisosUsuario = miRol ? miRol.permisos.map(p => p.codigo) : [];
    return true;
  } catch (e) {
    permisosUsuario = [];
    return false;
  }
}

async function cargarPermisosConUsuarioActual() {
  try {
    const res = await fetch('/api/roles', { headers: { 'Authorization': 'Bearer ' + token } });
    const data = await res.json();
    const roles = data.roles || [];
    const miRol = roles.find(r => r.nombre === usuarioActual.rol);
    permisosUsuario = miRol ? miRol.permisos.map(p => p.codigo) : [];
    return roles;
  } catch (e) {
    permisosUsuario = [];
    return null;
  }
}
