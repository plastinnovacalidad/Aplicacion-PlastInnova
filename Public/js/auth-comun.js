// ========================================================================
// Login y logout compartidos.
// Usada por: gestion.html, referencias.html, smd.html (las 3 páginas cuyo
// doLogin/doLogout eran idénticos, carácter por carácter).
// index.html y garantias.html tienen su propia versión (con diferencias
// reales de comportamiento) y NO usan este archivo.
//
// Requiere que la página que la use ya haya declarado, en su propio
// <script>, las variables globales `token` y `usuarioActual`, y la
// función `initApp()` — igual que antes de este cambio.
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
      usuarioActual = { nombre: data.usuario, rol: data.rol };
      initApp();
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
