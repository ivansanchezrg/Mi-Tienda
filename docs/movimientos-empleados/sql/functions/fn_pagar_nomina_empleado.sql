-- ==========================================
-- FUNCION: fn_pagar_nomina_empleado (v1.1)
-- ==========================================
-- Liquida la cuenta corriente de un empleado como transaccion atomica.
-- El sistema elige automaticamente de que cajas sacar: VARIOS primero, luego CAJA (Tienda).
-- CAJA_CHICA no se usa — solo VARIOS y CAJA (cajas permanentes, no requieren turno).
--
-- CAMBIOS v1.1:
--   - p_turno_id eliminado. El pago de nomina no requiere turno abierto.
--     El admin paga la nomina desde cualquier dispositivo en cualquier momento.
--     Solo requieren turno las operaciones que afectan CAJA_CHICA (el cajon diario).
--
-- Flujo:
--   1. Insertar SUELDO_BASE en movimientos_empleados
--   2. Calcular descuentos pendientes (FALTANTE_CAJA + ADELANTO_SUELDO + AJUSTE cargo)
--   3. Calcular liquido = sueldo_base - descuentos
--   4. Si liquido <= 0: marcar todo LIQUIDADO, no tocar caja
--   5. Si liquido > 0: distribuir entre VARIOS → CAJA, registrar EGRESO(s)
--   6. Registrar PAGO_NOMINA + marcar pendientes como LIQUIDADO
--   7. Retornar JSON con desglose e instrucciones fisicas
--
-- Llamada desde: MovimientosEmpleadosService.pagarNomina()
-- ==========================================

-- DROP previo necesario porque cambia la firma (se elimina p_turno_id UUID)
DROP FUNCTION IF EXISTS public.fn_pagar_nomina_empleado(UUID, INTEGER, INTEGER, DECIMAL, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_pagar_nomina_empleado(
  p_empleado_id     INTEGER,        -- quien opera (admin que autoriza)
  p_beneficiario_id INTEGER,        -- a quien se le paga
  p_sueldo_base     DECIMAL(12,2),  -- sueldo bruto del periodo
  p_descripcion     TEXT DEFAULT NULL,
  p_comprobante_url TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_varios_id         INTEGER;
  v_caja_id           INTEGER;
  v_saldo_varios      DECIMAL(12,2);
  v_saldo_caja        DECIMAL(12,2);
  v_cat_salarios_id   INTEGER;
  v_beneficiario_nombre VARCHAR(255);

  v_total_descuentos  DECIMAL(12,2) := 0;
  v_liquido           DECIMAL(12,2);
  v_monto_de_varios   DECIMAL(12,2);
  v_monto_de_caja     DECIMAL(12,2);

  v_tipo_ref_id       INTEGER;
  v_op_varios_id      UUID;
  v_op_caja_id        UUID;
  v_mov_sueldo_id     UUID;
  v_mov_pago_id       UUID;

  v_detalle_descuentos JSON;
  v_instrucciones      JSON;
BEGIN
  -- ==========================================
  -- VALIDACIONES
  -- ==========================================

  IF p_sueldo_base <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'El sueldo base debe ser mayor a cero');
  END IF;

  SELECT nombre INTO v_beneficiario_nombre
  FROM usuarios WHERE id = p_beneficiario_id AND activo = TRUE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'El empleado no existe o no esta activo');
  END IF;

  SELECT id INTO v_cat_salarios_id
  FROM categorias_operaciones
  WHERE tipo = 'EGRESO' AND nombre = 'Salarios'
  LIMIT 1;

  IF v_cat_salarios_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Categoria EG-007 (Salarios) no encontrada');
  END IF;

  SELECT id INTO v_tipo_ref_id
  FROM tipos_referencia WHERE tabla = 'movimientos_empleados';
  IF v_tipo_ref_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Tipo de referencia movimientos_empleados no encontrado en tipos_referencia');
  END IF;

  -- ==========================================
  -- 1. INSERTAR SUELDO_BASE
  -- ==========================================

  INSERT INTO movimientos_empleados (
    empleado_id, tipo_movimiento, monto, descripcion, creado_por
  ) VALUES (
    p_beneficiario_id,
    'SUELDO_BASE',
    p_sueldo_base,
    COALESCE(p_descripcion, 'Sueldo del periodo'),
    p_empleado_id
  ) RETURNING id INTO v_mov_sueldo_id;

  -- ==========================================
  -- 2. CALCULAR DESCUENTOS PENDIENTES
  -- ==========================================

  SELECT
    COALESCE(SUM(monto), 0),
    COALESCE(json_agg(json_build_object(
      'tipo', tipo_movimiento::TEXT,
      'monto', monto,
      'fecha', TO_CHAR(fecha, 'YYYY-MM-DD'),
      'descripcion', COALESCE(descripcion, '')
    ) ORDER BY fecha), '[]'::JSON)
  INTO v_total_descuentos, v_detalle_descuentos
  FROM movimientos_empleados
  WHERE empleado_id = p_beneficiario_id
    AND estado_liquidacion = 'PENDIENTE'
    AND tipo_movimiento IN ('FALTANTE_CAJA', 'ADELANTO_SUELDO', 'AJUSTE_CARGO')
    AND id != v_mov_sueldo_id;

  -- ==========================================
  -- 3. CALCULAR LIQUIDO
  -- ==========================================

  v_liquido := p_sueldo_base - v_total_descuentos;

  -- ==========================================
  -- 4. SI LIQUIDO <= 0: DESCUENTOS ABSORBEN TODO
  -- ==========================================

  IF v_liquido <= 0 THEN
    INSERT INTO movimientos_empleados (
      empleado_id, tipo_movimiento, monto, descripcion, creado_por
    ) VALUES (
      p_beneficiario_id,
      'PAGO_NOMINA',
      p_sueldo_base,
      'Sueldo absorbido por descuentos pendientes — no sale efectivo de caja',
      p_empleado_id
    ) RETURNING id INTO v_mov_pago_id;

    UPDATE movimientos_empleados
    SET estado_liquidacion = 'LIQUIDADO',
        liquidado_en = v_mov_pago_id
    WHERE empleado_id = p_beneficiario_id
      AND estado_liquidacion = 'PENDIENTE';

    RETURN json_build_object(
      'success',               true,
      'sueldo_bruto',          p_sueldo_base,
      'total_descuentos',      v_total_descuentos,
      'detalle_descuentos',    v_detalle_descuentos,
      'liquido_pagado',        0,
      'instrucciones_fisicas', '[]'::JSON,
      'operaciones_ids',       '[]'::JSON,
      'mensaje',               'El sueldo fue absorbido por los descuentos pendientes. No sale efectivo de caja.'
    );
  END IF;

  -- ==========================================
  -- 5. LIQUIDO > 0: DISTRIBUIR ENTRE CAJAS
  -- ==========================================

  SELECT id INTO v_varios_id FROM cajas WHERE codigo = 'VARIOS';
  SELECT id INTO v_caja_id   FROM cajas WHERE codigo = 'CAJA';

  SELECT saldo_actual INTO v_saldo_varios FROM cajas WHERE id = v_varios_id FOR UPDATE;
  SELECT saldo_actual INTO v_saldo_caja   FROM cajas WHERE id = v_caja_id   FOR UPDATE;

  v_monto_de_varios := LEAST(v_liquido, v_saldo_varios);
  v_monto_de_caja   := v_liquido - v_monto_de_varios;

  IF v_monto_de_caja > v_saldo_caja THEN
    RAISE EXCEPTION 'Fondos insuficientes. Varios: $%, Tienda: $%, Total: $%, Necesario: $%',
      TO_CHAR(v_saldo_varios, 'FM999990.00'),
      TO_CHAR(v_saldo_caja, 'FM999990.00'),
      TO_CHAR(v_saldo_varios + v_saldo_caja, 'FM999990.00'),
      TO_CHAR(v_liquido, 'FM999990.00');
  END IF;

  -- ==========================================
  -- 6. PAGO_NOMINA (primero para obtener el ID)
  -- ==========================================

  INSERT INTO movimientos_empleados (
    empleado_id, tipo_movimiento, monto,
    descripcion, creado_por
  ) VALUES (
    p_beneficiario_id,
    'PAGO_NOMINA',
    v_liquido,
    COALESCE(p_descripcion, format('Pago nomina — bruto $%s, descuentos $%s, liquido $%s',
      TO_CHAR(p_sueldo_base, 'FM999990.00'),
      TO_CHAR(v_total_descuentos, 'FM999990.00'),
      TO_CHAR(v_liquido, 'FM999990.00')
    )),
    p_empleado_id
  ) RETURNING id INTO v_mov_pago_id;

  -- Egreso de VARIOS
  IF v_monto_de_varios > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, categoria_id,
      tipo_referencia_id, referencia_id,
      monto, saldo_anterior, saldo_actual,
      descripcion, comprobante_url
    ) VALUES (
      gen_random_uuid(), v_varios_id, p_empleado_id, 'EGRESO', v_cat_salarios_id,
      v_tipo_ref_id, v_mov_pago_id,
      v_monto_de_varios, v_saldo_varios, v_saldo_varios - v_monto_de_varios,
      format('Pago nomina a %s', v_beneficiario_nombre),
      p_comprobante_url
    ) RETURNING id INTO v_op_varios_id;

    UPDATE cajas SET saldo_actual = saldo_actual - v_monto_de_varios WHERE id = v_varios_id;
  END IF;

  -- Egreso de CAJA/Tienda
  IF v_monto_de_caja > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, categoria_id,
      tipo_referencia_id, referencia_id,
      monto, saldo_anterior, saldo_actual,
      descripcion, comprobante_url
    ) VALUES (
      gen_random_uuid(), v_caja_id, p_empleado_id, 'EGRESO', v_cat_salarios_id,
      v_tipo_ref_id, v_mov_pago_id,
      v_monto_de_caja, v_saldo_caja, v_saldo_caja - v_monto_de_caja,
      format('Pago nomina a %s', v_beneficiario_nombre),
      p_comprobante_url
    ) RETURNING id INTO v_op_caja_id;

    UPDATE cajas SET saldo_actual = saldo_actual - v_monto_de_caja WHERE id = v_caja_id;
  END IF;

  UPDATE movimientos_empleados
  SET estado_liquidacion = 'LIQUIDADO',
      liquidado_en = v_mov_pago_id
  WHERE empleado_id = p_beneficiario_id
    AND estado_liquidacion = 'PENDIENTE';

  -- ==========================================
  -- 7. INSTRUCCIONES FISICAS
  -- ==========================================

  SELECT json_agg(x) INTO v_instrucciones
  FROM (
    SELECT * FROM (VALUES
      ('Varios', 'VARIOS', v_monto_de_varios),
      ('Tienda', 'CAJA',   v_monto_de_caja)
    ) AS t(caja, codigo, monto)
    WHERE monto > 0
  ) x;

  -- ==========================================
  -- RESULTADO
  -- ==========================================

  RETURN json_build_object(
    'success',                true,
    'sueldo_bruto',           p_sueldo_base,
    'total_descuentos',       v_total_descuentos,
    'detalle_descuentos',     v_detalle_descuentos,
    'liquido_pagado',         v_liquido,
    'beneficiario',           v_beneficiario_nombre,
    'instrucciones_fisicas',  COALESCE(v_instrucciones, '[]'::JSON),
    'operaciones_ids',        json_build_array(v_op_varios_id, v_op_caja_id)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_pagar_nomina_empleado(INTEGER, INTEGER, DECIMAL, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_pagar_nomina_empleado(INTEGER, INTEGER, DECIMAL, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_pagar_nomina_empleado IS
  'v1.1 - Liquida la cuenta corriente de un empleado como transaccion atomica. No requiere turno abierto. '
  'Solo requieren turno las operaciones sobre CAJA_CHICA (cajon diario). VARIOS y CAJA son cajas permanentes. '
  'Inserta SUELDO_BASE, calcula descuentos pendientes (faltantes + adelantos + ajustes cargo), '
  'distribuye el liquido entre VARIOS y CAJA automaticamente, registra EGRESO(s), '
  'inserta PAGO_NOMINA y marca todos los movimientos PENDIENTE como LIQUIDADO. '
  'Retorna desglose completo con instrucciones fisicas para el admin.';
