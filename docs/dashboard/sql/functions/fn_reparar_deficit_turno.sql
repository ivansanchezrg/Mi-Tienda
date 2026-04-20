-- ==========================================
-- DROP — descomentar SOLO si cambia la firma (parámetros o tipo de retorno)
-- ==========================================
-- DROP FUNCTION IF EXISTS public.fn_reparar_deficit_turno(
--   INTEGER, DECIMAL, DECIMAL, INTEGER, INTEGER
-- );

-- ==========================================
-- FUNCIÓN: fn_reparar_deficit_turno (v1.4)
-- ==========================================
-- CAMBIOS v1.4:
--   - El déficit de VARIOS y del fondo son costos operacionales del negocio.
--     NO se tocan movimientos_empleados — esa tabla solo registra faltantes de
--     conteo físico via fn_ejecutar_cierre_diario (tipo FALTANTE_CAJA).
--     Los faltantes se descuentan automaticamente al pagar nomina.
-- CAMBIOS v1.3:
--   - Agrega apertura de turno al final de la misma transacción.
--     Antes: la reparación y la apertura eran 2 operaciones separadas (TypeScript).
--     Ahora: todo es atómico — si algo falla, nada queda a medias.
--   - Retorna turno_id del turno recién abierto.
-- CAMBIOS v1.2 (Refactor v5):
--   - Cambio: busca caja por codigo 'VARIOS' (antes 'CAJA_CHICA')
-- CAMBIOS v1.1:
--   - Reemplaza WHERE id = 1/2 por lookup dinámico con codigo
--
-- Registra el ajuste contable del déficit del turno anterior Y abre el nuevo turno,
-- todo en una sola transacción atómica.
-- EGRESO de Tienda con validación de saldo: si Tienda no tiene suficiente, retorna error.
-- INGRESO a VARIOS solo si p_deficit_varios > 0.
-- ==========================================
-- Llamada desde: TurnosCajaService.repararDeficit()
-- Parámetros:
--   p_empleado_id        — empleado que abre el turno
--   p_deficit_varios — monto pendiente a VARIOS del turno anterior
--   p_fondo_faltante     — fondo que faltó para el día
--   p_cat_egreso_id      — ID de categoría EG-012 (Ajuste Déficit Turno Anterior)
--   p_cat_ingreso_id     — ID de categoría IN-004 (Reposición Déficit Turno Anterior)
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_reparar_deficit_turno(
  p_empleado_id        INTEGER,
  p_deficit_varios DECIMAL(12,2),
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
  v_varios_id       INTEGER;
  v_saldo_tienda    DECIMAL(12,2);
  v_saldo_varios    DECIMAL(12,2);
  v_op_egreso_id    UUID;
  v_op_ingreso_id   UUID;
  -- Apertura de turno
  v_inicio_dia      TIMESTAMPTZ;
  v_numero_turno    INTEGER;
  v_turno_id        UUID;
BEGIN
  v_total_a_reponer := p_deficit_varios + p_fondo_faltante;

  -- Validaciones básicas
  IF v_total_a_reponer <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'El monto a reponer debe ser mayor a cero');
  END IF;

  IF p_deficit_varios < 0 OR p_fondo_faltante < 0 THEN
    RETURN json_build_object('success', false, 'error', 'Los montos de déficit no pueden ser negativos');
  END IF;

  -- Obtener IDs de cajas por código
  v_caja_id   := (SELECT id FROM cajas WHERE codigo = 'CAJA');
  v_varios_id := (SELECT id FROM cajas WHERE codigo = 'VARIOS');

  -- Obtener saldo actual de Tienda (con lock)
  PERFORM id FROM cajas WHERE id = v_caja_id FOR UPDATE;
  v_saldo_tienda := (SELECT saldo_actual FROM cajas WHERE id = v_caja_id);
  IF v_saldo_tienda IS NULL THEN
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

  -- ==========================================
  -- 1. EGRESO de Tienda
  -- ==========================================
  v_op_egreso_id := gen_random_uuid();
  INSERT INTO operaciones_cajas (
    id, caja_id, empleado_id, tipo_operacion, categoria_id,
    monto, saldo_anterior, saldo_actual, descripcion, comprobante_url
  ) VALUES (
    v_op_egreso_id, v_caja_id, p_empleado_id, 'EGRESO', p_cat_egreso_id,
    v_total_a_reponer, v_saldo_tienda, v_saldo_tienda - v_total_a_reponer,
    FORMAT(
      'Ajuste déficit turno anterior — Varios: $%s, Fondo: $%s',
      TO_CHAR(p_deficit_varios, 'FM999990.00'),
      TO_CHAR(p_fondo_faltante, 'FM999990.00')
    ),
    NULL
  );

  UPDATE cajas SET saldo_actual = v_saldo_tienda - v_total_a_reponer WHERE id = v_caja_id;

  -- ==========================================
  -- 2. INGRESO a VARIOS (solo si hay déficit de la transferencia diaria)
  -- ==========================================
  IF p_deficit_varios > 0 THEN
    PERFORM id FROM cajas WHERE id = v_varios_id FOR UPDATE;
    v_saldo_varios := (SELECT saldo_actual FROM cajas WHERE id = v_varios_id);
    IF v_saldo_varios IS NULL THEN
      RETURN json_build_object('success', false, 'error', 'No se encontró la caja Varios');
    END IF;

    v_op_ingreso_id := gen_random_uuid();
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, categoria_id,
      monto, saldo_anterior, saldo_actual, descripcion, comprobante_url
    ) VALUES (
      v_op_ingreso_id, v_varios_id, p_empleado_id, 'INGRESO', p_cat_ingreso_id,
      p_deficit_varios, v_saldo_varios, v_saldo_varios + p_deficit_varios,
      'Reposición déficit turno anterior — pendiente cobrado de Tienda',
      NULL
    );

    UPDATE cajas SET saldo_actual = v_saldo_varios + p_deficit_varios WHERE id = v_varios_id;
  END IF;

  -- ==========================================
  -- 3. ABRIR TURNO (mismo proceso atómico)
  -- ==========================================

  -- Inicio del día en zona horaria local para filtrar turnos de hoy
  v_inicio_dia := (
    (NOW() AT TIME ZONE 'America/Guayaquil')::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil'
  );

  -- Validar que no haya turno abierto (no debería, pero doble check)
  IF EXISTS (
    SELECT 1 FROM turnos_caja
    WHERE hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
      AND hora_fecha_cierre IS NULL
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Ya hay un turno abierto hoy');
  END IF;

  -- Número de turno: siguiente al último del día
  v_numero_turno := (
    SELECT COUNT(*) + 1
    FROM turnos_caja
    WHERE hora_fecha_apertura >= v_inicio_dia
      AND hora_fecha_apertura <  v_inicio_dia + INTERVAL '1 day'
  );

  v_turno_id := gen_random_uuid();
  INSERT INTO turnos_caja (id, numero_turno, empleado_id, hora_fecha_apertura)
  VALUES (v_turno_id, v_numero_turno, p_empleado_id, NOW());

  -- ==========================================
  -- RESULTADO
  -- ==========================================
  RETURN json_build_object(
    'success',            true,
    'turno_id',           v_turno_id,
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
REVOKE EXECUTE ON FUNCTION public.fn_reparar_deficit_turno(INTEGER, DECIMAL, DECIMAL, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_reparar_deficit_turno(INTEGER, DECIMAL, DECIMAL, INTEGER, INTEGER) TO authenticated;

-- Refrescar caché PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_reparar_deficit_turno IS
  'v1.4 - Reparación déficit operacional + apertura de turno en una sola transacción atómica. '
  'EGRESO de Tienda (validando saldo) + INGRESO a VARIOS (si hay déficit de transferencia) + INSERT en turnos_caja. '
  'El déficit de VARIOS y del fondo son costos operacionales — NO son deudas del empleado. '
  'movimientos_empleados registra faltantes de conteo como FALTANTE_CAJA (via fn_ejecutar_cierre_diario). '
  'Retorna turno_id del turno abierto. Si algo falla, rollback completo — sin operaciones a medias.';
