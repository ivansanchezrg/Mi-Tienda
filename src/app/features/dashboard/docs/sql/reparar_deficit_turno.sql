-- ==========================================
-- DROP — descomentar SOLO si cambia la firma (parámetros o tipo de retorno)
-- ==========================================
-- DROP FUNCTION IF EXISTS public.reparar_deficit_turno(
--   INTEGER, DECIMAL, DECIMAL, INTEGER, INTEGER
-- );

-- ==========================================
-- FUNCIÓN: reparar_deficit_turno (v1.1)
-- ==========================================
-- CAMBIOS v1.1:
--   - Reemplaza WHERE id = 1/2 por lookup dinámico con codigo
--     (consistente con el resto de funciones del proyecto)
-- Registra el ajuste contable del déficit del turno anterior.
-- EGRESO de Tienda sin validación de saldo mínimo (el dinero existe físicamente).
-- INGRESO a Varios solo si p_deficit_caja_chica > 0.
-- ==========================================
-- Llamada desde: TurnosCajaService.repararDeficit()
-- Parámetros:
--   p_empleado_id        — empleado que abre el turno
--   p_deficit_caja_chica — monto pendiente a Varios del turno anterior
--   p_fondo_faltante     — fondo que faltó para el día (fondo_fijo - efectivo_recaudado_anterior)
--   p_cat_egreso_id      — ID de categoría EG-012 (Ajuste Déficit Turno Anterior)
--   p_cat_ingreso_id     — ID de categoría IN-004 (Reposición Déficit Turno Anterior)
-- ==========================================

CREATE OR REPLACE FUNCTION public.reparar_deficit_turno(
  p_empleado_id        INTEGER,
  p_deficit_caja_chica DECIMAL(12,2),
  p_fondo_faltante     DECIMAL(12,2),
  p_cat_egreso_id      INTEGER,
  p_cat_ingreso_id     INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_a_reponer DECIMAL(12,2);
  v_caja_id         INTEGER;
  v_caja_chica_id   INTEGER;
  v_saldo_tienda    DECIMAL(12,2);
  v_saldo_varios    DECIMAL(12,2);
  v_op_egreso_id    UUID;
  v_op_ingreso_id   UUID;
BEGIN
  v_total_a_reponer := p_deficit_caja_chica + p_fondo_faltante;

  -- Validaciones básicas
  IF v_total_a_reponer <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'El monto a reponer debe ser mayor a cero');
  END IF;

  IF p_deficit_caja_chica < 0 OR p_fondo_faltante < 0 THEN
    RETURN json_build_object('success', false, 'error', 'Los montos de déficit no pueden ser negativos');
  END IF;

  -- Obtener IDs de cajas por código (consistente con el resto de funciones)
  SELECT id INTO v_caja_id       FROM cajas WHERE codigo = 'CAJA';
  SELECT id INTO v_caja_chica_id FROM cajas WHERE codigo = 'CAJA_CHICA';

  -- Obtener saldo actual de Tienda (con lock)
  SELECT saldo_actual INTO v_saldo_tienda FROM cajas WHERE id = v_caja_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'No se encontró la caja Tienda');
  END IF;

  -- Validar que Tienda tiene saldo suficiente para cubrir el ajuste
  IF v_saldo_tienda < v_total_a_reponer THEN
    RETURN json_build_object(
      'success', false,
      'error', FORMAT(
        'Saldo insuficiente en Tienda ($%s) para cubrir el ajuste de $%s. Registra un ingreso manual en Tienda primero.',
        TO_CHAR(v_saldo_tienda, 'FM999990.00'),
        TO_CHAR(v_total_a_reponer, 'FM999990.00')
      )
    );
  END IF;

  -- 1. EGRESO de Tienda
  INSERT INTO operaciones_cajas (
    id, caja_id, empleado_id, tipo_operacion, categoria_id,
    monto, saldo_anterior, saldo_actual, descripcion, comprobante_url, created_at
  ) VALUES (
    gen_random_uuid(), v_caja_id, p_empleado_id, 'EGRESO', p_cat_egreso_id,
    v_total_a_reponer, v_saldo_tienda, v_saldo_tienda - v_total_a_reponer,
    FORMAT(
      'Ajuste déficit turno anterior — Varios: $%s, Fondo: $%s',
      TO_CHAR(p_deficit_caja_chica, 'FM999990.00'),
      TO_CHAR(p_fondo_faltante, 'FM999990.00')
    ),
    NULL, NOW()
  ) RETURNING id INTO v_op_egreso_id;

  UPDATE cajas SET saldo_actual = v_saldo_tienda - v_total_a_reponer, updated_at = NOW() WHERE id = v_caja_id;

  -- 2. INGRESO a Varios (solo si hay déficit de caja chica)
  IF p_deficit_caja_chica > 0 THEN
    SELECT saldo_actual INTO v_saldo_varios FROM cajas WHERE id = v_caja_chica_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN json_build_object('success', false, 'error', 'No se encontró la caja Varios');
    END IF;

    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, categoria_id,
      monto, saldo_anterior, saldo_actual, descripcion, comprobante_url, created_at
    ) VALUES (
      gen_random_uuid(), v_caja_chica_id, p_empleado_id, 'INGRESO', p_cat_ingreso_id,
      p_deficit_caja_chica, v_saldo_varios, v_saldo_varios + p_deficit_caja_chica,
      'Reposición déficit turno anterior — pendiente cobrado de Tienda',
      NULL, NOW()
    ) RETURNING id INTO v_op_ingreso_id;

    UPDATE cajas SET saldo_actual = v_saldo_varios + p_deficit_caja_chica, updated_at = NOW() WHERE id = v_caja_chica_id;
  END IF;

  RETURN json_build_object(
    'success',            true,
    'op_egreso_id',       v_op_egreso_id,
    'op_ingreso_id',      v_op_ingreso_id,
    'total_retirado',     v_total_a_reponer,
    'saldo_tienda_nuevo', v_saldo_tienda - v_total_a_reponer
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Permisos
GRANT EXECUTE ON FUNCTION public.reparar_deficit_turno(INTEGER, DECIMAL, DECIMAL, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reparar_deficit_turno(INTEGER, DECIMAL, DECIMAL, INTEGER, INTEGER) TO anon;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.reparar_deficit_turno IS
  'v1.1 - Ajuste contable del déficit del turno anterior al abrir caja. '
  'EGRESO de Tienda sin validación de saldo mínimo + INGRESO a Varios si hay déficit de caja chica. '
  'Usa lookup por codigo en lugar de IDs hardcodeados.';
