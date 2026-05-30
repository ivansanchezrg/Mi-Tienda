-- ==========================================
-- DROP — todas las firmas anteriores
-- ==========================================
DROP FUNCTION IF EXISTS public.fn_reparar_deficit_turno(INTEGER, DECIMAL, DECIMAL, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.fn_reparar_deficit_turno(UUID, DECIMAL, DECIMAL, UUID, UUID);
DROP FUNCTION IF EXISTS public.fn_reparar_deficit_turno(UUID, DECIMAL, UUID, UUID);

-- ==========================================
-- FUNCIÓN: fn_reparar_deficit_turno (v3.0 — fondo libre, solo repara VARIOS)
-- ==========================================
-- CAMBIOS v3.0:
--   - Elimina p_fondo_faltante: sin fondo fijo no hay fondo que reponer automáticamente.
--     El empleado declara el fondo libremente al abrir el próximo turno.
--   - Solo repara el déficit de VARIOS (transferencia diaria pendiente del turno anterior).
--   - El EGRESO de Tienda ahora es solo por p_deficit_varios.
--   - Abre el nuevo turno con p_fondo_apertura (monto libre declarado por el empleado).
--
-- HEREDA DE v2.0:
--   - Transacción atómica: EGRESO Tienda + INGRESO VARIOS + INSERT turno.
--   - Validación de saldo de Tienda antes de operar.
--   - Negocio leído del JWT (multi-tenant).
--
-- Llamada desde: TurnosCajaService.repararDeficit()
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_reparar_deficit_turno(
  p_empleado_id    UUID,
  p_deficit_varios DECIMAL(12,2),
  p_fondo_apertura DECIMAL(12,2),
  p_cat_egreso_id  UUID,
  p_cat_ingreso_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_negocio_id   UUID;
  v_caja_id      UUID;
  v_varios_id    UUID;
  v_saldo_tienda DECIMAL(12,2);
  v_saldo_varios DECIMAL(12,2);
  v_op_egreso_id  UUID;
  v_op_ingreso_id UUID;
  -- Apertura de turno
  v_inicio_dia   TIMESTAMPTZ;
  v_numero_turno INTEGER;
  v_turno_id     UUID;
  v_caja_chica_id UUID;
BEGIN
  PERFORM public.fn_assert_no_superadmin();

  v_negocio_id := public.get_negocio_id();
  IF v_negocio_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No hay negocio activo en el JWT');
  END IF;

  IF p_deficit_varios <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'El déficit de VARIOS debe ser mayor a cero');
  END IF;

  IF p_fondo_apertura < 0 THEN
    RETURN json_build_object('success', false, 'error', 'El fondo de apertura no puede ser negativo');
  END IF;

  -- Obtener IDs de cajas por código
  v_caja_id       := (SELECT id FROM cajas WHERE codigo = 'CAJA'       AND negocio_id = v_negocio_id);
  v_varios_id     := (SELECT id FROM cajas WHERE codigo = 'VARIOS'     AND negocio_id = v_negocio_id);
  v_caja_chica_id := (SELECT id FROM cajas WHERE codigo = 'CAJA_CHICA' AND negocio_id = v_negocio_id);

  -- Obtener saldo actual de Tienda (con lock)
  PERFORM id FROM cajas WHERE id = v_caja_id AND negocio_id = v_negocio_id FOR UPDATE;
  v_saldo_tienda := (SELECT saldo_actual FROM cajas WHERE id = v_caja_id AND negocio_id = v_negocio_id);
  IF v_saldo_tienda IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No se encontró la caja Tienda');
  END IF;

  -- Validar saldo suficiente
  IF v_saldo_tienda < p_deficit_varios THEN
    RETURN json_build_object(
      'success', false,
      'error', FORMAT(
        'Saldo insuficiente en Tienda ($%s) para cubrir el déficit de VARIOS ($%s). Registra un ingreso manual en Tienda primero.',
        TO_CHAR(v_saldo_tienda, 'FM999990.00'),
        TO_CHAR(p_deficit_varios, 'FM999990.00')
      )
    );
  END IF;

  -- ==========================================
  -- 1. EGRESO de Tienda (solo por déficit de VARIOS)
  -- ==========================================
  v_op_egreso_id := gen_random_uuid();
  INSERT INTO operaciones_cajas (
    id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_id,
    monto, saldo_anterior, saldo_actual, descripcion, comprobante_url
  ) VALUES (
    v_op_egreso_id, v_negocio_id, v_caja_id, p_empleado_id, 'EGRESO', p_cat_egreso_id,
    p_deficit_varios, v_saldo_tienda, v_saldo_tienda - p_deficit_varios,
    FORMAT('Ajuste déficit turno anterior — Varios: $%s', TO_CHAR(p_deficit_varios, 'FM999990.00')),
    NULL
  );

  UPDATE cajas SET saldo_actual = v_saldo_tienda - p_deficit_varios
    WHERE id = v_caja_id AND negocio_id = v_negocio_id;

  -- ==========================================
  -- 2. INGRESO a VARIOS
  -- ==========================================
  PERFORM id FROM cajas WHERE id = v_varios_id AND negocio_id = v_negocio_id FOR UPDATE;
  v_saldo_varios := (SELECT saldo_actual FROM cajas WHERE id = v_varios_id AND negocio_id = v_negocio_id);
  IF v_saldo_varios IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No se encontró la caja Varios');
  END IF;

  v_op_ingreso_id := gen_random_uuid();
  INSERT INTO operaciones_cajas (
    id, negocio_id, caja_id, empleado_id, tipo_operacion, categoria_id,
    monto, saldo_anterior, saldo_actual, descripcion, comprobante_url
  ) VALUES (
    v_op_ingreso_id, v_negocio_id, v_varios_id, p_empleado_id, 'INGRESO', p_cat_ingreso_id,
    p_deficit_varios, v_saldo_varios, v_saldo_varios + p_deficit_varios,
    'Reposición déficit turno anterior — pendiente cobrado de Tienda',
    NULL
  );

  UPDATE cajas SET saldo_actual = v_saldo_varios + p_deficit_varios
    WHERE id = v_varios_id AND negocio_id = v_negocio_id;

  -- ==========================================
  -- 3. ABRIR TURNO (mismo proceso atómico)
  -- ==========================================
  v_inicio_dia := (
    (NOW() AT TIME ZONE 'America/Guayaquil')::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil'
  );

  IF EXISTS (
    SELECT 1 FROM turnos_caja
    WHERE negocio_id = v_negocio_id
      AND hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
      AND hora_fecha_cierre IS NULL
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Ya hay un turno abierto hoy');
  END IF;

  v_numero_turno := (
    SELECT COUNT(*) + 1
    FROM turnos_caja
    WHERE negocio_id = v_negocio_id
      AND hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
  );

  v_turno_id := gen_random_uuid();
  INSERT INTO turnos_caja (id, negocio_id, caja_id, numero_turno, empleado_id, hora_fecha_apertura, fondo_apertura)
  VALUES (v_turno_id, v_negocio_id, v_caja_chica_id, v_numero_turno, p_empleado_id, NOW(), p_fondo_apertura);

  -- ==========================================
  -- RESULTADO
  -- ==========================================
  RETURN json_build_object(
    'success',            true,
    'turno_id',           v_turno_id,
    'op_egreso_id',       v_op_egreso_id,
    'op_ingreso_id',      v_op_ingreso_id,
    'total_retirado',     p_deficit_varios,
    'saldo_tienda_nuevo', v_saldo_tienda - p_deficit_varios
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_reparar_deficit_turno(UUID, DECIMAL, DECIMAL, UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_reparar_deficit_turno(UUID, DECIMAL, DECIMAL, UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_reparar_deficit_turno IS
  'v3.0 — Solo repara déficit de VARIOS (fondo libre: sin fondo fijo predeterminado). '
  'EGRESO de Tienda + INGRESO a VARIOS + INSERT en turnos_caja con fondo_apertura libre. '
  'Transacción atómica: si algo falla, rollback completo. '
  'Negocio leído del JWT; todas las queries filtran por negocio_id.';
