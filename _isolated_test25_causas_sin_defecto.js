// Prueba de la limpieza de una sola vez pedida por Julio (07/09): "borrar
// las que no tengan o problema o raiz asignada" / aclarado después:
// "Todas las que no tengan problema asignado, aunque ya se hayan usado" --
// DELETE /produccion/trazabilidad/catalogo/causas-sin-defecto borra TODAS
// las causas del catálogo con defecto_id NULL, incluso si ya se usaron en
// casos reales de Producción o de Reportes: el texto de esos casos se
// mantiene (queda guardado directo en la fila del caso), solo se desvincula
// el causa_catalogo_id (se pone NULL) y se borra la fila del catálogo (y sus
// medidas propias). Las causas SÍ ligadas a un defecto (las de Reportes por
// Áreas) nunca se tocan.
const path = require('path');

const PROJECT = '/tmp/valtest_project';
const { SESSIONS_FILE } = require(path.join(PROJECT, 'settings/paths'));

if (!SESSIONS_FILE.startsWith('/tmp/valtest_project')) {
  throw new Error('SESSIONS_FILE no apunta a la copia aislada -- abortando.');
}

const TOKEN_CAT_GESTIONAR = 'token-prueba-causassindefecto-catgestionar';
const TOKEN_SOLO_VER_TRAZA = 'token-prueba-causassindefecto-vertraza';

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
  const catalogoData = require(path.join(PROJECT, 'data/trazabilidadCatalogo'));
  const trazabilidadData = require(path.join(PROJECT, 'data/trazabilidadProduccion'));

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
  const rolCatGestionar = await asegurarRol('Prueba CausasSinDefecto CatGestionar', ['catalogos.gestionar']);
  const rolSoloVerTraza = await asegurarRol('Prueba CausasSinDefecto VerTraza', ['produccion.trazabilidad.ver']);

  const usuario = await db.get('SELECT id FROM usuarios LIMIT 1');
  const fs = require('fs');
  async function crearSesion(token, rolId) {
    const sesiones = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8') || '{}');
    sesiones[token] = { id: usuario.id, nombre: 'Prueba CausasSinDefecto', rol_id: rolId, ultimaActividad: Date.now() };
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sesiones, null, 2));
  }
  await crearSesion(TOKEN_CAT_GESTIONAR, rolCatGestionar.id);
  await crearSesion(TOKEN_SOLO_VER_TRAZA, rolSoloVerTraza.id);

  const { recargarPermisos } = require(path.join(PROJECT, 'middleware/auth'));
  await recargarPermisos();

  const SUFIJO = Date.now();

  // -------- Datos de prueba --------
  // 1) Una causa SIN defecto, nunca usada en ningún caso real -- debe borrarse.
  const causaSinUsoNunca = await catalogoData.obtenerOCrearCausaCatalogo('Causa sin defecto sin uso ' + SUFIJO, null);
  const medidaDeEsaCausa = await catalogoData.obtenerOCrearMedidaCatalogo(causaSinUsoNunca.id, 'Medida de la causa sin uso ' + SUFIJO);

  // 2) Una causa SIN defecto, YA usada en un caso real de Producción --
  //    Julio confirmó que debe borrarse IGUAL (aunque ya se haya usado).
  const problema = await trazabilidadData.crearProblema({
    fabrica: 'Fabrica 1', tipo_contexto: 'referencia', valor_contexto: 'REF-CSD-' + SUFIJO,
    pct_desperdicio_inicial: 1, causaInicial: 'placeholder', causaCatalogoId: null,
    autorId: usuario.id, autorNombre: 'Prueba',
  });
  const causaUsadaEnProduccion = await catalogoData.obtenerOCrearCausaCatalogo('Causa sin defecto YA usada en Producción ' + SUFIJO, null);
  await trazabilidadData.agregarCausa({
    problema_id: problema.id, texto: causaUsadaEnProduccion.texto, causa_catalogo_id: causaUsadaEnProduccion.id,
    autor_id: usuario.id, autor_nombre: 'Prueba',
  });

  // 3) Una causa SIN defecto, YA usada en un Reporte de "Reportes por Áreas"
  //    (aunque ESE reporte en sí no tenga defecto_id -- el escalar sin elegir
  //    "el problema" sigue funcionando) -- también debe borrarse.
  const reportesData = require(path.join(PROJECT, 'data/reportes'));
  const areaResult = await db.run(
    "INSERT INTO iso_areas (nombre, modulo, estado, encargado) VALUES (?, 'Ambos', 'Activo', ?)",
    ['Área Prueba CSD ' + SUFIJO, 'Encargado Prueba']
  );
  const reporteRapido = await reportesData.crearReporteRapido({
    area_origen_id: areaResult.lastID, descripcion: 'Reporte de prueba CSD', autorId: usuario.id, autorNombre: 'Prueba',
  });
  const causaUsadaEnReportes = await catalogoData.obtenerOCrearCausaCatalogo('Causa sin defecto YA usada en Reportes ' + SUFIJO, null);
  await reportesData.escalarAReporteCompleto(reporteRapido.id, {
    causaInicial: causaUsadaEnReportes.texto, causaCatalogoId: causaUsadaEnReportes.id, defectoId: null,
    autorId: usuario.id, autorNombre: 'Prueba',
  });

  // 4) Una causa CON defecto asignado (de Reportes por Áreas) -- NO debe tocarse.
  const maxIdDefecto = (await db.get('SELECT MAX(id) as m FROM iso_tipificacion_defectos')).m || 0;
  const idDefecto = maxIdDefecto + 1;
  await db.run(
    "INSERT INTO iso_tipificacion_defectos (id, codigo, area, descripcion, estado, severidad) VALUES (?, ?, 'SMD', 'Defecto de prueba CSD', 'Activo', 'Mayor')",
    [idDefecto, 'DEFCSD-' + SUFIJO]
  );
  const causaConDefecto = await catalogoData.obtenerOCrearCausaCatalogo('Causa CON defecto asignado ' + SUFIJO, idDefecto);

  // -------- Servidor de prueba --------
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', require(path.join(PROJECT, 'routes/produccion')));
  app.use((err, req, res, next) => { res.status(500).json({ error: err.message }); });
  const server = app.listen(0);
  const puerto = server.address().port;
  const base = `http://localhost:${puerto}/api`;

  // -------- Permisos: solo catalogos.gestionar puede correr la limpieza --------
  const resSinPermiso = await fetch(`${base}/produccion/trazabilidad/catalogo/causas-sin-defecto`, {
    method: 'DELETE', headers: { 'Authorization': 'Bearer ' + TOKEN_SOLO_VER_TRAZA },
  });
  check('DELETE causas-sin-defecto con solo produccion.trazabilidad.ver -> 403 (requiere catalogos.gestionar)', resSinPermiso.status === 403);

  // Verificamos que todavía nada se borró.
  const antesDeLimpiar = await catalogoData.obtenerCausaCatalogoPorId(causaSinUsoNunca.id);
  check('antes de correr la limpieza, la causa de prueba sigue en el catálogo', !!antesDeLimpiar);

  // -------- Ejecutar la limpieza de verdad --------
  const resLimpiar = await fetch(`${base}/produccion/trazabilidad/catalogo/causas-sin-defecto`, {
    method: 'DELETE', headers: { 'Authorization': 'Bearer ' + TOKEN_CAT_GESTIONAR },
  });
  check('DELETE causas-sin-defecto con catalogos.gestionar -> 200', resLimpiar.ok);
  const resultado = await resLimpiar.json();
  check('la respuesta trae causasEliminadas, medidasEliminadas y referenciasDesvinculadas', typeof resultado.causasEliminadas === 'number' && typeof resultado.medidasEliminadas === 'number' && typeof resultado.referenciasDesvinculadas === 'number');
  check('se eliminó AL MENOS las 3 causas de prueba sin defecto (puede haber más de otras pruebas)', resultado.causasEliminadas >= 3);
  check('se eliminó AL MENOS la medida propia de la causa sin uso', resultado.medidasEliminadas >= 1);
  check('se desvincularon AL MENOS las 2 referencias reales (Producción + Reportes)', resultado.referenciasDesvinculadas >= 2);

  // -------- Verificar el resultado en la base de datos --------
  check('la causa sin uso ya NO existe en el catálogo', await catalogoData.obtenerCausaCatalogoPorId(causaSinUsoNunca.id) == null);
  check('su medida propia tampoco existe', await catalogoData.obtenerMedidaCatalogoPorId(medidaDeEsaCausa.id) == null);
  check('la causa ya usada en Producción también se borró del catálogo', await catalogoData.obtenerCausaCatalogoPorId(causaUsadaEnProduccion.id) == null);
  check('la causa ya usada en Reportes también se borró del catálogo', await catalogoData.obtenerCausaCatalogoPorId(causaUsadaEnReportes.id) == null);

  // El caso real de Producción NO se borró -- solo se desvinculó el causa_catalogo_id, el texto se mantiene.
  const filaProduccion = await db.get('SELECT * FROM trazabilidad_causas WHERE problema_id = ? AND texto = ?', [problema.id, causaUsadaEnProduccion.texto]);
  check('el caso real de Producción sigue existiendo (no se borró)', !!filaProduccion);
  check('su texto histórico se mantiene intacto', filaProduccion && filaProduccion.texto === causaUsadaEnProduccion.texto);
  check('su causa_catalogo_id quedó en NULL (desvinculado del catálogo, no se pierde el historial)', filaProduccion && filaProduccion.causa_catalogo_id == null);

  // El reporte real de Reportes por Áreas tampoco se borró -- mismo criterio.
  const reporteCompletoTrasLimpieza = await reportesData.obtenerReporteCompleto(reporteRapido.id);
  const filaReportes = reporteCompletoTrasLimpieza.causas.find(c => c.texto === causaUsadaEnReportes.texto);
  check('el caso real de Reportes por Áreas sigue existiendo con su causa (no se borró)', !!filaReportes);
  check('su texto histórico se mantiene intacto', filaReportes && filaReportes.texto === causaUsadaEnReportes.texto);
  check('su causa_catalogo_id quedó en NULL (desvinculado del catálogo)', filaReportes && filaReportes.causa_catalogo_id == null);

  // La causa CON defecto asignado (de Reportes) NUNCA se toca -- solo se
  // borran las que tienen defecto_id NULL.
  check('la causa CON defecto asignado sigue existiendo en el catálogo (nunca se toca)', await catalogoData.obtenerCausaCatalogoPorId(causaConDefecto.id) != null);

  // -------- Correr la limpieza de nuevo: ya no hay nada que borrar (o solo lo que otras pruebas hayan creado después) --------
  const resLimpiarDeNuevo = await fetch(`${base}/produccion/trazabilidad/catalogo/causas-sin-defecto`, {
    method: 'DELETE', headers: { 'Authorization': 'Bearer ' + TOKEN_CAT_GESTIONAR },
  });
  const resultadoDeNuevo = await resLimpiarDeNuevo.json();
  check('correr la limpieza de nuevo -> 200, sin reventar aunque ya no queden causas de esta prueba', resLimpiarDeNuevo.ok);
  check('el resultado sigue trayendo la forma esperada (0 o más, nunca revienta)', resultadoDeNuevo.causasEliminadas >= 0);

  server.close();
  console.log(`\n${ok} OK, ${fail} FAIL`);
  console.log('\n=== Prueba limpieza de causas sin defecto completa ===');
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('ERROR INESPERADO:', e); process.exit(1); });
