-- ============================================================
-- Unicidad global de código de barras (productos + presentaciones)
-- ============================================================
-- NOTA: esta lógica fue reemplazada por la tabla codigos_barras +
-- fn_sync_codigo_barras (schema.sql). Este archivo se conserva como
-- archivo de mantenimiento puntual — re-ejecutable en cualquier momento.
--
-- DROP + CREATE garantiza que siempre queda la versión limpia.
-- ============================================================

-- ── Limpiar versión anterior ───────────────────────────────
DROP TRIGGER IF EXISTS trg_codigo_barras_unico_productos      ON productos;
DROP TRIGGER IF EXISTS trg_codigo_barras_unico_presentaciones ON producto_presentaciones;
DROP FUNCTION IF EXISTS fn_validar_codigo_barras_unico() CASCADE;

-- ── Función de validación ──────────────────────────────────

CREATE OR REPLACE FUNCTION fn_validar_codigo_barras_unico()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Solo validar si el código no es NULL
    IF NEW.codigo_barras IS NULL THEN
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'productos' THEN
        -- Verificar que no exista en producto_presentaciones
        IF EXISTS (
            SELECT 1 FROM producto_presentaciones
            WHERE codigo_barras = NEW.codigo_barras
              AND id != COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
        ) THEN
            RAISE EXCEPTION 'El código de barras "%" ya está asignado a una presentación existente', NEW.codigo_barras;
        END IF;

    ELSIF TG_TABLE_NAME = 'producto_presentaciones' THEN
        -- Verificar que no exista en productos
        IF EXISTS (
            SELECT 1 FROM productos
            WHERE codigo_barras = NEW.codigo_barras
              AND id != COALESCE(NEW.producto_id, '00000000-0000-0000-0000-000000000000'::uuid)
        ) THEN
            RAISE EXCEPTION 'El código de barras "%" ya está asignado a un producto existente', NEW.codigo_barras;
        END IF;

        -- Verificar que no exista en otra presentación (distinta al registro actual)
        IF EXISTS (
            SELECT 1 FROM producto_presentaciones
            WHERE codigo_barras = NEW.codigo_barras
              AND id IS DISTINCT FROM NEW.id
        ) THEN
            RAISE EXCEPTION 'El código de barras "%" ya está asignado a otra presentación', NEW.codigo_barras;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- ── Triggers en ambas tablas ───────────────────────────────

DROP TRIGGER IF EXISTS trg_codigo_barras_unico_productos ON productos;
CREATE TRIGGER trg_codigo_barras_unico_productos
    BEFORE INSERT OR UPDATE OF codigo_barras ON productos
    FOR EACH ROW
    EXECUTE FUNCTION fn_validar_codigo_barras_unico();

DROP TRIGGER IF EXISTS trg_codigo_barras_unico_presentaciones ON producto_presentaciones;
CREATE TRIGGER trg_codigo_barras_unico_presentaciones
    BEFORE INSERT OR UPDATE OF codigo_barras ON producto_presentaciones
    FOR EACH ROW
    EXECUTE FUNCTION fn_validar_codigo_barras_unico();

-- ── Permisos ───────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION fn_validar_codigo_barras_unico() FROM anon;
GRANT  EXECUTE ON FUNCTION fn_validar_codigo_barras_unico() TO authenticated;

NOTIFY pgrst, 'reload schema';
