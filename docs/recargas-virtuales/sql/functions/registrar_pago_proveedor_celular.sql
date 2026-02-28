-- ==========================================
-- FUNCIÓN: registrar_pago_proveedor_celular
-- VERSIÓN: 2.1
-- FECHA: 2026-02-25
-- ==========================================
-- CAMBIOS v2.1:
--   - Eliminado lookup de TR-001 (no existe en categorias_operaciones)
--   - categoria_id = NULL para TRANSFERENCIA_SALIENTE/ENTRANTE
--     (consistente con ejecutar_cierre_diario y el schema actual)
-- Registra el pago al proveedor CELULAR de forma atómica:
--   1. Valida deudas y calcula totales (monto_a_pagar + ganancia)
--   2. Crea EGRESO en operaciones_cajas (CAJA_CELULAR) — pago al proveedor
--   3. Crea TRANSFERENCIA_SALIENTE en CAJA_CELULAR — ganancia sale
--   4. Crea TRANSFERENCIA_ENTRANTE en CAJA_CHICA — ganancia entra
--   5. Marca deudas como pagadas
--   6. Actualiza saldo CAJA_CELULAR (saldo -= monto_a_pagar + ganancia)
--   7. Actualiza saldo CAJA_CHICA (saldo += ganancia)
--
-- La ganancia (v_total_ganancia) se obtiene de recargas_virtuales.ganancia
-- de cada deuda — NO es un valor hardcodeado.
--
-- Parámetros:
--   p_empleado_id   INT      Empleado que registra el pago
--   p_deuda_ids     UUID[]   Array de IDs de recargas_virtuales a pagar
--   p_notas         TEXT     Notas opcionales del pago
-- ==========================================

-- Descomentar solo si cambia la firma (parámetros o tipo de retorno):
-- DROP FUNCTION IF EXISTS registrar_pago_proveedor_celular(INTEGER, UUID[], TEXT);

CREATE OR REPLACE FUNCTION registrar_pago_proveedor_celular(
  p_empleado_id  INTEGER,
  p_deuda_ids    UUID[],
  p_notas        TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caja_celular_id        INTEGER;
  v_caja_chica_id          INTEGER;
  v_tipo_ref_id            INTEGER;
  v_categoria_eg010_id     INTEGER;
  v_total_a_pagar          NUMERIC;
  v_total_ganancia         NUMERIC;
  v_total_egreso           NUMERIC;
  v_saldo_celular_ant      NUMERIC;
  v_saldo_celular_nuevo    NUMERIC;
  v_saldo_chica_ant        NUMERIC;
  v_saldo_chica_nuevo      NUMERIC;
  v_operacion_pago_id      UUID;
  v_operacion_sal_id       UUID;
  v_operacion_ent_id       UUID;
  v_fecha_hoy              DATE;
  v_deudas_count           INTEGER;
BEGIN
  v_fecha_hoy := CURRENT_DATE;

  -- ==========================================
  -- 1. OBTENER IDs NECESARIOS
  -- ==========================================
  SELECT id INTO v_caja_celular_id FROM cajas WHERE codigo = 'CAJA_CELULAR';
  SELECT id INTO v_caja_chica_id   FROM cajas WHERE codigo = 'CAJA_CHICA';
  SELECT id INTO v_tipo_ref_id     FROM tipos_referencia WHERE codigo = 'RECARGAS_VIRTUALES';
  SELECT id INTO v_categoria_eg010_id FROM categorias_operaciones WHERE codigo = 'EG-010';
  -- TRANSFERENCIA_SALIENTE/ENTRANTE no requieren categoria_id (NULL permitido en schema)

  IF v_caja_celular_id IS NULL THEN
    RAISE EXCEPTION 'Caja CAJA_CELULAR no encontrada';
  END IF;

  IF v_caja_chica_id IS NULL THEN
    RAISE EXCEPTION 'Caja CAJA_CHICA no encontrada';
  END IF;

  -- ==========================================
  -- 2. VALIDAR DEUDAS
  -- ==========================================
  SELECT COUNT(*) INTO v_deudas_count
  FROM recargas_virtuales
  WHERE id = ANY(p_deuda_ids)
    AND pagado = false
    AND tipo_servicio_id = (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR');

  IF v_deudas_count != array_length(p_deuda_ids, 1) THEN
    RAISE EXCEPTION 'Algunas deudas no existen, ya están pagadas o no son de tipo CELULAR';
  END IF;

  -- ==========================================
  -- 3. CALCULAR TOTALES DESDE LAS DEUDAS
  -- Los valores vienen de recargas_virtuales — NO son hardcodeados
  -- ==========================================
  SELECT
    COALESCE(SUM(monto_a_pagar), 0),
    COALESCE(SUM(ganancia), 0)
  INTO v_total_a_pagar, v_total_ganancia
  FROM recargas_virtuales
  WHERE id = ANY(p_deuda_ids);

  IF v_total_a_pagar <= 0 THEN
    RAISE EXCEPTION 'El total a pagar debe ser mayor a cero';
  END IF;

  -- Total que debe salir de CAJA_CELULAR = pago al proveedor + ganancia a transferir
  v_total_egreso := v_total_a_pagar + v_total_ganancia;

  -- ==========================================
  -- 4. VALIDAR SALDO CAJA_CELULAR
  -- ==========================================
  SELECT saldo_actual INTO v_saldo_celular_ant
  FROM cajas WHERE id = v_caja_celular_id;

  IF v_saldo_celular_ant < v_total_egreso THEN
    RAISE EXCEPTION 'Saldo insuficiente en CAJA_CELULAR. Disponible: $%, Requerido: $% (pago: $% + ganancia: $%)',
      v_saldo_celular_ant, v_total_egreso, v_total_a_pagar, v_total_ganancia;
  END IF;

  SELECT saldo_actual INTO v_saldo_chica_ant
  FROM cajas WHERE id = v_caja_chica_id;

  -- ==========================================
  -- 5. CALCULAR SALDOS NUEVOS
  -- ==========================================
  v_saldo_celular_nuevo := v_saldo_celular_ant - v_total_egreso;
  v_saldo_chica_nuevo   := v_saldo_chica_ant + v_total_ganancia;

  v_operacion_pago_id := gen_random_uuid();
  v_operacion_sal_id  := gen_random_uuid();
  v_operacion_ent_id  := gen_random_uuid();

  -- ==========================================
  -- 6. EGRESO: Pago al proveedor (CAJA_CELULAR)
  -- ==========================================
  INSERT INTO operaciones_cajas (
    id, fecha, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    categoria_id, tipo_referencia_id,
    descripcion
  ) VALUES (
    v_operacion_pago_id, NOW(), v_caja_celular_id, p_empleado_id,
    'EGRESO', v_total_a_pagar,
    v_saldo_celular_ant, v_saldo_celular_ant - v_total_a_pagar,
    v_categoria_eg010_id, v_tipo_ref_id,
    COALESCE(p_notas, 'Pago al proveedor celular — ' || array_length(p_deuda_ids, 1) || ' deuda(s)')
  );

  -- ==========================================
  -- 7. TRANSFERENCIA_SALIENTE: Ganancia sale de CAJA_CELULAR
  -- ==========================================
  INSERT INTO operaciones_cajas (
    id, fecha, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    tipo_referencia_id,
    descripcion
  ) VALUES (
    v_operacion_sal_id, NOW(), v_caja_celular_id, p_empleado_id,
    'TRANSFERENCIA_SALIENTE', v_total_ganancia,
    v_saldo_celular_ant - v_total_a_pagar, v_saldo_celular_nuevo,
    v_tipo_ref_id,
    'Ganancia celular → Caja Chica'
  );

  -- ==========================================
  -- 8. TRANSFERENCIA_ENTRANTE: Ganancia entra a CAJA_CHICA
  -- ==========================================
  INSERT INTO operaciones_cajas (
    id, fecha, caja_id, empleado_id,
    tipo_operacion, monto,
    saldo_anterior, saldo_actual,
    tipo_referencia_id,
    descripcion
  ) VALUES (
    v_operacion_ent_id, NOW(), v_caja_chica_id, p_empleado_id,
    'TRANSFERENCIA_ENTRANTE', v_total_ganancia,
    v_saldo_chica_ant, v_saldo_chica_nuevo,
    v_tipo_ref_id,
    'Ganancia celular recibida desde Caja Celular'
  );

  -- ==========================================
  -- 9. MARCAR DEUDAS COMO PAGADAS
  -- ==========================================
  UPDATE recargas_virtuales
  SET pagado            = true,
      fecha_pago        = v_fecha_hoy,
      operacion_pago_id = v_operacion_pago_id
  WHERE id = ANY(p_deuda_ids);

  -- ==========================================
  -- 10. ACTUALIZAR SALDOS DE CAJAS
  -- ==========================================
  UPDATE cajas
  SET saldo_actual = v_saldo_celular_nuevo, updated_at = NOW()
  WHERE id = v_caja_celular_id;

  UPDATE cajas
  SET saldo_actual = v_saldo_chica_nuevo, updated_at = NOW()
  WHERE id = v_caja_chica_id;

  -- ==========================================
  -- 11. RETORNAR RESULTADO
  -- ==========================================
  RETURN json_build_object(
    'success',               true,
    'operacion_pago_id',     v_operacion_pago_id,
    'deudas_pagadas',        array_length(p_deuda_ids, 1),
    'total_pagado',          v_total_a_pagar,
    'total_ganancia',        v_total_ganancia,
    'saldo_celular_anterior', v_saldo_celular_ant,
    'saldo_celular_nuevo',   v_saldo_celular_nuevo,
    'saldo_chica_anterior',  v_saldo_chica_ant,
    'saldo_chica_nuevo',     v_saldo_chica_nuevo,
    'message',               'Pago registrado: $' || v_total_a_pagar || ' — Ganancia $' || v_total_ganancia || ' transferida a Caja Chica'
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al registrar pago proveedor celular: %', SQLERRM;
END;
$$;

COMMENT ON FUNCTION registrar_pago_proveedor_celular IS
'v2.1 - Registra pago al proveedor CELULAR. Crea EGRESO en CAJA_CELULAR (monto_a_pagar)
y transfiere la ganancia acumulada (de recargas_virtuales.ganancia) a CAJA_CHICA.
Ganancia NO hardcodeada: se lee de cada deuda seleccionada.
Las operaciones TRANSFERENCIA_SALIENTE/ENTRANTE no usan categoria_id (NULL).';

GRANT EXECUTE ON FUNCTION registrar_pago_proveedor_celular(INTEGER, UUID[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION registrar_pago_proveedor_celular(INTEGER, UUID[], TEXT) TO anon;

NOTIFY pgrst, 'reload schema';
