-- =============================================================================
-- AUTO-GENERACIÓN DE CÓDIGO PARA CATEGORÍAS
-- =============================================================================
-- Ejecutar en: Supabase SQL Editor
-- Propósito: Triggers que asignan automáticamente el campo `codigo` al insertar
--            una nueva categoría, eliminando la necesidad de que el usuario lo
--            ingrese manualmente.
--
-- FORMATO:
--   categorias_gastos      → GS-001, GS-002, GS-003 ...
--   categorias_operaciones → EG-001, EG-002 ... (EGRESO)
--                            IN-001, IN-002 ... (INGRESO)
--
-- ESTRATEGIA: MAX() + 1 filtrado a códigos válidos del mismo prefijo.
--   - Simple y predecible
--   - Si se elimina GS-003 y existen GS-001/002/004, el próximo será GS-005
--     (no rellena huecos — comportamiento esperado para una app de bajo volumen)
--   - Race condition imposible en uso real (operación admin de baja concurrencia)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. TRIGGER — categorias_gastos
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_set_codigo_categoria_gasto()
RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  -- Obtiene el mayor número de los códigos con formato válido GS-NNN
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

-- Eliminar trigger previo si existía (safe re-run)
DROP TRIGGER IF EXISTS trg_set_codigo_categoria_gasto ON categorias_gastos;

CREATE TRIGGER trg_set_codigo_categoria_gasto
  BEFORE INSERT ON categorias_gastos
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_codigo_categoria_gasto();


-- -----------------------------------------------------------------------------
-- 2. TRIGGER — categorias_operaciones
-- -----------------------------------------------------------------------------
-- El prefijo depende del tipo:
--   EGRESO  → EG
--   INGRESO → IN
-- Cada prefijo tiene su propia secuencia independiente.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_set_codigo_categoria_operacion()
RETURNS TRIGGER AS $$
DECLARE
  v_prefijo VARCHAR(2);
  v_numero  INTEGER;
BEGIN
  -- Determina el prefijo según el tipo
  v_prefijo := CASE NEW.tipo
    WHEN 'EGRESO'  THEN 'EG'
    WHEN 'INGRESO' THEN 'IN'
    ELSE UPPER(SUBSTRING(NEW.tipo FROM 1 FOR 2))
  END;

  -- Obtiene el mayor número del mismo prefijo con formato válido XX-NNN
  SELECT COALESCE(
    MAX(
      CASE WHEN codigo ~ ('^' || v_prefijo || '-\d+$')
        THEN CAST(SUBSTRING(codigo FROM 4) AS INTEGER)
        ELSE 0
      END
    ), 0
  ) + 1
  INTO v_numero
  FROM categorias_operaciones
  WHERE codigo LIKE v_prefijo || '-%';

  NEW.codigo := v_prefijo || '-' || LPAD(v_numero::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Eliminar trigger previo si existía (safe re-run)
DROP TRIGGER IF EXISTS trg_set_codigo_categoria_operacion ON categorias_operaciones;

CREATE TRIGGER trg_set_codigo_categoria_operacion
  BEFORE INSERT ON categorias_operaciones
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_codigo_categoria_operacion();


-- -----------------------------------------------------------------------------
-- VERIFICACIÓN (opcional, ejecutar después de los triggers)
-- -----------------------------------------------------------------------------
-- Prueba que el trigger funciona sin romper datos existentes:
--
-- INSERT INTO categorias_gastos (nombre) VALUES ('Test trigger')
--   RETURNING codigo;  -- debe devolver GS-008 (o el siguiente disponible)
-- DELETE FROM categorias_gastos WHERE nombre = 'Test trigger';
--
-- INSERT INTO categorias_operaciones (tipo, nombre) VALUES ('EGRESO', 'Test EG')
--   RETURNING codigo;  -- debe devolver EG-XXX con el siguiente número
-- DELETE FROM categorias_operaciones WHERE nombre = 'Test EG';
-- -----------------------------------------------------------------------------
