-- =============================================================================
-- TEARDOWN — Limpieza total previa a schema.sql v11.0
-- =============================================================================
-- ⚠️  DESTRUYE TODOS LOS DATOS. Solo para entorno de desarrollo.
-- ⚠️  Ejecutar ANTES de schema.sql cuando se re-crea la BD desde cero.
--
-- Cubre:
--   - Todas las funciones de modulos (docs/*/sql/functions/)
--   - Funciones de setup (fn_assert_no_superadmin, fn_set_negocio_activo,
--     fn_registrar_usuario_negocio, fn_completar_onboarding, fn_configurar_modulos*)
--   - Funciones de trigger inline (schema.sql + setup legacy)
--   - Funciones helper JWT (schema auth) — NO se dropean (propiedad de Supabase)
--   - Vistas
--   - Todas las tablas (en orden de dependencia)
--   - Todos los ENUMs
--   - Publicaciones Realtime (se re-agregan tras schema.sql + 02_rls.sql)
--
-- Orden posterior al teardown:
--   1. docs/setup/schema.sql
--   2. docs/setup/02_rls.sql                     (todas las RLS, fuente unica)
--   3. docs/setup/03_functions.sql               (fn_set_negocio_activo, fn_registrar_usuario_negocio)
--   4. docs/setup/fn_assert_no_superadmin.sql    (helper bloqueo superadmin — antes de cualquier funcion de mutacion)
--   5. docs/auth/sql/setup/trigger_proteger_superadmin.sql
--   6. docs/auth/sql/setup/trigger_proteger_propietario.sql
--   7. docs/onboarding/sql/functions/fn_completar_onboarding.sql
--   8. docs/onboarding/sql/functions/fn_configurar_modulos.sql
--   9. docs/admin/sql/functions/fn_configurar_modulos_admin.sql
--  10. docs/admin/sql/functions/fn_consultar_usuario_por_email.sql
--  11. docs/usuarios/sql/functions/fn_actualizar_membresia.sql
--  13. docs/usuarios/sql/functions/fn_transferir_empleado.sql
--  14. docs/*/sql/functions/*.sql                (resto de funciones de modulos)
--  15. docs/*/sql/setup/realtime_*.sql
--      — docs/configuracion/sql/setup/realtime_configuraciones.sql
--      — docs/caja/sql/setup/realtime_turnos_caja.sql
--      — docs/caja/sql/setup/realtime_cajas.sql
--      — docs/usuarios/sql/setup/realtime_usuario_negocios.sql
-- =============================================================================

-- =============================================================================
-- 1. FUNCIONES DE MODULOS — drop por nombre sin firma
-- Se usa pg_proc para encontrar TODAS las sobrecargas de cada funcion,
-- independientemente de los tipos de argumento (evita mismatch de firmas
-- entre schema v10.1 con SERIAL/INTEGER y v11.0 con UUID).
-- =============================================================================
DO $$
DECLARE
    v_nombres TEXT[] := ARRAY[
        -- Caja
        'fn_abrir_turno',
        'fn_ejecutar_cierre_diario',        -- legacy nombre anterior
        'fn_ejecutar_cierre_diario_v5',
        'fn_reparar_deficit_turno',
        'fn_registrar_operacion_manual',
        'fn_crear_transferencia',
        'fn_verificar_transferencia_caja_chica_hoy',
        -- Recargas Virtuales
        'fn_registrar_recarga_proveedor_celular',
        'fn_registrar_pago_proveedor_celular',
        'fn_registrar_compra_saldo_bus',
        'fn_liquidar_ganancias',
        -- POS
        'fn_registrar_venta_pos',
        'fn_anular_venta',
        'fn_buscar_productos_pos',
        'fn_catalogo_productos_pos',
        -- Dashboard
        'fn_home_dashboard',
        -- Caja — historial
        'fn_listar_cierres_turno',
        -- Recargas Virtuales
        'fn_pagar_proveedor_celular',
        -- Auth
        'fn_validar_sesion',
        -- Clientes / Cuentas por Cobrar
        'fn_registrar_pago_fiado',
        'fn_listar_cuentas_cobrar',
        'fn_resumir_cuentas_cobrar',
        'fn_listar_clientes_con_saldo',
        -- Inventario
        'fn_ajustar_stock_inventario',
        'fn_generar_codigo_interno',
        'fn_generar_codigo_interno_presentacion',
        'fn_crear_producto_simple',
        'fn_crear_producto_con_variantes',
        'fn_ean13_check_digit',
        'fn_listar_productos',
        -- Ventas
        'fn_listar_ventas',
        'fn_reporte_ventas_periodo',
        -- Movimientos Empleados
        'fn_registrar_adelanto_sueldo',
        'fn_pagar_nomina_empleado',
        -- Usuarios
        'fn_actualizar_membresia',
        'fn_transferir_empleado',
        -- Admin
        'fn_consultar_usuario_por_email',
        'fn_suspender_usuario',                     -- legacy (reemplazada por fn_suspender_propietario_suscripcion, 2026-06-16)
        -- Notas
        'fn_eliminar_nota',
        -- Usuarios helpers
        'fn_get_usuarios_asignables',
        'comparten_negocio',
        -- Ventas
        'fn_resumir_ventas',
        -- Recargas Virtuales (bus)
        'fn_liquidar_ganancias_bus',
        -- Setup v11.0
        'fn_assert_no_superadmin',
        'fn_registrar_usuario_negocio',
        'fn_crear_negocio',         -- legacy (eliminado en 2026-05-02, lo dejamos aqui por si quedo en una BD vieja)
        'fn_completar_onboarding',
        'fn_set_negocio_activo',
        'fn_suspender_negocio',
        'fn_activar_caja_varios',
        'fn_habilitar_recargas',
        'fn_habilitar_recargas_admin',
        'fn_configurar_modulos',
        'fn_configurar_modulos_admin',
        -- Suscripciones / Monetizacion
        'fn_estado_suscripcion',
        'fn_registrar_pago_propietario',            -- pago por dueño (renueva todos sus negocios)
        'fn_registrar_pago_suscripcion',            -- eliminada 2026-06-16 (reemplazada por fn_registrar_pago_propietario); se deja para limpiar BD vieja
        'fn_suspender_suscripcion',                 -- legacy (reemplazada por fn_suspender_propietario_suscripcion, 2026-06-16)
        'fn_suspender_propietario_suscripcion',     -- suspende todos los negocios del propietario
        'fn_listar_suscripciones_admin'
    ];
    v_nombre TEXT;
    v_oid    OID;
    v_firma  TEXT;
BEGIN
    FOREACH v_nombre IN ARRAY v_nombres LOOP
        FOR v_oid IN
            SELECT p.oid
            FROM pg_proc p
            INNER JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = v_nombre
        LOOP
            v_firma := pg_get_function_identity_arguments(v_oid);
            EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', v_nombre, v_firma);
        END LOOP;
    END LOOP;
END $$;

-- =============================================================================
-- 2. FUNCIONES HELPER JWT (public schema, recreadas por schema.sql)
-- Intentamos dropearlas; si Supabase da permission denied, se ignora el error.
-- schema.sql usa CREATE OR REPLACE de todas formas — el resultado es el mismo.
-- =============================================================================
DO $$
BEGIN
    DROP FUNCTION IF EXISTS public.get_negocio_id()   CASCADE;
    DROP FUNCTION IF EXISTS public.get_es_superadmin() CASCADE;
    DROP FUNCTION IF EXISTS public.get_rol()           CASCADE;
    DROP FUNCTION IF EXISTS public.get_email()         CASCADE;
EXCEPTION WHEN insufficient_privilege OR others THEN
    NULL;  -- Supabase puede denegar el DROP — schema.sql las sobreescribe igual
END $$;

-- =============================================================================
-- 3. FUNCIONES DE TRIGGER INLINE y LEGACY (recreadas por schema.sql)
-- Mismo patron: drop por nombre sin firma via pg_proc.
-- =============================================================================
DO $$
DECLARE
    v_nombres TEXT[] := ARRAY[
        'fn_set_updated_at',
        'fn_limpiar_herencia_template',
        'fn_sync_codigo_barras',
        'fn_proteger_movimiento_empleado',
        'fn_bloquear_delete_movimiento',
        'fn_proteger_operacion_caja',
        'fn_sync_superadmin_to_jwt',
        'fn_sync_rol_to_jwt',
        'fn_set_codigo_categoria_operacion',
        'fn_actualizar_stock_venta',
        'fn_actualizar_saldo_caja_venta',
        'fn_proteger_propietario_negocio',
        'fn_validar_codigo_barras_unico',
        -- Legacy v10.1
        'fn_proteger_cambio_superadmin',
        'fn_proteger_superadmin'
    ];
    v_nombre TEXT;
    v_oid    OID;
    v_firma  TEXT;
BEGIN
    FOREACH v_nombre IN ARRAY v_nombres LOOP
        FOR v_oid IN
            SELECT p.oid
            FROM pg_proc p
            INNER JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = v_nombre
        LOOP
            v_firma := pg_get_function_identity_arguments(v_oid);
            EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', v_nombre, v_firma);
        END LOOP;
    END LOOP;
END $$;

-- =============================================================================
-- 3b. TRIGGERS LEGACY (DROP explicito — el CASCADE de la funcion los elimina,
--     pero los listamos para claridad y por si la funcion ya no existe)
-- =============================================================================
DO $$
BEGIN
    DROP TRIGGER IF EXISTS trg_codigo_barras_unico_productos      ON public.productos;
    DROP TRIGGER IF EXISTS trg_codigo_barras_unico_presentaciones ON public.producto_presentaciones;
EXCEPTION WHEN undefined_table OR others THEN
    NULL;  -- ignorar si la tabla ya no existe
END $$;

-- =============================================================================
-- 4. VISTAS
-- =============================================================================
DROP VIEW IF EXISTS public.v_saldos_empleados    CASCADE;
DROP VIEW IF EXISTS public.v_productos_completos CASCADE;

-- =============================================================================
-- 5. TABLAS (orden: mas dependiente → menos)
-- =============================================================================
DROP TABLE IF EXISTS public.notas                       CASCADE;
DROP TABLE IF EXISTS public.cuentas_cobrar              CASCADE;
DROP TABLE IF EXISTS public.ventas_detalles             CASCADE;
DROP TABLE IF EXISTS public.kardex_inventario           CASCADE;
DROP TABLE IF EXISTS public.ventas                      CASCADE;
DROP TABLE IF EXISTS public.secuencias_comprobantes     CASCADE;
DROP TABLE IF EXISTS public.codigos_barras              CASCADE;
DROP TABLE IF EXISTS public.producto_presentaciones     CASCADE;
DROP TABLE IF EXISTS public.producto_atributos          CASCADE;
DROP TABLE IF EXISTS public.productos                   CASCADE;
DROP TABLE IF EXISTS public.template_atributo_opciones  CASCADE;
DROP TABLE IF EXISTS public.template_atributos          CASCADE;
DROP TABLE IF EXISTS public.producto_templates          CASCADE;
DROP TABLE IF EXISTS public.atributo_opciones           CASCADE;
DROP TABLE IF EXISTS public.atributos                   CASCADE;
DROP TABLE IF EXISTS public.categorias_productos        CASCADE;
DROP TABLE IF EXISTS public.clientes                    CASCADE;
DROP TABLE IF EXISTS public.movimientos_empleados       CASCADE;
DROP TABLE IF EXISTS public.operaciones_cajas           CASCADE;
DROP TABLE IF EXISTS public.turnos_caja                 CASCADE;
DROP TABLE IF EXISTS public.recargas                    CASCADE;
DROP TABLE IF EXISTS public.recargas_virtuales          CASCADE;
DROP TABLE IF EXISTS public.categorias_operaciones      CASCADE;
DROP TABLE IF EXISTS public.cajas                       CASCADE;
DROP TABLE IF EXISTS public.configuraciones             CASCADE;
DROP TABLE IF EXISTS public.suscripcion_pagos           CASCADE;
DROP TABLE IF EXISTS public.suscripciones               CASCADE;
DROP TABLE IF EXISTS public.usuario_negocios            CASCADE;
DROP TABLE IF EXISTS public.usuarios                    CASCADE;
DROP TABLE IF EXISTS public.negocios                    CASCADE;
DROP TABLE IF EXISTS public.config_plataforma           CASCADE;
DROP TABLE IF EXISTS public.metodos_pago_suscripcion    CASCADE;
DROP TABLE IF EXISTS public.planes                      CASCADE;
DROP TABLE IF EXISTS public.tipos_referencia            CASCADE;
DROP TABLE IF EXISTS public.tipos_servicio              CASCADE;
-- Vestigios legacy
DROP TABLE IF EXISTS public.cierres_diarios             CASCADE;
DROP TABLE IF EXISTS public.gastos_diarios              CASCADE;

-- =============================================================================
-- 6. TIPOS ENUMERADOS
-- =============================================================================
DROP TYPE IF EXISTS public.tipo_operacion_caja_enum        CASCADE;
DROP TYPE IF EXISTS public.rol_usuario_enum                CASCADE;
DROP TYPE IF EXISTS public.tipo_comprobante_enum           CASCADE;
DROP TYPE IF EXISTS public.tipo_movimiento_empleado_enum   CASCADE;
-- Legacies del schema v10.1 (por si quedaron con otro nombre)
DROP TYPE IF EXISTS public.tipo_operacion_enum             CASCADE;
DROP TYPE IF EXISTS public.rol_enum                        CASCADE;
DROP TYPE IF EXISTS public.estado_liquidacion_enum         CASCADE;

-- =============================================================================
-- 7. PUBLICACIONES REALTIME
-- Quitar tablas de la publicacion para que realtime_*.sql las re-agregue limpio.
-- Se usa DO $$ para que no falle si la tabla ya no esta en la publicacion.
-- =============================================================================
DO $$
DECLARE
    v_tablas TEXT[] := ARRAY[
        'usuarios', 'negocios', 'usuario_negocios',
        'cajas', 'configuraciones', 'turnos_caja',
        'productos', 'producto_presentaciones', 'categorias_productos'
    ];
    v_tabla TEXT;
BEGIN
    FOREACH v_tabla IN ARRAY v_tablas LOOP
        BEGIN
            EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE %I', v_tabla);
        EXCEPTION WHEN undefined_table OR undefined_object OR OTHERS THEN
            NULL;  -- ignorar si la tabla no estaba en la publicacion
        END;
    END LOOP;
END $$;

-- =============================================================================
-- VERIFICACION (ejecutar por separado para confirmar que quedo limpio)
-- =============================================================================
-- Tablas que no deberian existir tras el teardown:
-- SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
--
-- Funciones que no deberian existir:
-- SELECT routine_name FROM information_schema.routines
-- WHERE routine_schema = 'public' ORDER BY routine_name;
--
-- Tipos que no deberian existir:
-- SELECT typname FROM pg_type
-- WHERE typnamespace = 'public'::regnamespace AND typtype = 'e';
--
-- Publicaciones:
-- SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
-- =============================================================================
