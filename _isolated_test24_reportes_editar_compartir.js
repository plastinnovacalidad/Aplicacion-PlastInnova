// Prueba de "Editar" y "Compartir" en Reportes por Áreas (pedido por Julio,
// 07/09): "ayúdame a que los pueda editar después de cerrarlos" (aclarado:
// poder editarlos en cualquier momento después de crearlos, sin importar el
// estado) y "como los podemos compartir?" (aclarado: reenviar la
// tarjeta-imagen por WhatsApp, en cualquier momento, a quien sea, desde el
// detalle de un Rápido o Completo).
const path = require('path');

const PROJECT = '/tmp/valtest_project';
const { SESSIONS_FILE } = require(path.join(PROJECT, 'settings/paths'));

if (!SESSIONS_FILE.startsWith('/tmp/valtest_project')) {
  throw new Error('SESSIONS_FILE no apunta a la copia aislada -- abortando.');
}

const TOKEN_GESTIONAR = 'token-prueba-reportes-editar-gestionar';
const TOKEN_SOLO_VER = 'token-prueba-reportes-editar-ver';
const TOKEN_SOLO_CREAR = 'token-prueba-reportes-editar-crear';

async function main() {
  let ok = 0, fail = 0;
  function check(nombre, cond) {
    console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + nombre);
    if (cond) ok++; else fail++;
  }

  const { inicializarBaseDatos } = require(path.join(PROJECT, 'db/init'));
  await inicializarBaseDatos();
  const { getDb } = require(path.join(PROJECT, 'db/connection'));
  const db = getDb();

  // -------- Roles/sesiones de prueba --------
  const permId = async (codigo) => (await db.get('SELECT id FROM permisos WHERE codigo = ?', [codigo])).id;
  async function asegurarRol(nombre, codigos) {
    let rol = await db.get('SELECT id FROM roles WHERE nombre = ?', [nombre]);
    if (!rol) {
      const r = await db.run("INSERT INTO roles (nombre, descripcion, es_sistema) VALUES (?, 'Prueba', 0)", [nombre]);
      rol = { id: r.lastID };
    } else {
      await db.run('DELETE FROM rol_permisos WHERE rol_id = ?', [rol.id]);
    }
    for (const codigo of codigos) {
      await db.run('INSERT INTO rol_permisos (rol_id, permiso_id) VALUES (?, ?)', [rol.id, await permId(codigo)]);
    }
    return rol;
  }
  const rolGestionar = await asegurarRol('Prueba Reportes Editar Gestionar', ['reportes.ver', 'reportes.crear', 'reportes.gestionar', 'reportes.eliminar']);
  const rolSoloVer = await asegurarRol('Prueba Reportes Editar SoloVer', ['reportes.ver']);
  const rolSoloCrear = await asegurarRol('Prueba Reportes Editar SoloCrear', ['reportes.ver', 'reportes.crear']);

  const SUFIJO = Date.now();

  // Usuarios de prueba: dos CON teléfono (para compartir), uno SIN teléfono.
  const rolBase = await db.get('SELECT id FROM roles LIMIT 1');
  async function crearUsuarioPrueba(nombre, usuarioLogin, telefono) {
    const r = await db.run(
      'INSERT INTO usuarios (nombre, usuario, contrasena, rol_id, telefono) VALUES (?, ?, ?, ?, ?)',
      [nombre, usuarioLogin, 'hashfalso', rolBase ? rolBase.id : null, telefono || null]
    );
    return r.lastID;
  }
  const idDestConTelefono = await crearUsuarioPrueba('Destinatario Editar ' + SUFIJO, 'desteditar' + SUFIJO, '573009998877');
  const idDestSinTelefono = await crearUsuarioPrueba('Sin Telefono Editar ' + SUFIJO, 'sinteleditar' + SUFIJO, null);

  const usuario = await db.get('SELECT id FROM usuarios LIMIT 1');
  const fs = require('fs');
  async function crearSesion(token, rolId) {
    const sesiones = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8') || '{}');
    sesiones[token] = { id: usuario.id, nombre: 'Prueba Reportes Editar', rol_id: rolId, ultimaActividad: Date.now() };
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sesiones, null, 2));
  }
  await crearSesion(TOKEN_GESTIONAR, rolGestionar.id);
  await crearSesion(TOKEN_SOLO_VER, rolSoloVer.id);
  await crearSesion(TOKEN_SOLO_CREAR, rolSoloCrear.id);

  const { recargarPermisos } = require(path.join(PROJECT, 'middleware/auth'));
  await recargarPermisos();

  // -------- Áreas de prueba --------
  const areaResult = await db.run(
    "INSERT INTO iso_areas (nombre, modulo, estado, encargado) VALUES (?, 'Ambos', 'Activo', ?)",
    ['Área Prueba Editar ' + SUFIJO, 'Encargado Prueba']
  );
  const idArea = areaResult.lastID;
  const areaResult2 = await db.run(
    "INSERT INTO iso_areas (nombre, modulo, estado, encargado) VALUES (?, 'Ambos', 'Activo', ?)",
    ['Área Prueba Editar 2 ' + SUFIJO, 'Encargado Prueba 2']
  );
  const idArea2 = areaResult2.lastID;

  // -------- Defectos de prueba (para "el problema" editable, pedido de Julio 2da vuelta) --------
  const maxIdDefecto = (await db.get('SELECT MAX(id) as m FROM iso_tipificacion_defectos')).m || 0;
  const idDefectoX = maxIdDefecto + 1;
  const idDefectoY = maxIdDefecto + 2;
  await db.run(
    "INSERT INTO iso_tipificacion_defectos (id, codigo, area, descripcion, estado, severidad) VALUES (?, ?, 'SMD', 'Defecto de prueba X para editar', 'Activo', 'Mayor')",
    [idDefectoX, 'DEFEDITX-' + SUFIJO]
  );
  await db.run(
    "INSERT INTO iso_tipificacion_defectos (id, codigo, area, descripcion, estado, severidad) VALUES (?, ?, 'SMD', 'Defecto de prueba Y para editar', 'Activo', 'Mayor')",
    [idDefectoY, 'DEFEDITY-' + SUFIJO]
  );

  // -------- Servidor de prueba --------
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', require(path.join(PROJECT, 'routes/reportes')));
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  const server = app.listen(0);
  const puerto = server.address().port;
  const base = `http://localhost:${puerto}/api`;

  const authGestionar = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN_GESTIONAR };
  const authVer = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN_SOLO_VER };
  const authCrear = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN_SOLO_CREAR };

  // ======================== EDITAR: RÁPIDO ========================
  const resRapido = await fetch(`${base}/reportes/rapido`, {
    method: 'POST', headers: authGestionar,
    body: JSON.stringify({ area_origen_id: idArea, referencia: 'REF-ORIG', lote: 'LOTE-ORIG', urgencia: 'Media', descripcion: 'Descripción original.' }),
  });
  const reporteRapido = await resRapido.json();
  check('crear Rápido de prueba -> 201', resRapido.status === 201);

  const resEditarSinPermiso = await fetch(`${base}/reportes/${reporteRapido.id}`, {
    method: 'PUT', headers: authVer, body: JSON.stringify({ descripcion: 'No debería pasar' }),
  });
  check('PUT /reportes/:id con solo reportes.ver -> 403 (requiere reportes.gestionar)', resEditarSinPermiso.status === 403);

  const resEditarRapido = await fetch(`${base}/reportes/${reporteRapido.id}`, {
    method: 'PUT', headers: authGestionar,
    body: JSON.stringify({ area_origen_id: idArea2, urgencia: 'Alta', referencia: 'REF-EDITADA', lote: 'LOTE-EDITADO', descripcion: 'Descripción editada.' }),
  });
  check('PUT /reportes/:id (Rápido) -> 200', resEditarRapido.ok);
  const rapidoEditado = await resEditarRapido.json();
  check('el área quedó cambiada', rapidoEditado.area_origen_id === idArea2);
  check('la urgencia quedó cambiada', rapidoEditado.urgencia === 'Alta');
  check('la referencia quedó cambiada', rapidoEditado.referencia === 'REF-EDITADA');
  check('el lote quedó cambiado', rapidoEditado.lote === 'LOTE-EDITADO');
  check('la descripción quedó cambiada', rapidoEditado.descripcion === 'Descripción editada.');
  check('el tipo sigue siendo rapido (editar no cambia el tipo)', rapidoEditado.tipo === 'rapido');
  check('el estado no se toca al editar (sigue Pendiente)', rapidoEditado.estado === 'Pendiente');

  // Edición parcial: solo un campo, el resto se mantiene igual.
  const resEditarParcial = await fetch(`${base}/reportes/${reporteRapido.id}`, {
    method: 'PUT', headers: authGestionar, body: JSON.stringify({ urgencia: 'Baja' }),
  });
  const rapidoParcial = await resEditarParcial.json();
  check('edición parcial (solo urgencia) -> 200 y solo cambia ese campo', resEditarParcial.ok && rapidoParcial.urgencia === 'Baja' && rapidoParcial.referencia === 'REF-EDITADA' && rapidoParcial.descripcion === 'Descripción editada.');

  // Validaciones.
  const resEditarSinArea = await fetch(`${base}/reportes/${reporteRapido.id}`, {
    method: 'PUT', headers: authGestionar, body: JSON.stringify({ area_origen_id: '' }),
  });
  check('PUT con area_origen_id vacío -> 400 (el área es obligatoria)', resEditarSinArea.status === 400);

  const resEditarSinDescripcion = await fetch(`${base}/reportes/${reporteRapido.id}`, {
    method: 'PUT', headers: authGestionar, body: JSON.stringify({ descripcion: '   ' }),
  });
  check('PUT con descripcion en blanco -> 400 (no puede quedar vacía)', resEditarSinDescripcion.status === 400);

  const resEditarUrgenciaInvalida = await fetch(`${base}/reportes/${reporteRapido.id}`, {
    method: 'PUT', headers: authGestionar, body: JSON.stringify({ urgencia: 'Urgentisima' }),
  });
  check('PUT con urgencia inválida -> 400', resEditarUrgenciaInvalida.status === 400);

  const resEditarNada = await fetch(`${base}/reportes/${reporteRapido.id}`, {
    method: 'PUT', headers: authGestionar, body: JSON.stringify({}),
  });
  check('PUT sin ningún campo -> 400 ("nada que actualizar")', resEditarNada.status === 400);

  const resEditarNoExiste = await fetch(`${base}/reportes/999999`, {
    method: 'PUT', headers: authGestionar, body: JSON.stringify({ descripcion: 'x' }),
  });
  check('PUT a un reporte inexistente -> 404', resEditarNoExiste.status === 404);

  // ======================== EDITAR: COMPLETO (sin importar el estado -- pedido explícito de Julio) ========================
  const resEscalar = await fetch(`${base}/reportes/${reporteRapido.id}/escalar`, {
    method: 'POST', headers: authGestionar, body: JSON.stringify({ causa_raiz: 'Causa de prueba para editar' }),
  });
  const reporteCompleto = await resEscalar.json();
  check('escalar a Completo para probar edición -> 200', resEscalar.ok && reporteCompleto.tipo === 'completo');

  // Marcar una medida como Funciono para que el estado quede Implementado, y
  // confirmar que editar los datos base NO le toca el estado.
  const resCausaId = reporteCompleto.causas[0].id;
  const resMedida = await fetch(`${base}/reportes/${reporteCompleto.id}/medidas`, {
    method: 'POST', headers: authGestionar,
    body: JSON.stringify({ texto: 'Medida de prueba', estado: 'Funciono', causa_id: resCausaId }),
  });
  const reporteConMedida = await resMedida.json();
  check('la medida "Funciono" recalculó el estado a Implementado', reporteConMedida.estado === 'Implementado');

  const resEditarCompletoImplementado = await fetch(`${base}/reportes/${reporteCompleto.id}`, {
    method: 'PUT', headers: authGestionar, body: JSON.stringify({ descripcion: 'Descripción editada ya con el reporte Implementado.' }),
  });
  const completoEditado = await resEditarCompletoImplementado.json();
  check('se puede editar un Reporte Completo ya Implementado (pedido de Julio: sin importar el estado)', resEditarCompletoImplementado.ok);
  check('la descripción quedó editada', completoEditado.descripcion === 'Descripción editada ya con el reporte Implementado.');
  check('el estado Implementado NO se toca al editar los datos base', completoEditado.estado === 'Implementado');
  check('las causas/medidas ya registradas siguen intactas', completoEditado.causas.length === 1 && completoEditado.medidas.length === 1);

  // ======================== EDITAR: "EL PROBLEMA" (defecto_id) -- pedido por Julio, segunda vuelta ========================
  // Este Completo se escaló SIN elegir defecto (arriba, con el botón rápido
  // de "escalar" de toda la vida) -- confirmamos que Editar deja asignárselo
  // ahora, y que desde ahí en adelante las causas nuevas quedan ligadas a él.
  check('el Completo escalado sin elegir "el problema" queda con defecto_id NULL', reporteCompleto.defecto_id == null);
  const resAsignarDefecto = await fetch(`${base}/reportes/${reporteCompleto.id}`, {
    method: 'PUT', headers: authGestionar, body: JSON.stringify({ defecto_id: idDefectoX }),
  });
  const conDefectoAsignado = await resAsignarDefecto.json();
  check('PUT con defecto_id -> 200 y lo asigna', resAsignarDefecto.ok && conDefectoAsignado.defecto_id === idDefectoX);
  check('las causas ya existentes NO se retocan solo por asignar el problema', conDefectoAsignado.causas.length === 1 && conDefectoAsignado.causas[0].id === resCausaId);

  // Una causa nueva agregada DESPUÉS de asignar el problema sí queda ligada a él.
  const resCausaTrasAsignar = await fetch(`${base}/reportes/${reporteCompleto.id}/causas`, {
    method: 'POST', headers: authGestionar, body: JSON.stringify({ texto: 'Causa agregada tras asignar el problema' }),
  });
  const conCausaTrasAsignar = await resCausaTrasAsignar.json();
  const nuevaCausa = conCausaTrasAsignar.causas.find(c => c.texto === 'Causa agregada tras asignar el problema');
  check('la causa nueva agregada después de asignar el problema queda ligada al catálogo de ESE defecto', nuevaCausa && nuevaCausa.causa_catalogo_id != null);
  const resCatalogoDefectoX = await fetch(`${base}/reportes/catalogo-causas?defecto_id=${idDefectoX}`, { headers: authVer });
  const catalogoDefectoX = await resCatalogoDefectoX.json();
  check('esa causa ya aparece en el catálogo filtrado por el defecto recién asignado (pedido de Julio: que quede para los siguientes reportes)', catalogoDefectoX.some(c => c.id === nuevaCausa.causa_catalogo_id));

  // Cambiar el problema a otro distinto -> las causas viejas se quedan como estaban (no se reetiquetan).
  const resCambiarDefecto = await fetch(`${base}/reportes/${reporteCompleto.id}`, {
    method: 'PUT', headers: authGestionar, body: JSON.stringify({ defecto_id: idDefectoY }),
  });
  const conDefectoCambiado = await resCambiarDefecto.json();
  check('cambiar el problema a otro -> 200', resCambiarDefecto.ok && conDefectoCambiado.defecto_id === idDefectoY);
  check('las causas anteriores NO se reetiquetan al cambiar el problema (siguen ligadas al catálogo de antes)', conDefectoCambiado.causas.find(c => c.id === nuevaCausa.id).causa_catalogo_id === nuevaCausa.causa_catalogo_id);

  // Quitar el problema (dejarlo sin asignar de nuevo) con defecto_id vacío.
  const resQuitarDefecto = await fetch(`${base}/reportes/${reporteCompleto.id}`, {
    method: 'PUT', headers: authGestionar, body: JSON.stringify({ defecto_id: '' }),
  });
  const sinDefecto = await resQuitarDefecto.json();
  check('mandar defecto_id vacío lo deja sin problema asignado (NULL)', resQuitarDefecto.ok && sinDefecto.defecto_id == null);

  // ======================== EDITAR: INFORMATIVO (campos y áreas destino distintos) ========================
  const resInformativo = await fetch(`${base}/reportes/informativo`, {
    method: 'POST', headers: authGestionar,
    body: JSON.stringify({ area_origen_id: idArea, titulo: 'Título original', contenido: 'Contenido original', areas_destino: [idArea2] }),
  });
  const reporteInformativo = await resInformativo.json();
  check('crear Informativo de prueba -> 201', resInformativo.status === 201);

  const resEditarInformativo = await fetch(`${base}/reportes/${reporteInformativo.id}`, {
    method: 'PUT', headers: authGestionar,
    body: JSON.stringify({ titulo: 'Título editado', contenido: 'Contenido editado', fecha_vigencia: '2026-12-31', areas_destino: [idArea] }),
  });
  check('PUT /reportes/:id (Informativo) -> 200', resEditarInformativo.ok);
  const informativoEditado = await resEditarInformativo.json();
  check('el título quedó editado', informativoEditado.titulo === 'Título editado');
  check('el contenido quedó editado (guardado en la columna descripcion)', informativoEditado.descripcion === 'Contenido editado');
  check('la vigencia quedó editada', String(informativoEditado.fecha_vigencia).slice(0, 10) === '2026-12-31');
  check('las áreas destino se reemplazaron por completo (ya no incluye la anterior)', informativoEditado.destinos.length === 1 && informativoEditado.destinos[0].id === idArea);

  const resEditarInformativoSinTitulo = await fetch(`${base}/reportes/${reporteInformativo.id}`, {
    method: 'PUT', headers: authGestionar, body: JSON.stringify({ titulo: '   ' }),
  });
  check('PUT Informativo con título en blanco -> 400', resEditarInformativoSinTitulo.status === 400);

  const resEditarInformativoSinAreas = await fetch(`${base}/reportes/${reporteInformativo.id}`, {
    method: 'PUT', headers: authGestionar, body: JSON.stringify({ areas_destino: [] }),
  });
  check('PUT Informativo con areas_destino vacío -> 400 (al menos un área destino)', resEditarInformativoSinAreas.status === 400);

  // Un campo de rapido/completo (p.ej. "urgencia") no aplica a un Informativo -- se ignora sin error.
  const resEditarInformativoConCampoAjeno = await fetch(`${base}/reportes/${reporteInformativo.id}`, {
    method: 'PUT', headers: authGestionar, body: JSON.stringify({ urgencia: 'Alta', titulo: 'Reintento con campo ajeno' }),
  });
  const informativoConCampoAjeno = await resEditarInformativoConCampoAjeno.json();
  check('un campo que no aplica al tipo (urgencia en un Informativo) se ignora sin romper la edición', resEditarInformativoConCampoAjeno.ok && informativoConCampoAjeno.titulo === 'Reintento con campo ajeno' && informativoConCampoAjeno.urgencia == null);

  // ======================== COMPARTIR ========================
  const resCompartirSinDestinatarios = await fetch(`${base}/reportes/${reporteRapido.id}/compartir`, {
    method: 'POST', headers: authGestionar, body: JSON.stringify({ destinatarios: [] }),
  });
  check('POST /reportes/:id/compartir sin destinatarios -> 400', resCompartirSinDestinatarios.status === 400);

  const resCompartirNoExiste = await fetch(`${base}/reportes/999999/compartir`, {
    method: 'POST', headers: authGestionar, body: JSON.stringify({ destinatarios: [idDestConTelefono] }),
  });
  check('compartir un reporte inexistente -> 404', resCompartirNoExiste.status === 404);

  const resCompartirInformativo = await fetch(`${base}/reportes/${reporteInformativo.id}/compartir`, {
    method: 'POST', headers: authGestionar, body: JSON.stringify({ destinatarios: [idDestConTelefono] }),
  });
  check('compartir un Reporte Informativo -> 400 (todavía no soportado para ese tipo)', resCompartirInformativo.status === 400);

  const resCompartirSoloSinTelefono = await fetch(`${base}/reportes/${reporteRapido.id}/compartir`, {
    method: 'POST', headers: authGestionar, body: JSON.stringify({ destinatarios: [idDestSinTelefono] }),
  });
  check('compartir eligiendo solo a alguien sin teléfono -> 400', resCompartirSoloSinTelefono.status === 400);

  const resCompartirOk = await fetch(`${base}/reportes/${reporteRapido.id}/compartir`, {
    method: 'POST', headers: authGestionar, body: JSON.stringify({ destinatarios: [idDestConTelefono, idDestSinTelefono, 888888] }),
  });
  check('compartir un Rápido con un destinatario válido (más ids inválidos mezclados) -> 200', resCompartirOk.ok);
  const compartidoRapido = await resCompartirOk.json();
  check('la respuesta trae el campo envio (sin bot conectado en pruebas, enviado=false pero no revienta)', 'envio' in compartidoRapido && compartidoRapido.envio.enviado === false);

  const resCompartirCompleto = await fetch(`${base}/reportes/${reporteCompleto.id}/compartir`, {
    method: 'POST', headers: authGestionar, body: JSON.stringify({ destinatarios: [idDestConTelefono] }),
  });
  check('compartir un Reporte Completo (no solo Rápido) -> 200', resCompartirCompleto.ok);

  // Compartir solo pide "ver el módulo" (cualquiera de los 4 permisos), no reportes.gestionar.
  const resCompartirConSoloCrear = await fetch(`${base}/reportes/${reporteRapido.id}/compartir`, {
    method: 'POST', headers: authCrear, body: JSON.stringify({ destinatarios: [idDestConTelefono] }),
  });
  check('compartir con reportes.crear (no reportes.gestionar) -> 200 (basta con ver el módulo)', resCompartirConSoloCrear.ok);
  const resCompartirConSoloVer = await fetch(`${base}/reportes/${reporteRapido.id}/compartir`, {
    method: 'POST', headers: authVer, body: JSON.stringify({ destinatarios: [idDestConTelefono] }),
  });
  check('compartir con reportes.ver -> 200 (basta con ver el módulo)', resCompartirConSoloVer.ok);

  server.close();
  console.log(`\n${ok} OK, ${fail} FAIL`);
  console.log('\n=== Prueba Editar/Compartir completa ===');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('ERROR INESPERADO:', e); process.exit(1); });
