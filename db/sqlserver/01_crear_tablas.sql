/* =====================================================================
   Plast Innova · App de calidad (Circuitos SMD)
   Paso 1 de la migración SQLite -> SQL Server 2022
   ARCHIVO 1 de 2: crea el esquema [calidad] y sus 52 tablas, VACÍAS.

   Qué crea:
     - Esquema [calidad]
     - 52 tablas con llave primaria, valores por defecto, reglas CHECK,
       columnas únicas e índices (los mismos de la base SQLite).
   Qué NO crea todavía:
     - Las relaciones entre tablas (llaves foráneas). Esas van en el
       archivo 2 (02_relaciones.sql), que se ejecuta DESPUÉS de cargar
       los datos, para que la carga no falle por el orden de las tablas.

   Cómo usarlo (en tu SQL Server de práctica):
     1. Crea una base vacía, por ejemplo [ensayo_calidad].
     2. Abre este archivo en SSMS (Archivo -> Abrir -> Archivo).
     3. Arriba, en la lista de bases, elige [ensayo_calidad] (NO master).
     4. Presiona F5. En "Mensajes" debe terminar con: Listo: 52 tablas creadas.
   Si algo falla, no queda nada a medias: todo se deshace solo.

   Decisiones tomadas (ver conversación):
     - Fechas -> DATETIME2(0) (fecha y hora) o DATE (solo fecha).
     - Sí/No -> TINYINT con regla (0 o 1). Se usa TINYINT y no BIT para
       que la app siga recibiendo 0 y 1 como números, igual que hoy.
     - Decimales -> DECIMAL(18,4); los NCA de ISO 2859 -> DECIMAL(6,3).
     - Columnas únicas que aceptan vacíos (NULL) usan un índice único
       filtrado: igual que en SQLite, varios vacíos no chocan entre sí.
     - Los nombres Referencias y Versiones se conservan con mayúscula.
   Generado el 14/10/2026 a partir de db/base_datos.db.
   ===================================================================== */

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @base SYSNAME = DB_NAME();
IF @base IN (N'master', N'model', N'msdb', N'tempdb')
BEGIN
    RAISERROR(N'Estás en la base %s. Elige tu base de ensayo en la lista de arriba y vuelve a ejecutar.', 16, 1, @base);
    RETURN;
END;

IF SCHEMA_ID(N'calidad') IS NOT NULL
   AND EXISTS (SELECT 1 FROM sys.tables WHERE schema_id = SCHEMA_ID(N'calidad'))
BEGIN
    RAISERROR(N'El esquema [calidad] ya tiene tablas en esta base. Este archivo es para una base vacía.', 16, 1);
    RETURN;
END;

BEGIN TRANSACTION;

IF SCHEMA_ID(N'calidad') IS NULL
    EXEC (N'CREATE SCHEMA [calidad];');


/* ---------- Usuarios y permisos ---------- */
CREATE TABLE [calidad].[roles] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [nombre] NVARCHAR(100) NOT NULL,
    [descripcion] NVARCHAR(MAX) NULL,
    [es_sistema] TINYINT NULL CONSTRAINT [DF_roles_es_sistema] DEFAULT (0),
    [created_at] DATETIME2(0) NULL CONSTRAINT [DF_roles_created_at] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_roles] PRIMARY KEY ([id]),
    CONSTRAINT [CK_roles_es_sistema] CHECK ([es_sistema] IN (0, 1)),
    CONSTRAINT [UQ_roles_nombre] UNIQUE ([nombre])
);
CREATE TABLE [calidad].[usuarios] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [nombre] NVARCHAR(255) NOT NULL,
    [usuario] NVARCHAR(100) NOT NULL,
    [contrasena] NVARCHAR(255) NOT NULL,
    [rol_id] INT NULL,
    [created_at] DATETIME2(0) NULL CONSTRAINT [DF_usuarios_created_at] DEFAULT SYSDATETIME(),
    [telefono] NVARCHAR(255) NULL,
    CONSTRAINT [PK_usuarios] PRIMARY KEY ([id]),
    CONSTRAINT [UQ_usuarios_usuario] UNIQUE ([usuario])
);
CREATE TABLE [calidad].[permisos] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [codigo] NVARCHAR(100) NOT NULL,
    [descripcion] NVARCHAR(MAX) NOT NULL,
    CONSTRAINT [PK_permisos] PRIMARY KEY ([id]),
    CONSTRAINT [UQ_permisos_codigo] UNIQUE ([codigo])
);
CREATE TABLE [calidad].[rol_permisos] (
    [rol_id] INT NOT NULL,
    [permiso_id] INT NOT NULL,
    CONSTRAINT [PK_rol_permisos] PRIMARY KEY ([rol_id], [permiso_id])
);
CREATE TABLE [calidad].[registro_cambios] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [modulo] NVARCHAR(255) NOT NULL,
    [entidad] NVARCHAR(100) NOT NULL,
    [entidad_id] NVARCHAR(255) NULL,
    [accion] NVARCHAR(255) NOT NULL,
    [detalle] NVARCHAR(MAX) NULL,
    [hecho_por] INT NULL,
    [hecho_por_nombre] NVARCHAR(255) NULL,
    [fecha] DATETIME2(0) NULL CONSTRAINT [DF_registro_cambios_fecha] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_registro_cambios] PRIMARY KEY ([id]),
    CONSTRAINT [CK_registro_cambios_accion] CHECK ([accion] IN (N'Creación', N'Edición', N'Eliminación'))
);

/* ---------- Circuitos SMD y eléctricos ---------- */
CREATE TABLE [calidad].[Referencias] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [codigo_base] NVARCHAR(255) NOT NULL,
    [creado_por] INT NULL,
    [created_at] DATETIME2(0) NOT NULL CONSTRAINT [DF_Referencias_created_at] DEFAULT SYSDATETIME(),
    [activa] TINYINT NULL CONSTRAINT [DF_Referencias_activa] DEFAULT (1),
    [eliminado_por] INT NULL,
    [eliminado_en] DATETIME2(0) NULL,
    CONSTRAINT [PK_Referencias] PRIMARY KEY ([id]),
    CONSTRAINT [CK_Referencias_activa] CHECK ([activa] IN (0, 1))
);
CREATE TABLE [calidad].[Versiones] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [referencia_id] INT NOT NULL,
    [version] NVARCHAR(255) NOT NULL,
    [imagen_ruta] NVARCHAR(500) NOT NULL,
    [estado] NVARCHAR(255) NOT NULL,
    [creado_por] INT NOT NULL,
    [created_at] DATETIME2(0) NOT NULL,
    [necesita_prueba] TINYINT NULL CONSTRAINT [DF_Versiones_necesita_prueba] DEFAULT (0),
    CONSTRAINT [PK_Versiones] PRIMARY KEY ([id]),
    CONSTRAINT [CK_Versiones_necesita_prueba] CHECK ([necesita_prueba] IN (0, 1)),
    CONSTRAINT [CK_Versiones_estado] CHECK ([estado] IN (N'activa', N'obsoleta'))
);
CREATE TABLE [calidad].[observaciones] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [referencia_id] INT NOT NULL,
    [observacion] NVARCHAR(MAX) NULL,
    [actualizado_por] INT NULL,
    [actualizado_en] DATETIME2(0) NULL,
    CONSTRAINT [PK_observaciones] PRIMARY KEY ([id]),
    CONSTRAINT [UQ_observaciones_referencia_id] UNIQUE ([referencia_id])
);
CREATE TABLE [calidad].[recomendaciones] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [referencia] NVARCHAR(255) NOT NULL,
    [recomendacion] NVARCHAR(MAX) NOT NULL,
    [usuario_id] INT NULL,
    [usuario_nombre] NVARCHAR(255) NULL,
    [fecha_creacion] DATETIME2(0) NULL CONSTRAINT [DF_recomendaciones_fecha_creacion] DEFAULT SYSDATETIME(),
    [eliminada] TINYINT NULL CONSTRAINT [DF_recomendaciones_eliminada] DEFAULT (0),
    [eliminada_por] INT NULL,
    [fecha_eliminacion] DATETIME2(0) NULL,
    CONSTRAINT [PK_recomendaciones] PRIMARY KEY ([id]),
    CONSTRAINT [CK_recomendaciones_eliminada] CHECK ([eliminada] IN (0, 1))
);
CREATE TABLE [calidad].[elec_fotos_cableado] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [forma_cableado] NVARCHAR(100) NOT NULL,
    [url_foto] NVARCHAR(500) NOT NULL,
    CONSTRAINT [PK_elec_fotos_cableado] PRIMARY KEY ([id]),
    CONSTRAINT [UQ_elec_fotos_cableado_forma_cableado] UNIQUE ([forma_cableado])
);
CREATE TABLE [calidad].[elec_config_cableado] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [version_id] INT NOT NULL,
    [cortar_puntas] TINYINT NULL CONSTRAINT [DF_elec_config_cableado_cortar_puntas] DEFAULT (0),
    [posicion_punto] NVARCHAR(255) NULL,
    [empujar_cables] TINYINT NULL CONSTRAINT [DF_elec_config_cableado_empujar_cables] DEFAULT (0),
    [forma_cableado] NVARCHAR(100) NULL,
    [referencia_cable] NVARCHAR(255) NULL,
    [no_aplica_medias] TINYINT NULL CONSTRAINT [DF_elec_config_cableado_no_aplica_medias] DEFAULT (0),
    CONSTRAINT [PK_elec_config_cableado] PRIMARY KEY ([id]),
    CONSTRAINT [CK_elec_config_cableado_cortar_puntas] CHECK ([cortar_puntas] IN (0, 1)),
    CONSTRAINT [CK_elec_config_cableado_empujar_cables] CHECK ([empujar_cables] IN (0, 1)),
    CONSTRAINT [CK_elec_config_cableado_no_aplica_medias] CHECK ([no_aplica_medias] IN (0, 1)),
    CONSTRAINT [UQ_elec_config_cableado_version_id] UNIQUE ([version_id])
);
CREATE TABLE [calidad].[elec_mediciones] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [version_id] INT NOT NULL,
    [voltaje_revision] NVARCHAR(255) NULL,
    [amperaje_medias] NVARCHAR(255) NULL,
    [amperaje_altas] NVARCHAR(255) NULL,
    [potencia_medias] NVARCHAR(255) NULL,
    [potencia_altas] NVARCHAR(255) NULL,
    CONSTRAINT [PK_elec_mediciones] PRIMARY KEY ([id]),
    CONSTRAINT [UQ_elec_mediciones_version_id] UNIQUE ([version_id])
);
CREATE TABLE [calidad].[elec_rangos_revision] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [version_id] INT NOT NULL,
    [voltaje_min] NVARCHAR(255) NULL,
    [voltaje_max] NVARCHAR(255) NULL,
    [amperaje_min_bajas] NVARCHAR(255) NULL,
    [amperaje_min_altas] NVARCHAR(255) NULL,
    [amperaje_max] NVARCHAR(255) NULL,
    [potencia_min_bajas] NVARCHAR(255) NULL,
    [potencia_min_altas] NVARCHAR(255) NULL,
    [potencia_max] NVARCHAR(255) NULL,
    CONSTRAINT [PK_elec_rangos_revision] PRIMARY KEY ([id]),
    CONSTRAINT [UQ_elec_rangos_revision_version_id] UNIQUE ([version_id])
);

/* ---------- Metrología de moldes ---------- */
CREATE TABLE [calidad].[moldes_referencias] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [codigo_base] NVARCHAR(100) NOT NULL,
    [creado_por] INT NULL,
    [created_at] DATETIME2(0) NULL CONSTRAINT [DF_moldes_referencias_created_at] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_moldes_referencias] PRIMARY KEY ([id]),
    CONSTRAINT [UQ_moldes_referencias_codigo_base] UNIQUE ([codigo_base])
);
CREATE TABLE [calidad].[moldes_versiones] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [referencia_id] INT NOT NULL,
    [version] NVARCHAR(255) NOT NULL,
    [archivo_ruta] NVARCHAR(500) NULL,
    [estado] NVARCHAR(255) NULL CONSTRAINT [DF_moldes_versiones_estado] DEFAULT N'activa',
    [creado_por] INT NULL,
    [created_at] DATETIME2(0) NULL CONSTRAINT [DF_moldes_versiones_created_at] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_moldes_versiones] PRIMARY KEY ([id]),
    CONSTRAINT [CK_moldes_versiones_estado] CHECK ([estado] IN (N'activa', N'obsoleta'))
);
CREATE TABLE [calidad].[moldes_cotas] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [referencia_id] INT NOT NULL,
    [cota] NVARCHAR(255) NOT NULL,
    [medida_estandar] DECIMAL(18,4) NOT NULL,
    [tolerancia] DECIMAL(18,4) NOT NULL,
    [tolerancia_maxima] DECIMAL(18,4) NOT NULL,
    [tolerancia_minima] DECIMAL(18,4) NOT NULL,
    CONSTRAINT [PK_moldes_cotas] PRIMARY KEY ([id])
);
CREATE TABLE [calidad].[moldes_inspecciones] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [referencia_id] INT NOT NULL,
    [fecha] DATE NOT NULL,
    [responsable] NVARCHAR(255) NOT NULL,
    [lote] NVARCHAR(255) NULL,
    [molde] NVARCHAR(255) NULL,
    [imagen_evidencia] NVARCHAR(500) NULL,
    [creado_por] INT NULL,
    [created_at] DATETIME2(0) NULL CONSTRAINT [DF_moldes_inspecciones_created_at] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_moldes_inspecciones] PRIMARY KEY ([id])
);
CREATE TABLE [calidad].[moldes_medidas_detalle] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [inspeccion_id] INT NOT NULL,
    [cota_id] INT NOT NULL,
    [medida_real] DECIMAL(18,4) NOT NULL,
    [estado] NVARCHAR(255) NOT NULL,
    [imagen_evidencia] NVARCHAR(500) NULL,
    CONSTRAINT [PK_moldes_medidas_detalle] PRIMARY KEY ([id]),
    CONSTRAINT [CK_moldes_medidas_detalle_estado] CHECK ([estado] IN (N'CONFORME', N'FUERA DE TOLERANCIA'))
);

/* ---------- Inspección ISO 2859 ---------- */
CREATE TABLE [calidad].[iso_planes_muestreo] (
    [producto] NVARCHAR(100) NOT NULL,
    [nivel_inspeccion] NVARCHAR(255) NOT NULL,
    [nca_mayores] DECIMAL(6,3) NOT NULL,
    [nca_menores] DECIMAL(6,3) NOT NULL,
    [nca_criticos] DECIMAL(6,3) NOT NULL,
    CONSTRAINT [PK_iso_planes_muestreo] PRIMARY KEY ([producto])
);
CREATE TABLE [calidad].[iso_referencias] (
    [nombre] NVARCHAR(100) NOT NULL,
    [tipo_producto] NVARCHAR(100) NOT NULL,
    [estado] NVARCHAR(255) NULL CONSTRAINT [DF_iso_referencias_estado] DEFAULT N'Activo',
    CONSTRAINT [PK_iso_referencias] PRIMARY KEY ([nombre])
);
CREATE TABLE [calidad].[iso_revisiones] (
    [id_revision] INT IDENTITY(1,1) NOT NULL,
    [numero_revision] NVARCHAR(100) NOT NULL,
    [referencia] NVARCHAR(255) NOT NULL,
    [cantidad_programada] INT NULL,
    [maquina] NVARCHAR(255) NULL,
    [fecha_inicio] DATETIME2(0) NULL CONSTRAINT [DF_iso_revisiones_fecha_inicio] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_iso_revisiones] PRIMARY KEY ([id_revision]),
    CONSTRAINT [UQ_iso_revisiones_numero_revision] UNIQUE ([numero_revision])
);
CREATE TABLE [calidad].[iso_lotes] (
    [id_lote] NVARCHAR(100) NOT NULL,
    [referencia] NVARCHAR(100) NOT NULL,
    [modulo] NVARCHAR(100) NOT NULL,
    [cantidad_total] INT NOT NULL,
    [metodo_en_proceso] NVARCHAR(255) NULL,
    [fecha_creacion] DATETIME2(0) NULL CONSTRAINT [DF_iso_lotes_fecha_creacion] DEFAULT SYSDATETIME(),
    [estado_final] NVARCHAR(255) NULL CONSTRAINT [DF_iso_lotes_estado_final] DEFAULT N'Pendiente',
    [plan_actual] NVARCHAR(255) NULL CONSTRAINT [DF_iso_lotes_plan_actual] DEFAULT N'Normal',
    [id_revision] INT NULL,
    [proveedor] NVARCHAR(255) NULL,
    [oc_factura] NVARCHAR(255) NULL,
    [maquina] NVARCHAR(255) NULL,
    [cierre_tipo] NVARCHAR(255) NULL,
    [cierre_motivo] NVARCHAR(255) NULL,
    [cerrado_por] NVARCHAR(255) NULL,
    [fecha_cierre] DATETIME2(0) NULL,
    CONSTRAINT [PK_iso_lotes] PRIMARY KEY ([id_lote]),
    CONSTRAINT [CK_iso_lotes_modulo] CHECK ([modulo] IN (N'Recepcion', N'Produccion')),
    CONSTRAINT [CK_iso_lotes_estado_final] CHECK ([estado_final] IN (N'Pendiente', N'Aceptado', N'Aceptado_con_obs', N'Rechazado', N'Cerrado_sin_auditoria', N'Reclasificado', N'Reparacion')),
    CONSTRAINT [CK_iso_lotes_cierre_tipo] CHECK ([cierre_tipo] IN (N'automatico', N'manual'))
);
CREATE TABLE [calidad].[iso_muestreos] (
    [id_muestreo] INT IDENTITY(1,1) NOT NULL,
    [id_lote] NVARCHAR(100) NOT NULL,
    [tipo] NVARCHAR(255) NOT NULL,
    [fecha_hora] DATETIME2(0) NULL CONSTRAINT [DF_iso_muestreos_fecha_hora] DEFAULT SYSDATETIME(),
    [analista] NVARCHAR(255) NOT NULL,
    [cantidad_muestreada] INT NOT NULL,
    [decision] NVARCHAR(255) NOT NULL,
    [observaciones] NVARCHAR(MAX) NULL,
    [turno] NVARCHAR(255) NULL,
    [area] NVARCHAR(255) NULL,
    [operario] NVARCHAR(255) NULL,
    [piezas_reclasificadas] INT NULL CONSTRAINT [DF_iso_muestreos_piezas_reclasificadas] DEFAULT (0),
    [piezas_reparadas] INT NULL CONSTRAINT [DF_iso_muestreos_piezas_reparadas] DEFAULT (0),
    [piezas_rechazadas] INT NULL CONSTRAINT [DF_iso_muestreos_piezas_rechazadas] DEFAULT (0),
    CONSTRAINT [PK_iso_muestreos] PRIMARY KEY ([id_muestreo]),
    CONSTRAINT [CK_iso_muestreos_tipo] CHECK ([tipo] IN (N'Primera_Pieza', N'En_Proceso', N'Final'))
);
CREATE TABLE [calidad].[iso_tipificacion_defectos] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [codigo] NVARCHAR(100) NOT NULL,
    [area] NVARCHAR(255) NOT NULL,
    [descripcion] NVARCHAR(MAX) NULL,
    [estado] NVARCHAR(255) NULL,
    [severidad] NVARCHAR(255) NULL CONSTRAINT [DF_iso_tipificacion_defectos_severidad] DEFAULT N'Menor',
    CONSTRAINT [PK_iso_tipificacion_defectos] PRIMARY KEY ([id]),
    CONSTRAINT [CK_iso_tipificacion_defectos_severidad] CHECK ([severidad] IN (N'Crítico', N'Mayor', N'Menor')),
    CONSTRAINT [UQ_iso_tipificacion_defectos_codigo] UNIQUE ([codigo])
);
CREATE TABLE [calidad].[iso_defectos_encontrados] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [id_muestreo] INT NOT NULL,
    [codigo_defecto] NVARCHAR(100) NOT NULL,
    [cantidad] INT NOT NULL CONSTRAINT [DF_iso_defectos_encontrados_cantidad] DEFAULT (1),
    CONSTRAINT [PK_iso_defectos_encontrados] PRIMARY KEY ([id])
);
CREATE TABLE [calidad].[iso_areas] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [nombre] NVARCHAR(255) NOT NULL,
    [modulo] NVARCHAR(255) NOT NULL,
    [estado] NVARCHAR(255) NULL CONSTRAINT [DF_iso_areas_estado] DEFAULT N'Activo',
    [encargado] NVARCHAR(255) NULL,
    CONSTRAINT [PK_iso_areas] PRIMARY KEY ([id]),
    CONSTRAINT [CK_iso_areas_modulo] CHECK ([modulo] IN (N'Recepcion', N'Produccion', N'Ambos'))
);

/* ---------- Problemas y causa raíz ---------- */
CREATE TABLE [calidad].[problemas] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [origen] NVARCHAR(100) NOT NULL,
    [fabrica] NVARCHAR(100) NULL,
    [tipo_contexto] NVARCHAR(100) NULL,
    [valor_contexto] NVARCHAR(100) NULL,
    [semana] NVARCHAR(10) NULL,
    [pct_desperdicio_inicial] DECIMAL(18,4) NULL,
    [area_origen_id] INT NULL,
    [referencia] NVARCHAR(255) NULL,
    [lote] NVARCHAR(255) NULL,
    [defecto_id] INT NULL,
    [descripcion] NVARCHAR(MAX) NULL,
    [criticidad] NVARCHAR(100) NOT NULL CONSTRAINT [DF_problemas_criticidad] DEFAULT N'Media',
    [estado] NVARCHAR(100) NOT NULL CONSTRAINT [DF_problemas_estado] DEFAULT N'Pendiente',
    [autor_id] INT NULL,
    [autor_nombre] NVARCHAR(255) NULL,
    [creado_en] DATETIME2(0) NULL CONSTRAINT [DF_problemas_creado_en] DEFAULT SYSDATETIME(),
    [actualizado_en] DATETIME2(0) NULL CONSTRAINT [DF_problemas_actualizado_en] DEFAULT SYSDATETIME(),
    [cerrado_en] DATETIME2(0) NULL,
    [cantidad_total] DECIMAL(18,4) NULL,
    [cantidad_afectada] DECIMAL(18,4) NULL,
    [tratamiento] NVARCHAR(MAX) NULL,
    [chk_falla_funcional] NVARCHAR(MAX) NULL,
    [chk_problema_visual] NVARCHAR(MAX) NULL,
    [chk_retraso_tiempo] NVARCHAR(MAX) NULL,
    [chk_fuera_tolerancias] NVARCHAR(MAX) NULL,
    [prevencion] NVARCHAR(MAX) NULL,
    [firma_implicados_nombre] NVARCHAR(255) NULL,
    [firma_implicados_fecha] DATETIME2(0) NULL,
    [es_aviso_rapido] TINYINT NULL CONSTRAINT [DF_problemas_es_aviso_rapido] DEFAULT (0),
    [aviso_rapido_origen] INT NULL CONSTRAINT [DF_problemas_aviso_rapido_origen] DEFAULT (0),
    CONSTRAINT [PK_problemas] PRIMARY KEY ([id]),
    CONSTRAINT [CK_problemas_es_aviso_rapido] CHECK ([es_aviso_rapido] IN (0, 1)),
    CONSTRAINT [CK_problemas_origen] CHECK ([origen] IN (N'produccion', N'reporte', N'general')),
    CONSTRAINT [CK_problemas_tipo_contexto] CHECK ([tipo_contexto] IN (N'referencia', N'motivo')),
    CONSTRAINT [CK_problemas_criticidad] CHECK ([criticidad] IN (N'Baja', N'Media', N'Alta')),
    CONSTRAINT [CK_problemas_estado] CHECK ([estado] IN (N'Pendiente', N'En_Proceso', N'Implementado', N'Descartado'))
);
CREATE TABLE [calidad].[problemas_adjuntos] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [problema_id] INT NOT NULL,
    [archivo] NVARCHAR(500) NOT NULL,
    [nombre_original] NVARCHAR(255) NULL,
    [autor_id] INT NULL,
    [autor_nombre] NVARCHAR(255) NULL,
    [fecha] DATETIME2(0) NULL CONSTRAINT [DF_problemas_adjuntos_fecha] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_problemas_adjuntos] PRIMARY KEY ([id])
);
CREATE TABLE [calidad].[causas_raiz] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [problema_id] INT NOT NULL,
    [texto] NVARCHAR(MAX) NOT NULL,
    [causa_catalogo_id] INT NULL,
    [autor_id] INT NULL,
    [autor_nombre] NVARCHAR(255) NULL,
    [responsable_id] INT NULL,
    [responsable_nombre] NVARCHAR(255) NULL,
    [fecha] DATETIME2(0) NULL CONSTRAINT [DF_causas_raiz_fecha] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_causas_raiz] PRIMARY KEY ([id])
);
CREATE TABLE [calidad].[medidas] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [causa_id] INT NOT NULL,
    [texto] NVARCHAR(MAX) NOT NULL,
    [estado] NVARCHAR(255) NOT NULL CONSTRAINT [DF_medidas_estado] DEFAULT N'En_Proceso',
    [autor_id] INT NULL,
    [autor_nombre] NVARCHAR(255) NULL,
    [responsable_id] INT NULL,
    [responsable_nombre] NVARCHAR(255) NULL,
    [creado_en] DATETIME2(0) NULL CONSTRAINT [DF_medidas_creado_en] DEFAULT SYSDATETIME(),
    [actualizado_en] DATETIME2(0) NULL CONSTRAINT [DF_medidas_actualizado_en] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_medidas] PRIMARY KEY ([id]),
    CONSTRAINT [CK_medidas_estado] CHECK ([estado] IN (N'En_Proceso', N'Funciono', N'No_Funciono'))
);
CREATE TABLE [calidad].[trazabilidad_catalogo_causas] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [texto] NVARCHAR(MAX) NOT NULL,
    [activo] NVARCHAR(255) NOT NULL CONSTRAINT [DF_trazabilidad_catalogo_causas_activo] DEFAULT N'Activo',
    [creado_en] DATETIME2(0) NULL CONSTRAINT [DF_trazabilidad_catalogo_causas_creado_en] DEFAULT SYSDATETIME(),
    [defecto_id] INT NULL,
    CONSTRAINT [PK_trazabilidad_catalogo_causas] PRIMARY KEY ([id]),
    CONSTRAINT [CK_trazabilidad_catalogo_causas_activo] CHECK ([activo] IN (N'Activo', N'Inactivo'))
);
CREATE TABLE [calidad].[trazabilidad_catalogo_medidas] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [causa_catalogo_id] INT NOT NULL,
    [texto] NVARCHAR(MAX) NOT NULL,
    [activo] NVARCHAR(255) NOT NULL CONSTRAINT [DF_trazabilidad_catalogo_medidas_activo] DEFAULT N'Activo',
    [creado_en] DATETIME2(0) NULL CONSTRAINT [DF_trazabilidad_catalogo_medidas_creado_en] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_trazabilidad_catalogo_medidas] PRIMARY KEY ([id]),
    CONSTRAINT [CK_trazabilidad_catalogo_medidas_activo] CHECK ([activo] IN (N'Activo', N'Inactivo'))
);
CREATE TABLE [calidad].[trazabilidad_problemas] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [fabrica] NVARCHAR(100) NOT NULL,
    [tipo_contexto] NVARCHAR(100) NOT NULL,
    [valor_contexto] NVARCHAR(100) NOT NULL,
    [semana] NVARCHAR(10) NOT NULL,
    [pct_desperdicio_inicial] DECIMAL(18,4) NULL,
    [causa_raiz] NVARCHAR(MAX) NULL,
    [solucion] NVARCHAR(MAX) NULL,
    [responsable] NVARCHAR(255) NULL,
    [estado] NVARCHAR(100) NOT NULL CONSTRAINT [DF_trazabilidad_problemas_estado] DEFAULT N'Pendiente',
    [creado_por] INT NULL,
    [creado_por_nombre] NVARCHAR(255) NULL,
    [created_at] DATETIME2(0) NULL CONSTRAINT [DF_trazabilidad_problemas_created_at] DEFAULT SYSDATETIME(),
    [actualizado_en] DATETIME2(0) NULL CONSTRAINT [DF_trazabilidad_problemas_actualizado_en] DEFAULT SYSDATETIME(),
    [cerrado_en] DATETIME2(0) NULL,
    CONSTRAINT [PK_trazabilidad_problemas] PRIMARY KEY ([id]),
    CONSTRAINT [CK_trazabilidad_problemas_tipo_contexto] CHECK ([tipo_contexto] IN (N'referencia', N'motivo')),
    CONSTRAINT [CK_trazabilidad_problemas_estado] CHECK ([estado] IN (N'Pendiente', N'En_Proceso', N'Implementado'))
);
CREATE TABLE [calidad].[trazabilidad_causas] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [problema_id] INT NOT NULL,
    [texto] NVARCHAR(MAX) NOT NULL,
    [autor_id] INT NULL,
    [autor_nombre] NVARCHAR(255) NULL,
    [fecha] DATETIME2(0) NULL CONSTRAINT [DF_trazabilidad_causas_fecha] DEFAULT SYSDATETIME(),
    [responsable_id] INT NULL,
    [responsable_nombre] NVARCHAR(255) NULL,
    [causa_catalogo_id] INT NULL,
    CONSTRAINT [PK_trazabilidad_causas] PRIMARY KEY ([id])
);
CREATE TABLE [calidad].[trazabilidad_medidas] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [problema_id] INT NOT NULL,
    [texto] NVARCHAR(MAX) NOT NULL,
    [estado] NVARCHAR(255) NOT NULL CONSTRAINT [DF_trazabilidad_medidas_estado] DEFAULT N'En_Proceso',
    [autor_id] INT NULL,
    [autor_nombre] NVARCHAR(255) NULL,
    [creado_en] DATETIME2(0) NULL CONSTRAINT [DF_trazabilidad_medidas_creado_en] DEFAULT SYSDATETIME(),
    [actualizado_en] DATETIME2(0) NULL CONSTRAINT [DF_trazabilidad_medidas_actualizado_en] DEFAULT SYSDATETIME(),
    [responsable_id] INT NULL,
    [responsable_nombre] NVARCHAR(255) NULL,
    [causa_id] INT NULL,
    CONSTRAINT [PK_trazabilidad_medidas] PRIMARY KEY ([id]),
    CONSTRAINT [CK_trazabilidad_medidas_estado] CHECK ([estado] IN (N'En_Proceso', N'Funciono', N'No_Funciono'))
);

/* ---------- Reportes entre áreas ---------- */
CREATE TABLE [calidad].[reportes] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [tipo] NVARCHAR(100) NOT NULL,
    [area_origen_id] INT NULL,
    [referencia] NVARCHAR(255) NULL,
    [lote] NVARCHAR(255) NULL,
    [urgencia] NVARCHAR(255) NULL,
    [titulo] NVARCHAR(255) NULL,
    [descripcion] NVARCHAR(MAX) NULL,
    [estado] NVARCHAR(100) NULL,
    [fecha_vigencia] DATE NULL,
    [autor_id] INT NULL,
    [autor_nombre] NVARCHAR(255) NULL,
    [created_at] DATETIME2(0) NULL CONSTRAINT [DF_reportes_created_at] DEFAULT SYSDATETIME(),
    [actualizado_en] DATETIME2(0) NULL CONSTRAINT [DF_reportes_actualizado_en] DEFAULT SYSDATETIME(),
    [defecto_id] INT NULL,
    CONSTRAINT [PK_reportes] PRIMARY KEY ([id]),
    CONSTRAINT [CK_reportes_tipo] CHECK ([tipo] IN (N'rapido', N'completo', N'informativo')),
    CONSTRAINT [CK_reportes_urgencia] CHECK ([urgencia] IN (N'Baja', N'Media', N'Alta', N'Critica')),
    CONSTRAINT [CK_reportes_estado] CHECK ([estado] IN (N'Pendiente', N'Revisado', N'En_Proceso', N'Implementado'))
);
CREATE TABLE [calidad].[reportes_adjuntos] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [reporte_id] INT NOT NULL,
    [archivo] NVARCHAR(500) NOT NULL,
    [nombre_original] NVARCHAR(255) NULL,
    [autor_id] INT NULL,
    [autor_nombre] NVARCHAR(255) NULL,
    [fecha] DATETIME2(0) NULL CONSTRAINT [DF_reportes_adjuntos_fecha] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_reportes_adjuntos] PRIMARY KEY ([id])
);
CREATE TABLE [calidad].[reportes_destinos] (
    [reporte_id] INT NOT NULL,
    [area_id] INT NOT NULL,
    CONSTRAINT [PK_reportes_destinos] PRIMARY KEY ([reporte_id], [area_id])
);

/* ---------- Garantías ---------- */
CREATE TABLE [calidad].[garantias_tipificacion_problemas] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [codigo] NVARCHAR(100) NOT NULL,
    [descripcion] NVARCHAR(MAX) NOT NULL,
    [estado] NVARCHAR(255) NULL CONSTRAINT [DF_garantias_tipificacion_problemas_estado] DEFAULT N'Activo',
    CONSTRAINT [PK_garantias_tipificacion_problemas] PRIMARY KEY ([id]),
    CONSTRAINT [CK_garantias_tipificacion_problemas_estado] CHECK ([estado] IN (N'Activo', N'Inactivo')),
    CONSTRAINT [UQ_garantias_tipificacion_problemas_codigo] UNIQUE ([codigo])
);
CREATE TABLE [calidad].[garantias] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [no_garantia] NVARCHAR(255) NULL,
    [fecha_reporte] DATE NULL,
    [responsable] NVARCHAR(255) NULL,
    [vendedor_distribuidor] NVARCHAR(255) NULL,
    [memorando] NVARCHAR(MAX) NULL,
    [op_pedido] NVARCHAR(255) NULL,
    [cliente] NVARCHAR(255) NULL,
    [nit_cliente] NVARCHAR(255) NULL,
    [ciudad] NVARCHAR(255) NULL,
    [remision] NVARCHAR(255) NULL,
    [referencia] NVARCHAR(255) NULL,
    [cantidad] INT NULL,
    [tipo_solicitud] NVARCHAR(255) NULL,
    [observaciones] NVARCHAR(MAX) NULL,
    [fecha_revision] DATE NULL,
    [estado] NVARCHAR(255) NULL,
    [lote_fecha] NVARCHAR(255) NULL,
    [problema] NVARCHAR(MAX) NULL,
    [quien_aprobo_rechazo] NVARCHAR(255) NULL,
    [observacion_calidad] NVARCHAR(MAX) NULL,
    [tipo_circuito] NVARCHAR(255) NULL,
    [fecha_creacion] DATETIME2(0) NULL,
    [problema_id] INT NULL,
    CONSTRAINT [PK_garantias] PRIMARY KEY ([id])
);
CREATE TABLE [calidad].[clientes] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [nit] NVARCHAR(100) NULL,
    [razon_social] NVARCHAR(255) NULL,
    [codigo_vendedor] NVARCHAR(255) NULL,
    [nombre_vendedor] NVARCHAR(255) NULL,
    [ciudad] NVARCHAR(255) NULL,
    CONSTRAINT [PK_clientes] PRIMARY KEY ([id])
);
CREATE TABLE [calidad].[referencias_pt] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [referencia] NVARCHAR(100) NULL,
    [linea_base] NVARCHAR(255) NULL,
    [tipo_circuito] NVARCHAR(255) NULL,
    CONSTRAINT [PK_referencias_pt] PRIMARY KEY ([id])
);

/* ---------- Producción sincronizada ---------- */
CREATE TABLE [calidad].[lotes] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [no_lote] NVARCHAR(100) NOT NULL,
    [referencia] NVARCHAR(100) NULL,
    [color] NVARCHAR(255) NULL,
    [voltaje] NVARCHAR(20) NULL,
    [codigo] NVARCHAR(MAX) NULL,
    [sincronizado_en] DATETIME2(0) NULL CONSTRAINT [DF_lotes_sincronizado_en] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_lotes] PRIMARY KEY ([id]),
    CONSTRAINT [UQ_lotes_no_lote] UNIQUE ([no_lote])
);
CREATE TABLE [calidad].[entregas_produccion] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [fabrica] NVARCHAR(100) NOT NULL,
    [id_entrega] INT NULL,
    [fecha_entrega] DATETIME2(0) NULL,
    [linea_entrega] NVARCHAR(255) NULL,
    [lote_entrega] NVARCHAR(100) NULL,
    [referencia_entrega] NVARCHAR(150) NULL,
    [operacion_entrega] NVARCHAR(255) NULL,
    [cantidad_buenas] INT NULL,
    [hash_fila] NVARCHAR(100) NULL,
    [sincronizado_en] DATETIME2(0) NULL CONSTRAINT [DF_entregas_produccion_sincronizado_en] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_entregas_produccion] PRIMARY KEY ([id])
);
CREATE TABLE [calidad].[rechazos_produccion] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [fabrica] NVARCHAR(100) NOT NULL,
    [id_rechazo_origen] INT NOT NULL,
    [fecha_rechazo] DATETIME2(0) NULL,
    [linea_org] NVARCHAR(255) NULL,
    [proceso_org] NVARCHAR(255) NULL,
    [linea_rep] NVARCHAR(255) NULL,
    [proceso_rep] NVARCHAR(255) NULL,
    [lote_produccion] NVARCHAR(100) NULL,
    [lote] NVARCHAR(255) NULL,
    [referencia] NVARCHAR(255) NULL,
    [cantidad] INT NULL,
    [motivo] NVARCHAR(100) NULL,
    [observaciones] NVARCHAR(MAX) NULL,
    [sincronizado_en] DATETIME2(0) NULL CONSTRAINT [DF_rechazos_produccion_sincronizado_en] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_rechazos_produccion] PRIMARY KEY ([id]),
    CONSTRAINT [UQ_rechazos_produccion_fabrica_id_rechazo_origen] UNIQUE ([fabrica], [id_rechazo_origen])
);
CREATE TABLE [calidad].[sincronizacion_estado] (
    [id] INT NOT NULL,
    [fallos_consecutivos] INT NOT NULL CONSTRAINT [DF_sincronizacion_estado_fallos_consecutivos] DEFAULT (0),
    [alerta_enviada] TINYINT NOT NULL CONSTRAINT [DF_sincronizacion_estado_alerta_enviada] DEFAULT (0),
    [ultimo_ciclo_exitoso] DATETIME2(0) NULL,
    [ultima_actualizacion] DATETIME2(0) NULL CONSTRAINT [DF_sincronizacion_estado_ultima_actualizacion] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_sincronizacion_estado] PRIMARY KEY ([id]),
    CONSTRAINT [CK_sincronizacion_estado_alerta_enviada] CHECK ([alerta_enviada] IN (0, 1)),
    CONSTRAINT [CK_sincronizacion_estado_id] CHECK ([id] = 1)
);

/* ---------- Bot de WhatsApp ---------- */
CREATE TABLE [calidad].[whatsapp_numeros] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [telefono] NVARCHAR(100) NOT NULL,
    [nombre] NVARCHAR(255) NOT NULL,
    [es_admin] TINYINT NOT NULL CONSTRAINT [DF_whatsapp_numeros_es_admin] DEFAULT (0),
    [activo] TINYINT NOT NULL CONSTRAINT [DF_whatsapp_numeros_activo] DEFAULT (1),
    [creado_en] DATETIME2(0) NULL CONSTRAINT [DF_whatsapp_numeros_creado_en] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_whatsapp_numeros] PRIMARY KEY ([id]),
    CONSTRAINT [CK_whatsapp_numeros_es_admin] CHECK ([es_admin] IN (0, 1)),
    CONSTRAINT [CK_whatsapp_numeros_activo] CHECK ([activo] IN (0, 1)),
    CONSTRAINT [UQ_whatsapp_numeros_telefono] UNIQUE ([telefono])
);
CREATE TABLE [calidad].[whatsapp_numero_permisos] (
    [numero_id] INT NOT NULL,
    [permiso] NVARCHAR(100) NOT NULL,
    CONSTRAINT [PK_whatsapp_numero_permisos] PRIMARY KEY ([numero_id], [permiso])
);
CREATE TABLE [calidad].[whatsapp_registros] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [telefono] NVARCHAR(100) NOT NULL,
    [tipo] NVARCHAR(255) NOT NULL,
    [area_id] INT NULL,
    [area_nombre] NVARCHAR(255) NULL,
    [entrada] NVARCHAR(255) NULL,
    [salida] NVARCHAR(255) NULL,
    [duracion] NVARCHAR(255) NULL,
    [timestamp_entrada] DATETIME2(0) NULL,
    [timestamp_salida] DATETIME2(0) NULL,
    [cerrado_por_admin] TINYINT NULL CONSTRAINT [DF_whatsapp_registros_cerrado_por_admin] DEFAULT (0),
    CONSTRAINT [PK_whatsapp_registros] PRIMARY KEY ([id]),
    CONSTRAINT [CK_whatsapp_registros_cerrado_por_admin] CHECK ([cerrado_por_admin] IN (0, 1))
);
CREATE TABLE [calidad].[whatsapp_sesiones_activas] (
    [telefono] NVARCHAR(100) NOT NULL,
    [area_id] INT NULL,
    [area_nombre] NVARCHAR(255) NULL,
    [entrada] NVARCHAR(255) NULL,
    [entrada_raw] DATETIME2(0) NULL,
    CONSTRAINT [PK_whatsapp_sesiones_activas] PRIMARY KEY ([telefono])
);
CREATE TABLE [calidad].[whatsapp_alertas_config] (
    [tipo] NVARCHAR(100) NOT NULL,
    [activo] TINYINT NOT NULL CONSTRAINT [DF_whatsapp_alertas_config_activo] DEFAULT (1),
    [umbral] INT NULL,
    [ventana_dias] INT NULL,
    [actualizado_en] DATETIME2(0) NULL CONSTRAINT [DF_whatsapp_alertas_config_actualizado_en] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_whatsapp_alertas_config] PRIMARY KEY ([tipo]),
    CONSTRAINT [CK_whatsapp_alertas_config_activo] CHECK ([activo] IN (0, 1))
);
CREATE TABLE [calidad].[whatsapp_alertas_enviadas] (
    [id] INT IDENTITY(1,1) NOT NULL,
    [tipo] NVARCHAR(100) NOT NULL,
    [clave] NVARCHAR(100) NOT NULL,
    [fecha_envio] DATETIME2(0) NULL CONSTRAINT [DF_whatsapp_alertas_enviadas_fecha_envio] DEFAULT SYSDATETIME(),
    CONSTRAINT [PK_whatsapp_alertas_enviadas] PRIMARY KEY ([id]),
    CONSTRAINT [UQ_whatsapp_alertas_enviadas_tipo_clave] UNIQUE ([tipo], [clave])
);

/* ---------- Columnas únicas que aceptan vacíos (índice único filtrado) ---------- */
CREATE UNIQUE INDEX [UQ_clientes_nit] ON [calidad].[clientes] ([nit])
    WHERE [nit] IS NOT NULL;
CREATE UNIQUE INDEX [UQ_entregas_produccion_hash_fila] ON [calidad].[entregas_produccion] ([hash_fila])
    WHERE [hash_fila] IS NOT NULL;
CREATE UNIQUE INDEX [UQ_entregas_produccion_fabrica_id_entrega] ON [calidad].[entregas_produccion] ([fabrica], [id_entrega])
    WHERE [id_entrega] IS NOT NULL;

/* ---------- Índices (los mismos que tiene hoy la base SQLite) ---------- */
CREATE INDEX [idx_ref_pt] ON [calidad].[referencias_pt] ([referencia]);
CREATE INDEX [idx_iso_muestreo_lote] ON [calidad].[iso_muestreos] ([id_lote]);
CREATE INDEX [idx_iso_defecto_muestreo] ON [calidad].[iso_defectos_encontrados] ([id_muestreo]);
CREATE INDEX [idx_iso_muestreos_fecha] ON [calidad].[iso_muestreos] ([fecha_hora]);
CREATE INDEX [idx_registro_cambios_entidad] ON [calidad].[registro_cambios] ([entidad]);
CREATE INDEX [idx_registro_cambios_fecha] ON [calidad].[registro_cambios] ([fecha]);
CREATE INDEX [idx_registro_cambios_usuario] ON [calidad].[registro_cambios] ([hecho_por]);
CREATE INDEX [idx_iso_lotes_referencia] ON [calidad].[iso_lotes] ([referencia]);
CREATE INDEX [idx_iso_lotes_modulo] ON [calidad].[iso_lotes] ([modulo]);
CREATE INDEX [idx_rechazos_fabrica_fecha] ON [calidad].[rechazos_produccion] ([fabrica], [fecha_rechazo]);
CREATE INDEX [idx_rechazos_motivo] ON [calidad].[rechazos_produccion] ([motivo]);
CREATE INDEX [idx_rechazos_lote_produccion] ON [calidad].[rechazos_produccion] ([lote_produccion]);
CREATE INDEX [idx_lotes_referencia] ON [calidad].[lotes] ([referencia]);
CREATE INDEX [idx_entregas_lote] ON [calidad].[entregas_produccion] ([lote_entrega]);
CREATE INDEX [idx_entregas_fabrica_fecha] ON [calidad].[entregas_produccion] ([fabrica], [fecha_entrega]);
CREATE INDEX [idx_entregas_referencia] ON [calidad].[entregas_produccion] ([referencia_entrega]);
CREATE INDEX [idx_trazabilidad_catalogo_medidas_causa] ON [calidad].[trazabilidad_catalogo_medidas] ([causa_catalogo_id]);
CREATE INDEX [idx_reportes_tipo] ON [calidad].[reportes] ([tipo]);
CREATE INDEX [idx_reportes_estado] ON [calidad].[reportes] ([estado]);
CREATE INDEX [idx_reportes_area] ON [calidad].[reportes] ([area_origen_id]);
CREATE INDEX [idx_reportes_adjuntos_reporte] ON [calidad].[reportes_adjuntos] ([reporte_id]);
CREATE INDEX [idx_reportes_destinos_area] ON [calidad].[reportes_destinos] ([area_id]);
CREATE INDEX [idx_trazabilidad_causas_problema] ON [calidad].[trazabilidad_causas] ([problema_id]);
CREATE INDEX [idx_trazabilidad_medidas_problema] ON [calidad].[trazabilidad_medidas] ([problema_id]);
CREATE INDEX [idx_problemas_origen] ON [calidad].[problemas] ([origen]);
CREATE INDEX [idx_problemas_estado] ON [calidad].[problemas] ([estado]);
CREATE INDEX [idx_problemas_criticidad] ON [calidad].[problemas] ([criticidad]);
CREATE INDEX [idx_problemas_contexto] ON [calidad].[problemas] ([fabrica], [tipo_contexto], [valor_contexto]);
CREATE INDEX [idx_causas_raiz_problema] ON [calidad].[causas_raiz] ([problema_id]);
CREATE INDEX [idx_medidas_causa] ON [calidad].[medidas] ([causa_id]);
CREATE INDEX [idx_trazabilidad_contexto] ON [calidad].[trazabilidad_problemas] ([fabrica], [tipo_contexto], [valor_contexto]);
CREATE INDEX [idx_trazabilidad_estado] ON [calidad].[trazabilidad_problemas] ([estado]);
CREATE INDEX [idx_elec_config_forma] ON [calidad].[elec_config_cableado] ([forma_cableado]);
CREATE INDEX [idx_problemas_adjuntos_problema] ON [calidad].[problemas_adjuntos] ([problema_id]);

COMMIT TRANSACTION;

DECLARE @n INT = (SELECT COUNT(*) FROM sys.tables WHERE schema_id = SCHEMA_ID(N'calidad'));
PRINT CONCAT(N'Listo: ', @n, N' tablas creadas en el esquema [calidad].');
