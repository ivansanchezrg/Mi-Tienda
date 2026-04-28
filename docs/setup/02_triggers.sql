-- =============================================================================
-- 02_triggers.sql — Triggers adicionales (no incluidos en schema.sql)
-- =============================================================================
-- Ejecutar DESPUES de 01_rls.sql.
-- Orden: 01_rls → 02_triggers → 03_functions → 04_realtime → 05_seed_dev
--
-- IMPORTANTE: schema.sql ya crea los siguientes triggers internamente.
-- NO se deben repetir aqui (causarian conflicto o versiones degradadas):
--   - trg_updated_at_*                    (fn_set_updated_at)
--   - trg_limpiar_herencia_template       (fn_limpiar_herencia_template)
--   - trg_sync_barcode_*                  (fn_sync_codigo_barras)
--   - trg_proteger_movimiento_empleado    (fn_proteger_movimiento_empleado)
--   - trg_bloquear_delete_movimiento      (fn_bloquear_delete_movimiento)
--   - trg_proteger_operacion_caja         (fn_proteger_operacion_caja)
--   - trg_bloquear_delete_operacion_caja  (fn_proteger_operacion_caja)
--   - trg_sync_superadmin                 (fn_sync_superadmin_to_jwt)
--   - trg_sync_rol                        (fn_sync_rol_to_jwt)
--   - trg_set_codigo_categoria_operacion  (fn_set_codigo_categoria_operacion)
--   - trg_descontar_stock_venta           (fn_actualizar_stock_venta)
--   - trg_actualizar_caja_por_venta       (fn_actualizar_saldo_caja_venta)
--
-- Este archivo SOLO agrega los triggers que schema.sql NO incluye:
--   1. trg_proteger_superadmin  (fuente: docs/auth/sql/setup/trigger_proteger_superadmin.sql)
-- =============================================================================


-- =============================================================================
-- 1. PROTEGER SUPERADMIN
-- Impide cambiar es_superadmin via UPDATE directo en la tabla usuarios.
-- El schema.sql no incluye este trigger — vive en el archivo de auth setup.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_proteger_superadmin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF OLD.es_superadmin = true THEN
        IF NEW.es_superadmin IS DISTINCT FROM OLD.es_superadmin THEN
            RAISE EXCEPTION 'No se puede modificar los permisos del administrador principal del sistema.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_superadmin_update ON usuarios;
CREATE TRIGGER trg_proteger_superadmin_update
    BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION fn_proteger_superadmin();

NOTIFY pgrst, 'reload schema';
