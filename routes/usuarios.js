const express = require('express');
const bcrypt = require('bcryptjs');

const { SALT_ROUNDS } = require('../settings/paths');
const { ahoraISO } = require('../utils/fechas');
const { validarToken, requerirPermiso } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const usuariosData = require('../data/usuarios');
const { registrarCambio } = require('../data/auditoria');
const rolesData = require('../data/roles');
const whatsappService = require('../whatsapp_bot_service');
const { PERMISOS_SENSIBLES } = require('../settings/permisosSensibles');

const router = express.Router();

// ======================== USUARIOS ========================

router.get('/usuarios', validarToken, requerirPermiso('usuarios.gestionar'), asyncHandler(async (req, res) => {
  const users = await usuariosData.listarUsuarios();
  res.json({ usuarios: users });
}));

router.post('/usuarios', validarToken, requerirPermiso('usuarios.gestionar'), async (req, res) => {
  const { nombre, usuario, contrasena, rol_id } = req.body;
  if (!nombre || !usuario || !contrasena) return res.status(400).json({ error: 'Nombre, usuario y contraseña requeridos' });

  try {
    const contrasenaHash = await bcrypt.hash(contrasena, SALT_ROUNDS);
    const result = await usuariosData.crearUsuario(nombre, usuario, contrasenaHash, rol_id, ahoraISO());
    await registrarCambio({
      modulo: 'Roles y Usuarios', entidad: 'usuarios', entidadId: result.lastID, accion: 'Creación',
      detalle: `Usuario "${usuario}" (${nombre}) creado.`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
    });
    res.status(201).json({ success: true, id: result.lastID });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/usuarios/:id', validarToken, requerirPermiso('usuarios.gestionar'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { nombre, usuario, contrasena, rol_id } = req.body;
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    // Se guarda antes de actualizar, para saber si el rol realmente cambió
    // (y así poder avisar si el rol nuevo trae algún permiso sensible).
    const usuarioAntes = rol_id !== undefined ? await usuariosData.buscarUsuarioPorId(id) : null;

    const sets = [];
    const vals = [];
    if (nombre) { sets.push('nombre = ?'); vals.push(nombre); }
    if (usuario) { sets.push('usuario = ?'); vals.push(usuario); }
    if (contrasena) { sets.push('contrasena = ?'); vals.push(await bcrypt.hash(contrasena, SALT_ROUNDS)); }
    if (rol_id !== undefined) { sets.push('rol_id = ?'); vals.push(rol_id); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    vals.push(id);

    await usuariosData.actualizarUsuario(id, sets, vals);
    const camposCambiados = [];
    if (nombre) camposCambiados.push('nombre');
    if (usuario) camposCambiados.push('usuario (login)');
    if (contrasena) camposCambiados.push('contraseña');
    if (rol_id !== undefined) camposCambiados.push('rol');
    await registrarCambio({
      modulo: 'Roles y Usuarios', entidad: 'usuarios', entidadId: id, accion: 'Edición',
      detalle: `Usuario editado. Campos modificados: ${camposCambiados.join(', ') || 'ninguno'}.`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
    });

    // Alerta de permiso sensible: solo si el rol realmente cambió (no si se
    // volvió a mandar el mismo rol_id) y el rol nuevo trae algún permiso de
    // la lista PERMISOS_SENSIBLES.
    if (usuarioAntes && rol_id !== undefined && String(usuarioAntes.rol_id) !== String(rol_id)) {
      const permisosNuevoRol = (await rolesData.listarPermisosDeRol(rol_id)).map(p => p.codigo);
      const sensibles = permisosNuevoRol.filter(c => PERMISOS_SENSIBLES.includes(c));
      if (sensibles.length > 0) {
        const rolNuevo = await rolesData.buscarRolPorId(rol_id);
        whatsappService.enviarAlerta('permiso_sensible',
          `🔐 *CAMBIO DE ROL CON PERMISOS SENSIBLES*\n\nEl usuario *${usuarioAntes.nombre}* (${usuarioAntes.usuario}) ahora tiene el rol *"${rolNuevo ? rolNuevo.nombre : rol_id}"*, que incluye: ${sensibles.join(', ')}.\nHecho por: ${req.usuario.nombre}`
        );
      }
    }

    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre de usuario' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/usuarios/:id', validarToken, requerirPermiso('usuarios.gestionar'), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'ID inválido' });
  if (id === req.usuario.id) return res.status(403).json({ error: 'No puedes eliminarte a ti mismo' });

  const usuarioAEliminar = await usuariosData.buscarUsuarioPorId(id);
  const result = await usuariosData.eliminarUsuario(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  await registrarCambio({
    modulo: 'Roles y Usuarios', entidad: 'usuarios', entidadId: id, accion: 'Eliminación',
    detalle: `Usuario "${usuarioAEliminar ? usuarioAEliminar.usuario : id}" (${usuarioAEliminar ? usuarioAEliminar.nombre : ''}) eliminado.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ success: true });
}));

module.exports = router;
