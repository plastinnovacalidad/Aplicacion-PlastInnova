const express = require('express');
const { validarToken, requerirPermiso, recargarPermisos } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errores');
const { enTransaccion } = require('../db/connection');
const rolesData = require('../data/roles');
const { registrarCambio } = require('../data/auditoria');
const whatsappService = require('../whatsapp_bot_service');
const { PERMISOS_SENSIBLES } = require('../settings/permisosSensibles');

const router = express.Router();

// ======================== ROLES Y PERMISOS ========================

router.get('/permisos', validarToken, requerirPermiso('roles.gestionar'), asyncHandler(async (req, res) => {
  const permisos = await rolesData.listarPermisos();
  res.json({ permisos });
}));

router.get('/roles', validarToken, asyncHandler(async (req, res) => {
  const roles = await rolesData.listarRoles();
  for (const rol of roles) {
    rol.permisos = await rolesData.listarPermisosDeRol(rol.id);
  }
  res.json({ roles });
}));

router.post('/roles', validarToken, requerirPermiso('roles.gestionar'), async (req, res) => {
  const { nombre, descripcion, permisos } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre del rol requerido' });

  try {
    // Crear el rol y asignarle sus permisos es una sola operación desde el
    // punto de vista de quien lo usa: si falla a mitad de la lista de
    // permisos, no debe quedar un rol nuevo con solo algunos de ellos.
    const rolId = await enTransaccion(async () => {
      const result = await rolesData.crearRol(nombre, descripcion);
      const rolId = result.lastID;

      if (Array.isArray(permisos) && permisos.length > 0) {
        for (const permId of permisos) {
          await rolesData.asignarPermisoARol(rolId, permId);
        }
      }
      return rolId;
    });

    await recargarPermisos();
    await registrarCambio({
      modulo: 'Roles y Usuarios', entidad: 'roles', entidadId: rolId, accion: 'Creación',
      detalle: `Rol "${nombre}" creado con ${Array.isArray(permisos) ? permisos.length : 0} permiso(s).`,
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
    });

    const codigosNuevoRol = (await rolesData.listarPermisosDeRol(rolId)).map(p => p.codigo);
    const sensiblesGanados = codigosNuevoRol.filter(c => PERMISOS_SENSIBLES.includes(c));
    if (sensiblesGanados.length > 0) {
      whatsappService.enviarAlerta('permiso_sensible',
        `🔐 *ROL NUEVO CON PERMISOS SENSIBLES*\n\nSe creó el rol *"${nombre}"* con: ${sensiblesGanados.join(', ')}.\nHecho por: ${req.usuario.nombre}`
      );
    }

    res.status(201).json({ success: true, id: rolId });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/roles/:id', validarToken, requerirPermiso('roles.gestionar'), async (req, res) => {
  const rolId = parseInt(req.params.id, 10);
  const { nombre, descripcion, permisos } = req.body;
  if (isNaN(rolId)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const rol = await rolesData.buscarRolPorId(rolId);
    if (!rol) return res.status(404).json({ error: 'Rol no encontrado' });
    // NOTA: Ahora SÍ se pueden editar roles de sistema (solo no eliminar)

    // Se guarda ANTES de tocar nada, para poder avisar solo cuando un
    // permiso sensible se GANA (no cuando se quita, ni cuando ya lo tenía).
    const codigosAntes = (await rolesData.listarPermisosDeRol(rolId)).map(p => p.codigo);

    // Igual que al crear: cambiar los permisos de un rol implica borrar
    // todos los que tenía y volver a insertar la lista nueva completa; si
    // eso se corta a la mitad, el rol se queda sin ningún permiso en vez de
    // con los de antes o los nuevos.
    await enTransaccion(async () => {
      if (nombre) await rolesData.actualizarNombreRol(rolId, nombre);
      if (descripcion !== undefined) await rolesData.actualizarDescripcionRol(rolId, descripcion);

      if (Array.isArray(permisos)) {
        await rolesData.borrarPermisosDeRol(rolId);
        for (const permId of permisos) {
          await rolesData.asignarPermisoARol(rolId, permId);
        }
      }
    });

    await recargarPermisos();
    await registrarCambio({
      modulo: 'Roles y Usuarios', entidad: 'roles', entidadId: rolId, accion: 'Edición',
      detalle: `Rol "${rol.nombre}" editado.` + (nombre && nombre !== rol.nombre ? ` Nombre nuevo: "${nombre}".` : '') + (Array.isArray(permisos) ? ` Permisos actualizados (${permisos.length}).` : ''),
      usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
    });

    if (Array.isArray(permisos)) {
      const codigosDespues = (await rolesData.listarPermisosDeRol(rolId)).map(p => p.codigo);
      const sensiblesGanados = codigosDespues.filter(c => PERMISOS_SENSIBLES.includes(c) && !codigosAntes.includes(c));
      if (sensiblesGanados.length > 0) {
        whatsappService.enviarAlerta('permiso_sensible',
          `🔐 *ROL EDITADO — NUEVOS PERMISOS SENSIBLES*\n\nEl rol *"${rol.nombre}"* ganó: ${sensiblesGanados.join(', ')}.\nHecho por: ${req.usuario.nombre}`
        );
      }
    }

    res.json({ success: true });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
    res.status(500).json({ error: e.message });
  }
});

router.delete('/roles/:id', validarToken, requerirPermiso('roles.gestionar'), asyncHandler(async (req, res) => {
  const rolId = parseInt(req.params.id, 10);
  if (isNaN(rolId)) return res.status(400).json({ error: 'ID inválido' });

  const rol = await rolesData.buscarRolPorId(rolId);
  if (!rol) return res.status(404).json({ error: 'Rol no encontrado' });
  if (rol.es_sistema === 1) return res.status(403).json({ error: 'No se puede eliminar un rol de sistema' });

  const usuarios = await rolesData.contarUsuariosConRol(rolId);
  if (usuarios.total > 0) return res.status(409).json({ error: `Hay ${usuarios.total} usuarios con este rol. Reasígnalos primero.` });

  await rolesData.eliminarRol(rolId);
  await recargarPermisos();
  await registrarCambio({
    modulo: 'Roles y Usuarios', entidad: 'roles', entidadId: rolId, accion: 'Eliminación',
    detalle: `Rol "${rol.nombre}" eliminado.`,
    usuarioId: req.usuario.id, usuarioNombre: req.usuario.nombre
  });
  res.json({ success: true });
}));

module.exports = router;
