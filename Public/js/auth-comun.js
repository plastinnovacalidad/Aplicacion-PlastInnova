// ========================================================================
// Login y logout compartidos.
// Usada por: calidad.html, gestion.html, referencias.html,
// referencias_metrologia.html, smd.html (las páginas cuyo doLogin/doLogout
// eran idénticos, carácter por carácter).
// index.html y garantias.html tienen su propia versión (con diferencias
// reales de comportamiento) y NO usan este archivo.
//
// Requiere que la página que la use ya haya declarado, en su propio
// <script>, las variables globales `token` y `usuarioActual`.
//
// Julio pidió que, sin importar en qué módulo haya quedado la sesión al
// cerrarse (ya sea por "Cerrar sesión" o porque expiró sola), al volver a
// iniciar sesión SIEMPRE se llegue al panel central — nunca se debe quedar
// en el módulo donde estaba. Por eso, en vez de llamar a initApp() (que
// solo redibuja ese mismo módulo), se redirige directo a index.html.
// ========================================================================

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
      location.href = 'index.html';
    } else {
      err.textContent = data.error || 'Error al iniciar sesión';
      err.style.display = 'block';
    }
  } catch (e) {
    err.textContent = 'No se pudo conectar al servidor';
    err.style.display = 'block';
  }
}

async function doLogout() {
  await fetch('/api/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
  localStorage.removeItem('token'); token = null; location.reload();
}
