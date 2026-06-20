-- =============================================================================
-- 02_rls.sql — Row Level Security (todas las tablas)
-- =============================================================================
-- Ejecutar DESPUES de schema.sql.
--
-- REGLA DE ORO: negocio_id = get_negocio_id() en TODA operacion, sin excepcion.
-- El superadmin NO tiene bypass de tenant. Cuando opera dentro de un negocio,
-- su JWT contiene ese negocio_id y ve exactamente lo mismo que cualquier ADMIN.
-- Ningun usuario puede ver datos de otro negocio, nunca, bajo ninguna condicion.
--
-- Patron general (Grupo A — tablas con negocio_id):
--   USING  (negocio_id = public.get_negocio_id())
--   CHECK  (negocio_id = public.get_negocio_id())
--
-- Grupo B (pivot sin negocio_id — heredan via FK al parent con negocio_id):
--   ventas_detalles, producto_atributos, template_atributos,
--   template_atributo_opciones → USING (true) — el aislamiento lo da el JOIN al parent
--
-- Grupo C (catalogos globales — solo lectura):
--   tipos_servicio, tipos_referencia → SELECT USING (true)
--
-- Grupo D (identidad multi-tenant — politicas propias):
--   usuarios, usuario_negocios, negocios
--
-- Tablas con negocio_id cubiertas (21 tablas Grupo A):
--   cajas, configuraciones, categorias_operaciones, turnos_caja,
--   recargas, recargas_virtuales, operaciones_cajas, movimientos_empleados,
--   categorias_productos, atributos, atributo_opciones, producto_templates,
--   productos, producto_presentaciones, codigos_barras,
--   clientes, secuencias_comprobantes, ventas, kardex_inventario,
--   cuentas_cobrar, notas
-- =============================================================================


-- =============================================================================
-- GRUPO D — IDENTIDAD Y MEMBRESÍA
-- usuarios, usuario_negocios, negocios
-- =============================================================================

-- usuarios
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usuarios_select"                       ON usuarios;
DROP POLICY IF EXISTS "usuarios_insert"                       ON usuarios;
DROP POLICY IF EXISTS "usuarios_update"                       ON usuarios;
DROP POLICY IF EXISTS "usuarios_delete"                       ON usuarios;
DROP POLICY IF EXISTS "superadmin_no_delete"                  ON usuarios;
DROP POLICY IF EXISTS "usuario puede leer su propio registro" ON usuarios;
DROP POLICY IF EXISTS "usuario puede auto-registrarse"        ON usuarios;

-- SELECT: el propio usuario ve su perfil + compañeros del negocio activo.
-- Superadmin ve todos (necesario para /admin y para gestionar usuarios desde dentro de un negocio).
CREATE POLICY "usuarios_select" ON usuarios FOR SELECT TO authenticated
USING (
    email = public.get_email()
    OR public.comparten_negocio(id)
    OR public.get_es_superadmin()
);

-- INSERT: auto-registro (email propio) o ADMIN/superadmin agregando usuarios.
-- El auto-registro cubre el primer login OAuth: el usuario aun no existe en la tabla.
CREATE POLICY "usuarios_insert" ON usuarios FOR INSERT TO authenticated
WITH CHECK (
    email = public.get_email()
    OR public.get_rol() = 'ADMIN'
    OR public.get_es_superadmin()
);

-- UPDATE: ADMIN del negocio activo puede editar usuarios de su tenant.
-- Superadmin puede editar cualquier usuario (soporte/correcciones).
CREATE POLICY "usuarios_update" ON usuarios FOR UPDATE TO authenticated
USING (
    (public.get_rol() = 'ADMIN' AND public.comparten_negocio(id))
    OR public.get_es_superadmin()
);

-- DELETE: bloqueado para todos salvo superadmin por trigger fn_proteger_superadmin
CREATE POLICY "superadmin_no_delete" ON usuarios FOR DELETE TO authenticated
USING (es_superadmin = false);


-- usuario_negocios
ALTER TABLE usuario_negocios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usuario_negocios_select" ON usuario_negocios;
DROP POLICY IF EXISTS "usuario_negocios_insert" ON usuario_negocios;
DROP POLICY IF EXISTS "usuario_negocios_update" ON usuario_negocios;
DROP POLICY IF EXISTS "usuario_negocios_delete" ON usuario_negocios;

CREATE POLICY "usuario_negocios_select" ON usuario_negocios FOR SELECT TO authenticated
USING (
    negocio_id = public.get_negocio_id()
    OR usuario_id = (SELECT id FROM usuarios WHERE email = public.get_email())
);

-- INSERT: ADMIN o superadmin del negocio activo crea membresias en su tenant.
CREATE POLICY "usuario_negocios_insert" ON usuario_negocios FOR INSERT TO authenticated
WITH CHECK (
    negocio_id = public.get_negocio_id()
    AND (public.get_rol() = 'ADMIN' OR public.get_es_superadmin())
);

-- UPDATE: ADMIN o superadmin del negocio activo modifica membresias (activo, rol).
CREATE POLICY "usuario_negocios_update" ON usuario_negocios FOR UPDATE TO authenticated
USING (
    negocio_id = public.get_negocio_id()
    AND (public.get_rol() = 'ADMIN' OR public.get_es_superadmin())
);

CREATE POLICY "usuario_negocios_delete" ON usuario_negocios FOR DELETE TO authenticated
USING (public.get_es_superadmin());


-- negocios
-- SELECT:
--   1. Negocio activo del JWT (usuario normal operando un negocio)
--   2. Superadmin via tabla usuarios — NO via JWT, porque el superadmin puede
--      llegar a /admin sin haber pasado por fn_set_negocio_activo (sin JWT actualizado)
--   3. Cualquier negocio donde el usuario tenga membresía activa (selector de sidebar)
ALTER TABLE negocios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "negocios_select" ON negocios;
DROP POLICY IF EXISTS "negocios_insert" ON negocios;
DROP POLICY IF EXISTS "negocios_update" ON negocios;
DROP POLICY IF EXISTS "negocios_delete" ON negocios;

CREATE POLICY "negocios_select" ON negocios FOR SELECT TO authenticated
USING (
    id = public.get_negocio_id()
    OR EXISTS (
        SELECT 1 FROM usuarios
        WHERE email = public.get_email()
        AND es_superadmin = true
    )
    OR id IN (
        SELECT negocio_id FROM usuario_negocios
        WHERE usuario_id = (SELECT id FROM usuarios WHERE email = public.get_email())
        AND activo = true
    )
);

CREATE POLICY "negocios_insert" ON negocios FOR INSERT TO authenticated
WITH CHECK (public.get_es_superadmin());

-- UPDATE: superadmin puede actualizar cualquier negocio.
--         ADMIN del negocio activo puede actualizar sus propios datos de identidad
--         (nombre, telefono, direccion, correo, RUC, etc.) via fn_actualizar_datos_negocio
--         que usa SECURITY DEFINER — esta política es la red de seguridad directa.
CREATE POLICY "negocios_update" ON negocios FOR UPDATE TO authenticated
USING (
    public.get_es_superadmin()
    OR (
        id = public.get_negocio_id()
        AND public.get_rol() = 'ADMIN'
    )
);

CREATE POLICY "negocios_delete" ON negocios FOR DELETE TO authenticated
USING (public.get_es_superadmin());


-- =============================================================================
-- GRUPO A — TABLAS CON negocio_id (21 tablas)
-- Patron unico: negocio_id = get_negocio_id() en todas las operaciones.
-- Sin bypass de superadmin — el JWT siempre controla el tenant activo.
-- =============================================================================

-- cajas
ALTER TABLE cajas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cajas_select" ON cajas; DROP POLICY IF EXISTS "cajas_insert" ON cajas;
DROP POLICY IF EXISTS "cajas_update" ON cajas; DROP POLICY IF EXISTS "cajas_delete" ON cajas;
CREATE POLICY "cajas_select" ON cajas FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "cajas_insert" ON cajas FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "cajas_update" ON cajas FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "cajas_delete" ON cajas FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- configuraciones
-- SELECT: tenant normal + superadmin puede leer configuraciones de cualquier negocio
-- (necesario para el panel /admin donde lista módulos de todos los negocios sin JWT de negocio)
ALTER TABLE configuraciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "configuraciones_select" ON configuraciones; DROP POLICY IF EXISTS "configuraciones_insert" ON configuraciones;
DROP POLICY IF EXISTS "configuraciones_update" ON configuraciones; DROP POLICY IF EXISTS "configuraciones_delete" ON configuraciones;
DROP POLICY IF EXISTS "authenticated puede leer configuraciones" ON configuraciones;
CREATE POLICY "configuraciones_select" ON configuraciones FOR SELECT TO authenticated
    USING (
        negocio_id = public.get_negocio_id()
        OR EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true)
    );
CREATE POLICY "configuraciones_insert" ON configuraciones FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "configuraciones_update" ON configuraciones FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "configuraciones_delete" ON configuraciones FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- categorias_operaciones
ALTER TABLE categorias_operaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "categorias_operaciones_select" ON categorias_operaciones; DROP POLICY IF EXISTS "categorias_operaciones_insert" ON categorias_operaciones;
DROP POLICY IF EXISTS "categorias_operaciones_update" ON categorias_operaciones; DROP POLICY IF EXISTS "categorias_operaciones_delete" ON categorias_operaciones;
CREATE POLICY "categorias_operaciones_select" ON categorias_operaciones FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "categorias_operaciones_insert" ON categorias_operaciones FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "categorias_operaciones_update" ON categorias_operaciones FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "categorias_operaciones_delete" ON categorias_operaciones FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- turnos_caja
ALTER TABLE turnos_caja ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "turnos_caja_select" ON turnos_caja; DROP POLICY IF EXISTS "turnos_caja_insert" ON turnos_caja;
DROP POLICY IF EXISTS "turnos_caja_update" ON turnos_caja; DROP POLICY IF EXISTS "turnos_caja_delete" ON turnos_caja;
DROP POLICY IF EXISTS "authenticated puede leer turnos_caja" ON turnos_caja;
CREATE POLICY "turnos_caja_select" ON turnos_caja FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "turnos_caja_insert" ON turnos_caja FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "turnos_caja_update" ON turnos_caja FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "turnos_caja_delete" ON turnos_caja FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- recargas
ALTER TABLE recargas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recargas_select" ON recargas; DROP POLICY IF EXISTS "recargas_insert" ON recargas;
DROP POLICY IF EXISTS "recargas_update" ON recargas; DROP POLICY IF EXISTS "recargas_delete" ON recargas;
CREATE POLICY "recargas_select" ON recargas FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "recargas_insert" ON recargas FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "recargas_update" ON recargas FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "recargas_delete" ON recargas FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- recargas_virtuales
ALTER TABLE recargas_virtuales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recargas_virtuales_select" ON recargas_virtuales; DROP POLICY IF EXISTS "recargas_virtuales_insert" ON recargas_virtuales;
DROP POLICY IF EXISTS "recargas_virtuales_update" ON recargas_virtuales; DROP POLICY IF EXISTS "recargas_virtuales_delete" ON recargas_virtuales;
CREATE POLICY "recargas_virtuales_select" ON recargas_virtuales FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "recargas_virtuales_insert" ON recargas_virtuales FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "recargas_virtuales_update" ON recargas_virtuales FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "recargas_virtuales_delete" ON recargas_virtuales FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- operaciones_cajas
ALTER TABLE operaciones_cajas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "operaciones_cajas_select" ON operaciones_cajas; DROP POLICY IF EXISTS "operaciones_cajas_insert" ON operaciones_cajas;
DROP POLICY IF EXISTS "operaciones_cajas_update" ON operaciones_cajas; DROP POLICY IF EXISTS "operaciones_cajas_delete" ON operaciones_cajas;
CREATE POLICY "operaciones_cajas_select" ON operaciones_cajas FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "operaciones_cajas_insert" ON operaciones_cajas FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "operaciones_cajas_update" ON operaciones_cajas FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "operaciones_cajas_delete" ON operaciones_cajas FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- movimientos_empleados
ALTER TABLE movimientos_empleados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "movimientos_empleados_select" ON movimientos_empleados; DROP POLICY IF EXISTS "movimientos_empleados_insert" ON movimientos_empleados;
DROP POLICY IF EXISTS "movimientos_empleados_update" ON movimientos_empleados; DROP POLICY IF EXISTS "movimientos_empleados_delete" ON movimientos_empleados;
CREATE POLICY "movimientos_empleados_select" ON movimientos_empleados FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "movimientos_empleados_insert" ON movimientos_empleados FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "movimientos_empleados_update" ON movimientos_empleados FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "movimientos_empleados_delete" ON movimientos_empleados FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- categorias_productos
ALTER TABLE categorias_productos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "categorias_productos_select" ON categorias_productos; DROP POLICY IF EXISTS "categorias_productos_insert" ON categorias_productos;
DROP POLICY IF EXISTS "categorias_productos_update" ON categorias_productos; DROP POLICY IF EXISTS "categorias_productos_delete" ON categorias_productos;
CREATE POLICY "categorias_productos_select" ON categorias_productos FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "categorias_productos_insert" ON categorias_productos FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "categorias_productos_update" ON categorias_productos FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "categorias_productos_delete" ON categorias_productos FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- atributos
ALTER TABLE atributos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atributos_select" ON atributos; DROP POLICY IF EXISTS "atributos_insert" ON atributos;
DROP POLICY IF EXISTS "atributos_update" ON atributos; DROP POLICY IF EXISTS "atributos_delete" ON atributos;
CREATE POLICY "atributos_select" ON atributos FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "atributos_insert" ON atributos FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "atributos_update" ON atributos FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "atributos_delete" ON atributos FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- atributo_opciones
ALTER TABLE atributo_opciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atributo_opciones_select" ON atributo_opciones; DROP POLICY IF EXISTS "atributo_opciones_insert" ON atributo_opciones;
DROP POLICY IF EXISTS "atributo_opciones_update" ON atributo_opciones; DROP POLICY IF EXISTS "atributo_opciones_delete" ON atributo_opciones;
CREATE POLICY "atributo_opciones_select" ON atributo_opciones FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "atributo_opciones_insert" ON atributo_opciones FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "atributo_opciones_update" ON atributo_opciones FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "atributo_opciones_delete" ON atributo_opciones FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- producto_templates
ALTER TABLE producto_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "producto_templates_select" ON producto_templates; DROP POLICY IF EXISTS "producto_templates_insert" ON producto_templates;
DROP POLICY IF EXISTS "producto_templates_update" ON producto_templates; DROP POLICY IF EXISTS "producto_templates_delete" ON producto_templates;
CREATE POLICY "producto_templates_select" ON producto_templates FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "producto_templates_insert" ON producto_templates FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "producto_templates_update" ON producto_templates FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "producto_templates_delete" ON producto_templates FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- productos
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "productos_select" ON productos; DROP POLICY IF EXISTS "productos_insert" ON productos;
DROP POLICY IF EXISTS "productos_update" ON productos; DROP POLICY IF EXISTS "productos_delete" ON productos;
CREATE POLICY "productos_select" ON productos FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "productos_insert" ON productos FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "productos_update" ON productos FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "productos_delete" ON productos FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- producto_presentaciones
ALTER TABLE producto_presentaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "producto_presentaciones_select" ON producto_presentaciones; DROP POLICY IF EXISTS "producto_presentaciones_insert" ON producto_presentaciones;
DROP POLICY IF EXISTS "producto_presentaciones_update" ON producto_presentaciones; DROP POLICY IF EXISTS "producto_presentaciones_delete" ON producto_presentaciones;
CREATE POLICY "producto_presentaciones_select" ON producto_presentaciones FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "producto_presentaciones_insert" ON producto_presentaciones FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "producto_presentaciones_update" ON producto_presentaciones FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "producto_presentaciones_delete" ON producto_presentaciones FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- codigos_barras
ALTER TABLE codigos_barras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "codigos_barras_select" ON codigos_barras; DROP POLICY IF EXISTS "codigos_barras_insert" ON codigos_barras;
DROP POLICY IF EXISTS "codigos_barras_update" ON codigos_barras; DROP POLICY IF EXISTS "codigos_barras_delete" ON codigos_barras;
CREATE POLICY "codigos_barras_select" ON codigos_barras FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "codigos_barras_insert" ON codigos_barras FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "codigos_barras_update" ON codigos_barras FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "codigos_barras_delete" ON codigos_barras FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- clientes
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clientes_select" ON clientes; DROP POLICY IF EXISTS "clientes_insert" ON clientes;
DROP POLICY IF EXISTS "clientes_update" ON clientes; DROP POLICY IF EXISTS "clientes_delete" ON clientes;
CREATE POLICY "clientes_select" ON clientes FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "clientes_insert" ON clientes FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "clientes_update" ON clientes FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "clientes_delete" ON clientes FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- secuencias_comprobantes
ALTER TABLE secuencias_comprobantes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "secuencias_comprobantes_select" ON secuencias_comprobantes; DROP POLICY IF EXISTS "secuencias_comprobantes_insert" ON secuencias_comprobantes;
DROP POLICY IF EXISTS "secuencias_comprobantes_update" ON secuencias_comprobantes; DROP POLICY IF EXISTS "secuencias_comprobantes_delete" ON secuencias_comprobantes;
CREATE POLICY "secuencias_comprobantes_select" ON secuencias_comprobantes FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "secuencias_comprobantes_insert" ON secuencias_comprobantes FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "secuencias_comprobantes_update" ON secuencias_comprobantes FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "secuencias_comprobantes_delete" ON secuencias_comprobantes FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- ventas
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ventas_select" ON ventas; DROP POLICY IF EXISTS "ventas_insert" ON ventas;
DROP POLICY IF EXISTS "ventas_update" ON ventas; DROP POLICY IF EXISTS "ventas_delete" ON ventas;
CREATE POLICY "ventas_select" ON ventas FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "ventas_insert" ON ventas FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "ventas_update" ON ventas FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "ventas_delete" ON ventas FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- kardex_inventario
ALTER TABLE kardex_inventario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kardex_inventario_select" ON kardex_inventario; DROP POLICY IF EXISTS "kardex_inventario_insert" ON kardex_inventario;
DROP POLICY IF EXISTS "kardex_inventario_update" ON kardex_inventario; DROP POLICY IF EXISTS "kardex_inventario_delete" ON kardex_inventario;
CREATE POLICY "kardex_inventario_select" ON kardex_inventario FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "kardex_inventario_insert" ON kardex_inventario FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "kardex_inventario_update" ON kardex_inventario FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "kardex_inventario_delete" ON kardex_inventario FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- cuentas_cobrar
ALTER TABLE cuentas_cobrar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cuentas_cobrar_select" ON cuentas_cobrar; DROP POLICY IF EXISTS "cuentas_cobrar_insert" ON cuentas_cobrar;
DROP POLICY IF EXISTS "cuentas_cobrar_update" ON cuentas_cobrar; DROP POLICY IF EXISTS "cuentas_cobrar_delete" ON cuentas_cobrar;
CREATE POLICY "cuentas_cobrar_select" ON cuentas_cobrar FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "cuentas_cobrar_insert" ON cuentas_cobrar FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "cuentas_cobrar_update" ON cuentas_cobrar FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "cuentas_cobrar_delete" ON cuentas_cobrar FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id());

-- notas
ALTER TABLE notas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notas_select" ON notas; DROP POLICY IF EXISTS "notas_insert" ON notas;
DROP POLICY IF EXISTS "notas_update" ON notas; DROP POLICY IF EXISTS "notas_delete" ON notas;
CREATE POLICY "notas_select" ON notas FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "notas_insert" ON notas FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id());
CREATE POLICY "notas_update" ON notas FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id());
CREATE POLICY "notas_delete" ON notas FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() AND public.get_rol() = 'ADMIN');


-- =============================================================================
-- GRUPO B — PIVOTS SIN negocio_id
-- El aislamiento lo garantiza el JOIN al parent (que sí tiene RLS con negocio_id).
-- Postgres evalua la RLS del parent antes de devolver filas del pivot.
-- =============================================================================

-- ventas_detalles → hereda via ventas.negocio_id
ALTER TABLE ventas_detalles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ventas_detalles_select" ON ventas_detalles; DROP POLICY IF EXISTS "ventas_detalles_insert" ON ventas_detalles;
DROP POLICY IF EXISTS "ventas_detalles_update" ON ventas_detalles; DROP POLICY IF EXISTS "ventas_detalles_delete" ON ventas_detalles;
CREATE POLICY "ventas_detalles_select" ON ventas_detalles FOR SELECT TO authenticated USING (true);
CREATE POLICY "ventas_detalles_insert" ON ventas_detalles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ventas_detalles_update" ON ventas_detalles FOR UPDATE TO authenticated USING (true);
CREATE POLICY "ventas_detalles_delete" ON ventas_detalles FOR DELETE TO authenticated USING (true);

-- producto_atributos → hereda via productos.negocio_id
ALTER TABLE producto_atributos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "producto_atributos_select" ON producto_atributos; DROP POLICY IF EXISTS "producto_atributos_insert" ON producto_atributos;
DROP POLICY IF EXISTS "producto_atributos_update" ON producto_atributos; DROP POLICY IF EXISTS "producto_atributos_delete" ON producto_atributos;
CREATE POLICY "producto_atributos_select" ON producto_atributos FOR SELECT TO authenticated USING (true);
CREATE POLICY "producto_atributos_insert" ON producto_atributos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "producto_atributos_update" ON producto_atributos FOR UPDATE TO authenticated USING (true);
CREATE POLICY "producto_atributos_delete" ON producto_atributos FOR DELETE TO authenticated USING (true);

-- template_atributos → hereda via producto_templates.negocio_id
ALTER TABLE template_atributos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "template_atributos_select" ON template_atributos; DROP POLICY IF EXISTS "template_atributos_insert" ON template_atributos;
DROP POLICY IF EXISTS "template_atributos_update" ON template_atributos; DROP POLICY IF EXISTS "template_atributos_delete" ON template_atributos;
CREATE POLICY "template_atributos_select" ON template_atributos FOR SELECT TO authenticated USING (true);
CREATE POLICY "template_atributos_insert" ON template_atributos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "template_atributos_update" ON template_atributos FOR UPDATE TO authenticated USING (true);
CREATE POLICY "template_atributos_delete" ON template_atributos FOR DELETE TO authenticated USING (true);

-- template_atributo_opciones → hereda via template_atributos
ALTER TABLE template_atributo_opciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "template_atributo_opciones_select" ON template_atributo_opciones; DROP POLICY IF EXISTS "template_atributo_opciones_insert" ON template_atributo_opciones;
DROP POLICY IF EXISTS "template_atributo_opciones_update" ON template_atributo_opciones; DROP POLICY IF EXISTS "template_atributo_opciones_delete" ON template_atributo_opciones;
CREATE POLICY "template_atributo_opciones_select" ON template_atributo_opciones FOR SELECT TO authenticated USING (true);
CREATE POLICY "template_atributo_opciones_insert" ON template_atributo_opciones FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "template_atributo_opciones_update" ON template_atributo_opciones FOR UPDATE TO authenticated USING (true);
CREATE POLICY "template_atributo_opciones_delete" ON template_atributo_opciones FOR DELETE TO authenticated USING (true);


-- =============================================================================
-- GRUPO C — CATÁLOGOS GLOBALES (solo lectura para todos)
-- =============================================================================

-- tipos_servicio
ALTER TABLE tipos_servicio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tipos_servicio_select" ON tipos_servicio;
CREATE POLICY "tipos_servicio_select" ON tipos_servicio FOR SELECT TO authenticated USING (true);

-- tipos_referencia
ALTER TABLE tipos_referencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tipos_referencia_select" ON tipos_referencia;
CREATE POLICY "tipos_referencia_select" ON tipos_referencia FOR SELECT TO authenticated USING (true);


-- =============================================================================
-- MONETIZACION / SUSCRIPCIONES
-- planes, metodos_pago_suscripcion, config_plataforma: catalogos/config globales.
--   SELECT abierto a authenticated (el cliente necesita leer su plan y los datos de cobro,
--   incluso suspendido). Escritura SOLO superadmin (gestiona catalogo y datos de cobro).
-- suscripciones: por tenant. El negocio ve la suya; el superadmin ve todas (via tabla
--   usuarios, NO get_es_superadmin() del JWT — en /admin el claim puede estar desactualizado).
--   Escrituras SOLO via funciones SECURITY DEFINER (fn_registrar_pago_propietario, etc.) —
--   cubiertas por la RESTRICTIVE superadmin_no_write mas abajo.
-- =============================================================================

-- planes
ALTER TABLE planes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "planes_select" ON planes;
DROP POLICY IF EXISTS "planes_admin"  ON planes;
CREATE POLICY "planes_select" ON planes FOR SELECT TO authenticated USING (true);
CREATE POLICY "planes_admin"  ON planes FOR ALL TO authenticated
    USING (public.get_es_superadmin()) WITH CHECK (public.get_es_superadmin());

-- metodos_pago_suscripcion
ALTER TABLE metodos_pago_suscripcion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "metodos_pago_select" ON metodos_pago_suscripcion;
DROP POLICY IF EXISTS "metodos_pago_admin"  ON metodos_pago_suscripcion;
CREATE POLICY "metodos_pago_select" ON metodos_pago_suscripcion FOR SELECT TO authenticated USING (true);
CREATE POLICY "metodos_pago_admin"  ON metodos_pago_suscripcion FOR ALL TO authenticated
    USING (public.get_es_superadmin()) WITH CHECK (public.get_es_superadmin());

-- config_plataforma
ALTER TABLE config_plataforma ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "config_plataforma_select" ON config_plataforma;
DROP POLICY IF EXISTS "config_plataforma_admin"  ON config_plataforma;
CREATE POLICY "config_plataforma_select" ON config_plataforma FOR SELECT TO authenticated USING (true);
CREATE POLICY "config_plataforma_admin"  ON config_plataforma FOR ALL TO authenticated
    USING (public.get_es_superadmin()) WITH CHECK (public.get_es_superadmin());

-- suscripciones
ALTER TABLE suscripciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "suscripciones_select" ON suscripciones;
CREATE POLICY "suscripciones_select" ON suscripciones FOR SELECT TO authenticated
USING (
    negocio_id = public.get_negocio_id()
    OR EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true)
);

-- suscripcion_pagos: historial financiero. El negocio ve los pagos de su propio negocio;
-- el superadmin ve todos (via tabla usuarios, NO get_es_superadmin() — en /admin el claim
-- puede estar desactualizado). Escrituras SOLO via funciones SECURITY DEFINER (cubiertas
-- por la RESTRICTIVE mas abajo).
ALTER TABLE suscripcion_pagos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "suscripcion_pagos_select" ON suscripcion_pagos;
CREATE POLICY "suscripcion_pagos_select" ON suscripcion_pagos FOR SELECT TO authenticated
USING (
    negocio_id = public.get_negocio_id()
    OR EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true)
);


-- =============================================================================
-- BLOQUEO SUPERADMIN — writes directos desde servicios Angular
-- =============================================================================
-- El superadmin entra a los negocios solo para revisar datos.
-- Las funciones SQL ya tienen PERFORM fn_assert_no_superadmin() para RPCs.
-- Estas políticas RESTRICTIVE cubren los INSERT/UPDATE/DELETE directos
-- (sin RPC) que hacen los servicios Angular: clientes, inventario, notas, etc.
--
-- RESTRICTIVE = se evalúa con AND sobre las políticas permisivas existentes.
-- No reemplaza las políticas de tenant — las suma. El superadmin queda bloqueado
-- incluso si las políticas de negocio_id lo habrían permitido pasar.
--
-- Tablas cubiertas (writes directos identificados en servicios Angular):
--   Grupo A: clientes, productos, categorias_productos, producto_presentaciones,
--            atributos, atributo_opciones, categorias_operaciones,
--            movimientos_empleados, notas, configuraciones,
--            turnos_caja, cajas, operaciones_cajas, ventas,
--            recargas, recargas_virtuales, kardex_inventario, cuentas_cobrar
--   Grupo B: producto_atributos, ventas_detalles
-- =============================================================================

-- Helper: subquery reutilizable para verificar superadmin
-- (no se puede usar fn_assert_no_superadmin() en WITH CHECK — RLS no admite PERFORM)

DROP POLICY IF EXISTS "superadmin_no_write" ON clientes;
CREATE POLICY "superadmin_no_write" ON clientes AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON productos;
CREATE POLICY "superadmin_no_write" ON productos AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON categorias_productos;
CREATE POLICY "superadmin_no_write" ON categorias_productos AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON producto_presentaciones;
CREATE POLICY "superadmin_no_write" ON producto_presentaciones AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON atributos;
CREATE POLICY "superadmin_no_write" ON atributos AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON atributo_opciones;
CREATE POLICY "superadmin_no_write" ON atributo_opciones AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON categorias_operaciones;
CREATE POLICY "superadmin_no_write" ON categorias_operaciones AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON movimientos_empleados;
CREATE POLICY "superadmin_no_write" ON movimientos_empleados AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON notas;
CREATE POLICY "superadmin_no_write" ON notas AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON configuraciones;
CREATE POLICY "superadmin_no_write" ON configuraciones AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON turnos_caja;
CREATE POLICY "superadmin_no_write" ON turnos_caja AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON cajas;
CREATE POLICY "superadmin_no_write" ON cajas AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON operaciones_cajas;
CREATE POLICY "superadmin_no_write" ON operaciones_cajas AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON ventas;
CREATE POLICY "superadmin_no_write" ON ventas AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON recargas;
CREATE POLICY "superadmin_no_write" ON recargas AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON recargas_virtuales;
CREATE POLICY "superadmin_no_write" ON recargas_virtuales AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON kardex_inventario;
CREATE POLICY "superadmin_no_write" ON kardex_inventario AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON cuentas_cobrar;
CREATE POLICY "superadmin_no_write" ON cuentas_cobrar AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

-- Grupo B — pivots sin negocio_id (USING también bloqueado para UPDATE/DELETE)
DROP POLICY IF EXISTS "superadmin_no_write" ON producto_atributos;
CREATE POLICY "superadmin_no_write" ON producto_atributos AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

DROP POLICY IF EXISTS "superadmin_no_write" ON ventas_detalles;
CREATE POLICY "superadmin_no_write" ON ventas_detalles AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (NOT EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true));

-- suscripciones: bloqueo TOTAL de escritura directa desde el cliente (no solo superadmin).
-- Las suscripciones SOLO se crean/modifican via funciones SECURITY DEFINER
-- (fn_completar_onboarding, fn_registrar_pago_propietario, fn_suspender_propietario_suscripcion),
-- que bypassan RLS. Sin esta RESTRICTIVE, un ADMIN de negocio podria insertarse a si mismo
-- una suscripcion 'ACTIVA' con vence_el lejano y saltarse el cobro. WITH CHECK (false)
-- niega todo INSERT/UPDATE/DELETE directo; las funciones SECURITY DEFINER no se ven afectadas.
DROP POLICY IF EXISTS "suscripciones_no_write" ON suscripciones;
CREATE POLICY "suscripciones_no_write" ON suscripciones AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (false);

-- suscripcion_pagos: mismo bloqueo total. El historial financiero solo lo escriben las
-- funciones SECURITY DEFINER (fn_registrar_pago_propietario). Nadie inserta pagos a mano.
DROP POLICY IF EXISTS "suscripcion_pagos_no_write" ON suscripcion_pagos;
CREATE POLICY "suscripcion_pagos_no_write" ON suscripcion_pagos AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (false);


NOTIFY pgrst, 'reload schema';
