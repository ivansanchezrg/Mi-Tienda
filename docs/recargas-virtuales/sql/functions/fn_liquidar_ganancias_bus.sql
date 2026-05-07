-- ==========================================
-- FUNCIÓN: fn_liquidar_ganancias_bus
-- VERSIÓN: 1.0
-- FECHA: 2026-03-03
-- ==========================================
-- Liquida las ganancias BUS pendientes de un mes dado.
-- Opera de forma atómica:
--   1. Calcula ganancia = ROUND(SUM(monto_a_pagar) * comision%, 2) WHERE pagado=false AND fecha IN mes
--      (monto_a_pagar = monto completo de cada compra; la ganancia es el % aplicado sobre el total)
--   2. Transfiere esa ganancia de CAJA_BUS → CAJA_CHICA (via crear_transferencia)
--   3. Marca las filas como pagado=true, fecha_pago=hoy
--
-- Si la transferencia falla (ej: saldo insuficiente en CAJA_BUS), la transacción
-- completa se revierte y las filas NO se marcan como pagadas.
--
-- Parámetros:
--   p_mes          TEXT     Mes a liquidar en formato 'YYYY-MM' (ej: '2026-02')
--   p_empleado_id  INTEGER  Empleado que ejecuta la liquidación
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_liquidar_ganancias_bus(
  p_mes         TEXT,
  p_empleado_id INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo_bus_id      INTEGER;
  v_comision_pct     NUMERIC;
  v_inicio_mes       DATE;
  v_fin_mes          DATE;
  v_total_compras    NUMERIC;
  v_total_ganancia   NUMERIC;
  v_filas_afectadas  INTEGER;
  v_transfer_result  JSON;
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  -- ==========================================
  -- INICIALIZACIÓN
  -- ==========================================

  v_tipo_bus_id  := (SELECT id                 FROM tipos_servicio WHERE codigo = 'BUS');
  v_comision_pct := (SELECT porcentaje_comision FROM tipos_servicio WHERE codigo = 'BUS');

  IF v_tipo_bus_id IS NULL THEN
    RAISE EXCEPTION 'Tipo de servicio BUS no encontrado';
  END IF;

  -- Calcular rango del mes (inicio inclusivo, fin exclusivo)
  v_inicio_mes := (p_mes || '-01')::date;
  v_fin_mes    := (v_inicio_mes + INTERVAL '1 month')::date;

  -- ==========================================
  -- CALCULAR GANANCIA PENDIENTE DEL MES
  -- ==========================================

  -- monto_a_pagar = monto completo de cada compra (mismo que monto_virtual)
  -- La ganancia es el porcentaje de comisión aplicado sobre el total del mes
  v_total_compras := (
    SELECT COALESCE(SUM(monto_a_pagar), 0)
    FROM recargas_virtuales
    WHERE tipo_servicio_id = v_tipo_bus_id
      AND pagado = false
      AND fecha >= v_inicio_mes
      AND fecha < v_fin_mes
  );

  IF v_total_compras <= 0 THEN
    RAISE EXCEPTION 'No hay compras BUS pendientes de liquidar para el mes %', p_mes;
  END IF;

  v_total_ganancia := ROUND(v_total_compras * (v_comision_pct / 100.0), 2);

  -- ==========================================
  -- TRANSFERENCIA CAJA_BUS → CAJA_CHICA
  -- ==========================================

  v_transfer_result := public.fn_crear_transferencia(
    'CAJA_BUS',
    'CAJA_CHICA',
    v_total_ganancia,
    p_empleado_id,
    'Ganancia ' || v_comision_pct || '% BUS ' || p_mes
  );

  IF NOT (v_transfer_result->>'success')::boolean THEN
    RAISE EXCEPTION '%', v_transfer_result->>'error';
  END IF;

  -- ==========================================
  -- MARCAR FILAS COMO PAGADAS
  -- ==========================================

  UPDATE recargas_virtuales
  SET
    pagado     = true,
    fecha_pago = CURRENT_DATE
  WHERE tipo_servicio_id = v_tipo_bus_id
    AND pagado = false
    AND fecha >= v_inicio_mes
    AND fecha < v_fin_mes;

  GET DIAGNOSTICS v_filas_afectadas = ROW_COUNT;

  -- ==========================================
  -- RESULTADO
  -- ==========================================

  RETURN json_build_object(
    'success',          true,
    'mes',              p_mes,
    'total_ganancia',   v_total_ganancia,
    'filas_afectadas',  v_filas_afectadas,
    'message',          'Ganancia $' || v_total_ganancia || ' transferida a Varios (' || v_filas_afectadas || ' compras del mes ' || p_mes || ')'
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al liquidar ganancias BUS: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.fn_liquidar_ganancias_bus IS
'v1.0 - Liquida ganancias BUS de un mes: calcula ROUND(SUM(monto_a_pagar) * comision%, 2) WHERE pagado=false,
transfiere de CAJA_BUS a CAJA_CHICA y marca las filas como pagado=true. Operación atómica:
si la transferencia falla (saldo insuficiente) toda la operación se revierte.
monto_a_pagar = monto completo de cada compra; la ganancia = ese total * porcentaje_comision.';

REVOKE EXECUTE ON FUNCTION public.fn_liquidar_ganancias_bus(TEXT, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_liquidar_ganancias_bus(TEXT, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';
