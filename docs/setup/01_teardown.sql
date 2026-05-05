-- =============================================================================
-- TEARDOWN — Limpieza total previa a schema.sql v11.0
-- =============================================================================
-- ⚠️  DESTRUYE TODOS LOS DATOS. Solo para entorno de desarrollo.
-- ⚠️  Ejecutar ANTES de schema.sql cuando se re-crea la BD desde cero.
--
-- Cubre:
--   - Todas las funciones de modulos (docs/*/sql/functions/)
--   - Funciones de setup legacy (trigger_proteger_superadmin,
--     codigo_barras_unique_global, presentaciones_constraints)
--   - Funciones helper JWT (schema auth)
--   - Funciones de setup nuevas (fn_completar_onboarding, fn_set_negocio_activo)
--   - Triggers inline (recreados por schema.sql)
--   - Vistas
--   - Todas las tablas (en orden de dependencia)
--   - Todos los ENUMs
--   - Publicaciones Realtime (se re-agregan tras schema.sql + 02_rls.sql)
--
-- Orden posterior al teardown:
--   1. docs/setup/schema.sql
--   2. docs/setup/02_rls.sql                     (todas las RLS, fuente unica)
--   3. docs/setup/03_functions.sql               (incluye fn_set_negocio_activo)
--   4. docs/onboarding/sql/functions/fn_completar_onboarding.sql
--   5. docs/onboarding/sql/functions/fn_habilitar_recargas.sql
--   6. docs/configuracion/sql/functions/fn_activar_caja_varios.sql
--   7. docs/*/sql/functions/*.sql                (resto de funciones de modulos)
--   8. docs/*/sql/setup/realtime_*.sql
--      — docs/auth/sql/setup/realtime_usuarios.sql
--      — docs/configuracion/sql/setup/realtime_configuraciones.sql
--      — docs/dashboard/sql/setup/realtime_turnos_caja.sql
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
        -- Dashboard
        'fn_abrir_turno',
        'fn_ejecutar_cierre_diario',
        'fn_reparar_deficit_turno',
        'fn_registrar_operacion_manual',
        'fn_crear_transferencia',
        'fn_verificar_transferencia_caja_chica_hoy',
        -- Recargas Virtuales
        'fn_registrar_recarga_proveedor_celular',
        'fn_registrar_pago_proveedor_celular',
        'fn_registrar_compra_saldo_bus',
        'fn_liquidar_ganancias_bus',
        -- POS
        'fn_registrar_venta_pos',
        'fn_anular_venta',
        -- Cuentas por Cobrar
        'fn_registrar_pago_fiado',
        'fn_listar_cuentas_cobrar',
        'fn_resumir_cuentas_cobrar',
        -- Inventario
        'fn_ajustar_stock_inventario',
        'fn_generar_codigo_interno',
        'fn_generar_codigo_interno_presentacion',
        'fn_crear_producto_simple',
        'fn_crear_producto_con_variantes',
        'fn_ean13_check_digit',
        -- Ventas
        'fn_listar_ventas',
        'fn_resumir_ventas',
        'fn_reporte_ventas_periodo',
        -- Movimientos Empleados
        'fn_registrar_adelanto_sueldo',
        'fn_pagar_nomina_empleado',
        -- Notas
        'fn_eliminar_nota',
        -- Setup v11.0
        'fn_crear_negocio',         -- legacy (eliminado en 2026-05-02, lo dejamos aqui por si quedo en una BD vieja)
        'fn_completar_onboarding',
        'fn_set_negocio_activo',
        'fn_suspender_negocio',
        'fn_activar_caja_varios',
        'fn_habilitar_recargas'
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
-- 2. FUNCIONES HELPER JWT (schema auth)
-- NO se dropean aqui — son propiedad de Supabase (permission denied).
-- schema.sql usa CREATE OR REPLACE, que las sobreescribe sin necesidad de DROP.
-- =============================================================================

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
DROP TABLE IF EXISTS public.usuario_negocios            CASCADE;
DROP TABLE IF EXISTS public.usuarios                    CASCADE;
DROP TABLE IF EXISTS public.negocios                    CASCADE;
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
