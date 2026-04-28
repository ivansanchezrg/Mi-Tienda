-- ==========================================
-- RLS — Politicas multi-tenant para todas las tablas del proyecto
-- Version: 2.0 (Multi-Tenant)
-- ==========================================
-- Patron general: tenant_or_superadmin
--   SELECT/INSERT/UPDATE/DELETE filtran por negocio_id del JWT.
--
-- Helpers JWT (definidos en schema.sql):
--   public.get_negocio_id()    → UUID del negocio activo en el JWT
--   public.get_es_superadmin() → TRUE si es superadmin
--   public.get_rol()     → 'ADMIN' | 'EMPLEADO'
--
-- Tablas sin negocio_id (Grupo B pivots y Grupo C globales):
--   - ventas_detalles / template_atributos / template_atributo_opciones
--     / producto_atributos: heredan aislamiento via FK → parent ya filtrado por RLS.
--     Se usa USING (true) aqui; PostgREST ya aplica el filtro del parent en joins.
--   - tipos_servicio / tipos_referencia: catalogo global, solo lectura para todos.
--
-- La tabla `usuarios`, `usuario_negocios` y `negocios` tienen sus propias politicas en:
--   docs/auth/sql/setup/rls_usuarios.sql  (NO repetir aqui)
--
-- Idempotente: DROP IF EXISTS + CREATE.
-- ==========================================

-- ==========================================
-- MACRO: patron tenant_or_superadmin
-- USING  (negocio_id = public.get_negocio_id() OR public.get_es_superadmin())
-- CHECK  (negocio_id = public.get_negocio_id() OR public.get_es_superadmin())
-- ==========================================

-- ==========================================
-- cajas
-- ==========================================
ALTER TABLE cajas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cajas_select" ON cajas;
DROP POLICY IF EXISTS "cajas_insert" ON cajas;
DROP POLICY IF EXISTS "cajas_update" ON cajas;
DROP POLICY IF EXISTS "cajas_delete" ON cajas;
CREATE POLICY "cajas_select" ON cajas FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "cajas_insert" ON cajas FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "cajas_update" ON cajas FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "cajas_delete" ON cajas FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- configuraciones
-- ==========================================
ALTER TABLE configuraciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "configuraciones_select" ON configuraciones;
DROP POLICY IF EXISTS "configuraciones_insert" ON configuraciones;
DROP POLICY IF EXISTS "configuraciones_update" ON configuraciones;
DROP POLICY IF EXISTS "configuraciones_delete" ON configuraciones;
CREATE POLICY "configuraciones_select" ON configuraciones FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "configuraciones_insert" ON configuraciones FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "configuraciones_update" ON configuraciones FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "configuraciones_delete" ON configuraciones FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- tipos_servicio  (Grupo C — catalogo global, SERIAL PK, sin negocio_id)
-- Solo lectura para authenticated; gestion solo via migraciones/superadmin.
-- ==========================================
ALTER TABLE tipos_servicio ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tipos_servicio_select" ON tipos_servicio;
DROP POLICY IF EXISTS "tipos_servicio_insert" ON tipos_servicio;
DROP POLICY IF EXISTS "tipos_servicio_update" ON tipos_servicio;
DROP POLICY IF EXISTS "tipos_servicio_delete" ON tipos_servicio;
CREATE POLICY "tipos_servicio_select" ON tipos_servicio FOR SELECT TO authenticated USING (true);
-- INSERT/UPDATE/DELETE: solo superadmin puede modificar el catalogo global
CREATE POLICY "tipos_servicio_insert" ON tipos_servicio FOR INSERT TO authenticated
    WITH CHECK (public.get_es_superadmin());
CREATE POLICY "tipos_servicio_update" ON tipos_servicio FOR UPDATE TO authenticated
    USING (public.get_es_superadmin());
CREATE POLICY "tipos_servicio_delete" ON tipos_servicio FOR DELETE TO authenticated
    USING (public.get_es_superadmin());

-- ==========================================
-- tipos_referencia  (Grupo C — catalogo global, sin negocio_id)
-- ==========================================
ALTER TABLE tipos_referencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tipos_referencia_select" ON tipos_referencia;
DROP POLICY IF EXISTS "tipos_referencia_insert" ON tipos_referencia;
DROP POLICY IF EXISTS "tipos_referencia_update" ON tipos_referencia;
DROP POLICY IF EXISTS "tipos_referencia_delete" ON tipos_referencia;
CREATE POLICY "tipos_referencia_select" ON tipos_referencia FOR SELECT TO authenticated USING (true);
CREATE POLICY "tipos_referencia_insert" ON tipos_referencia FOR INSERT TO authenticated
    WITH CHECK (public.get_es_superadmin());
CREATE POLICY "tipos_referencia_update" ON tipos_referencia FOR UPDATE TO authenticated
    USING (public.get_es_superadmin());
CREATE POLICY "tipos_referencia_delete" ON tipos_referencia FOR DELETE TO authenticated
    USING (public.get_es_superadmin());

-- ==========================================
-- turnos_caja
-- ==========================================
ALTER TABLE turnos_caja ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "turnos_caja_select" ON turnos_caja;
DROP POLICY IF EXISTS "turnos_caja_insert" ON turnos_caja;
DROP POLICY IF EXISTS "turnos_caja_update" ON turnos_caja;
DROP POLICY IF EXISTS "turnos_caja_delete" ON turnos_caja;
CREATE POLICY "turnos_caja_select" ON turnos_caja FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "turnos_caja_insert" ON turnos_caja FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "turnos_caja_update" ON turnos_caja FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "turnos_caja_delete" ON turnos_caja FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- recargas
-- ==========================================
ALTER TABLE recargas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recargas_select" ON recargas;
DROP POLICY IF EXISTS "recargas_insert" ON recargas;
DROP POLICY IF EXISTS "recargas_update" ON recargas;
DROP POLICY IF EXISTS "recargas_delete" ON recargas;
CREATE POLICY "recargas_select" ON recargas FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "recargas_insert" ON recargas FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "recargas_update" ON recargas FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "recargas_delete" ON recargas FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- categorias_operaciones
-- ==========================================
ALTER TABLE categorias_operaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "categorias_operaciones_select" ON categorias_operaciones;
DROP POLICY IF EXISTS "categorias_operaciones_insert" ON categorias_operaciones;
DROP POLICY IF EXISTS "categorias_operaciones_update" ON categorias_operaciones;
DROP POLICY IF EXISTS "categorias_operaciones_delete" ON categorias_operaciones;
CREATE POLICY "categorias_operaciones_select" ON categorias_operaciones FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "categorias_operaciones_insert" ON categorias_operaciones FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "categorias_operaciones_update" ON categorias_operaciones FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "categorias_operaciones_delete" ON categorias_operaciones FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- operaciones_cajas
-- (Inmutabilidad: trigger fn_proteger_operacion_caja)
-- ==========================================
ALTER TABLE operaciones_cajas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "operaciones_cajas_select" ON operaciones_cajas;
DROP POLICY IF EXISTS "operaciones_cajas_insert" ON operaciones_cajas;
DROP POLICY IF EXISTS "operaciones_cajas_update" ON operaciones_cajas;
DROP POLICY IF EXISTS "operaciones_cajas_delete" ON operaciones_cajas;
CREATE POLICY "operaciones_cajas_select" ON operaciones_cajas FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "operaciones_cajas_insert" ON operaciones_cajas FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "operaciones_cajas_update" ON operaciones_cajas FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
-- DELETE bloqueado por trigger; la politica evita intentos desde cliente
CREATE POLICY "operaciones_cajas_delete" ON operaciones_cajas FOR DELETE TO authenticated
    USING (public.get_es_superadmin());

-- ==========================================
-- movimientos_empleados
-- (Inmutabilidad: trigger fn_proteger_movimiento_empleado)
-- ==========================================
ALTER TABLE movimientos_empleados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "movimientos_empleados_select" ON movimientos_empleados;
DROP POLICY IF EXISTS "movimientos_empleados_insert" ON movimientos_empleados;
DROP POLICY IF EXISTS "movimientos_empleados_update" ON movimientos_empleados;
DROP POLICY IF EXISTS "movimientos_empleados_delete" ON movimientos_empleados;
CREATE POLICY "movimientos_empleados_select" ON movimientos_empleados FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "movimientos_empleados_insert" ON movimientos_empleados FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
-- UPDATE: solo los campos estado_liquidacion/liquidado_en (el trigger protege el resto)
CREATE POLICY "movimientos_empleados_update" ON movimientos_empleados FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
-- DELETE bloqueado por trigger; solo superadmin puede intentarlo (trigger lo bloqueara igual)
CREATE POLICY "movimientos_empleados_delete" ON movimientos_empleados FOR DELETE TO authenticated
    USING (public.get_es_superadmin());

-- ==========================================
-- recargas_virtuales
-- ==========================================
ALTER TABLE recargas_virtuales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recargas_virtuales_select" ON recargas_virtuales;
DROP POLICY IF EXISTS "recargas_virtuales_insert" ON recargas_virtuales;
DROP POLICY IF EXISTS "recargas_virtuales_update" ON recargas_virtuales;
DROP POLICY IF EXISTS "recargas_virtuales_delete" ON recargas_virtuales;
CREATE POLICY "recargas_virtuales_select" ON recargas_virtuales FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "recargas_virtuales_insert" ON recargas_virtuales FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "recargas_virtuales_update" ON recargas_virtuales FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "recargas_virtuales_delete" ON recargas_virtuales FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- categorias_productos
-- ==========================================
ALTER TABLE categorias_productos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "categorias_productos_select" ON categorias_productos;
DROP POLICY IF EXISTS "categorias_productos_insert" ON categorias_productos;
DROP POLICY IF EXISTS "categorias_productos_update" ON categorias_productos;
DROP POLICY IF EXISTS "categorias_productos_delete" ON categorias_productos;
CREATE POLICY "categorias_productos_select" ON categorias_productos FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "categorias_productos_insert" ON categorias_productos FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "categorias_productos_update" ON categorias_productos FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "categorias_productos_delete" ON categorias_productos FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- atributos
-- ==========================================
ALTER TABLE atributos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atributos_select" ON atributos;
DROP POLICY IF EXISTS "atributos_insert" ON atributos;
DROP POLICY IF EXISTS "atributos_update" ON atributos;
DROP POLICY IF EXISTS "atributos_delete" ON atributos;
CREATE POLICY "atributos_select" ON atributos FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "atributos_insert" ON atributos FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "atributos_update" ON atributos FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "atributos_delete" ON atributos FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- atributo_opciones
-- ==========================================
ALTER TABLE atributo_opciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "atributo_opciones_select" ON atributo_opciones;
DROP POLICY IF EXISTS "atributo_opciones_insert" ON atributo_opciones;
DROP POLICY IF EXISTS "atributo_opciones_update" ON atributo_opciones;
DROP POLICY IF EXISTS "atributo_opciones_delete" ON atributo_opciones;
CREATE POLICY "atributo_opciones_select" ON atributo_opciones FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "atributo_opciones_insert" ON atributo_opciones FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "atributo_opciones_update" ON atributo_opciones FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "atributo_opciones_delete" ON atributo_opciones FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- producto_templates
-- ==========================================
ALTER TABLE producto_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "producto_templates_select" ON producto_templates;
DROP POLICY IF EXISTS "producto_templates_insert" ON producto_templates;
DROP POLICY IF EXISTS "producto_templates_update" ON producto_templates;
DROP POLICY IF EXISTS "producto_templates_delete" ON producto_templates;
CREATE POLICY "producto_templates_select" ON producto_templates FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "producto_templates_insert" ON producto_templates FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "producto_templates_update" ON producto_templates FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "producto_templates_delete" ON producto_templates FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- template_atributos  (Grupo B — sin negocio_id; hereda via template_id → producto_templates)
-- RLS del parent ya garantiza que el usuario solo ve templates de su negocio.
-- ==========================================
ALTER TABLE template_atributos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "template_atributos_select" ON template_atributos;
DROP POLICY IF EXISTS "template_atributos_insert" ON template_atributos;
DROP POLICY IF EXISTS "template_atributos_update" ON template_atributos;
DROP POLICY IF EXISTS "template_atributos_delete" ON template_atributos;
CREATE POLICY "template_atributos_select" ON template_atributos FOR SELECT TO authenticated USING (true);
CREATE POLICY "template_atributos_insert" ON template_atributos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "template_atributos_update" ON template_atributos FOR UPDATE TO authenticated USING (true);
CREATE POLICY "template_atributos_delete" ON template_atributos FOR DELETE TO authenticated USING (true);

-- ==========================================
-- template_atributo_opciones  (Grupo B — sin negocio_id; hereda via template_atributo_id)
-- ==========================================
ALTER TABLE template_atributo_opciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "template_atributo_opciones_select" ON template_atributo_opciones;
DROP POLICY IF EXISTS "template_atributo_opciones_insert" ON template_atributo_opciones;
DROP POLICY IF EXISTS "template_atributo_opciones_update" ON template_atributo_opciones;
DROP POLICY IF EXISTS "template_atributo_opciones_delete" ON template_atributo_opciones;
CREATE POLICY "template_atributo_opciones_select" ON template_atributo_opciones FOR SELECT TO authenticated USING (true);
CREATE POLICY "template_atributo_opciones_insert" ON template_atributo_opciones FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "template_atributo_opciones_update" ON template_atributo_opciones FOR UPDATE TO authenticated USING (true);
CREATE POLICY "template_atributo_opciones_delete" ON template_atributo_opciones FOR DELETE TO authenticated USING (true);

-- ==========================================
-- productos
-- ==========================================
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "productos_select" ON productos;
DROP POLICY IF EXISTS "productos_insert" ON productos;
DROP POLICY IF EXISTS "productos_update" ON productos;
DROP POLICY IF EXISTS "productos_delete" ON productos;
CREATE POLICY "productos_select" ON productos FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "productos_insert" ON productos FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "productos_update" ON productos FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "productos_delete" ON productos FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- producto_presentaciones
-- ==========================================
ALTER TABLE producto_presentaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "producto_presentaciones_select" ON producto_presentaciones;
DROP POLICY IF EXISTS "producto_presentaciones_insert" ON producto_presentaciones;
DROP POLICY IF EXISTS "producto_presentaciones_update" ON producto_presentaciones;
DROP POLICY IF EXISTS "producto_presentaciones_delete" ON producto_presentaciones;
CREATE POLICY "producto_presentaciones_select" ON producto_presentaciones FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "producto_presentaciones_insert" ON producto_presentaciones FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "producto_presentaciones_update" ON producto_presentaciones FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "producto_presentaciones_delete" ON producto_presentaciones FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- codigos_barras
-- ==========================================
ALTER TABLE codigos_barras ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "codigos_barras_select" ON codigos_barras;
DROP POLICY IF EXISTS "codigos_barras_insert" ON codigos_barras;
DROP POLICY IF EXISTS "codigos_barras_update" ON codigos_barras;
DROP POLICY IF EXISTS "codigos_barras_delete" ON codigos_barras;
CREATE POLICY "codigos_barras_select" ON codigos_barras FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
-- INSERT/UPDATE/DELETE: solo via triggers (fn_sync_codigo_barras).
-- La politica existe para que el trigger (que corre como INVOKER cuando no es DEFINER)
-- pueda hacer el INSERT/UPDATE/DELETE. El trigger fn_sync_codigo_barras NO es SECURITY DEFINER
-- por diseno; la fila ya contiene negocio_id correcto.
CREATE POLICY "codigos_barras_insert" ON codigos_barras FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "codigos_barras_update" ON codigos_barras FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "codigos_barras_delete" ON codigos_barras FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- producto_atributos  (Grupo B — sin negocio_id; hereda via producto_id → productos)
-- ==========================================
ALTER TABLE producto_atributos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "producto_atributos_select" ON producto_atributos;
DROP POLICY IF EXISTS "producto_atributos_insert" ON producto_atributos;
DROP POLICY IF EXISTS "producto_atributos_update" ON producto_atributos;
DROP POLICY IF EXISTS "producto_atributos_delete" ON producto_atributos;
CREATE POLICY "producto_atributos_select" ON producto_atributos FOR SELECT TO authenticated USING (true);
CREATE POLICY "producto_atributos_insert" ON producto_atributos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "producto_atributos_update" ON producto_atributos FOR UPDATE TO authenticated USING (true);
CREATE POLICY "producto_atributos_delete" ON producto_atributos FOR DELETE TO authenticated USING (true);

-- ==========================================
-- clientes
-- ==========================================
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clientes_select" ON clientes;
DROP POLICY IF EXISTS "clientes_insert" ON clientes;
DROP POLICY IF EXISTS "clientes_update" ON clientes;
DROP POLICY IF EXISTS "clientes_delete" ON clientes;
CREATE POLICY "clientes_select" ON clientes FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "clientes_insert" ON clientes FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "clientes_update" ON clientes FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "clientes_delete" ON clientes FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- secuencias_comprobantes
-- ==========================================
ALTER TABLE secuencias_comprobantes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "secuencias_comprobantes_select" ON secuencias_comprobantes;
DROP POLICY IF EXISTS "secuencias_comprobantes_insert" ON secuencias_comprobantes;
DROP POLICY IF EXISTS "secuencias_comprobantes_update" ON secuencias_comprobantes;
DROP POLICY IF EXISTS "secuencias_comprobantes_delete" ON secuencias_comprobantes;
CREATE POLICY "secuencias_comprobantes_select" ON secuencias_comprobantes FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "secuencias_comprobantes_insert" ON secuencias_comprobantes FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "secuencias_comprobantes_update" ON secuencias_comprobantes FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "secuencias_comprobantes_delete" ON secuencias_comprobantes FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- ventas
-- ==========================================
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ventas_select" ON ventas;
DROP POLICY IF EXISTS "ventas_insert" ON ventas;
DROP POLICY IF EXISTS "ventas_update" ON ventas;
DROP POLICY IF EXISTS "ventas_delete" ON ventas;
CREATE POLICY "ventas_select" ON ventas FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "ventas_insert" ON ventas FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "ventas_update" ON ventas FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "ventas_delete" ON ventas FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- ventas_detalles  (Grupo B — sin negocio_id; hereda via venta_id → ventas)
-- ==========================================
ALTER TABLE ventas_detalles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ventas_detalles_select" ON ventas_detalles;
DROP POLICY IF EXISTS "ventas_detalles_insert" ON ventas_detalles;
DROP POLICY IF EXISTS "ventas_detalles_update" ON ventas_detalles;
DROP POLICY IF EXISTS "ventas_detalles_delete" ON ventas_detalles;
CREATE POLICY "ventas_detalles_select" ON ventas_detalles FOR SELECT TO authenticated USING (true);
CREATE POLICY "ventas_detalles_insert" ON ventas_detalles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ventas_detalles_update" ON ventas_detalles FOR UPDATE TO authenticated USING (true);
CREATE POLICY "ventas_detalles_delete" ON ventas_detalles FOR DELETE TO authenticated USING (true);

-- ==========================================
-- kardex_inventario
-- ==========================================
ALTER TABLE kardex_inventario ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "kardex_inventario_select" ON kardex_inventario;
DROP POLICY IF EXISTS "kardex_inventario_insert" ON kardex_inventario;
DROP POLICY IF EXISTS "kardex_inventario_update" ON kardex_inventario;
DROP POLICY IF EXISTS "kardex_inventario_delete" ON kardex_inventario;
CREATE POLICY "kardex_inventario_select" ON kardex_inventario FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "kardex_inventario_insert" ON kardex_inventario FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
-- UPDATE/DELETE: solo superadmin (el kardex es historico)
CREATE POLICY "kardex_inventario_update" ON kardex_inventario FOR UPDATE TO authenticated
    USING (public.get_es_superadmin());
CREATE POLICY "kardex_inventario_delete" ON kardex_inventario FOR DELETE TO authenticated
    USING (public.get_es_superadmin());

-- ==========================================
-- cuentas_cobrar
-- ==========================================
ALTER TABLE cuentas_cobrar ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cuentas_cobrar_select" ON cuentas_cobrar;
DROP POLICY IF EXISTS "cuentas_cobrar_insert" ON cuentas_cobrar;
DROP POLICY IF EXISTS "cuentas_cobrar_update" ON cuentas_cobrar;
DROP POLICY IF EXISTS "cuentas_cobrar_delete" ON cuentas_cobrar;
CREATE POLICY "cuentas_cobrar_select" ON cuentas_cobrar FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "cuentas_cobrar_insert" ON cuentas_cobrar FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "cuentas_cobrar_update" ON cuentas_cobrar FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "cuentas_cobrar_delete" ON cuentas_cobrar FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());

-- ==========================================
-- notas
-- ==========================================
ALTER TABLE notas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notas_select" ON notas;
DROP POLICY IF EXISTS "notas_insert" ON notas;
DROP POLICY IF EXISTS "notas_update" ON notas;
DROP POLICY IF EXISTS "notas_delete" ON notas;
CREATE POLICY "notas_select" ON notas FOR SELECT TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "notas_insert" ON notas FOR INSERT TO authenticated
    WITH CHECK (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "notas_update" ON notas FOR UPDATE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());
CREATE POLICY "notas_delete" ON notas FOR DELETE TO authenticated
    USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin());


-- ==========================================
-- VERIFICACION (ejecutar por separado)
-- ==========================================
-- Listar todas las politicas del proyecto:
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE tablename NOT IN ('usuarios', 'usuario_negocios', 'negocios')
-- ORDER BY tablename, cmd;

NOTIFY pgrst, 'reload schema';
