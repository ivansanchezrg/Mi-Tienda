-- ==========================================
-- FUNCIÓN + TRIGGER: fn_generar_codigo_interno
-- ==========================================
-- Genera un código de barras interno EAN-13 para productos que se insertan
-- o actualizan sin código de barras (ej: granos a granel, productos caseros).
--
-- Formato EAN-13 interno:
--   20 XXXXX YYYYY C
--   ├─ 20       = Prefijo reservado para uso interno de tienda (GS1)
--   ├─ XXXXX    = Secuencia incremental (00001..99999)
--   ├─ YYYYY    = Padding ceros
--   └─ C        = Dígito de control EAN-13 (calculado)
--
-- Usa un SEQUENCE de PostgreSQL para garantizar unicidad sin race conditions.
--
-- Ejecutar: una sola vez en Supabase SQL Editor.
-- ==========================================

-- 1. Crear sequence si no existe
CREATE SEQUENCE IF NOT EXISTS seq_codigo_interno_producto START 1 INCREMENT 1;

-- 2. Función que calcula el dígito de control EAN-13
CREATE OR REPLACE FUNCTION fn_ean13_check_digit(p_12_digits TEXT)
RETURNS TEXT AS $$
DECLARE
    v_sum INTEGER := 0;
    v_digit INTEGER;
    v_weight INTEGER;
    v_check INTEGER;
BEGIN
    IF LENGTH(p_12_digits) <> 12 THEN
        RAISE EXCEPTION 'Se esperan 12 dígitos, se recibieron %', LENGTH(p_12_digits);
    END IF;

    FOR i IN 1..12 LOOP
        v_digit := CAST(SUBSTRING(p_12_digits FROM i FOR 1) AS INTEGER);
        v_weight := CASE WHEN i % 2 = 0 THEN 3 ELSE 1 END;
        v_sum := v_sum + (v_digit * v_weight);
    END LOOP;

    v_check := (10 - (v_sum % 10)) % 10;
    RETURN p_12_digits || v_check::TEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE
   SECURITY DEFINER
   SET search_path = public;

-- 3. Trigger function: genera código interno si codigo_barras es NULL o vacío
CREATE OR REPLACE FUNCTION fn_generar_codigo_interno()
RETURNS TRIGGER AS $$
DECLARE
    v_seq INTEGER;
    v_base TEXT;
    v_ean13 TEXT;
BEGIN
    IF NEW.codigo_barras IS NULL OR TRIM(NEW.codigo_barras) = '' THEN
        v_seq := nextval('seq_codigo_interno_producto');

        IF v_seq > 9999999999 THEN
            RAISE EXCEPTION 'Secuencia de códigos internos agotada (máx 9999999999)';
        END IF;

        v_base := '20' || LPAD(v_seq::TEXT, 10, '0');
        v_ean13 := fn_ean13_check_digit(v_base);
        NEW.codigo_barras := v_ean13;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path = public;

-- 4. Trigger en INSERT (no en UPDATE para no sobreescribir códigos editados manualmente)
DROP TRIGGER IF EXISTS trg_generar_codigo_interno ON productos;
CREATE TRIGGER trg_generar_codigo_interno
    BEFORE INSERT ON productos
    FOR EACH ROW
    EXECUTE FUNCTION fn_generar_codigo_interno();

-- 5. Permisos
GRANT USAGE, SELECT ON SEQUENCE seq_codigo_interno_producto TO authenticated;
GRANT EXECUTE ON FUNCTION fn_ean13_check_digit(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_generar_codigo_interno() TO authenticated;

-- 6. Recargar schema de PostgREST
NOTIFY pgrst, 'reload schema';
