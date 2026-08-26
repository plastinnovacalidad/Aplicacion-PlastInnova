const express = require('express');
const fs = require('fs');
const path = require('path');

const { TMP_DIR, EVIDENCIAS_DIR } = require('../settings/paths');
const { validarToken, requerirPermiso, requerirPermisoAlternativo, obtenerSesionActiva, tienePermiso, obtenerTokenDeCookie } = require('../middleware/auth');
const { upload } = require('../utils/upload');
const { sanitizeFilename, buscarArchivoRecursivo, moverArchivo } = require('../utils/archivos');
const { ahoraISO } = require('../utils/fechas');
const { validarOBorrar, contenidoRealValido } = require('../utils/validarArchivo');
const { siguienteVersionAutomatica } = require('../utils/versiones');
const { asyncHandler } = require('../middleware/errores');
const { enTransaccion } = require('../db/connection');
const metroData = require('../data/metrologia');
const whatsappService = require('../whatsapp_bot_service');

const router = express.Router();

// ======================== MÓDULO METROLOGÍA Y PLANOS DE MOLDE ========================

router.post('/moldes/referencias', validarToken, requerirPermisoAlternativo(['metrologia.crear_referencia', 'metrologia.gestion']), upload.single('archivo'), async (req, res) => {
  const { codigo_base, version, motivo, cotas } = req.body;
  const usuarioId = req.usuario.id;

  if (!codigo_base || !codigo_base.trim()) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'El código base de la referencia es obligatorio' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Debe subir el archivo del plano (PDF o imagen)' });
  }
  if (!(await validarOBorrar(req, res, req.file.path))) return;

  try {
    // Crear la referencia + su primera versión + sus cotas iniciales + el
    // registro de seguimiento en una sola transacción: si algo falla a la
    // mitad (por ejemplo, una cota con datos inválidos que rompe la
    // consulta), no queda una referencia "huérfana" sin versión ni cotas.
    const refId = await enTransaccion(async () => {
      const existente = await metroData.existeReferenciaPorCodigo(codigo_base.trim());
      if (existente) {
        const error = new Error('Ya existe una referencia de molde con ese código');
        error.status = 409;
        throw error;
      }

      const resRef = await metroData.crearReferencia(codigo_base.trim(), usuarioId);
      const refId = resRef.lastID;

      const ver = version && version.trim() ? version.trim().toUpperCase() : 'V1';
      const ext = path.extname(req.file.originalname);
      const nombreArchivo = sanitizeFilename(codigo_base.trim().replace(/\//g, '_')) + '_' + ver + ext;
      const destinoFinal = path.join(TMP_DIR, nombreArchivo);
      moverArchivo(req.file.path, destinoFinal);

      await metroData.crearVersion(refId, ver, destinoFinal, 'activa', usuarioId);

      if (cotas) {
        let parsedCotas = [];
        try {
          parsedCotas = typeof cotas === 'string' ? JSON.parse(cotas) : cotas;
        } catch (e) {}

        for (const c of parsedCotas) {
          if (!c.cota || c.medida_estandar === undefined || c.tolerancia === undefined) continue;
          const est = parseFloat(c.medida_estandar) || 0;
          const tol = parseFloat(c.tolerancia) || 0;
          const tolMax = est + tol;
          const tolMin = est - tol;

          await metroData.crearCota(refId, c.cota.trim().toUpperCase(), est, tol, tolMax, tolMin);
        }
      }

      await metroData.insertarSeguimiento(
        refId, 'creacion',
        { codigo_base: codigo_base.trim(), version: ver, archivo: destinoFinal },
        motivo || 'Creación de referencia y cotas iniciales', usuarioId
      );

      return refId;
    });

    res.status(201).json({ success: true, referencia_id: refId, codigo_base: codigo_base.trim() });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Mismo motivo que en GET /moldes/referencias/:codigo un poco más abajo: la
// pantalla de administración (crear/versionar referencias) necesita poder
// listarlas aunque quien la use no tenga 'metrologia.ver'.
router.get('/moldes/referencias', validarToken, requerirPermisoAlternativo(['metrologia.ver', 'metrologia.gestion', 'metrologia.crear_referencia', 'metrologia.versiones']), asyncHandler(async (req, res) => {
  const refs = await metroData.listarReferenciasConVersionActiva();
  res.json({ referencias: refs });
}));

// Estas dos rutas no usan el middleware validarToken porque el visor de
// PDF/imagen (<iframe>/<img>) no puede mandar headers personalizados. Antes
// el token viajaba visible en la URL (?token=...); ahora se lee de la
// cookie httpOnly que el navegador manda solo, así que la URL ya no expone
// el token de sesión (por ejemplo en el historial del navegador o en logs
// del servidor).
router.get('/moldes/ver-plano', (req, res) => {
  const token = obtenerTokenDeCookie(req) || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  const usuario = obtenerSesionActiva(token);
  if (!usuario) return res.status(401).json({ error: 'Token inválido o sesión expirada' });

  // Antes solo dejaba ver el plano a quien tuviera 'metrologia.ver' o
  // 'metrologia.gestion' — pero ahora "Crear Referencia (Planos)" también
  // muestra el plano actual dentro de Modificación/Nueva versión, a la que
  // puede entrar alguien con 'metrologia.crear_referencia' o
  // 'metrologia.versiones' sin tener necesariamente 'metrologia.ver' (ese
  // permiso es para inspeccionar, no para administrar). Mismo criterio que
  // ya se usa en GET /moldes/referencias/:codigo.
  const permisosValidos = ['metrologia.ver', 'metrologia.gestion', 'metrologia.crear_referencia', 'metrologia.versiones'];
  if (!permisosValidos.some(p => tienePermiso(usuario.rol_id, p))) {
    return res.status(403).json({ error: 'No tienes permiso' });
  }

  const ruta = req.query.ruta;
  if (!ruta) return res.status(400).json({ error: 'Ruta requerida' });

  let filePath = path.resolve(ruta);
  if (!fs.existsSync(filePath)) {
    const basename = path.basename(ruta);
    const encontrada = buscarArchivoRecursivo(basename);
    if (encontrada && fs.existsSync(encontrada)) {
      filePath = encontrada;
    } else if (fs.existsSync(path.join(TMP_DIR, basename))) {
      filePath = path.join(TMP_DIR, basename);
    } else {
      return res.status(404).json({ error: 'Archivo no encontrado en disco: ' + ruta });
    }
  }
  res.sendFile(filePath);
});

router.get('/moldes/ver-evidencia', (req, res) => {
  const token = obtenerTokenDeCookie(req) || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  const usuario = obtenerSesionActiva(token);
  if (!usuario) return res.status(401).json({ error: 'Token inválido o sesión expirada' });

  if (!tienePermiso(usuario.rol_id, 'metrologia.ver') && !tienePermiso(usuario.rol_id, 'metrologia.gestion')) {
    return res.status(403).json({ error: 'No tienes permiso' });
  }

  const ruta = req.query.ruta;
  if (!ruta) return res.status(400).json({ error: 'Ruta requerida' });

  let filePath = path.resolve(ruta);
  if (!fs.existsSync(filePath)) {
    const basename = path.basename(ruta);
    if (fs.existsSync(path.join(EVIDENCIAS_DIR, basename))) {
      filePath = path.join(EVIDENCIAS_DIR, basename);
    } else {
      return res.status(404).json({ error: 'Evidencia no encontrada en disco' });
    }
  }
  res.sendFile(filePath);
});

// Antes pedía el permiso 'metrologia.editar', que ya no existe en el
// catálogo (settings/permisos.js) desde hace tiempo — solo funcionaba
// porque admin e inspector todavía tenían ese código viejo asignado desde
// antes. Se cambia a 'metrologia.editar_cotas' (el mismo que ya usa
// PUT /moldes/cotas/:id), que sí está en el catálogo actual y es el
// correcto para esta acción.
router.post('/moldes/referencias/:codigo/cotas', validarToken, requerirPermisoAlternativo(['metrologia.editar_cotas', 'metrologia.gestion']), asyncHandler(async (req, res) => {
  const codigo = decodeURIComponent(req.params.codigo || '');
  const { cota, medida_estandar, tolerancia, motivo } = req.body;
  const usuarioId = req.usuario.id;

  if (!cota || medida_estandar === undefined || tolerancia === undefined) {
    return res.status(400).json({ error: 'Cota, medida estándar y tolerancia son requeridas' });
  }

  const ref = await metroData.buscarIdReferenciaPorCodigo(codigo);
  if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });

  const est = parseFloat(medida_estandar) || 0;
  const tol = parseFloat(tolerancia) || 0;
  const tolMax = est + tol;
  const tolMin = est - tol;

  await metroData.crearCota(ref.id, cota.trim().toUpperCase(), est, tol, tolMax, tolMin);

  await metroData.insertarSeguimiento(
    ref.id, 'creacion_cota',
    { cota: cota.trim().toUpperCase(), medida_estandar: est, tolerancia: tol },
    motivo || 'Adición de nueva cota', usuarioId
  );

  res.status(201).json({ success: true });
}));

// Antes solo dejaba ver el detalle de un molde a quien tuviera
// 'metrologia.ver' (o 'metrologia.gestion') — pero ahora también lo usa la
// pantalla de administración de Referencias de Planos (crear/subir nueva
// versión/modificar), a la que puede entrar alguien con 'metrologia.
// crear_referencia' o 'metrologia.versiones' sin tener necesariamente
// 'metrologia.ver' (ese permiso es para inspeccionar, no para administrar).
// Se agregan esos dos como alternativas para que no se quede sin poder ver
// el detalle de lo que él mismo puede crear o versionar.
router.get('/moldes/referencias/:codigo', validarToken, requerirPermisoAlternativo(['metrologia.ver', 'metrologia.gestion', 'metrologia.crear_referencia', 'metrologia.versiones']), asyncHandler(async (req, res) => {
  const codigo = decodeURIComponent(req.params.codigo || '');
  const ref = await metroData.buscarReferenciaConCreador(codigo);
  if (!ref) return res.status(404).json({ error: 'Referencia de molde no encontrada' });

  const versionActiva = await metroData.buscarVersionActiva(ref.id);
  const versiones = await metroData.listarVersiones(ref.id);
  const cotas = await metroData.listarCotas(ref.id);
  const inspecciones = await metroData.listarInspecciones(ref.id);
  const seguimiento = await metroData.listarSeguimientoSinInspeccion(ref.id);

  res.json({
    referencia: ref,
    version_activa: versionActiva || null,
    versiones,
    cotas,
    inspecciones,
    seguimiento
  });
}));

router.post('/moldes/referencias/:codigo/medidas', validarToken, requerirPermisoAlternativo(['metrologia.inspeccionar', 'metrologia.gestion']), upload.any(), async (req, res) => {
  const codigo = decodeURIComponent(req.params.codigo || '');
  const { fecha, responsable, lote, molde, medidas } = req.body;
  const usuarioId = req.usuario.id;

  if (!fecha || !responsable) {
    if (req.files) req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
    return res.status(400).json({ error: 'Fecha y responsable son obligatorios' });
  }

  let parsedMedidas = [];
  try {
    parsedMedidas = typeof medidas === 'string' ? JSON.parse(medidas) : medidas;
  } catch (e) {
    if (req.files) req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
    return res.status(400).json({ error: 'Formato de medidas inválido' });
  }

  // Con upload.any() pueden llegar varias fotos de evidencia a la vez (una
  // por cota); se revisa el contenido real de cada una antes de seguir.
  if (req.files && req.files.length > 0) {
    for (const f of req.files) {
      if (!(await contenidoRealValido(f.path))) {
        req.files.forEach(ff => { if (fs.existsSync(ff.path)) fs.unlinkSync(ff.path); });
        return res.status(400).json({ error: 'Una de las fotos de evidencia no es una imagen o PDF válido (el contenido no coincide con el tipo esperado)' });
      }
    }
  }

  try {
    // La inspección y todas sus medidas (puede haber varias decenas de
    // cotas por inspección) se guardan como una sola unidad: si una medida
    // falla a mitad del lote, no queda una inspección con solo la mitad de
    // sus medidas guardadas.
    const inspeccionId = await enTransaccion(async () => {
      const ref = await metroData.buscarIdReferenciaPorCodigo(codigo);
      if (!ref) {
        const error = new Error('Referencia no encontrada');
        error.status = 404;
        throw error;
      }

      const resInsp = await metroData.crearInspeccion(ref.id, fecha, responsable, lote, molde, usuarioId);
      const inspeccionId = resInsp.lastID;

      const fileMap = {};
      if (req.files) {
        req.files.forEach(f => {
          fileMap[f.fieldname] = f;
        });
      }

      for (const m of parsedMedidas) {
        const cotaId = parseInt(m.cota_id, 10);
        const medidaReal = parseFloat(m.medida_real);
        if (isNaN(cotaId) || isNaN(medidaReal)) continue;

        const cotaInfo = await metroData.buscarCotaPorId(cotaId);
        if (!cotaInfo) continue;

        const estadoMedida = (medidaReal >= cotaInfo.tolerancia_minima && medidaReal <= cotaInfo.tolerancia_maxima) ? 'CONFORME' : 'FUERA DE TOLERANCIA';

        let evidenciaPath = null;
        const fileKey = `evidencia_${cotaId}`;
        if (fileMap[fileKey]) {
          const f = fileMap[fileKey];
          const ext = path.extname(f.originalname);
          const nuevoNombre = `evid_cota_${cotaId}_${Date.now()}${ext}`;
          const destino = path.join(EVIDENCIAS_DIR, nuevoNombre);
          fs.renameSync(f.path, destino);
          evidenciaPath = destino;
        }

        await metroData.crearMedidaDetalle(inspeccionId, cotaId, medidaReal, estadoMedida, evidenciaPath);
      }

      return inspeccionId;
    });

    res.status(201).json({ success: true, inspeccion_id: inspeccionId });
  } catch (e) {
    if (req.files) req.files.forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); });
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Antes pedía el permiso 'metrologia.crear', que ya no existe en el
// catálogo — igual que arriba, solo funcionaba por un código viejo que
// admin e inspector conservaban de antes. Se cambia a 'metrologia.versiones',
// que es justo el permiso del catálogo actual pensado para esto ("Subir y
// gestionar nuevas versiones de planos").
router.post('/moldes/referencias/:codigo/versiones', validarToken, requerirPermisoAlternativo(['metrologia.versiones', 'metrologia.gestion']), upload.single('archivo'), async (req, res) => {
  const codigo = decodeURIComponent(req.params.codigo || '');
  const { motivo, version: versionManual } = req.body;
  const usuarioId = req.usuario.id;

  if (!req.file) return res.status(400).json({ error: 'Debe subir el archivo del plano' });
  if (!motivo || !motivo.trim()) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'El motivo del cambio es obligatorio' });
  }
  if (!(await validarOBorrar(req, res, req.file.path))) return;

  try {
    // Marcar la versión anterior como obsoleta + crear la nueva versión +
    // dejar el registro de seguimiento, todo junto: si algo falla a mitad
    // de camino, la versión anterior no se queda marcada como obsoleta sin
    // que exista todavía una versión nueva que la reemplace.
    const nuevaVersion = await enTransaccion(async () => {
      const ref = await metroData.buscarIdReferenciaPorCodigo(codigo);
      if (!ref) {
        const error = new Error('Referencia no encontrada');
        error.status = 404;
        throw error;
      }

      const versionActiva = await metroData.buscarVersionActivaMasReciente(ref.id);

      let nuevaVersion = 'V1';
      if (versionManual && versionManual.trim()) {
        nuevaVersion = versionManual.trim().toUpperCase();
      } else {
        nuevaVersion = siguienteVersionAutomatica(versionActiva);
      }

      if (versionActiva) {
        await metroData.marcarVersionObsoleta(versionActiva.id);
      }

      const ext = path.extname(req.file.originalname);
      const nombreArchivo = sanitizeFilename(codigo.replace(/\//g, '_')) + '_' + nuevaVersion + ext;
      const destinoFinal = path.join(TMP_DIR, nombreArchivo);
      moverArchivo(req.file.path, destinoFinal);

      const resultVer = await metroData.crearVersion(ref.id, nuevaVersion, destinoFinal, 'activa', usuarioId);
      // Red de seguridad: si por algún motivo esta referencia tenía OTRA
      // fila también marcada 'activa' (datos viejos, importación duplicada,
      // etc.), se retira aquí — mismo patrón ya usado en Circuitos SMD.
      await metroData.retirarOtrasVersionesActivas(ref.id, resultVer.lastID);

      await metroData.insertarSeguimiento(
        ref.id, 'nueva_version',
        { version: nuevaVersion, archivo: destinoFinal },
        motivo, usuarioId
      );

      return nuevaVersion;
    });

    res.status(201).json({ success: true, version: nuevaVersion });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Modificar versión actual (reemplaza el archivo del plano, misma versión)
// — antes esta acción no existía en Metrología: solo se podía "Subir
// Versión" (que siempre crea una versión nueva). Mismo patrón que
// /referencias/:codigo_base/modificar-version en Circuitos SMD: el motivo
// es opcional acá (a diferencia de "nueva versión", que sí lo exige), para
// mantener la misma diferencia de comportamiento entre las dos acciones que
// ya existe en electrónica.
router.post('/moldes/referencias/:codigo/modificar-version', validarToken, requerirPermisoAlternativo(['metrologia.versiones', 'metrologia.gestion']), upload.single('archivo'), async (req, res) => {
  const codigo = decodeURIComponent(req.params.codigo || '');
  const { motivo } = req.body;
  const usuarioId = req.usuario.id;

  if (!req.file) return res.status(400).json({ error: 'Debe subir el archivo del plano para reemplazar la versión actual' });
  if (!(await validarOBorrar(req, res, req.file.path))) return;

  try {
    const { versionActiva, destinoFinal } = await enTransaccion(async () => {
      const ref = await metroData.buscarIdReferenciaPorCodigo(codigo);
      if (!ref) {
        const error = new Error('Referencia no encontrada');
        error.status = 404;
        throw error;
      }

      const versionActiva = await metroData.buscarVersionActivaMasReciente(ref.id);
      if (!versionActiva) {
        const error = new Error('No hay versión activa para modificar');
        error.status = 404;
        throw error;
      }

      const ext = path.extname(req.file.originalname);
      const nombreArchivo = sanitizeFilename(codigo.replace(/\//g, '_')) + '_' + versionActiva.version + '_mod' + Date.now() + ext;
      const destinoFinal = path.join(TMP_DIR, nombreArchivo);
      moverArchivo(req.file.path, destinoFinal);

      const rutaAnterior = versionActiva.archivo_ruta;
      await metroData.actualizarArchivoVersion(destinoFinal, versionActiva.id);
      // Misma red de seguridad que en "nueva versión".
      await metroData.retirarOtrasVersionesActivas(ref.id, versionActiva.id);

      await metroData.insertarSeguimiento(
        ref.id, 'modificacion',
        { accion: 'Modificación de versión actual', version: versionActiva.version, archivo: { antes: rutaAnterior, despues: destinoFinal } },
        motivo || null, usuarioId
      );

      return { versionActiva, destinoFinal };
    });

    res.json({ success: true, message: `Versión ${versionActiva.version} modificada correctamente`, archivo_ruta: destinoFinal });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.put('/moldes/cotas/:id', validarToken, requerirPermisoAlternativo(['metrologia.editar_cotas', 'metrologia.gestion']), asyncHandler(async (req, res) => {
  const cotaId = parseInt(req.params.id, 10);
  const { cota: nombreCota, medida_estandar, tolerancia, motivo } = req.body;
  const usuarioId = req.usuario.id;

  if (isNaN(cotaId)) return res.status(400).json({ error: 'ID de cota inválido' });
  if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'El motivo de la modificación es obligatorio' });

  const cotaActual = await metroData.buscarCotaPorId(cotaId);
  if (!cotaActual) return res.status(404).json({ error: 'Cota no encontrada' });

  const nombre = nombreCota !== undefined && nombreCota.trim() !== '' ? nombreCota.trim().toUpperCase() : cotaActual.cota;
  const est = medida_estandar !== undefined ? parseFloat(medida_estandar) : cotaActual.medida_estandar;
  const tol = tolerancia !== undefined ? parseFloat(tolerancia) : cotaActual.tolerancia;
  const tolMax = est + tol;
  const tolMin = est - tol;

  await metroData.actualizarCota(cotaId, nombre, est, tol, tolMax, tolMin);

  await metroData.insertarSeguimiento(
    cotaActual.referencia_id, 'modificacion_cota',
    { cota: nombre, anterior: { cota: cotaActual.cota, estandar: cotaActual.medida_estandar, tolerancia: cotaActual.tolerancia }, nuevo: { cota: nombre, estandar: est, tolerancia: tol } },
    motivo, usuarioId
  );

  res.json({ success: true });
}));

router.delete('/moldes/cotas/:id', validarToken, requerirPermisoAlternativo(['metrologia.eliminar_cotas', 'metrologia.gestion']), asyncHandler(async (req, res) => {
  const cotaId = parseInt(req.params.id, 10);
  const usuarioId = req.usuario.id;
  const { motivo } = req.body;
  if (isNaN(cotaId)) return res.status(400).json({ error: 'ID de cota inválido' });
  if (!motivo || !motivo.trim()) return res.status(400).json({ error: 'El motivo de la eliminación es obligatorio' });

  const cota = await metroData.buscarCotaPorId(cotaId);
  if (!cota) return res.status(404).json({ error: 'Cota no encontrada' });

  await metroData.eliminarCota(cotaId);

  await metroData.insertarSeguimiento(
    cota.referencia_id, 'eliminacion_cota',
    { cota: cota.cota },
    motivo.trim(), usuarioId
  );

  res.json({ success: true });
}));

router.get('/moldes/inspeccion-detalle/:id', validarToken, requerirPermisoAlternativo(['metrologia.ver', 'metrologia.gestion']), asyncHandler(async (req, res) => {
  const inspId = parseInt(req.params.id, 10);
  if (isNaN(inspId)) return res.status(400).json({ error: 'ID inválido' });
  const inspeccion = await metroData.buscarInspeccionConCreador(inspId);
  if (!inspeccion) return res.status(404).json({ error: 'Inspección no encontrada' });
  const medidas = await metroData.listarMedidasDeInspeccion(inspId);
  res.json({ inspeccion, medidas });
}));

// Julio pidió que, después de guardar una inspección, se pueda generar y
// mandar por WhatsApp un reporte (plano + datos + conforme/no conforme +
// fotos de evidencia) al número administrador — ver utils/pdfInspeccionMetrologia.js
// y whatsapp_bot_service.enviarReporteInspeccionMetrologia(). Mismo permiso
// que exige guardar la inspección (POST .../medidas más arriba), porque es
// un paso que se ofrece justo después de ese guardado, no una vista nueva.
// A diferencia de las alertas automáticas (enviarAlerta/enviarResumenPDF,
// que son "fire and forget"), acá SÍ se espera el resultado real del envío
// para poder avisarle a la persona en pantalla si no se pudo mandar (por
// ejemplo, porque el bot de WhatsApp no está conectado en ese momento) —
// eso nunca afecta la inspección ya guardada, que para este punto ya quedó
// guardada de forma independiente.
router.post('/moldes/inspeccion/:id/enviar-reporte', validarToken, requerirPermisoAlternativo(['metrologia.inspeccionar', 'metrologia.gestion']), asyncHandler(async (req, res) => {
  const inspId = parseInt(req.params.id, 10);
  if (isNaN(inspId)) return res.status(400).json({ error: 'ID inválido' });

  const inspeccion = await metroData.buscarInspeccionConCreador(inspId);
  if (!inspeccion) return res.status(404).json({ error: 'Inspección no encontrada' });

  const medidas = await metroData.listarMedidasDeInspeccion(inspId);
  const versionActiva = await metroData.buscarVersionActiva(inspeccion.referencia_id);
  const planoRuta = versionActiva ? versionActiva.archivo_ruta : null;
  const codigo = inspeccion.molde || `Molde #${inspeccion.referencia_id}`;

  const resultado = await whatsappService.enviarReporteInspeccionMetrologia(codigo, inspeccion, medidas, planoRuta);
  if (resultado.enviado) {
    res.json({ success: true });
  } else {
    res.status(502).json({ error: resultado.motivo || 'No se pudo enviar el reporte por WhatsApp.' });
  }
}));

module.exports = router;
