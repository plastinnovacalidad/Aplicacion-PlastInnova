const fs = require('fs');
const path = require('path');
const express = require('express');
const FileType = require('file-type');
const sharp = require('sharp');

const { validarToken, requerirPermiso, requerirPermisoAlternativo, tienePermiso } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const { upload } = require('../utils/upload');
const { moverArchivo } = require('../utils/archivos');
const { EVIDENCIAS_DIR, OBSOLETAS_DIR } = require('../settings/paths');
const { registrarCambio } = require('../data/auditoria');
const cajaRoja = require('../data/cajaRoja');
const lib = require('../data/liberaciones');
const { generarPdfLiberacion } = require('../utils/pdfLiberacion');

const router = express.Router();

// ======================== LIBERACIÓN DE PRODUCTO (MIGRACIÓN #56) ========================
// Permisos:
//   liberacion.registrar -> crear, ver las propias y editar las que creó
//   liberacion.ver       -> ver todas (sin editar)
//   liberacion.gestion   -> eliminar
// Editar: solo quien creó el registro (pedido por Julio), y además debe
// seguir teniendo liberacion.registrar.
const PERMISOS_MODULO = ['liberacion.registrar', 'liberacion.ver', 'liberacion.gestion'];
const puedeEntrar = requerirPermisoAlternativo(PERMISOS_MODULO);

const MAX_PRODUCTOS = 20;

// Copia de cada PDF en la carpeta de formatos de Calidad (pedido por Julio,
// 23/11/2026): una subcarpeta para liberaciones y otra para rechazos. Al
// editar se reemplaza el archivo (un solo PDF por documento, con su Rev. N).
// Al eliminar, el PDF se mueve a una subcarpeta "_Eliminados" (no se borra).
// La ruta se puede cambiar con CARPETA_PDF_LIBERACIONES en el .env.
const CARPETA_PDF = process.env.CARPETA_PDF_LIBERACIONES
  || 'P:\\1. Equipo Produccion\\15.3 Calidad\\15.3.3 Proyecto Calidad Nuevo\\Formatos\\9.Liberacion de Productos No Conformes';
const SUBCARPETA_TIPO = { 'Liberación': 'Liberaciones', 'Rechazo': 'Rechazos' };
const MAX_DESCRIPCION = 150;
const CARPETA_FOTOS = path.join(EVIDENCIAS_DIR, 'liberaciones');
// Solo fotos (no PDF, aunque utils/upload.js también deja pasar PDF).
const MIMES_FOTO = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];

function veTodo(usuario) {
  return tienePermiso(usuario.rol_id, 'liberacion.ver') || tienePermiso(usuario.rol_id, 'liberacion.gestion');
}

function esCreador(liberacion, usuario) {
  return Number(liberacion.responsable_id) === Number(usuario.id);
}

function puedeVerLiberacion(liberacion, usuario) {
  return veTodo(usuario) || esCreador(liberacion, usuario);
}

function puedeEditarLiberacion(liberacion, usuario) {
  return esCreador(liberacion, usuario) && tienePermiso(usuario.rol_id, 'liberacion.registrar');
}

// Busca la liberación del parámetro :id y revisa que quien pide la pueda ver.
// Responde el error y devuelve null si no.
async function cargarParaVer(req, res) {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) { res.status(400).json({ error: 'Id inválido' }); return null; }
  const liberacion = await lib.buscarLiberacion(id);
  if (!liberacion) { res.status(404).json({ error: 'Liberación no encontrada' }); return null; }
  if (!puedeVerLiberacion(liberacion, req.usuario)) {
    res.status(403).json({ error: 'No tienes permiso para ver esta liberación' });
    return null;
  }
  return liberacion;
}

// ---------------------------------------------------------------- validación
const fechaValida = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// tipoFijo: al editar, el tipo es el que ya tiene el documento (no cambia).
async function validarEntrada(body, tipoFijo) {
  const b = body || {};
  const tipo = tipoFijo || b.tipo;
  if (!lib.TIPOS.includes(tipo)) return { error: 'Elige si es una liberación o un rechazo' };
  if (!fechaValida(b.fecha)) return { error: 'Indica la fecha' };
  if (!lib.TURNOS.includes(b.turno)) return { error: 'Elige el turno' };
  const areaId = parseInt(b.area_id, 10);
  if (!Number.isInteger(areaId)) return { error: 'Elige el área' };
  const area = await lib.buscarArea(areaId);
  if (!area) return { error: 'El área elegida no existe o está inactiva' };

  const lista = Array.isArray(b.productos) ? b.productos : [];
  if (!lista.length) return { error: 'Agrega al menos un producto' };
  if (lista.length > MAX_PRODUCTOS) return { error: `Máximo ${MAX_PRODUCTOS} productos por liberación` };

  const mapaMaestro = new Map(cajaRoja.leerMaestro().items.map(it => [it[1], it]));
  const productos = [];
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i] || {};
    const n = i + 1;
    const referencia = String(p.referencia || '').trim().toUpperCase();
    if (!referencia) return { error: `Producto ${n}: falta la referencia` };
    if (referencia.length > 100) return { error: `Producto ${n}: la referencia es demasiado larga` };
    const lote = String(p.lote || '').trim().toUpperCase();
    if (!lote) return { error: `Producto ${n}: falta el lote` };
    if (lote.length > 100) return { error: `Producto ${n}: el lote es demasiado largo` };
    const cantidad = Number(p.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000000) return { error: `Producto ${n}: la cantidad no es válida` };
    const descripcion = String(p.descripcion || '').trim().replace(/\s+/g, ' ');
    if (descripcion.length > MAX_DESCRIPCION) return { error: `Producto ${n}: la descripción pasa de ${MAX_DESCRIPCION} caracteres` };
    // La descripción de la referencia sale del maestro del servidor cuando la
    // referencia existe ahí (no de lo que mande la tablet), igual que Caja roja.
    const delMaestro = mapaMaestro.get(referencia);
    productos.push({
      id: p.id != null ? parseInt(p.id, 10) || null : null,
      referencia,
      descripcion_referencia: delMaestro ? delMaestro[2] : null,
      lote,
      cantidad,
      descripcion: descripcion || null,
    });
  }
  return {
    encabezado: { tipo, fecha: b.fecha, turno: b.turno, area_id: area.id, area_nombre: area.nombre },
    productos,
  };
}

function moverAObsoletas(archivo) {
  if (!archivo) return;
  const origen = path.join(CARPETA_FOTOS, archivo);
  try {
    if (!fs.existsSync(origen)) return;
    const destinoDir = path.join(OBSOLETAS_DIR, 'liberaciones');
    if (!fs.existsSync(destinoDir)) fs.mkdirSync(destinoDir, { recursive: true });
    moverArchivo(origen, path.join(destinoDir, archivo));
  } catch (e) {
    console.error('⚠️ No se pudo mover a obsoletas la foto de liberación', archivo, e.message);
  }
}

// ---------------------------------------------------------------- catálogos
router.get('/liberaciones/catalogos', validarToken, puedeEntrar, asyncHandler(async (req, res) => {
  res.json({
    areas: await lib.listarAreasActivas(),
    turnos: lib.TURNOS,
    tipos: lib.TIPOS,
    estados: lib.ESTADOS,
    maxProductos: MAX_PRODUCTOS,
    maxDescripcion: MAX_DESCRIPCION,
    veTodo: veTodo(req.usuario),
  });
}));

// Mismo maestro de referencias de Caja roja (ítems del ERP). Si la tablet
// ya tiene la misma versión, no se vuelve a descargar.
router.get('/liberaciones/maestro', validarToken, puedeEntrar, asyncHandler(async (req, res) => {
  const maestro = cajaRoja.leerMaestro();
  if (req.query.version && maestro.actualizado && req.query.version === maestro.actualizado) {
    return res.json({ sinCambios: true, actualizado: maestro.actualizado, total: maestro.total });
  }
  res.json(maestro);
}));

// ---------------------------------------------------------------- listado
// Filtros comunes de las dos vistas (por documento y por referencia). Quien
// no tiene liberacion.ver ni gestión solo ve lo que registró.
function filtrosDeConsulta(req) {
  const areaId = parseInt(req.query.area_id, 10);
  return {
    desde: fechaValida(req.query.desde) ? req.query.desde : null,
    hasta: fechaValida(req.query.hasta) ? req.query.hasta : null,
    turno: lib.TURNOS.includes(req.query.turno) ? req.query.turno : null,
    areaId: Number.isInteger(areaId) ? areaId : null,
    tipo: lib.TIPOS.includes(req.query.tipo) ? req.query.tipo : null,
    q: String(req.query.q || '').trim().slice(0, 100) || null,
    responsableId: veTodo(req.usuario) ? null : req.usuario.id,
  };
}

// Vista "Por referencia": un renglón por producto. Va antes de
// /liberaciones/:id para que "productos" no se tome como un id.
router.get('/liberaciones/productos', validarToken, puedeEntrar, asyncHandler(async (req, res) => {
  const lista = await lib.listarProductos(filtrosDeConsulta(req));
  res.json({
    productos: lista.map(({ foto_archivo, ...p }) => ({ ...p, tieneFoto: !!foto_archivo })),
    soloPropias: !veTodo(req.usuario),
  });
}));

router.get('/liberaciones', validarToken, puedeEntrar, asyncHandler(async (req, res) => {
  const todo = veTodo(req.usuario);
  const lista = await lib.listarLiberaciones(filtrosDeConsulta(req));
  res.json({
    liberaciones: lista.map(l => ({ ...l, puedeEditar: puedeEditarLiberacion(l, req.usuario) })),
    soloPropias: !todo,
  });
}));

router.get('/liberaciones/:id', validarToken, puedeEntrar, asyncHandler(async (req, res) => {
  const liberacion = await cargarParaVer(req, res);
  if (!liberacion) return;
  const completa = await lib.obtenerLiberacionCompleta(liberacion.id);
  completa.productos = completa.productos.map(p => ({ ...p, tieneFoto: !!p.foto_archivo }));
  res.json({
    ...completa,
    puedeEditar: puedeEditarLiberacion(completa, req.usuario),
    puedeEliminar: tienePermiso(req.usuario.rol_id, 'liberacion.gestion'),
  });
}));

// ---------------------------------------------------------------- crear / editar
// Se guardan primero los datos (JSON) y después la tablet sube cada foto por
// separado (POST .../foto). Así una foto pesada no hace fallar todo el
// registro, y si una foto no sube se puede volver a intentar editándolo.
router.post('/liberaciones', validarToken, requerirPermiso('liberacion.registrar'), asyncHandler(async (req, res) => {
  const datos = await validarEntrada(req.body);
  if (datos.error) return res.status(400).json({ error: datos.error });
  const creada = await lib.crearLiberacion({ ...datos, usuario: req.usuario });
  await registrarCambio({
    modulo: 'Liberación de producto', entidad: 'liberaciones', entidadId: creada.id, accion: 'Creación',
    detalle: `${creada.consecutivo} (${datos.encabezado.tipo}) · ${datos.encabezado.fecha} · ${datos.encabezado.turno} · ${datos.encabezado.area_nombre} · ${datos.productos.length} producto(s) — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.status(201).json(creada);
}));

router.put('/liberaciones/:id', validarToken, requerirPermiso('liberacion.registrar'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido' });
  const liberacion = await lib.buscarLiberacion(id);
  if (!liberacion) return res.status(404).json({ error: 'Liberación no encontrada' });
  if (!esCreador(liberacion, req.usuario)) return res.status(403).json({ error: 'Solo quien creó esta liberación la puede editar' });

  const datos = await validarEntrada(req.body, liberacion.tipo);
  if (datos.error) return res.status(400).json({ error: datos.error });
  const r = await lib.actualizarLiberacion(id, { ...datos, usuario: req.usuario });
  if (r.error === 'no_encontrado') return res.status(404).json({ error: 'Liberación no encontrada' });
  r.fotosBorradas.forEach(moverAObsoletas);
  await registrarCambio({
    modulo: 'Liberación de producto', entidad: 'liberaciones', entidadId: id, accion: 'Edición',
    detalle: `${liberacion.consecutivo} editada (Rev. ${r.revision}) · ${datos.productos.length} producto(s) — por ${req.usuario.nombre}`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json({ id, consecutivo: liberacion.consecutivo, revision: r.revision, productos: r.productos });
}));

// ---------------------------------------------------------------- fotos
// La foto se guarda tal cual llega (original, sin recomprimir) para que el
// PDF la lleve con toda su calidad.
router.post('/liberaciones/:id/productos/:pid/foto', validarToken, requerirPermiso('liberacion.registrar'),
  upload.single('foto'),
  asyncHandler(async (req, res) => {
    const borrarTmp = () => { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); };
    if (!req.file) return res.status(400).json({ error: 'Sube una foto (JPG, PNG, WEBP, GIF o BMP de máximo 20 MB).' });
    const id = parseInt(req.params.id, 10);
    const pid = parseInt(req.params.pid, 10);
    if (!Number.isInteger(id) || !Number.isInteger(pid)) { borrarTmp(); return res.status(400).json({ error: 'Id inválido' }); }
    const liberacion = await lib.buscarLiberacion(id);
    if (!liberacion) { borrarTmp(); return res.status(404).json({ error: 'Liberación no encontrada' }); }
    if (!esCreador(liberacion, req.usuario)) { borrarTmp(); return res.status(403).json({ error: 'Solo quien creó esta liberación puede cambiar sus fotos' }); }

    // Se revisa el contenido real del archivo, no lo que dice el navegador.
    let tipo = null;
    try { tipo = await FileType.fromFile(req.file.path); } catch (e) { tipo = null; }
    if (!tipo || !MIMES_FOTO.includes(tipo.mime)) {
      borrarTmp();
      return res.status(400).json({ error: 'El archivo no es una foto válida (JPG, PNG, WEBP, GIF o BMP).' });
    }

    if (!fs.existsSync(CARPETA_FOTOS)) fs.mkdirSync(CARPETA_FOTOS, { recursive: true });
    const nombre = `${liberacion.consecutivo}_p${pid}_${Date.now()}-${Math.round(Math.random() * 1e6)}.${tipo.ext}`;
    const destino = path.join(CARPETA_FOTOS, nombre);
    moverArchivo(req.file.path, destino);

    const r = await lib.guardarFotoProducto(id, pid, nombre, String(req.file.originalname || '').slice(0, 250));
    if (r.error) {
      try { fs.unlinkSync(destino); } catch (e) { /* ya no estaba */ }
      return res.status(404).json({ error: 'Producto no encontrado en esta liberación' });
    }
    moverAObsoletas(r.anterior);
    res.json({ success: true });
  })
);

// ?mini=1 devuelve una versión liviana (solo para las miniaturas de la
// pantalla); sin eso, la foto original tal cual se subió.
router.get('/liberaciones/:id/productos/:pid/foto', validarToken, puedeEntrar, asyncHandler(async (req, res) => {
  const liberacion = await cargarParaVer(req, res);
  if (!liberacion) return;
  const producto = await lib.buscarProducto(liberacion.id, parseInt(req.params.pid, 10));
  if (!producto || !producto.foto_archivo) return res.status(404).json({ error: 'Este producto no tiene foto' });
  const ruta = path.join(CARPETA_FOTOS, producto.foto_archivo);
  if (!fs.existsSync(ruta)) return res.status(404).json({ error: 'La foto ya no está disponible en el servidor.' });
  res.setHeader('Cache-Control', 'private, max-age=86400');
  if (req.query.mini === '1') {
    const buffer = await sharp(ruta).rotate().resize(640, 640, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    res.type('jpeg');
    return res.send(buffer);
  }
  res.sendFile(ruta);
}));

// ---------------------------------------------------------------- PDF
function rutaPdfEnCarpeta(liberacion) {
  const sub = SUBCARPETA_TIPO[liberacion.tipo] || SUBCARPETA_TIPO['Liberación'];
  return path.join(CARPETA_PDF, sub, `${liberacion.consecutivo}.pdf`);
}

// Escribe (o reemplaza) el PDF del documento en la carpeta de formatos. Se
// escribe primero a un archivo temporal y luego se renombra, para que un
// corte a la mitad no deje un PDF dañado. Devuelve la ruta final.
async function guardarPdfEnCarpeta(liberacionId) {
  const completa = await lib.obtenerLiberacionCompleta(liberacionId);
  const destino = rutaPdfEnCarpeta(completa);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const temporal = destino + '.tmp';
  await generarPdfLiberacion(completa, CARPETA_FOTOS, fs.createWriteStream(temporal));
  try {
    moverArchivo(temporal, destino);
  } catch (e) {
    try { fs.unlinkSync(temporal); } catch (e2) { /* ya no estaba */ }
    throw e;
  }
  return destino;
}

// La tablet lo llama al terminar de guardar (después de subir las fotos),
// para que la copia en la carpeta ya lleve todas las fotos.
router.post('/liberaciones/:id/archivar', validarToken, requerirPermiso('liberacion.registrar'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido' });
  const liberacion = await lib.buscarLiberacion(id);
  if (!liberacion) return res.status(404).json({ error: 'Liberación no encontrada' });
  if (!esCreador(liberacion, req.usuario)) return res.status(403).json({ error: 'Solo quien creó este documento puede guardarlo en la carpeta' });
  try {
    const ruta = await guardarPdfEnCarpeta(id);
    res.json({ success: true, ruta });
  } catch (e) {
    console.error('⚠️ No se pudo guardar el PDF de', liberacion.consecutivo, 'en la carpeta de formatos:', e.message);
    const ocupado = e.code === 'EBUSY' || e.code === 'EPERM';
    res.status(500).json({
      error: ocupado
        ? `No se pudo reemplazar ${liberacion.consecutivo}.pdf porque está abierto en otro equipo o programa. Ciérralo y vuelve a intentar.`
        : `No se pudo guardar el PDF en la carpeta de formatos (${e.code || e.message}). Revisa que la unidad P: esté conectada.`,
    });
  }
}));

router.get('/liberaciones/:id/pdf', validarToken, puedeEntrar, asyncHandler(async (req, res) => {
  const liberacion = await cargarParaVer(req, res);
  if (!liberacion) return;
  const completa = await lib.obtenerLiberacionCompleta(liberacion.id);
  const nombre = `${completa.consecutivo}${completa.revision ? `_Rev${completa.revision}` : ''}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
  await generarPdfLiberacion(completa, CARPETA_FOTOS, res);
}));

// ---------------------------------------------------------------- eliminar
router.delete('/liberaciones/:id', validarToken, requerirPermiso('liberacion.gestion'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Id inválido' });
  const liberacion = await lib.buscarLiberacion(id);
  if (!liberacion) return res.status(404).json({ error: 'Liberación no encontrada' });
  await lib.eliminarLiberacion(id, req.usuario);
  // El PDF de la carpeta de formatos no se borra: se pasa a "_Eliminados".
  try {
    const origen = rutaPdfEnCarpeta(liberacion);
    if (fs.existsSync(origen)) {
      const dir = path.join(path.dirname(origen), '_Eliminados');
      fs.mkdirSync(dir, { recursive: true });
      moverArchivo(origen, path.join(dir, path.basename(origen)));
    }
  } catch (e) {
    console.error('⚠️ No se pudo mover a _Eliminados el PDF de', liberacion.consecutivo, e.message);
  }
  await registrarCambio({
    modulo: 'Liberación de producto', entidad: 'liberaciones', entidadId: id, accion: 'Eliminación',
    detalle: `${liberacion.consecutivo} · ${liberacion.fecha} · ${liberacion.turno} · ${liberacion.area_nombre || '—'} (creada por ${liberacion.responsable_nombre || '—'})`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre,
  });
  res.json({ success: true });
}));

module.exports = router;
