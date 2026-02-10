-- ==========================================
-- FUNCIÓN: registrar_recargas_testing
-- ==========================================
-- TEMPORAL: Solo para testing del Cuadre de Caja
-- Registra recargas y actualiza cajas (sin cerrar turno)
--
-- PROPÓSITO: Verificar que los cálculos del Cuadre sean correctos
-- IMPORTANTE: Esta función NO debe usarse en producción
-- ==========================================

DROP FUNCTION IF EXISTS registrar_recargas_testing;

CREATE OR REPLACE FUNCTION registrar_recargas_testing(
  p_fecha DATE,
  p_empleado_id INTEGER,
  p_saldo_anterior_celular NUMERIC,
  p_saldo_actual_celular NUMERIC,
  p_venta_celular NUMERIC,
  p_saldo_anterior_bus NUMERIC,
  p_saldo_actual_bus NUMERIC,
  p_venta_bus NUMERIC
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_tipo_celular_id INTEGER;
  v_tipo_bus_id INTEGER;
  v_tipo_ref_recargas_id INTEGER;
  v_caja_celular_id INTEGER;
  v_caja_bus_id INTEGER;
  v_recarga_celular_id UUID;
  v_recarga_bus_id UUID;
  v_saldo_celular_anterior NUMERIC;
  v_saldo_bus_anterior NUMERIC;
  v_saldo_celular_nuevo NUMERIC;
  v_saldo_bus_nuevo NUMERIC;
  v_turno_id UUID;
BEGIN
  -- ==========================================
  -- 1. VALIDACIONES
  -- ==========================================

  -- Obtener IDs necesarios
  SELECT id INTO v_tipo_celular_id FROM tipos_servicio WHERE codigo = 'CELULAR';
  SELECT id INTO v_tipo_bus_id FROM tipos_servicio WHERE codigo = 'BUS';
  SELECT id INTO v_tipo_ref_recargas_id FROM tipos_referencia WHERE codigo = 'RECARGAS';
  SELECT id INTO v_caja_celular_id FROM cajas WHERE codigo = 'CAJA_CELULAR';
  SELECT id INTO v_caja_bus_id FROM cajas WHERE codigo = 'CAJA_BUS';

  -- Obtener turno activo de hoy, o el más reciente disponible
  SELECT id INTO v_turno_id
  FROM turnos_caja
  WHERE fecha = p_fecha AND hora_cierre IS NULL
  LIMIT 1;

  IF v_turno_id IS NULL THEN
    SELECT id INTO v_turno_id
    FROM turnos_caja
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- Si no existe ningún turno, crear uno temporal para testing
  IF v_turno_id IS NULL THEN
    INSERT INTO turnos_caja (id, fecha, numero_turno, empleado_id, hora_apertura, created_at)
    VALUES (uuid_generate_v4(), p_fecha, 1, p_empleado_id, NOW(), NOW())
    RETURNING id INTO v_turno_id;
  END IF;

  -- Validar que existan los tipos
  IF v_tipo_celular_id IS NULL OR v_tipo_bus_id IS NULL THEN
    RAISE EXCEPTION 'Tipos de servicio no encontrados';
  END IF;

  IF v_tipo_ref_recargas_id IS NULL THEN
    RAISE EXCEPTION 'Tipo de referencia RECARGAS no encontrado';
  END IF;

  -- Validar que las ventas no sean negativas
  IF p_venta_celular < 0 OR p_venta_bus < 0 THEN
    RAISE EXCEPTION 'Las ventas no pueden ser negativas. Celular: $%, Bus: $%',
      p_venta_celular, p_venta_bus;
  END IF;

  -- Validar fórmula: venta + saldo_actual = saldo_anterior
  IF (p_venta_celular + p_saldo_actual_celular) != p_saldo_anterior_celular THEN
    RAISE EXCEPTION 'Error en cálculo de celular. Venta ($%) + Actual ($%) != Anterior ($%)',
      p_venta_celular, p_saldo_actual_celular, p_saldo_anterior_celular;
  END IF;

  IF (p_venta_bus + p_saldo_actual_bus) != p_saldo_anterior_bus THEN
    RAISE EXCEPTION 'Error en cálculo de bus. Venta ($%) + Actual ($%) != Anterior ($%)',
      p_venta_bus, p_saldo_actual_bus, p_saldo_anterior_bus;
  END IF;

  -- ==========================================
  -- 2. INSERTAR RECARGAS
  -- ==========================================

  -- Insertar recarga CELULAR
  INSERT INTO recargas (
    id, fecha, turno_id, tipo_servicio_id, venta_dia,
    saldo_virtual_anterior, saldo_virtual_actual,
    empleado_id, validado, created_at
  )
  VALUES (
    uuid_generate_v4(), p_fecha, v_turno_id, v_tipo_celular_id, p_venta_celular,
    p_saldo_anterior_celular, p_saldo_actual_celular,
    p_empleado_id,
    (p_venta_celular + p_saldo_actual_celular) = p_saldo_anterior_celular,
    NOW()
  )
  RETURNING id INTO v_recarga_celular_id;

  -- Insertar recarga BUS
  INSERT INTO recargas (
    id, fecha, turno_id, tipo_servicio_id, venta_dia,
    saldo_virtual_anterior, saldo_virtual_actual,
    empleado_id, validado, created_at
  )
  VALUES (
    uuid_generate_v4(), p_fecha, v_turno_id, v_tipo_bus_id, p_venta_bus,
    p_saldo_anterior_bus, p_saldo_actual_bus,
    p_empleado_id,
    (p_venta_bus + p_saldo_actual_bus) = p_saldo_anterior_bus,
    NOW()
  )
  RETURNING id INTO v_recarga_bus_id;

  -- ==========================================
  -- 3. OBTENER SALDOS ANTERIORES DE CAJAS
  -- ==========================================

  SELECT saldo_actual INTO v_saldo_celular_anterior
  FROM cajas WHERE id = v_caja_celular_id;

  SELECT saldo_actual INTO v_saldo_bus_anterior
  FROM cajas WHERE id = v_caja_bus_id;

  -- Calcular nuevos saldos
  v_saldo_celular_nuevo := v_saldo_celular_anterior + p_venta_celular;
  v_saldo_bus_nuevo := v_saldo_bus_anterior + p_venta_bus;

  -- ==========================================
  -- 4. CREAR OPERACIONES DE CAJAS
  -- ==========================================

  -- Operación INGRESO en CAJA_CELULAR
  INSERT INTO operaciones_cajas (
    id, caja_id, empleado_id, tipo_operacion, monto, fecha,
    saldo_anterior, saldo_actual, descripcion,
    tipo_referencia_id, referencia_id, created_at
  )
  VALUES (
    uuid_generate_v4(), v_caja_celular_id, p_empleado_id, 'INGRESO', p_venta_celular, p_fecha,
    v_saldo_celular_anterior, v_saldo_celular_nuevo,
    'Venta del día ' || p_fecha,
    v_tipo_ref_recargas_id, v_recarga_celular_id, NOW()
  );

  -- Operación INGRESO en CAJA_BUS
  INSERT INTO operaciones_cajas (
    id, caja_id, empleado_id, tipo_operacion, monto, fecha,
    saldo_anterior, saldo_actual, descripcion,
    tipo_referencia_id, referencia_id, created_at
  )
  VALUES (
    uuid_generate_v4(), v_caja_bus_id, p_empleado_id, 'INGRESO', p_venta_bus, p_fecha,
    v_saldo_bus_anterior, v_saldo_bus_nuevo,
    'Venta del día ' || p_fecha,
    v_tipo_ref_recargas_id, v_recarga_bus_id, NOW()
  );

  -- ==========================================
  -- 5. ACTUALIZAR SALDOS DE CAJAS
  -- ==========================================

  UPDATE cajas
  SET saldo_actual = v_saldo_celular_nuevo, updated_at = NOW()
  WHERE id = v_caja_celular_id;

  UPDATE cajas
  SET saldo_actual = v_saldo_bus_nuevo, updated_at = NOW()
  WHERE id = v_caja_bus_id;

  -- ==========================================
  -- 6. RETORNAR RESULTADO
  -- ==========================================

  RETURN json_build_object(
    'success', true,
    'message', 'Recargas registradas correctamente (Testing)',
    'recargas', json_build_object(
      'celular_id', v_recarga_celular_id,
      'bus_id', v_recarga_bus_id
    ),
    'ventas', json_build_object(
      'celular', p_venta_celular,
      'bus', p_venta_bus
    ),
    'saldos_cajas_nuevos', json_build_object(
      'celular', v_saldo_celular_nuevo,
      'bus', v_saldo_bus_nuevo
    )
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al registrar recargas de testing: %', SQLERRM;
END;
$$;

-- Comentario
COMMENT ON FUNCTION registrar_recargas_testing IS 'FUNCIÓN DE TESTING - Registra recargas para verificar cálculos del Cuadre. NO USAR EN PRODUCCIÓN.';
