const express = require('express');
const fs = require('fs');
const path = require('path');

const { CARPETAS_FOTOS, OBSOLETAS_DIR } = require('../settings/paths');
const { validarToken, requerirPermiso } = require('../middleware/auth');
const { upload } = require('../utils/upload');
const { sanitizeFilename, nombreBaseParaArchivo, obtenerCarpetaDestino, moverArchivo, buscarArchivoRecursivo, escanearRecursivo } = require('../utils/archivos');
const { aplicarMarcaDeAgua } = require('../utils/logo');
const { validarOBorrar } = require('../utils/validarArchivo');
const { siguienteVersionAutomatica } = require('../utils/versiones');
const { asyncHandler } = require('../middleware/errores');
const { enTransaccion } = require('../db/connection');
const refData = require('../data/referencias');
const valoresData = require('../data/valoresCableado');

const router = express.Router();

// Reemplaza a refData.retirarOtrasVersionesActivas() en los dos lugares que
// la usaban como "red de seguridad" (crear nueva versión / modificar
// versión actual): antes esa red solo cambiaba el estado en la base de
// datos de cualquier OTRA fila que hubiera quedado 'activa' por error, pero
// dejaba su archivo de foto tal cual estaba, en la carpeta de fotos activas
// — con el tiempo esas fotos huérfanas se iban acumulando ahí mezcladas con
// las de verdad vigentes. Ahora, igual que ya se hace con la versión
// "principal" que se retira más arriba en cada ruta, se mueve cada foto a
// obsoletas si todavía existe en disco antes de marcar la fila.
async function retirarOtrasVersionesActivasConArchivos(referenciaId, idQueQuedaActiva) {
  const strays = await refData.listarOtrasVersionesActivas(referenciaId, idQueQuedaActiva);
  for (const stray of strays) {
    if (stray.imagen_ruta && fs.existsSync(stray.imagen_ruta)) {
      const fechaSufijo = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const ext = path.extname(stray.imagen_ruta);
      const nombreBase = path.basename(stray.imagen_ruta, ext);
      const destinoObsoleto = path.join(OBSOLETAS_DIR, nombreBase + '_' + fechaSufijo + '_huerfana' + ext);
      moverArchivo(stray.imagen_ruta, destinoObsoleto);
      await refData.marcarVersionObsoletaConRuta(destinoObsoleto, stray.id);
    } else {
      await refData.marcarVersionObsoleta(stray.id);
    }
  }
}

// ======================== REFERENCIAS Y VERSIONES ========================

router.post('/referencias', validarToken, requerirPermiso('referencias.crear'), upload.single('imagen'), async (req, res) => {
  const { codigo_base, motivo } = req.body;
  const usuarioId = req.usuario.id;

  if (!codigo_base) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'codigo_base requerido' }); }
  if (!req.file) return res.status(400).json({ error: 'Debe subir una imagen' });
  if (!(await validarOBorrar(req, res, req.file.path))) return;

  let carpetaDestino;
  try { carpetaDestino = obtenerCarpetaDestino(req); }
  catch (e) { if (req.file) fs.unlinkSync(req.file.path); return res.status(500).json({ error: e.message }); }

  try {
    const { refId, destinoFinal, versionId } = await enTransaccion(async () => {
      const existente = await refData.existeReferenciaPorCodigo(codigo_base);
      if (existente) {
        const error = new Error('Ya existe esa referencia');
        error.status = 409;
        throw error;
      }

      const resultRef = await refData.crearReferencia(codigo_base, usuarioId);
      const refId = resultRef.lastID;

      const ext = path.extname(req.file.originalname);
      const nombreArchivo = sanitizeFilename(nombreBaseParaArchivo(codigo_base)) + '_V1' + ext;
      const destinoFinal = path.join(carpetaDestino, nombreArchivo);
      moverArchivo(req.file.path, destinoFinal);

      const resultVersion = await refData.crearVersion(refId, 'V1', destinoFinal, 'activa', usuarioId, 1);
      const versionId = resultVersion.lastID;

      await refData.insertarSeguimientoCambios(
        refId, 'creacion',
        { accion: 'Referencia creada', codigo_base, version: 'V1', imagen_ruta: destinoFinal },
        usuarioId, motivo || null
      );

      return { refId, destinoFinal, versionId };
    });

    // version_id se incluye para que la pantalla de Crear Referencia pueda,
    // en el mismo flujo, guardar de una vez los valores eléctricos y la
    // configuración de cableado de esta V1 recién creada (PUT a
    // /api/valores-cableado/productos/:version_id) sin tener que volver a
    // consultar nada.
    res.status(201).json({ success: true, referencia: { id: refId, codigo_base }, version: 'V1', version_id: versionId, imagen_ruta: destinoFinal });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Crear nueva versión usando código_base (para el panel de edición)
router.post('/referencias-codigo/:codigo_base/versiones', validarToken, requerirPermiso('versiones.crear'), upload.single('imagen'), async (req, res) => {
  // Express ya decodifica req.params.codigo_base una vez al enrutar la
  // petición (incluso "%2F" en un segmento con nombre, como ya se
  // documentó en routes/valoresCableado.js) — volver a llamar
  // decodeURIComponent() acá lo decodificaba una SEGUNDA vez. Mientras el
  // código no tuviera un "%" de verdad esto no se notaba, pero un código
  // con un "%" suelto (ej. "SUP-50%-OFF") hacía que este decode extra
  // lanzara "URI malformed" y la petición fallara con un error genérico.
  const codigoBase = req.params.codigo_base || '';
  const { motivo, version: versionManual } = req.body;
  const usuarioId = req.usuario.id;

  if (!codigoBase) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'codigo_base requerido' }); }
  if (!req.file) return res.status(400).json({ error: 'Debe subir una imagen' });
  if (!motivo || !motivo.trim()) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'El motivo del cambio es obligatorio' }); }
  if (!(await validarOBorrar(req, res, req.file.path))) return;

  let carpetaDestino;
  try { carpetaDestino = obtenerCarpetaDestino(req); }
  catch (e) { if (req.file) fs.unlinkSync(req.file.path); return res.status(500).json({ error: e.message }); }

  try {
    const { resultVer, nuevaVersion, destinoFinal } = await enTransaccion(async () => {
      const ref = await refData.buscarReferenciaPorCodigo(codigoBase);
      if (!ref) {
        const error = new Error('Referencia no encontrada');
        error.status = 404;
        throw error;
      }
      const referenciaId = ref.id;

      const versionActiva = await refData.buscarVersionActivaMasReciente(referenciaId);

      let nuevaVersion = 'V1';
      if (versionManual && versionManual.trim()) {
        const vTrim = versionManual.trim().toUpperCase();
        if (!/^V\d+$/i.test(vTrim)) {
          const error = new Error('El número de versión debe tener formato V1, V2, V3...');
          error.status = 400;
          throw error;
        }
        const existeVer = await refData.existeVersion(referenciaId, vTrim);
        if (existeVer) {
          const error = new Error(`Ya existe la versión ${vTrim} para esta referencia`);
          error.status = 409;
          throw error;
        }
        nuevaVersion = vTrim;
      } else {
        nuevaVersion = siguienteVersionAutomatica(versionActiva);
      }

      // OJO: antes esto solo marcaba la versión anterior como 'obsoleta'
      // cuando tenía un imagen_ruta con contenido — si venía vacío (como
      // pasa en versiones importadas de la app vieja de Valores y
      // Cableado), la versión anterior se quedaba marcada 'activa' para
      // siempre, y con el tiempo una misma referencia terminaba con varias
      // versiones "activas" a la vez, cada una mostrando algo distinto
      // según qué consulta se usara para preguntarlo. Ahora se marca
      // obsoleta siempre que exista una versionActiva, tenga o no foto
      // guardada; mover el archivo a obsoletas solo aplica si en verdad
      // hay un archivo en disco que mover.
      let rutaObsoleta = null;
      if (versionActiva) {
        const rutaAnterior = versionActiva.imagen_ruta;
        if (rutaAnterior && fs.existsSync(rutaAnterior)) {
          const fechaSufijo = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const ext = path.extname(rutaAnterior);
          const nombreBase = path.basename(rutaAnterior, ext);
          const destinoObsoleto = path.join(OBSOLETAS_DIR, nombreBase + '_' + fechaSufijo + ext);
          moverArchivo(rutaAnterior, destinoObsoleto);
          rutaObsoleta = destinoObsoleto;
          await refData.marcarVersionObsoletaConRuta(destinoObsoleto, versionActiva.id);
        } else {
          await refData.marcarVersionObsoleta(versionActiva.id);
        }
      }

      const ext = path.extname(req.file.originalname);
      const nombreArchivo = sanitizeFilename(nombreBaseParaArchivo(ref.codigo_base)) + '_' + nuevaVersion + ext;
      const destinoFinal = path.join(carpetaDestino, nombreArchivo);
      moverArchivo(req.file.path, destinoFinal);

      const resultVer = await refData.crearVersion(referenciaId, nuevaVersion, destinoFinal, 'activa', usuarioId, 1);
      // Red de seguridad: si por algún motivo anterior a esta corrección
      // quedaron OTRAS versiones también marcadas 'activa' para esta misma
      // referencia, se retiran aquí — así la referencia queda con una sola
      // versión activa (la que se acaba de crear) de una vez por todas.
      await retirarOtrasVersionesActivasConArchivos(referenciaId, resultVer.lastID);

      // Las cotas eléctricas y la configuración de cableado (elec_mediciones,
      // elec_rangos_revision, elec_config_cableado) están guardadas por
      // version_id, no por referencia — así que una versión recién creada
      // nace sin ninguno de esos datos, aunque la versión anterior sí los
      // tuviera. Antes esto hacía que "Valores y Cableado" mostrara todo en
      // blanco justo después de crear una versión nueva en Circuitos SMD
      // (los datos viejos seguían existiendo, pero colgados de la versión
      // ahora obsoleta). Para que Julio siga viendo lo que ya sabíamos de
      // esta referencia (y solo tenga que corregir lo que de verdad cambió),
      // se copian esos datos de la versión anterior a la nueva en el momento
      // de crearla.
      if (versionActiva) {
        const fichaAnterior = await valoresData.obtenerFichaVersion(versionActiva.id);
        // Antes esta lista solo revisaba 11 de los 18 campos que en
        // realidad devuelve obtenerFichaVersion() — le faltaban
        // amperaje_min_medias, amperaje_min_altas, amperaje_max,
        // potencia_min_medias, potencia_min_altas, potencia_max y
        // empujar_cables. Si una versión anterior solo tenía datos en esos
        // 7 campos (y nada en los otros 11), tieneDatosPrevios daba false
        // y guardarFichaVersion() nunca se llamaba — así que TODOS los
        // valores eléctricos de esa versión se perdían al crear la
        // siguiente, en silencio. Ahora se revisan los campos "de datos"
        // de la ficha automáticamente (excluyendo version_id/version/
        // codigo_base, que son metadatos, no valores capturados), así que
        // un campo nuevo que se agregue a la ficha en el futuro queda
        // cubierto sin tener que acordarse de venir a actualizar esta lista.
        const CAMPOS_METADATA_FICHA = new Set(['version_id', 'version', 'codigo_base']);
        const tieneDatosPrevios = fichaAnterior && Object.entries(fichaAnterior).some(
          ([campo, valor]) => !CAMPOS_METADATA_FICHA.has(campo) && valor != null
        );
        if (tieneDatosPrevios) {
          await valoresData.guardarFichaVersion(resultVer.lastID, fichaAnterior);
        }
      }

      await refData.insertarSeguimientoCambios(
        referenciaId, 'nueva_version',
        {
          accion: 'Nueva versión', version: { antes: versionActiva?.version, despues: nuevaVersion },
          imagen_ruta: { antes: versionActiva?.imagen_ruta, despues: destinoFinal }, ruta_obsoleta: rutaObsoleta
        },
        usuarioId, motivo || null
      );

      return { resultVer, nuevaVersion, destinoFinal };
    });

    res.status(201).json({ success: true, version: { id: resultVer.lastID, version: nuevaVersion, imagen_ruta: destinoFinal, estado: 'activa' } });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Modificar versión actual (reemplaza imagen, misma versión, mueve anterior a obsoletas)
router.post('/referencias/:codigo_base/modificar-version', validarToken, requerirPermiso('referencias.editar'), upload.single('imagen'), async (req, res) => {
  // Mismo motivo que en /referencias-codigo/.../versiones más arriba:
  // Express ya decodifica este parámetro, un decode extra acá era
  // redundante y podía lanzar "URI malformed".
  const codigoBase = req.params.codigo_base || '';
  const { motivo } = req.body;
  const usuarioId = req.usuario.id;

  if (!codigoBase) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'codigo_base requerido' }); }
  if (!req.file) return res.status(400).json({ error: 'Debe subir una imagen para reemplazar la versión actual' });
  // Misma exigencia que ya tiene "Nueva versión" (línea ~82) — antes esta
  // ruta aceptaba modificar la versión activa sin ningún motivo, mientras
  // que crear una versión sí lo exigía; quedaba una referencia con menos
  // trazabilidad para el caso que en la práctica es el más delicado
  // (reemplazar la imagen que ya está en producción).
  if (!motivo || !motivo.trim()) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'El motivo del cambio es obligatorio' }); }
  if (!(await validarOBorrar(req, res, req.file.path))) return;

  try {
    const { versionActiva, destinoFinal } = await enTransaccion(async () => {
      const ref = await refData.buscarReferenciaPorCodigo(codigoBase);
      if (!ref) {
        const error = new Error('Referencia no encontrada');
        error.status = 404;
        throw error;
      }

      const versionActiva = await refData.buscarVersionActivaMasReciente(ref.id);
      if (!versionActiva) {
        const error = new Error('No hay versión activa para modificar');
        error.status = 404;
        throw error;
      }

      let rutaObsoleta = null;
      const rutaAnterior = versionActiva.imagen_ruta;
      if (rutaAnterior && fs.existsSync(rutaAnterior)) {
        const fechaSufijo = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const ext = path.extname(rutaAnterior);
        const nombreBase = path.basename(rutaAnterior, ext);
        const destinoObsoleto = path.join(OBSOLETAS_DIR, nombreBase + '_' + fechaSufijo + '_mod' + ext);
        moverArchivo(rutaAnterior, destinoObsoleto);
        rutaObsoleta = destinoObsoleto;
      }

      const extNueva = path.extname(req.file.originalname);
      const nombreArchivo = sanitizeFilename(nombreBaseParaArchivo(ref.codigo_base)) + '_' + versionActiva.version + extNueva;
      const carpetaDestino = rutaAnterior ? path.dirname(rutaAnterior) : (CARPETAS_FOTOS[1] || CARPETAS_FOTOS[0]);
      const destinoFinal = path.join(carpetaDestino, nombreArchivo);
      moverArchivo(req.file.path, destinoFinal);

      await refData.actualizarImagenVersion(destinoFinal, versionActiva.id);
      await refData.marcarNecesitaPrueba(versionActiva.id, 1);
      // Misma red de seguridad que en "nueva versión": si esta referencia
      // tenía otra fila también marcada 'activa' por error, se retira aquí.
      await retirarOtrasVersionesActivasConArchivos(ref.id, versionActiva.id);

      await refData.insertarSeguimientoCambios(
        ref.id, 'modificacion',
        {
          accion: 'Modificación de versión actual',
          version: versionActiva.version,
          imagen_ruta: { antes: rutaAnterior, despues: destinoFinal },
          ruta_obsoleta: rutaObsoleta
        },
        usuarioId, motivo || null
      );

      return { versionActiva, destinoFinal };
    });

    res.json({ success: true, message: `Versión ${versionActiva.version} modificada correctamente`, imagen_ruta: destinoFinal });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(error.status || 500).json({ error: error.message });
  }
});

router.get('/referencias/:id', validarToken, requerirPermiso('referencias.ver'), asyncHandler(async (req, res) => {
  const referenciaId = parseInt(req.params.id, 10);
  if (isNaN(referenciaId)) return res.status(400).json({ error: 'ID inválido' });

  const ref = await refData.buscarReferenciaPorId(referenciaId);
  if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });
  const versiones = await refData.listarVersionesPorReferencia(referenciaId);
  const activa = versiones.find(v => v.estado?.toLowerCase() === 'activa');
  res.json({ referencia: ref, version_activa: activa || null, historial: versiones });
}));

router.get('/referencias', validarToken, requerirPermiso('referencias.ver'), asyncHandler(async (req, res) => {
  const refs = await refData.listarCodigosReferencias();
  // 'necesita_prueba' se manda aparte (no se mezcla en el array principal)
  // para no romper a quien ya espera 'referencias' como una lista plana de
  // strings (Public/referencias.html) — Circuitos SMD es el único que lee
  // este campo nuevo, para poder pintar el punto rojo de "necesita prueba"
  // en toda la lista y no solo en la referencia seleccionada.
  const conPruebaPendiente = await refData.listarCodigosConPruebaPendiente();
  res.json({
    referencias: refs.map(r => r.codigo_base),
    necesitaPrueba: conPruebaPendiente.map(r => r.codigo_base),
  });
}));

router.get('/fotos/*', validarToken, requerirPermiso('referencias.ver'), asyncHandler(async (req, res) => {
  // Mismo motivo que las rutas de arriba — Express también decodifica el
  // parámetro comodín (req.params[0]) de una ruta "/fotos/*".
  const codigoBase = req.params[0] || '';
  const nombreUsuario = req.usuario.nombre || 'Inspector';

  const ref = await refData.buscarIdReferenciaPorCodigo(codigoBase);
  if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });

  const versionActiva = await refData.buscarVersionActivaPrimera(ref.id);
  if (!versionActiva || !versionActiva.imagen_ruta) return res.status(404).json({ error: 'No hay imagen activa' });

  let filePath = versionActiva.imagen_ruta;
  if (!fs.existsSync(filePath)) {
    const encontrada = buscarArchivoRecursivo(path.basename(filePath));
    if (encontrada) {
      await refData.actualizarImagenVersion(encontrada, versionActiva.id);
      filePath = encontrada;
    } else return res.status(404).json({ error: 'Archivo no encontrado en disco' });
  }

  await aplicarMarcaDeAgua(filePath, nombreUsuario, res);
}));

// Foto de UNA versión puntual del historial de una referencia (a diferencia
// de /api/fotos/*, que siempre sirve la de la versión activa) — la usan los
// chips de versión de Circuitos SMD para poder mostrar versiones viejas sin
// tener que volver a marcarlas como activas. Vive acá (con el permiso
// 'referencias.ver' de siempre) en vez de reusar
// /api/valores-cableado/foto-circuito/:version_id porque ese endpoint exige
// el permiso 'valores_cableado.ver', que es de un módulo distinto y no todo
// el que puede ver Circuitos SMD lo tiene necesariamente.
router.get('/fotos-version/:version_id', validarToken, requerirPermiso('referencias.ver'), asyncHandler(async (req, res) => {
  const versionId = parseInt(req.params.version_id, 10);
  if (isNaN(versionId)) return res.status(400).json({ error: 'ID de versión inválido' });

  let filePath = await valoresData.obtenerImagenRutaPorVersion(versionId);
  if (!filePath) return res.status(404).json({ error: 'Esta versión no tiene foto guardada' });

  if (!fs.existsSync(filePath)) {
    const encontrada = buscarArchivoRecursivo(path.basename(filePath));
    if (encontrada) {
      await valoresData.actualizarImagenRutaVersion(versionId, encontrada);
      filePath = encontrada;
    } else return res.status(404).json({ error: 'Archivo no encontrado en disco' });
  }

  const nombreUsuario = req.usuario.nombre || 'Inspector';
  await aplicarMarcaDeAgua(filePath, nombreUsuario, res);
}));

// GET datos de referencia para edición (simplificado)
router.get('/imagen/:referencia', validarToken, requerirPermiso('referencias.ver'), asyncHandler(async (req, res) => {
  // Mismo motivo que las rutas de arriba.
  const codigoBase = req.params.referencia || '';
  const ref = await refData.buscarReferenciaConCreador(codigoBase);
  if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });

  const versionActiva = await refData.buscarVersionActivaPrimera(ref.id);

  res.json({
    datos: {
      id: ref.id,
      codigo_base: ref.codigo_base,
      version_actual: versionActiva?.version || '',
      imagen_ruta: versionActiva?.imagen_ruta || '',
      estado: versionActiva?.estado || '',
      creado_por: ref.creado_por_nombre || 'Desconocido',
      fecha_creacion: ref.created_at,
      version_id: versionActiva?.id || null,
      necesita_prueba: versionActiva?.necesita_prueba || 0
    }
  });
}));

// PUT: marcar/desmarcar necesita_prueba en una versión
router.put('/versiones/:id/prueba', validarToken, requerirPermiso('referencias.editar'), asyncHandler(async (req, res) => {
  const versionId = parseInt(req.params.id, 10);
  const { necesita_prueba } = req.body;
  if (isNaN(versionId)) return res.status(400).json({ error: 'ID de versión inválido' });

  await refData.marcarNecesitaPrueba(versionId, necesita_prueba ? 1 : 0);
  res.json({ success: true, necesita_prueba: necesita_prueba ? 1 : 0 });
}));

router.get('/versiones/:codigo_base', validarToken, requerirPermiso('referencias.ver'), asyncHandler(async (req, res) => {
  // Mismo motivo que las rutas de arriba.
  const codigoBase = req.params.codigo_base || '';
  const ref = await refData.buscarIdReferenciaPorCodigo(codigoBase);
  if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });
  const versiones = await refData.listarVersionesPorReferencia(ref.id);
  res.json({ versiones });
}));

router.get('/seguimiento/:codigo_base', validarToken, requerirPermiso('referencias.ver'), asyncHandler(async (req, res) => {
  // Mismo motivo que las rutas de arriba.
  const codigoBase = req.params.codigo_base || '';
  const ref = await refData.buscarIdReferenciaPorCodigo(codigoBase);
  if (!ref) return res.status(404).json({ error: 'Referencia no encontrada' });
  const seguimiento = await refData.listarSeguimientoPorReferencia(codigoBase);
  res.json({ seguimiento });
}));

router.get('/rutas-fotos', validarToken, requerirPermiso('referencias.ver'), asyncHandler(async (req, res) => {
  const rutas = [];
  for (const carpeta of CARPETAS_FOTOS) {
    if (fs.existsSync(carpeta)) rutas.push(...escanearRecursivo(carpeta));
  }
  rutas.sort((a, b) => a.localeCompare(b));
  res.json({ rutas });
}));

module.exports = router;
