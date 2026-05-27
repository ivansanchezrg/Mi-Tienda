-- =============================================================================
-- DROP — firma cambia en v2.0 (p_empleado_id INTEGER → UUID)
-- =============================================================================
DROP FUNCTION IF EXISTS public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, UUID, TEXT);

-- =============================================================================
-- FUNCIÓN: fn_crear_transferencia (v2.1 — descripción contextual)
-- =============================================================================
-- Crea una transferencia atómica entre dos cajas usando códigos.
-- Busca las cajas por código, valida saldo suficiente en el origen,
-- registra las dos operaciones y actualiza los saldos en una sola
-- transacción (todo o nada).
--
-- CAMBIOS v2.0:
--   - p_empleado_id: INTEGER → UUID
--   - v_caja_origen_id, v_caja_destino_id: INTEGER → UUID
--   - Negocio leído del JWT (get_negocio_id()); cajas filtran por negocio_id
--   - operaciones_cajas INSERT incluye negocio_id
--
-- CAMBIOS v2.1:
--   - descripcion SALIENTE: "hacia [destino] · [motivo]"
--   - descripcion ENTRANTE: "desde [origen] · [motivo]"
--   - El frontend usa estos prefijos para construir el label contextual en el home
--
-- Llamada desde: CajasService.crearTransferencia()
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
  v_caja_origen_id      UUID;
  v_caja_destino_id     UUID;
  v_nombre_origen       TEXT;
  v_nombre_destino      TEXT;
  v_saldo_origen        NUMERIC;
  v_saldo_destino       NUMERIC;
  v_nuevo_saldo_origen  NUMERIC;
  v_nuevo_saldo_destino NUMERIC;
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  -- Obtener negocio del JWT
  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
  END IF;

  -- 1. Obtener caja origen por código
  v_caja_origen_id := (SELECT id           FROM cajas WHERE codigo = p_codigo_origen  AND negocio_id = v_negocio_id AND activo = true);
  v_nombre_origen  := (SELECT nombre       FROM cajas WHERE codigo = p_codigo_origen  AND negocio_id = v_negocio_id AND activo = true);
  v_saldo_origen   := (SELECT saldo_actual FROM cajas WHERE codigo = p_codigo_origen  AND negocio_id = v_negocio_id AND activo = true);

  IF v_caja_origen_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Caja origen no encontrada: ' || p_codigo_origen);
  END IF;

  -- 2. Obtener caja destino por código
  v_caja_destino_id := (SELECT id           FROM cajas WHERE codigo = p_codigo_destino AND negocio_id = v_negocio_id AND activo = true);
  v_nombre_destino  := (SELECT nombre       FROM cajas WHERE codigo = p_codigo_destino AND negocio_id = v_negocio_id AND activo = true);
  v_saldo_destino   := (SELECT saldo_actual FROM cajas WHERE codigo = p_codigo_destino AND negocio_id = v_negocio_id AND activo = true);

  IF v_caja_destino_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Caja destino no encontrada: ' || p_codigo_destino);
  END IF;

  -- 3. Validar saldo suficiente en origen
  IF v_saldo_origen < p_monto THEN
    RETURN json_build_object(
      'success', false,
      'error', format('Saldo insuficiente en %s. Disponible: $%s, requerido: $%s',
                      v_nombre_origen,
                      v_saldo_origen::TEXT,
                      p_monto::TEXT)
    );
  END IF;

  -- 4. Calcular nuevos saldos
  v_nuevo_saldo_origen  := v_saldo_origen  - p_monto;
  v_nuevo_saldo_destino := v_saldo_destino + p_monto;

  -- 5. Insertar operación SALIENTE en caja origen
  INSERT INTO operaciones_cajas (
    negocio_id, caja_id, empleado_id, tipo_operacion,
    monto, saldo_anterior, saldo_actual, descripcion
  ) VALUES (
    v_negocio_id, v_caja_origen_id, p_empleado_id, 'TRANSFERENCIA_SALIENTE',
    p_monto, v_saldo_origen, v_nuevo_saldo_origen,
    'hacia ' || v_nombre_destino || CASE WHEN TRIM(COALESCE(p_descripcion, '')) != '' THEN ' · ' || p_descripcion ELSE '' END
  );

  -- 6. Insertar operación ENTRANTE en caja destino
  INSERT INTO operaciones_cajas (
    negocio_id, caja_id, empleado_id, tipo_operacion,
    monto, saldo_anterior, saldo_actual, descripcion
  ) VALUES (
    v_negocio_id, v_caja_destino_id, p_empleado_id, 'TRANSFERENCIA_ENTRANTE',
    p_monto, v_saldo_destino, v_nuevo_saldo_destino,
    'desde ' || v_nombre_origen || CASE WHEN TRIM(COALESCE(p_descripcion, '')) != '' THEN ' · ' || p_descripcion ELSE '' END
  );

  -- 7. Actualizar saldo origen
  UPDATE cajas SET saldo_actual = v_nuevo_saldo_origen WHERE id = v_caja_origen_id AND negocio_id = v_negocio_id;

  -- 8. Actualizar saldo destino
  UPDATE cajas SET saldo_actual = v_nuevo_saldo_destino WHERE id = v_caja_destino_id AND negocio_id = v_negocio_id;

  RETURN json_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_crear_transferencia(TEXT, TEXT, NUMERIC, UUID, TEXT) IS
  'v2.1 — Transfiere monto entre dos cajas por código. Operación atómica. '
  'descripcion SALIENTE: "hacia [destino] · [motivo]", ENTRANTE: "desde [origen] · [motivo]".';
