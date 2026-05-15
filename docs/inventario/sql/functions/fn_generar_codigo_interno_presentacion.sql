-- ==========================================
-- TRIGGER: fn_generar_codigo_interno_presentacion
-- ==========================================
-- Genera un código de barras interno EAN-13 para presentaciones
-- que se insertan sin código de barras.
--
-- Reutiliza:
--   - fn_ean13_check_digit()       → ya existe (fn_generar_codigo_interno.sql)
--   - seq_codigo_interno_producto  → ya existe, comparte secuencia con productos
--
-- Prefijo 21 (distinto al 20 de productos) para evitar colisiones.
-- Ambos prefijos son válidos dentro del rango GS1 reservado para uso interno (20-29).
--
-- Ejecutar: una sola vez en Supabase SQL Editor, después de fn_generar_codigo_interno.sql.
-- ==========================================

CREATE OR REPLACE FUNCTION fn_generar_codigo_interno_presentacion()
RETURNS TRIGGER AS $$
DECLARE
    v_seq   BIGINT;
    v_base  TEXT;
    v_ean13 TEXT;
BEGIN
    IF NEW.codigo_barras IS NULL OR TRIM(NEW.codigo_barras) = '' THEN
        v_seq := nextval('seq_codigo_interno_producto');

        IF v_seq > 9999999999 THEN
            RAISE EXCEPTION 'Secuencia de códigos internos agotada (máx 9999999999)';
        END IF;

        v_base  := '21' || LPAD(v_seq::TEXT, 10, '0');
        v_ean13 := fn_ean13_check_digit(v_base);
        NEW.codigo_barras := v_ean13;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

-- Trigger en INSERT (no en UPDATE para no sobreescribir códigos editados manualmente)
DROP TRIGGER IF EXISTS trg_generar_codigo_interno_presentacion ON producto_presentaciones;
CREATE TRIGGER trg_generar_codigo_interno_presentacion
    BEFORE INSERT ON producto_presentaciones
    FOR EACH ROW
    EXECUTE FUNCTION fn_generar_codigo_interno_presentacion();

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_generar_codigo_interno_presentacion() FROM anon;
GRANT EXECUTE ON FUNCTION fn_generar_codigo_interno_presentacion() TO authenticated;

-- Recargar schema de PostgREST
NOTIFY pgrst, 'reload schema';
