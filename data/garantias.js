const { getDb } = require('../db/connection');

function buscarClientes(q) {
  return getDb().all(
    'SELECT nit, razon_social, codigo_vendedor, nombre_vendedor, ciudad FROM clientes WHERE nit LIKE ? OR razon_social LIKE ? LIMIT 15',
    [`%${q}%`, `%${q}%`]
  );
}

function buscarReferenciasPt(q) {
  return getDb().all(
    'SELECT referencia, linea_base, tipo_circuito FROM referencias_pt WHERE referencia LIKE ? LIMIT 15',
    [`%${q}%`]
  );
}

async function obtenerSiguienteNumeroGarantia() {
  const db = getDb();
  const ultima = await db.get('SELECT no_garantia FROM garantias ORDER BY id DESC LIMIT 1');
  let siguienteNum = 1250;
  if (ultima && ultima.no_garantia) {
    const match = ultima.no_garantia.match(/\d+/);
    if (match) {
      const num = parseInt(match[0], 10);
      siguienteNum = Math.max(1250, num + 1);
    }
  }
  return `G${siguienteNum}`;
}

function listarGarantias() {
  return getDb().all('SELECT * FROM garantias ORDER BY id DESC');
}

function crearGarantia(numGarantia, fechaRep, responsable, vendedorDistribuidor, cliente, nitCliente, ciudad, remision, item, tipoSolicitud, observacionesGeneral, fechaRev, estado, quienApruebaRechazo) {
  return getDb().run(`
    INSERT INTO garantias (
      no_garantia, fecha_reporte, responsable, vendedor_distribuidor, memorando,
      op_pedido, cliente, nit_cliente, ciudad, remision, referencia, cantidad,
      tipo_solicitud, observaciones, fecha_revision, estado, lote_fecha,
      problema, quien_aprobo_rechazo, observacion_calidad, tipo_circuito, fecha_creacion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [
    numGarantia, fechaRep,
    responsable || '', vendedorDistribuidor || '', '', '',
    cliente || '', nitCliente, ciudad || '', remision || '',
    item.referencia, item.cantidad || 1,
    item.tipo_solicitud || tipoSolicitud || 'GARANTIA', item.observaciones || observacionesGeneral || '',
    fechaRev, estado || 'Pendiente', item.lote_fecha || '',
    item.problema || '', quienApruebaRechazo, '', ''
  ]);
}

function actualizarGarantia(id, estado, tipoSolicitud, cantidad, referencia, loteFecha, problema, observaciones, remision, quienApruebaRechazo) {
  return getDb().run(`
    UPDATE garantias SET
      estado = ?, tipo_solicitud = ?, cantidad = ?, referencia = ?,
      lote_fecha = ?, problema = ?, observaciones = ?, remision = ?,
      quien_aprobo_rechazo = ?
    WHERE id = ?
  `, [
    estado || 'Pendiente', tipoSolicitud || 'GARANTIA', cantidad || 1, referencia || '',
    loteFecha || '', problema || '', observaciones || '', remision || '',
    quienApruebaRechazo || '', id
  ]);
}

function eliminarGarantia(id) {
  return getDb().run('DELETE FROM garantias WHERE id = ?', [id]);
}

// Para el registro de cambios: describir "se editó/eliminó la garantía
// G1300 de Fulano" en vez de solo un ID interno.
function buscarGarantiaPorId(id) {
  return getDb().get('SELECT id, no_garantia, cliente, referencia FROM garantias WHERE id = ?', [id]);
}

// ======================== CATÁLOGO DE CAUSALES (TIPIFICACIÓN) ========================
// Ver migración #7 en db/init.js. Solo se muestran los códigos "Activo" al
// autocompletar (los "Inactivo" quedan guardados, para no romper el
// historial de garantías viejas que ya los usan, pero dejan de ofrecerse
// como opción nueva).
function buscarProblemasCatalogo(q) {
  const db = getDb();
  if (q) {
    return db.all(
      `SELECT id, codigo, descripcion, estado FROM garantias_tipificacion_problemas
       WHERE estado = 'Activo' AND (codigo LIKE ? OR descripcion LIKE ?) ORDER BY codigo LIMIT 20`,
      [`%${q}%`, `%${q}%`]
    );
  }
  return db.all(
    `SELECT id, codigo, descripcion, estado FROM garantias_tipificacion_problemas WHERE estado = 'Activo' ORDER BY codigo LIMIT 50`
  );
}

function listarProblemasCatalogo() {
  return getDb().all('SELECT id, codigo, descripcion, estado FROM garantias_tipificacion_problemas ORDER BY codigo');
}

function crearProblemaCatalogo(codigo, descripcion) {
  return getDb().run(
    'INSERT INTO garantias_tipificacion_problemas (codigo, descripcion) VALUES (?, ?)',
    [codigo, descripcion]
  );
}

function actualizarProblemaCatalogo(id, codigo, descripcion, estado) {
  return getDb().run(
    'UPDATE garantias_tipificacion_problemas SET codigo = ?, descripcion = ?, estado = ? WHERE id = ?',
    [codigo, descripcion, estado, id]
  );
}

function eliminarProblemaCatalogo(id) {
  return getDb().run('DELETE FROM garantias_tipificacion_problemas WHERE id = ?', [id]);
}

module.exports = {
  buscarClientes,
  buscarReferenciasPt,
  obtenerSiguienteNumeroGarantia,
  listarGarantias,
  crearGarantia,
  actualizarGarantia,
  eliminarGarantia,
  buscarGarantiaPorId,
  buscarProblemasCatalogo,
  listarProblemasCatalogo,
  crearProblemaCatalogo,
  actualizarProblemaCatalogo,
  eliminarProblemaCatalogo,
};
