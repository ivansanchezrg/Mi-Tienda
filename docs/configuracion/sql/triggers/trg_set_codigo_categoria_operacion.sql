-- =============================================================================
-- TRIGGER: trg_set_codigo_categoria_operacion
-- =============================================================================
-- Fuente de verdad: schema.sql (esta es una copia para re-ejecucion puntual).
-- Usar este archivo si el trigger falla o hay que recrearlo sin correr schema.sql.
--
-- Tabla:    categorias_operaciones (BEFORE INSERT)
-- Función:  fn_set_codigo_categoria_operacion
-- Propósito: Asigna automáticamente el campo `codigo` al insertar una nueva
--            categoría de operación según su tipo.
-- Formato:
--   EGRESO  → EG-001, EG-002 ...
--   INGRESO → IN-001, IN-002 ...
-- Estrategia: MAX() + 1 por prefijo independiente, dentro del mismo negocio.
--   - pg_advisory_xact_lock: evita race condition en INSERTs concurrentes.
-- =============================================================================

CREATE OR REPLACE FUNCTION fn_set_codigo_categoria_operacion()
RETURNS TRIGGER AS $$
DECLARE
  v_prefijo VARCHAR(2);
  v_numero  INTEGER;
BEGIN
  v_prefijo := CASE NEW.tipo
    WHEN 'EGRESO'  THEN 'EG'
    WHEN 'INGRESO' THEN 'IN'
    ELSE UPPER(SUBSTRING(NEW.tipo FROM 1 FOR 2))
  END;

  -- Lock de sesion por negocio: previene que dos INSERTs concurrentes lean el mismo MAX
  -- y asignen el mismo codigo dentro del mismo negocio.
  PERFORM pg_advisory_xact_lock(hashtext(NEW.negocio_id::text || v_prefijo));

  v_numero := (
    SELECT COALESCE(
      MAX(
        CASE WHEN codigo ~ ('^' || v_prefijo || '-\d+$')
          THEN CAST(SUBSTRING(codigo FROM 4) AS INTEGER)
          ELSE 0
        END
      ), 0
    ) + 1
    FROM categorias_operaciones
    WHERE negocio_id = NEW.negocio_id
      AND codigo LIKE v_prefijo || '-%'
  );

  NEW.codigo := v_prefijo || '-' || LPAD(v_numero::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_set_codigo_categoria_operacion ON categorias_operaciones;

CREATE TRIGGER trg_set_codigo_categoria_operacion
  BEFORE INSERT ON categorias_operaciones
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_codigo_categoria_operacion();
