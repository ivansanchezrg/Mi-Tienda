-- =============================================================================
-- TRIGGER: trg_set_codigo_categoria_gasto
-- =============================================================================
-- Tabla:    categorias_gastos (BEFORE INSERT)
-- Función:  fn_set_codigo_categoria_gasto
-- Propósito: Asigna automáticamente el campo `codigo` al insertar una nueva
--            categoría de gasto, sin que el usuario deba ingresarlo.
-- Formato:  GS-001, GS-002, GS-003 ...
-- Estrategia: MAX() + 1 filtrado a códigos con formato válido GS-NNN.
--   - No rellena huecos si se borra un registro intermedio.
--   - Sin race conditions (operación admin de baja concurrencia).
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_set_codigo_categoria_gasto()
RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  SELECT COALESCE(
    MAX(
      CASE WHEN codigo ~ '^GS-\d+$'
        THEN CAST(SUBSTRING(codigo FROM 4) AS INTEGER)
        ELSE 0
      END
    ), 0
  ) + 1
  INTO v_numero
  FROM categorias_gastos;

  NEW.codigo := 'GS-' || LPAD(v_numero::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_set_codigo_categoria_gasto ON categorias_gastos;

CREATE TRIGGER trg_set_codigo_categoria_gasto
  BEFORE INSERT ON categorias_gastos
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_codigo_categoria_gasto();
