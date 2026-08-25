const fs = require('fs');
const path = require('path');
const express = require('express');
const { validarToken, requerirPermiso } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const { buscarArchivoRecursivo, moverArchivo } = require('../utils/archivos');
const { aplicarMarcaDeAgua } = require('../utils/logo');
const { upload } = require('../utils/upload');
const { CARPETA_FOTOS_CABLEADO, CARPETAS_FOTOS, OBSOLETAS_DIR } = require('../settings/paths');
const valoresData = require('../data/valoresCableado');

const router = express.Router();

// forma_cableado siempre debería ser un nombre de archivo simple (ej.
// "1017.jpg", ver comentarios más abajo) — nunca una ruta. Si contiene "/",
// "\" o ".." se podría escapar de CARPETA_FOTOS_CABLEADO al construir la
// ruta con path.join (ej. "..%2f..%2f..%2fetc%2fpasswd", que Express
// decodifica como "../../../etc/passwd" antes de llegar aquí) y leer o
// sobrescribir archivos fuera de esa carpeta. Se valida ANTES de tocar el
// filesystem, tanto para leer (GET) como para subir (POST) fotos.
function esNombreArchivoSeguro(nombre) {
  return typeof nombre === 'string' && nombre.length > 0 && !nombre.includes('/') && !nombre.includes('\\') && !nombre.includes('..');
}

// ======================== VALORES Y CABLEADO ========================
// Valores eléctricos medidos y configuración de cableado por referencia/
// color/versión de Circuitos SMD. 'valores_cableado.ver' deja ver la
// ficha; 'valores_cableado.gestion' deja además editar los valores/
// cableado y subir fotos de cableado. Crear la referencia+color+versión en
// sí (y su foto de circuito) se sigue haciendo desde la pantalla de
// Referencias de Circuitos SMD — es el mismo catálogo, no se duplica esa
// pantalla aquí (decisión de Julio).
const puedeVer = requerirPermiso('valores_cableado.ver');
const puedeGestionar = requerirPermiso('valores_cableado.gestion');

router.get('/valores-cableado/productos', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const productos = await valoresData.listarProductos();
  res.json({ count: productos.length, data: productos });
}));

// Valores de "forma_cableado" ya usados en otras referencias — llena el
// desplegable de Crear/Editar Referencia. Requiere 'valores_cableado.gestion'
// porque solo se usa desde esa pantalla de edición.
router.get('/valores-cableado/formas-cableado', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const formas = await valoresData.listarFormasCableadoConocidas();
  res.json({ formas });
}));

// Foto de circuito de una versión puntual, con la misma marca de agua
// (nombre de quien la ve) que ya usa Circuitos SMD en /api/fotos/* — son
// las mismas fotos protegidas, así que se sirven con la misma protección.
router.get('/valores-cableado/foto-circuito/:version_id', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const versionId = parseInt(req.params.version_id, 10);
  if (isNaN(versionId)) return res.status(400).json({ error: 'ID de versión inválido' });

  let filePath = await valoresData.obtenerImagenRutaPorVersion(versionId);
  if (!filePath) return res.status(404).json({ error: 'Esta versión no tiene foto de circuito' });

  if (!fs.existsSync(filePath)) {
    const encontrada = buscarArchivoRecursivo(path.basename(filePath));
    if (encontrada) {
      await valoresData.actualizarImagenRutaVersion(versionId, encontrada);
      filePath = encontrada;
    } else {
      return res.status(404).json({ error: 'Archivo no encontrado en disco' });
    }
  }

  const nombreUsuario = req.usuario.nombre || 'Inspector';
  await aplicarMarcaDeAgua(filePath, nombreUsuario, res);
}));

// Foto de "forma de cableado" — antes era siempre un link público de Google
// Drive (elec_fotos_cableado.url_foto); ahora Julio sube el archivo real y
// se busca por nombre exacto (ej. "1017.jpg") primero en
// CARPETA_FOTOS_CABLEADO y, si no aparece ahí, en las demás carpetas de
// fotos conocidas (por si el archivo quedó movido). Si tampoco hay archivo,
// se cae al link de Drive viejo como respaldo, para no perder las fotos que
// todavía no se han vuelto a subir como archivo.
router.get('/valores-cableado/foto-cableado/:forma_cableado', validarToken, puedeVer, asyncHandler(async (req, res) => {
  const formaCableado = decodeURIComponent(req.params.forma_cableado || '');
  if (!formaCableado) return res.status(400).json({ error: 'forma_cableado requerido' });
  if (!esNombreArchivoSeguro(formaCableado)) return res.status(400).json({ error: 'forma_cableado inválido' });

  const rutaDirecta = path.join(CARPETA_FOTOS_CABLEADO, formaCableado);
  let filePath = fs.existsSync(rutaDirecta) ? rutaDirecta : buscarArchivoRecursivo(formaCableado, [CARPETA_FOTOS_CABLEADO, ...CARPETAS_FOTOS]);

  if (filePath) {
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'jpeg';
    const mime = ext === 'jpg' ? 'jpeg' : ext;
    return res.json({ tipo: 'archivo', data: `data:image/${mime};base64,${buffer.toString('base64')}` });
  }

  const urlLegacy = await valoresData.obtenerUrlFotoCableadoLegacy(formaCableado);
  if (urlLegacy) return res.json({ tipo: 'url', url: urlLegacy });

  return res.status(404).json({ error: 'No hay foto de cableado para esta forma' });
}));

// Subir (o reemplazar) el archivo de foto de una "forma de cableado". Se
// guarda siempre con el mismo nombre que ya tiene en el catálogo (ej.
// "1017.jpg"), dentro de CARPETA_FOTOS_CABLEADO — así la búsqueda de arriba
// la encuentra de inmediato sin tocar nada más en la base de datos. Si ya
// había un archivo con ese nombre, se manda primero a uploads/obsoletas en
// vez de perderse (mismo criterio que las fotos de circuito de SMD).
router.post('/valores-cableado/fotos-cableado/:forma_cableado', validarToken, puedeGestionar, upload.single('imagen'), asyncHandler(async (req, res) => {
  const formaCableado = decodeURIComponent(req.params.forma_cableado || '');
  if (!formaCableado) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'forma_cableado requerido' });
  }
  if (!esNombreArchivoSeguro(formaCableado)) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'forma_cableado inválido' });
  }
  if (!req.file) return res.status(400).json({ error: 'Debe subir una imagen' });

  try {
    if (!fs.existsSync(CARPETA_FOTOS_CABLEADO)) fs.mkdirSync(CARPETA_FOTOS_CABLEADO, { recursive: true });

    // Se guarda exactamente con el nombre que ya tiene en el catálogo (el
    // valor de forma_cableado, ej. "1017.jpg") para que la búsqueda por
    // nombre de arriba la encuentre siempre, sin importar la extensión
    // real del archivo que suba Julio.
    const destinoFinal = path.join(CARPETA_FOTOS_CABLEADO, formaCableado);

    if (fs.existsSync(destinoFinal)) {
      const fechaSufijo = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const ext = path.extname(destinoFinal);
      const nombreBase = path.basename(destinoFinal, ext);
      moverArchivo(destinoFinal, path.join(OBSOLETAS_DIR, `${nombreBase}_${fechaSufijo}${ext}`));
    }

    moverArchivo(req.file.path, destinoFinal);
    res.json({ success: true, forma_cableado: formaCableado, ruta: destinoFinal });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: error.message });
  }
}));

// Ficha de valores/cableado de una sola versión — usada por el módulo
// "Crear Referencia" para precargar su formulario de edición (pestaña
// "⚡ Valores y Cableado"). Requiere 'valores_cableado.gestion' porque solo
// tiene sentido para quien vaya a editarlos ahí mismo.
router.get('/valores-cableado/producto/:version_id', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const versionId = parseInt(req.params.version_id, 10);
  if (isNaN(versionId)) return res.status(400).json({ error: 'ID de versión inválido' });

  const datos = await valoresData.obtenerFichaVersion(versionId);
  if (!datos) return res.status(404).json({ error: 'Esa versión no existe' });
  res.json({ datos });
}));

// Crear/editar los valores eléctricos y la configuración de cableado de una
// versión puntual (la versión en sí ya debe existir — se crea desde el
// módulo Crear Referencia). Reusa los mismos nombres de campo que ya
// devuelve GET /productos, así el formulario de edición no tiene que
// traducir nada.
router.put('/valores-cableado/productos/:version_id', validarToken, puedeGestionar, asyncHandler(async (req, res) => {
  const versionId = parseInt(req.params.version_id, 10);
  if (isNaN(versionId)) return res.status(400).json({ error: 'ID de versión inválido' });

  const version = await valoresData.existeVersion(versionId);
  if (!version) return res.status(404).json({ error: 'Esa versión no existe — créala primero desde Circuitos SMD' });

  await valoresData.guardarFichaVersion(versionId, req.body || {});
  res.json({ success: true, version_id: versionId, codigo_base: version.codigo_base, version: version.version });
}));

module.exports = router;
