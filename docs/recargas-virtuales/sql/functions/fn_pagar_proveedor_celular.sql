-- ==========================================
-- FUNCIÓN: fn_pagar_proveedor_celular
-- VERSIÓN: 1.0
-- FECHA: 2026-05-21
-- ==========================================
-- Registra el pago al proveedor CELULAR:
--   - Descuenta monto_a_pagar de CAJA_CELULAR
--   - Marca las filas seleccionadas como pagado_proveedor=true
--   - La ganancia queda en CAJA_CELULAR hasta que se ejecute fn_liquidar_ganancias('CELULAR')
--
-- Parámetros:
--   p_empleado_id    UUID     Empleado que registra el pago
--   p_ids_recargas   UUID[]   IDs de recargas_virtuales a marcar como pagadas
--
-- Retorna JSON:
--   success, total_pagado, filas_afectadas, saldo_caja_celular_nuevo, message
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_pagar_proveedor_celular(
  p_empleado_id  UUID,
  p_ids_recargas UUID[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id         UUID;
  v_caja_celular_id    UUID;
  -- UUID fijo de categorias_sistema para PAGO-PROV-CEL
  v_categoria_id       CONSTANT UUID := 'a1000001-0000-0000-0000-000000000011';
  v_tipo_ref_rv_id     INTEGER;
  v_saldo_anterior     DECIMAL(12,2);
  v_saldo_nuevo        DECIMAL(12,2);
  v_total_a_pagar      DECIMAL(12,2);
  v_filas_afectadas    INTEGER;
  v_operacion_id       UUID;
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RAISE EXCEPTION 'No hay negocio activo en el JWT';
  END IF;

  IF p_ids_recargas IS NULL OR array_length(p_ids_recargas, 1) = 0 THEN
    RAISE EXCEPTION 'Debes seleccionar al menos una recarga para pagar';
  END IF;

  -- ==========================================
  -- 1. OBTENER IDs Y CONFIGURACIÓN
  -- ==========================================

  v_caja_celular_id := (SELECT id FROM cajas WHERE codigo = 'CAJA_CELULAR' AND negocio_id = v_negocio_id);
  -- v_categoria_id: CONSTANT declarada en DECLARE (UUID fijo de categorias_sistema)
  v_tipo_ref_rv_id  := (SELECT id FROM tipos_referencia WHERE tabla = 'recargas_virtuales' LIMIT 1);

  IF v_caja_celular_id IS NULL THEN
    RAISE EXCEPTION 'Caja CAJA_CELULAR no encontrada';
  END IF;

  -- ==========================================
  -- 2. CALCULAR TOTAL A PAGAR
  -- Solo filas que pertenecen al negocio, aún no pagadas, y están en la lista
  -- ==========================================

  v_total_a_pagar := (
    SELECT COALESCE(SUM(monto_a_pagar), 0)
    FROM recargas_virtuales
    WHERE id = ANY(p_ids_recargas)
      AND negocio_id = v_negocio_id
      AND pagado_proveedor = false
  );

  IF v_total_a_pagar <= 0 THEN
    RAISE EXCEPTION 'No hay montos válidos para pagar en las recargas seleccionadas';
  END IF;

  -- ==========================================
  -- 3. VALIDAR SALDO CAJA_CELULAR
  -- ==========================================

  PERFORM id FROM cajas WHERE id = v_caja_celular_id FOR UPDATE;
  v_saldo_anterior := (SELECT saldo_actual FROM cajas WHERE id = v_caja_celular_id);

  IF v_saldo_anterior < v_total_a_pagar THEN
    RAISE EXCEPTION 'Saldo insuficiente en Caja Celular. Disponible: $%, Requerido: $%',
      v_saldo_anterior, v_total_a_pagar;
  END IF;

  v_saldo_nuevo  := v_saldo_anterior - v_total_a_pagar;
  v_operacion_id := gen_random_uuid();

  -- ==========================================
  -- 4. EGRESO EN CAJA_CELULAR
  -- ==========================================

  INSERT INTO operaciones_cajas (
    id, negocio_id, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    categoria_sistema_id, tipo_referencia_id,
    descripcion
  ) VALUES (
    v_operacion_id, v_negocio_id, v_caja_celular_id, p_empleado_id,
    'EGRESO', v_total_a_pagar,
    v_saldo_anterior, v_saldo_nuevo,
    v_categoria_id, v_tipo_ref_rv_id,
    'Pago al proveedor celular — ' || array_length(p_ids_recargas, 1) || ' recarga(s)'
  );

  -- ==========================================
  -- 5. MARCAR RECARGAS COMO PAGADAS
  -- ==========================================

  UPDATE recargas_virtuales
  SET pagado_proveedor     = true,
      fecha_pago_proveedor = CURRENT_DATE,
      operacion_pago_id    = v_operacion_id
  WHERE id = ANY(p_ids_recargas)
    AND negocio_id = v_negocio_id
    AND pagado_proveedor = false;

  GET DIAGNOSTICS v_filas_afectadas = ROW_COUNT;

  -- ==========================================
  -- 6. ACTUALIZAR SALDO CAJA_CELULAR
  -- ==========================================

  UPDATE cajas SET saldo_actual = v_saldo_nuevo WHERE id = v_caja_celular_id;

  -- ==========================================
  -- 7. RETORNAR RESULTADO
  -- ==========================================

  RETURN json_build_object(
    'success',                  true,
    'total_pagado',             v_total_a_pagar,
    'filas_afectadas',          v_filas_afectadas,
    'saldo_caja_celular_nuevo', v_saldo_nuevo,
    'message',                  'Pago al proveedor registrado: $' || v_total_a_pagar ||
                                ' (' || v_filas_afectadas || ' recarga(s) marcadas como pagadas)'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_pagar_proveedor_celular(UUID, UUID[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_pagar_proveedor_celular(UUID, UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_pagar_proveedor_celular IS
'v1.0 - Paga al proveedor CELULAR por las recargas seleccionadas.
EGRESO de CAJA_CELULAR por SUM(monto_a_pagar) de las filas.
Marca pagado_proveedor=true + fecha_pago_proveedor + operacion_pago_id.
La ganancia queda en CAJA_CELULAR hasta fn_liquidar_ganancias(CELULAR).
Multi-tenant: filtra todo por get_negocio_id() del JWT.';
