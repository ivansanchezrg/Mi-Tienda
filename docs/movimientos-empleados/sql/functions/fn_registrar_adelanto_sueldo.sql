-- ==========================================
-- FUNCION: fn_registrar_adelanto_sueldo (v1.1)
-- ==========================================
-- Registra un adelanto de sueldo como transaccion atomica.
-- El sistema elige automaticamente de que caja sacar: VARIOS primero, luego CAJA (Tienda).
-- CAJA_CHICA no se usa porque se resetea diariamente en el cierre.
--
-- CAMBIOS v1.1:
--   - p_turno_id ahora es opcional (DEFAULT NULL). El adelanto no requiere turno abierto.
--     El admin puede dar un adelanto desde cualquier dispositivo en cualquier momento.
--   - Se elimino la validacion de turno abierto.
--   - turno_id en movimientos_empleados queda NULL (no viene de un cierre).
--
-- Flujo:
--   1. Validar monto, beneficiario y fondos disponibles
--   2. Distribuir monto entre cajas (VARIOS → CAJA)
--   3. Registrar EGRESO(s) en operaciones_cajas con categoria EG-014
--   4. Registrar ADELANTO_SUELDO en movimientos_empleados
--   5. Retornar JSON con instrucciones fisicas
--
-- Llamada desde: MovimientosEmpleadosService.registrarAdelanto()
-- ==========================================

-- DROP previo necesario porque cambia la firma del parametro (UUID → UUID DEFAULT NULL)
DROP FUNCTION IF EXISTS public.fn_registrar_adelanto_sueldo(UUID, INTEGER, INTEGER, DECIMAL, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_registrar_adelanto_sueldo(
  p_empleado_id     INTEGER,        -- quien opera (admin que autoriza)
  p_beneficiario_id INTEGER,        -- a quien se le da el adelanto
  p_monto           DECIMAL(12,2),
  p_descripcion     TEXT DEFAULT NULL,
  p_comprobante_url TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_varios_id       INTEGER;
  v_caja_id         INTEGER;
  v_saldo_varios    DECIMAL(12,2);
  v_saldo_caja      DECIMAL(12,2);
  v_monto_de_varios DECIMAL(12,2);
  v_monto_de_caja   DECIMAL(12,2);
  v_cat_adelanto_id    INTEGER;
  v_tipo_ref_id        INTEGER;
  v_op_varios_id       UUID;
  v_op_caja_id         UUID;
  v_mov_id             UUID;
  v_beneficiario_nombre VARCHAR(255);
  v_instrucciones      JSON;
BEGIN
  -- ==========================================
  -- VALIDACIONES
  -- ==========================================

  IF p_monto <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'El monto debe ser mayor a cero');
  END IF;

  SELECT nombre INTO v_beneficiario_nombre
  FROM usuarios WHERE id = p_beneficiario_id AND activo = TRUE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'El empleado no existe o no esta activo');
  END IF;

  SELECT id INTO v_cat_adelanto_id
  FROM categorias_operaciones
  WHERE tipo = 'EGRESO' AND nombre = 'Adelanto Sueldo Empleado'
  LIMIT 1;

  IF v_cat_adelanto_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Categoria EG-014 no encontrada');
  END IF;

  SELECT id INTO v_tipo_ref_id
  FROM tipos_referencia WHERE tabla = 'movimientos_empleados';
  IF v_tipo_ref_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Tipo de referencia movimientos_empleados no encontrado en tipos_referencia');
  END IF;

  -- ==========================================
  -- DISTRIBUCION ENTRE CAJAS (VARIOS → CAJA)
  -- ==========================================

  SELECT id INTO v_varios_id FROM cajas WHERE codigo = 'VARIOS';
  SELECT id INTO v_caja_id   FROM cajas WHERE codigo = 'CAJA';

  SELECT saldo_actual INTO v_saldo_varios FROM cajas WHERE id = v_varios_id FOR UPDATE;
  SELECT saldo_actual INTO v_saldo_caja   FROM cajas WHERE id = v_caja_id   FOR UPDATE;

  v_monto_de_varios := LEAST(p_monto, v_saldo_varios);
  v_monto_de_caja   := p_monto - v_monto_de_varios;

  IF v_monto_de_caja > v_saldo_caja THEN
    RETURN json_build_object(
      'success', false,
      'error', format(
        'Fondos insuficientes. Varios: $%s, Tienda: $%s, Total disponible: $%s, Monto solicitado: $%s',
        TO_CHAR(v_saldo_varios, 'FM999990.00'),
        TO_CHAR(v_saldo_caja, 'FM999990.00'),
        TO_CHAR(v_saldo_varios + v_saldo_caja, 'FM999990.00'),
        TO_CHAR(p_monto, 'FM999990.00')
      )
    );
  END IF;

  -- ==========================================
  -- MOVIMIENTO DEL EMPLEADO (primero para obtener el ID)
  -- ==========================================

  INSERT INTO movimientos_empleados (
    empleado_id, tipo_movimiento, monto,
    descripcion, creado_por
  ) VALUES (
    p_beneficiario_id,
    'ADELANTO_SUELDO',
    p_monto,
    COALESCE(p_descripcion, 'Adelanto de sueldo'),
    p_empleado_id
  ) RETURNING id INTO v_mov_id;

  -- ==========================================
  -- EGRESOS DE CAJAS
  -- ==========================================

  IF v_monto_de_varios > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, categoria_id,
      tipo_referencia_id, referencia_id,
      monto, saldo_anterior, saldo_actual,
      descripcion, comprobante_url
    ) VALUES (
      gen_random_uuid(), v_varios_id, p_empleado_id, 'EGRESO', v_cat_adelanto_id,
      v_tipo_ref_id, v_mov_id,
      v_monto_de_varios, v_saldo_varios, v_saldo_varios - v_monto_de_varios,
      format('Adelanto de sueldo a %s', v_beneficiario_nombre),
      p_comprobante_url
    ) RETURNING id INTO v_op_varios_id;

    UPDATE cajas SET saldo_actual = saldo_actual - v_monto_de_varios WHERE id = v_varios_id;
  END IF;

  IF v_monto_de_caja > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, categoria_id,
      tipo_referencia_id, referencia_id,
      monto, saldo_anterior, saldo_actual,
      descripcion, comprobante_url
    ) VALUES (
      gen_random_uuid(), v_caja_id, p_empleado_id, 'EGRESO', v_cat_adelanto_id,
      v_tipo_ref_id, v_mov_id,
      v_monto_de_caja, v_saldo_caja, v_saldo_caja - v_monto_de_caja,
      format('Adelanto de sueldo a %s', v_beneficiario_nombre),
      p_comprobante_url
    ) RETURNING id INTO v_op_caja_id;

    UPDATE cajas SET saldo_actual = saldo_actual - v_monto_de_caja WHERE id = v_caja_id;
  END IF;

  -- ==========================================
  -- INSTRUCCIONES FISICAS
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
    'movimiento_id',          v_mov_id,
    'monto',                  p_monto,
    'beneficiario',           v_beneficiario_nombre,
    'instrucciones_fisicas',  COALESCE(v_instrucciones, '[]'::JSON),
    'operaciones_ids',        json_build_array(v_op_varios_id, v_op_caja_id)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Permisos
REVOKE EXECUTE ON FUNCTION public.fn_registrar_adelanto_sueldo(INTEGER, INTEGER, DECIMAL, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_registrar_adelanto_sueldo(INTEGER, INTEGER, DECIMAL, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_registrar_adelanto_sueldo IS
  'v1.1 - Registra adelanto de sueldo como transaccion atomica. No requiere turno abierto. '
  'El admin puede dar un adelanto en cualquier momento desde cualquier dispositivo. '
  'Distribuye automaticamente: VARIOS primero, luego CAJA (Tienda). CAJA_CHICA excluida. '
  'Registra EGRESO(s) en operaciones_cajas (EG-014) + ADELANTO_SUELDO en movimientos_empleados. '
  'Retorna instrucciones fisicas para que el admin sepa de que sobres sacar el efectivo.';
