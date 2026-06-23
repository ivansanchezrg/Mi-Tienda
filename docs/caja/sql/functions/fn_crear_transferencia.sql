-- =============================================================================
-- DROP — firmas anteriores
-- =============================================================================
DROP FUNCTION IF EXISTS public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, UUID, TEXT);

-- =============================================================================
-- FUNCIÓN: fn_crear_transferencia (v3.0 — FOR UPDATE + consolidación)
-- =============================================================================
-- Crea una transferencia atómica entre dos cajas usando códigos.
--
-- v3.0 (2026-05-30) — Race conditions y limpieza:
--   • Agrega FOR UPDATE en la lectura de ambas cajas (evitaba race condition
--     en transferencias concurrentes desde la misma caja origen).
--   • Lecturas de id/nombre/saldo consolidadas mediante FOR..LOOP atómico
--     (única iteración) en lugar de 3 subqueries idénticas por caja.
--   • Valida que p_empleado_id tenga membresía activa en el negocio.
--   • Elimina EXCEPTION WHEN OTHERS enmascarador.
--
-- v2.1 — descripción contextual:
--   • SALIENTE: "hacia [destino] · [motivo]"
--   • ENTRANTE: "desde [origen] · [motivo]"
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_crear_transferencia(
  p_codigo_origen    TEXT,
  p_codigo_destino   TEXT,
  p_monto            NUMERIC,
  p_empleado_id      UUID,
  p_descripcion      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id          UUID;
  v_origen              RECORD;
  v_destino             RECORD;
  v_nuevo_saldo_origen  NUMERIC;
  v_nuevo_saldo_destino NUMERIC;
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'El monto debe ser mayor a cero');
  END IF;

  IF p_codigo_origen = p_codigo_destino THEN
    RETURN json_build_object('success', false, 'error', 'Las cajas origen y destino no pueden ser la misma');
  END IF;

  -- Validar empleado pertenece al negocio
  IF NOT EXISTS (
    SELECT 1 FROM usuario_negocios
    WHERE usuario_id = p_empleado_id AND negocio_id = v_negocio_id AND activo = TRUE
  ) THEN
    RETURN json_build_object('success', false, 'error', 'El empleado no pertenece a este negocio');
  END IF;

  -- 1. Lock + lectura atómica de caja origen
  FOR v_origen IN
    SELECT id, nombre, saldo_actual
    FROM cajas
    WHERE codigo = p_codigo_origen AND negocio_id = v_negocio_id AND activo = TRUE
    FOR UPDATE
  LOOP
    -- single-row iterator: si hay match, los valores quedan en v_origen
    EXIT;
  END LOOP;

  IF v_origen.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Caja origen no encontrada: ' || p_codigo_origen);
  END IF;

  -- 2. Lock + lectura atómica de caja destino
  FOR v_destino IN
    SELECT id, nombre, saldo_actual
    FROM cajas
    WHERE codigo = p_codigo_destino AND negocio_id = v_negocio_id AND activo = TRUE
    FOR UPDATE
  LOOP
    EXIT;
  END LOOP;

  IF v_destino.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Caja destino no encontrada: ' || p_codigo_destino);
  END IF;

  -- 3. Validar saldo suficiente
  IF v_origen.saldo_actual < p_monto THEN
    RETURN json_build_object(
      'success', false,
      'error', format('Saldo insuficiente en %s. Disponible: $%s, requerido: $%s',
                      v_origen.nombre, v_origen.saldo_actual::TEXT, p_monto::TEXT)
    );
  END IF;

  -- 4. Calcular nuevos saldos
  v_nuevo_saldo_origen  := v_origen.saldo_actual  - p_monto;
  v_nuevo_saldo_destino := v_destino.saldo_actual + p_monto;

  -- 5. SALIENTE en caja origen
  INSERT INTO operaciones_cajas (
    negocio_id, caja_id, empleado_id, tipo_operacion,
    monto, saldo_anterior, saldo_actual, descripcion
  ) VALUES (
    v_negocio_id, v_origen.id, p_empleado_id, 'TRANSFERENCIA_SALIENTE',
    p_monto, v_origen.saldo_actual, v_nuevo_saldo_origen,
    'hacia ' || v_destino.nombre
      || CASE WHEN TRIM(COALESCE(p_descripcion, '')) <> '' THEN ' · ' || p_descripcion ELSE '' END
  );

  -- 6. ENTRANTE en caja destino
  INSERT INTO operaciones_cajas (
    negocio_id, caja_id, empleado_id, tipo_operacion,
    monto, saldo_anterior, saldo_actual, descripcion
  ) VALUES (
    v_negocio_id, v_destino.id, p_empleado_id, 'TRANSFERENCIA_ENTRANTE',
    p_monto, v_destino.saldo_actual, v_nuevo_saldo_destino,
    'desde ' || v_origen.nombre
      || CASE WHEN TRIM(COALESCE(p_descripcion, '')) <> '' THEN ' · ' || p_descripcion ELSE '' END
  );

  -- 7. Actualizar saldos
  UPDATE cajas SET saldo_actual = v_nuevo_saldo_origen  WHERE id = v_origen.id  AND negocio_id = v_negocio_id;
  UPDATE cajas SET saldo_actual = v_nuevo_saldo_destino WHERE id = v_destino.id AND negocio_id = v_negocio_id;

  RETURN json_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, UUID, TEXT) IS
  'v3.0 — FOR UPDATE en ambas cajas, queries consolidadas con RECORD, validación de empleado por negocio.';
