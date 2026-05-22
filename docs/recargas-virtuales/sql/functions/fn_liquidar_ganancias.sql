-- ==========================================
-- FUNCION: fn_liquidar_ganancias
-- VERSION: 2.0
-- FECHA: 2026-05-11
-- ==========================================
-- Liquida la ganancia pendiente de CELULAR o BUS en un solo paso atomico.
-- Ambos servicios funcionan igual: pagado_proveedor=false -> liquidar todo.
--
-- v2.0 — CELULAR unificado con BUS:
--   - Ya no existe etapa intermedia "pagar al proveedor" para CELULAR.
--   - Ambos servicios filtran pagado_proveedor=false y marcan
--     pagado_proveedor=true + ganancia_liquidada=true en la misma operacion.
--   - Caja origen: CAJA_CELULAR (CELULAR) o CAJA_BUS (BUS)
--   - Caja destino automatica: VARIOS si caja_varios_activa=true, sino CAJA
--   - Atomico todo-o-nada: si la caja origen no cubre la ganancia total,
--     RAISE EXCEPTION (el frontend ya bloquea el boton en ese caso).
--
-- v2.2 — Ambos servicios filtran pagado_proveedor=true AND ganancia_liquidada=false:
--   - CELULAR: pagado_proveedor=true via fn_pagar_proveedor_celular
--   - BUS: pagado_proveedor=true desde el momento del registro (fn_registrar_compra_saldo_bus)
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_celular(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_celular(UUID, TEXT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_celular(UUID);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_bus(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_bus(INTEGER);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_bus(UUID, TEXT, NUMERIC);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_bus(UUID, TEXT, NUMERIC, TEXT);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias_bus(UUID);
DROP FUNCTION IF EXISTS public.fn_liquidar_ganancias(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.fn_liquidar_ganancias(
  p_servicio    TEXT,  -- 'CELULAR' | 'BUS'
  p_empleado_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id       UUID;
  v_tipo_id          INTEGER;
  v_caja_origen      TEXT;
  v_total_ganancia   NUMERIC;
  v_filas_afectadas  INTEGER;
  v_caja_destino     TEXT;
  v_caja_saldo       NUMERIC;
  v_transfer_result  JSON;
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  IF p_servicio NOT IN ('CELULAR', 'BUS') THEN
    RAISE EXCEPTION 'Servicio invalido: %. Debe ser CELULAR o BUS', p_servicio;
  END IF;

  v_negocio_id := public.get_negocio_id();

  v_tipo_id := (SELECT id FROM tipos_servicio WHERE codigo = p_servicio);
  IF v_tipo_id IS NULL THEN
    RAISE EXCEPTION 'Tipo de servicio % no encontrado', p_servicio;
  END IF;

  v_caja_origen := CASE p_servicio
    WHEN 'CELULAR' THEN 'CAJA_CELULAR'
    WHEN 'BUS'     THEN 'CAJA_BUS'
  END;

  -- Ganancia pendiente:
  -- CELULAR: pagado_proveedor=true (via fn_pagar_proveedor_celular) AND ganancia_liquidada=false
  -- BUS: pagado_proveedor=true (se marca al registrar la compra) AND ganancia_liquidada=false
  v_total_ganancia := (
    SELECT COALESCE(SUM(ganancia), 0)
    FROM recargas_virtuales
    WHERE negocio_id       = v_negocio_id
      AND tipo_servicio_id = v_tipo_id
      AND pagado_proveedor   = true
      AND ganancia_liquidada = false
  );

  IF v_total_ganancia <= 0 THEN
    RAISE EXCEPTION 'No hay ganancias % pendientes de liquidar', p_servicio;
  END IF;

  -- Validar saldo de la caja origen
  v_caja_saldo := (
    SELECT saldo_actual FROM cajas
    WHERE codigo = v_caja_origen AND negocio_id = v_negocio_id
  );

  IF v_caja_saldo IS NULL THEN
    RAISE EXCEPTION 'Caja % no encontrada', v_caja_origen;
  END IF;

  IF v_caja_saldo < v_total_ganancia THEN
    RAISE EXCEPTION 'Saldo insuficiente en %. Disponible: $%, Requerido: $%',
      v_caja_origen, v_caja_saldo, v_total_ganancia;
  END IF;

  -- Destino automatico: VARIOS si esta activa, sino CAJA (Tienda)
  v_caja_destino := CASE
    WHEN (SELECT valor = 'true' FROM configuraciones
          WHERE clave = 'caja_varios_activa' AND negocio_id = v_negocio_id)
    THEN 'VARIOS'
    ELSE 'CAJA'
  END;

  -- Transferencia atomica: caja origen -> caja destino
  v_transfer_result := public.fn_crear_transferencia(
    v_caja_origen,
    v_caja_destino,
    v_total_ganancia,
    p_empleado_id,
    'Liquidacion ganancia ' || p_servicio
  );

  IF NOT (v_transfer_result->>'success')::boolean THEN
    RAISE EXCEPTION '%', v_transfer_result->>'error';
  END IF;

  -- Marcar filas como liquidadas (mismo filtro que el cálculo de arriba)
  UPDATE recargas_virtuales
  SET ganancia_liquidada         = true,
      fecha_liquidacion_ganancia = CURRENT_DATE
  WHERE negocio_id         = v_negocio_id
    AND tipo_servicio_id   = v_tipo_id
    AND pagado_proveedor   = true
    AND ganancia_liquidada = false;

  GET DIAGNOSTICS v_filas_afectadas = ROW_COUNT;

  RETURN json_build_object(
    'success',         true,
    'total_ganancia',  v_total_ganancia,
    'caja_destino',    v_caja_destino,
    'filas_afectadas', v_filas_afectadas,
    'message',         'Ganancia $' || v_total_ganancia || ' transferida a ' || v_caja_destino ||
                       ' (' || v_filas_afectadas || ' registros liquidados)'
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al liquidar ganancias %: %', p_servicio, SQLERRM;
END;
$$;

COMMENT ON FUNCTION public.fn_liquidar_ganancias(TEXT, UUID) IS
'v2.2 - Liquida ganancia pendiente de CELULAR o BUS (atomico).
Ambos servicios: pagado_proveedor=true AND ganancia_liquidada=false.
CELULAR: pagado_proveedor=true via fn_pagar_proveedor_celular.
BUS: pagado_proveedor=true desde fn_registrar_compra_saldo_bus.
Caja origen: CAJA_CELULAR o CAJA_BUS segun el servicio.
Caja destino automatica: VARIOS si esta activa, sino CAJA (Tienda).
Si la caja origen no cubre el total, RAISE EXCEPTION.';

REVOKE EXECUTE ON FUNCTION public.fn_liquidar_ganancias(TEXT, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_liquidar_ganancias(TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
