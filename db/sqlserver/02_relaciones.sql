/* =====================================================================
   Plast Innova · App de calidad (Circuitos SMD)
   ARCHIVO 2 de 2: relaciones entre tablas (llaves foráneas).

   Cuándo ejecutarlo: DESPUÉS de cargar los datos en las tablas.
   Si se ejecuta con las tablas vacías también funciona; solo que la carga
   posterior tendría que respetar el orden de las relaciones.

   Cómo usarlo: misma base que el archivo 1 (NO master) y F5.
   Debe terminar con: Listo: N relaciones creadas.

   Diferencias frente a SQLite (a propósito):
     1. moldes_medidas_detalle.cota_id queda SIN borrado en cascada.
        SQL Server no acepta dos caminos de borrado en cascada que lleguen
        a la misma tabla (moldes_referencias -> cotas -> detalle y
        moldes_referencias -> inspecciones -> detalle). La app ya avisa
        antes de borrar una cota con mediciones, así que no cambia nada.
     2. whatsapp_registros.area_id se crea WITH NOCHECK: hay 18 registros
        históricos con áreas 1 y 2 de antes del catálogo real (excepción
        ya documentada). Los registros nuevos sí se validan.
     3. Dos relaciones nuevas que en SQLite no estaban declaradas y cuyos
        datos coinciden al 100 %:
          Versiones.referencia_id      -> Referencias.id
          whatsapp_registros.telefono  -> whatsapp_numeros.telefono
   ===================================================================== */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @base SYSNAME = DB_NAME();
IF @base IN (N'master', N'model', N'msdb', N'tempdb')
BEGIN
    RAISERROR(N'Estás en la base %s. Elige tu base de ensayo en la lista de arriba y vuelve a ejecutar.', 16, 1, @base);
    RETURN;
END;

IF OBJECT_ID(N'calidad.usuarios', N'U') IS NULL
BEGIN
    RAISERROR(N'No encuentro las tablas del esquema [calidad]. Ejecuta primero 01_crear_tablas.sql en esta base.', 16, 1);
    RETURN;
END;

BEGIN TRANSACTION;


/* ---------- Usuarios y permisos ---------- */
ALTER TABLE [calidad].[usuarios] WITH CHECK
    ADD CONSTRAINT [FK_usuarios_rol_id] FOREIGN KEY ([rol_id])
    REFERENCES [calidad].[roles] ([id]);
ALTER TABLE [calidad].[rol_permisos] WITH CHECK
    ADD CONSTRAINT [FK_rol_permisos_permiso_id] FOREIGN KEY ([permiso_id])
    REFERENCES [calidad].[permisos] ([id]) ON DELETE CASCADE;
ALTER TABLE [calidad].[rol_permisos] WITH CHECK
    ADD CONSTRAINT [FK_rol_permisos_rol_id] FOREIGN KEY ([rol_id])
    REFERENCES [calidad].[roles] ([id]) ON DELETE CASCADE;
ALTER TABLE [calidad].[registro_cambios] WITH CHECK
    ADD CONSTRAINT [FK_registro_cambios_hecho_por] FOREIGN KEY ([hecho_por])
    REFERENCES [calidad].[usuarios] ([id]);

/* ---------- Circuitos SMD y eléctricos ---------- */
ALTER TABLE [calidad].[Referencias] WITH CHECK
    ADD CONSTRAINT [FK_Referencias_creado_por] FOREIGN KEY ([creado_por])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[observaciones] WITH CHECK
    ADD CONSTRAINT [FK_observaciones_actualizado_por] FOREIGN KEY ([actualizado_por])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[observaciones] WITH CHECK
    ADD CONSTRAINT [FK_observaciones_referencia_id] FOREIGN KEY ([referencia_id])
    REFERENCES [calidad].[Referencias] ([id]) ON DELETE CASCADE;
ALTER TABLE [calidad].[recomendaciones] WITH CHECK
    ADD CONSTRAINT [FK_recomendaciones_usuario_id] FOREIGN KEY ([usuario_id])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[recomendaciones] WITH CHECK
    ADD CONSTRAINT [FK_recomendaciones_eliminada_por] FOREIGN KEY ([eliminada_por])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[elec_config_cableado] WITH CHECK
    ADD CONSTRAINT [FK_elec_config_cableado_forma_cableado] FOREIGN KEY ([forma_cableado])
    REFERENCES [calidad].[elec_fotos_cableado] ([forma_cableado]);
ALTER TABLE [calidad].[elec_config_cableado] WITH CHECK
    ADD CONSTRAINT [FK_elec_config_cableado_version_id] FOREIGN KEY ([version_id])
    REFERENCES [calidad].[Versiones] ([id]) ON DELETE CASCADE;
ALTER TABLE [calidad].[elec_mediciones] WITH CHECK
    ADD CONSTRAINT [FK_elec_mediciones_version_id] FOREIGN KEY ([version_id])
    REFERENCES [calidad].[Versiones] ([id]) ON DELETE CASCADE;
ALTER TABLE [calidad].[elec_rangos_revision] WITH CHECK
    ADD CONSTRAINT [FK_elec_rangos_revision_version_id] FOREIGN KEY ([version_id])
    REFERENCES [calidad].[Versiones] ([id]) ON DELETE CASCADE;
-- Nueva: 100 % de coincidencia en los datos actuales
ALTER TABLE [calidad].[Versiones] WITH CHECK
    ADD CONSTRAINT [FK_Versiones_referencia_id] FOREIGN KEY ([referencia_id])
    REFERENCES [calidad].[Referencias] ([id]);

/* ---------- Metrología de moldes ---------- */
ALTER TABLE [calidad].[moldes_referencias] WITH CHECK
    ADD CONSTRAINT [FK_moldes_referencias_creado_por] FOREIGN KEY ([creado_por])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[moldes_versiones] WITH CHECK
    ADD CONSTRAINT [FK_moldes_versiones_creado_por] FOREIGN KEY ([creado_por])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[moldes_versiones] WITH CHECK
    ADD CONSTRAINT [FK_moldes_versiones_referencia_id] FOREIGN KEY ([referencia_id])
    REFERENCES [calidad].[moldes_referencias] ([id]) ON DELETE CASCADE;
ALTER TABLE [calidad].[moldes_cotas] WITH CHECK
    ADD CONSTRAINT [FK_moldes_cotas_referencia_id] FOREIGN KEY ([referencia_id])
    REFERENCES [calidad].[moldes_referencias] ([id]) ON DELETE CASCADE;
ALTER TABLE [calidad].[moldes_inspecciones] WITH CHECK
    ADD CONSTRAINT [FK_moldes_inspecciones_creado_por] FOREIGN KEY ([creado_por])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[moldes_inspecciones] WITH CHECK
    ADD CONSTRAINT [FK_moldes_inspecciones_referencia_id] FOREIGN KEY ([referencia_id])
    REFERENCES [calidad].[moldes_referencias] ([id]) ON DELETE CASCADE;
ALTER TABLE [calidad].[moldes_medidas_detalle] WITH CHECK
    ADD CONSTRAINT [FK_moldes_medidas_detalle_cota_id] FOREIGN KEY ([cota_id])
    REFERENCES [calidad].[moldes_cotas] ([id]);
ALTER TABLE [calidad].[moldes_medidas_detalle] WITH CHECK
    ADD CONSTRAINT [FK_moldes_medidas_detalle_inspeccion_id] FOREIGN KEY ([inspeccion_id])
    REFERENCES [calidad].[moldes_inspecciones] ([id]) ON DELETE CASCADE;

/* ---------- Inspección ISO 2859 ---------- */
ALTER TABLE [calidad].[iso_referencias] WITH CHECK
    ADD CONSTRAINT [FK_iso_referencias_tipo_producto] FOREIGN KEY ([tipo_producto])
    REFERENCES [calidad].[iso_planes_muestreo] ([producto]);
ALTER TABLE [calidad].[iso_lotes] WITH CHECK
    ADD CONSTRAINT [FK_iso_lotes_id_revision] FOREIGN KEY ([id_revision])
    REFERENCES [calidad].[iso_revisiones] ([id_revision]);
ALTER TABLE [calidad].[iso_lotes] WITH CHECK
    ADD CONSTRAINT [FK_iso_lotes_referencia] FOREIGN KEY ([referencia])
    REFERENCES [calidad].[iso_referencias] ([nombre]);
ALTER TABLE [calidad].[iso_muestreos] WITH CHECK
    ADD CONSTRAINT [FK_iso_muestreos_id_lote] FOREIGN KEY ([id_lote])
    REFERENCES [calidad].[iso_lotes] ([id_lote]);
ALTER TABLE [calidad].[iso_defectos_encontrados] WITH CHECK
    ADD CONSTRAINT [FK_iso_defectos_encontrados_codigo_defecto] FOREIGN KEY ([codigo_defecto])
    REFERENCES [calidad].[iso_tipificacion_defectos] ([codigo]);
ALTER TABLE [calidad].[iso_defectos_encontrados] WITH CHECK
    ADD CONSTRAINT [FK_iso_defectos_encontrados_id_muestreo] FOREIGN KEY ([id_muestreo])
    REFERENCES [calidad].[iso_muestreos] ([id_muestreo]);

/* ---------- Problemas y causa raíz ---------- */
ALTER TABLE [calidad].[problemas] WITH CHECK
    ADD CONSTRAINT [FK_problemas_autor_id] FOREIGN KEY ([autor_id])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[problemas] WITH CHECK
    ADD CONSTRAINT [FK_problemas_defecto_id] FOREIGN KEY ([defecto_id])
    REFERENCES [calidad].[iso_tipificacion_defectos] ([id]);
ALTER TABLE [calidad].[problemas] WITH CHECK
    ADD CONSTRAINT [FK_problemas_area_origen_id] FOREIGN KEY ([area_origen_id])
    REFERENCES [calidad].[iso_areas] ([id]);
ALTER TABLE [calidad].[problemas_adjuntos] WITH CHECK
    ADD CONSTRAINT [FK_problemas_adjuntos_autor_id] FOREIGN KEY ([autor_id])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[problemas_adjuntos] WITH CHECK
    ADD CONSTRAINT [FK_problemas_adjuntos_problema_id] FOREIGN KEY ([problema_id])
    REFERENCES [calidad].[problemas] ([id]);
ALTER TABLE [calidad].[causas_raiz] WITH CHECK
    ADD CONSTRAINT [FK_causas_raiz_responsable_id] FOREIGN KEY ([responsable_id])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[causas_raiz] WITH CHECK
    ADD CONSTRAINT [FK_causas_raiz_autor_id] FOREIGN KEY ([autor_id])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[causas_raiz] WITH CHECK
    ADD CONSTRAINT [FK_causas_raiz_causa_catalogo_id] FOREIGN KEY ([causa_catalogo_id])
    REFERENCES [calidad].[trazabilidad_catalogo_causas] ([id]);
ALTER TABLE [calidad].[causas_raiz] WITH CHECK
    ADD CONSTRAINT [FK_causas_raiz_problema_id] FOREIGN KEY ([problema_id])
    REFERENCES [calidad].[problemas] ([id]);
ALTER TABLE [calidad].[medidas] WITH CHECK
    ADD CONSTRAINT [FK_medidas_responsable_id] FOREIGN KEY ([responsable_id])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[medidas] WITH CHECK
    ADD CONSTRAINT [FK_medidas_autor_id] FOREIGN KEY ([autor_id])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[medidas] WITH CHECK
    ADD CONSTRAINT [FK_medidas_causa_id] FOREIGN KEY ([causa_id])
    REFERENCES [calidad].[causas_raiz] ([id]);
ALTER TABLE [calidad].[trazabilidad_catalogo_causas] WITH CHECK
    ADD CONSTRAINT [FK_trazabilidad_catalogo_causas_defecto_id] FOREIGN KEY ([defecto_id])
    REFERENCES [calidad].[iso_tipificacion_defectos] ([id]);
ALTER TABLE [calidad].[trazabilidad_catalogo_medidas] WITH CHECK
    ADD CONSTRAINT [FK_trazabilidad_catalogo_medidas_causa_catalogo_id] FOREIGN KEY ([causa_catalogo_id])
    REFERENCES [calidad].[trazabilidad_catalogo_causas] ([id]);
ALTER TABLE [calidad].[trazabilidad_problemas] WITH CHECK
    ADD CONSTRAINT [FK_trazabilidad_problemas_creado_por] FOREIGN KEY ([creado_por])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[trazabilidad_causas] WITH CHECK
    ADD CONSTRAINT [FK_trazabilidad_causas_autor_id] FOREIGN KEY ([autor_id])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[trazabilidad_causas] WITH CHECK
    ADD CONSTRAINT [FK_trazabilidad_causas_causa_catalogo_id] FOREIGN KEY ([causa_catalogo_id])
    REFERENCES [calidad].[trazabilidad_catalogo_causas] ([id]);
ALTER TABLE [calidad].[trazabilidad_causas] WITH CHECK
    ADD CONSTRAINT [FK_trazabilidad_causas_responsable_id] FOREIGN KEY ([responsable_id])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[trazabilidad_causas] WITH CHECK
    ADD CONSTRAINT [FK_trazabilidad_causas_problema_id] FOREIGN KEY ([problema_id])
    REFERENCES [calidad].[trazabilidad_problemas] ([id]);
ALTER TABLE [calidad].[trazabilidad_medidas] WITH CHECK
    ADD CONSTRAINT [FK_trazabilidad_medidas_autor_id] FOREIGN KEY ([autor_id])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[trazabilidad_medidas] WITH CHECK
    ADD CONSTRAINT [FK_trazabilidad_medidas_causa_id] FOREIGN KEY ([causa_id])
    REFERENCES [calidad].[trazabilidad_causas] ([id]);
ALTER TABLE [calidad].[trazabilidad_medidas] WITH CHECK
    ADD CONSTRAINT [FK_trazabilidad_medidas_responsable_id] FOREIGN KEY ([responsable_id])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[trazabilidad_medidas] WITH CHECK
    ADD CONSTRAINT [FK_trazabilidad_medidas_problema_id] FOREIGN KEY ([problema_id])
    REFERENCES [calidad].[trazabilidad_problemas] ([id]);

/* ---------- Reportes entre áreas ---------- */
ALTER TABLE [calidad].[reportes] WITH CHECK
    ADD CONSTRAINT [FK_reportes_defecto_id] FOREIGN KEY ([defecto_id])
    REFERENCES [calidad].[iso_tipificacion_defectos] ([id]);
ALTER TABLE [calidad].[reportes] WITH CHECK
    ADD CONSTRAINT [FK_reportes_autor_id] FOREIGN KEY ([autor_id])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[reportes] WITH CHECK
    ADD CONSTRAINT [FK_reportes_area_origen_id] FOREIGN KEY ([area_origen_id])
    REFERENCES [calidad].[iso_areas] ([id]);
ALTER TABLE [calidad].[reportes_adjuntos] WITH CHECK
    ADD CONSTRAINT [FK_reportes_adjuntos_autor_id] FOREIGN KEY ([autor_id])
    REFERENCES [calidad].[usuarios] ([id]);
ALTER TABLE [calidad].[reportes_adjuntos] WITH CHECK
    ADD CONSTRAINT [FK_reportes_adjuntos_reporte_id] FOREIGN KEY ([reporte_id])
    REFERENCES [calidad].[reportes] ([id]);
ALTER TABLE [calidad].[reportes_destinos] WITH CHECK
    ADD CONSTRAINT [FK_reportes_destinos_area_id] FOREIGN KEY ([area_id])
    REFERENCES [calidad].[iso_areas] ([id]);
ALTER TABLE [calidad].[reportes_destinos] WITH CHECK
    ADD CONSTRAINT [FK_reportes_destinos_reporte_id] FOREIGN KEY ([reporte_id])
    REFERENCES [calidad].[reportes] ([id]);

/* ---------- Garantías ---------- */
ALTER TABLE [calidad].[garantias] WITH CHECK
    ADD CONSTRAINT [FK_garantias_problema_id] FOREIGN KEY ([problema_id])
    REFERENCES [calidad].[garantias_tipificacion_problemas] ([id]);

/* ---------- Bot de WhatsApp ---------- */
ALTER TABLE [calidad].[whatsapp_numero_permisos] WITH CHECK
    ADD CONSTRAINT [FK_whatsapp_numero_permisos_numero_id] FOREIGN KEY ([numero_id])
    REFERENCES [calidad].[whatsapp_numeros] ([id]) ON DELETE CASCADE;
ALTER TABLE [calidad].[whatsapp_registros] WITH NOCHECK
    ADD CONSTRAINT [FK_whatsapp_registros_area_id] FOREIGN KEY ([area_id])
    REFERENCES [calidad].[iso_areas] ([id]);
ALTER TABLE [calidad].[whatsapp_sesiones_activas] WITH CHECK
    ADD CONSTRAINT [FK_whatsapp_sesiones_activas_area_id] FOREIGN KEY ([area_id])
    REFERENCES [calidad].[iso_areas] ([id]);
-- Nueva: 100 % de coincidencia en los datos actuales
ALTER TABLE [calidad].[whatsapp_registros] WITH CHECK
    ADD CONSTRAINT [FK_whatsapp_registros_telefono] FOREIGN KEY ([telefono])
    REFERENCES [calidad].[whatsapp_numeros] ([telefono]);

COMMIT TRANSACTION;

DECLARE @n INT = (SELECT COUNT(*) FROM sys.foreign_keys WHERE schema_id = SCHEMA_ID(N'calidad'));
PRINT CONCAT(N'Listo: ', @n, N' relaciones creadas en el esquema [calidad].');
