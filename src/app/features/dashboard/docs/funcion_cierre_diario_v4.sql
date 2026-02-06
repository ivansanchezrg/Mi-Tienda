-- ==========================================
-- FUNCIÓN: ejecutar_cierre_diario (VERSIÓN 4.0)
-- ==========================================
-- Ejecuta el cierre diario completo en una transacción atómica
-- Si alguna operación falla, se hace rollback automático de todo
--
-- CAMBIOS EN VERSIÓN 4.0:
-- ✅ Ultra-simplificado: Solo requiere efectivo_recaudado
-- ✅ Fondo fijo desde config: configuraciones.fondo_fijo_diario
-- ✅ Fórmula final: depósito = efectivo_recaudado - fondo_fijo - transferencia
-- ✅ Operaciones: INGRESO a CAJA, TRANSFERENCIA a CAJA_CHICA
-- ✅ No requiere saldo_inicial ni fondo_siguiente_dia (viene de config)
-- ==========================================

-- Eliminar la función anterior si existe
DROP FUNCTION IF EXISTS ejecutar_cierre_diario;

CREATE OR REPLACE FUNCTION ejecutar_cierre_diario(
  p_fecha DATE,
  p_empleado_id INTEGER,
  p_efectivo_recaudado DECIMAL(12,2),
  p_saldo_celular_final DECIMAL(12,2),
  p_saldo_bus_final DECIMAL(12,2),
  p_saldo_anterior_celular DECIMAL(12,2),
  p_saldo_anterior_bus DECIMAL(12,2),
  p_saldo_anterior_caja DECIMAL(12,2),
  p_saldo_anterior_caja_chica DECIMAL(12,2),
  p_saldo_anterior_caja_celular DECIMAL(12,2),
  p_saldo_anterior_caja_bus DECIMAL(12,2),
  p_observaciones TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  -- IDs de tablas
  v_caja_id INTEGER := 1;
  v_caja_chica_id INTEGER := 2;
  v_caja_celular_id INTEGER := 3;
  v_caja_bus_id INTEGER := 4;
  v_tipo_servicio_celular_id INTEGER;
  v_tipo_servicio_bus_id INTEGER;
  v_tipo_ref_caja_fisica_id INTEGER;

  -- Configuración (desde tabla configuraciones)
  v_fondo_fijo DECIMAL(10,2);
  v_transferencia_diaria DECIMAL(12,2);

  -- Cálculos v4.0 (ultra-simplificados)
  v_dinero_a_depositar DECIMAL(12,2);
  v_saldo_final_caja DECIMAL(12,2);
  v_saldo_final_caja_chica DECIMAL(12,2);

  -- Ventas de recargas
  v_venta_celular DECIMAL(12,2);
  v_venta_bus DECIMAL(12,2);
  v_saldo_final_caja_celular DECIMAL(12,2);
  v_saldo_final_caja_bus DECIMAL(12,2);

  -- IDs generados
  v_cierre_id UUID;
  v_recarga_celular_id UUID;
  v_recarga_bus_id UUID;
BEGIN
  -- ==========================================
  -- 1. VALIDACIONES
  -- ==========================================

  -- Verificar que no exista ya un cierre para esta fecha
  IF EXISTS (SELECT 1 FROM caja_fisica_diaria WHERE fecha = p_fecha) THEN
    RAISE EXCEPTION 'Ya existe un cierre registrado para la fecha %', p_fecha;
  END IF;

  -- Obtener configuración del sistema
  SELECT fondo_fijo_diario, caja_chica_transferencia_diaria
  INTO v_fondo_fijo, v_transferencia_diaria
  FROM configuraciones
  LIMIT 1;

  -- Validar que exista configuración
  IF v_fondo_fijo IS NULL OR v_transferencia_diaria IS NULL THEN
    RAISE EXCEPTION 'No se encontró configuración del sistema';
  END IF;

  -- Obtener IDs de tipos de servicio
  SELECT id INTO v_tipo_servicio_celular_id FROM tipos_servicio WHERE codigo = 'CELULAR';
  SELECT id INTO v_tipo_servicio_bus_id FROM tipos_servicio WHERE codigo = 'BUS';

  -- Obtener ID de tipo de referencia
  SELECT id INTO v_tipo_ref_caja_fisica_id FROM tipos_referencia WHERE codigo = 'CAJA_FISICA_DIARIA';

  -- ==========================================
  -- 2. INSERTAR REGISTRO EN caja_fisica_diaria
  -- ==========================================

  INSERT INTO caja_fisica_diaria (
    id, fecha, empleado_id, efectivo_recaudado, observaciones, created_at
  ) VALUES (
    uuid_generate_v4(), p_fecha, p_empleado_id, p_efectivo_recaudado, p_observaciones, NOW()
  )
  RETURNING id INTO v_cierre_id;

  -- ==========================================
  -- 3. CÁLCULOS v4.0 (ULTRA-SIMPLIFICADOS)
  -- ==========================================

  -- Fórmula simple: depósito = efectivo_recaudado - fondo_fijo - transferencia
  v_dinero_a_depositar := p_efectivo_recaudado - v_fondo_fijo - v_transferencia_diaria;

  -- Validar que el depósito no sea negativo
  IF v_dinero_a_depositar < 0 THEN
    RAISE EXCEPTION 'El dinero a depositar no puede ser negativo. Efectivo: $%, Fondo: $%, Transferencia: $%',
      p_efectivo_recaudado, v_fondo_fijo, v_transferencia_diaria;
  END IF;

  -- Saldo final CAJA: anterior + depósito
  v_saldo_final_caja := p_saldo_anterior_caja + v_dinero_a_depositar;

  -- Saldo final CAJA_CHICA: anterior + transferencia
  v_saldo_final_caja_chica := p_saldo_anterior_caja_chica + v_transferencia_diaria;

  -- Ventas de recargas (sin cambios)
  v_venta_celular := p_saldo_anterior_celular - p_saldo_celular_final;
  v_venta_bus := p_saldo_anterior_bus - p_saldo_bus_final;

  -- Saldos finales de cajas de recargas
  v_saldo_final_caja_celular := p_saldo_anterior_caja_celular + v_venta_celular;
  v_saldo_final_caja_bus := p_saldo_anterior_caja_bus + v_venta_bus;

  -- ==========================================
  -- 4. OPERACIÓN EN CAJA PRINCIPAL
  -- ==========================================

  -- INGRESO: Depósito del dinero
  IF v_dinero_a_depositar > 0 THEN
    INSERT INTO operaciones_cajas (
      id, caja_id, empleado_id, tipo_operacion, monto,
      saldo_anterior, saldo_actual, descripcion,
      tipo_referencia_id, referencia_id, created_at
    ) VALUES (
      uuid_generate_v4(), v_caja_id, p_empleado_id, 'INGRESO', v_dinero_a_depositar,
      p_saldo_anterior_caja, v_saldo_final_caja,
      'Depósito del día ' || p_fecha,
      v_tipo_ref_caja_fisica_id, v_cierre_id, NOW()
    );
  END IF;

  -- ==========================================
  -- 5. TRANSFERENCIA A CAJA_CHICA
  -- ==========================================

  -- La transferencia se hace FÍSICAMENTE, no desde CAJA PRINCIPAL
  -- Por eso CAJA_CHICA recibe directamente sin operación SALIENTE en CAJA
  INSERT INTO operaciones_cajas (
    id, caja_id, empleado_id, tipo_operacion, monto,
    saldo_anterior, saldo_actual, descripcion,
    tipo_referencia_id, referencia_id, created_at
  ) VALUES (
    uuid_generate_v4(), v_caja_chica_id, p_empleado_id, 'TRANSFERENCIA_ENTRANTE', v_transferencia_diaria,
    p_saldo_anterior_caja_chica, v_saldo_final_caja_chica,
    'Transferencia diaria desde caja física',
    v_tipo_ref_caja_fisica_id, v_cierre_id, NOW()
  );

  -- ==========================================
  -- 6. RECARGAS CELULAR
  -- ==========================================

  INSERT INTO recargas (
    id, fecha, empleado_id, tipo_servicio_id,
    venta_dia, saldo_virtual_anterior, saldo_virtual_actual,
    validado, created_at
  ) VALUES (
    uuid_generate_v4(), p_fecha, p_empleado_id, v_tipo_servicio_celular_id,
    v_venta_celular, p_saldo_anterior_celular, p_saldo_celular_final,
    (v_venta_celular + p_saldo_celular_final) = p_saldo_anterior_celular,
    NOW()
  )
  RETURNING id INTO v_recarga_celular_id;

  INSERT INTO operaciones_cajas (
    id, caja_id, empleado_id, tipo_operacion, monto,
    saldo_anterior, saldo_actual, descripcion,
    tipo_referencia_id, referencia_id, created_at
  ) VALUES (
    uuid_generate_v4(), v_caja_celular_id, p_empleado_id, 'INGRESO', v_venta_celular,
    p_saldo_anterior_caja_celular, v_saldo_final_caja_celular,
    'Venta del día ' || p_fecha,
    (SELECT id FROM tipos_referencia WHERE codigo = 'RECARGAS'), v_recarga_celular_id, NOW()
  );

  -- ==========================================
  -- 7. RECARGAS BUS
  -- ==========================================

  INSERT INTO recargas (
    id, fecha, empleado_id, tipo_servicio_id,
    venta_dia, saldo_virtual_anterior, saldo_virtual_actual,
    validado, created_at
  ) VALUES (
    uuid_generate_v4(), p_fecha, p_empleado_id, v_tipo_servicio_bus_id,
    v_venta_bus, p_saldo_anterior_bus, p_saldo_bus_final,
    (v_venta_bus + p_saldo_bus_final) = p_saldo_anterior_bus,
    NOW()
  )
  RETURNING id INTO v_recarga_bus_id;

  INSERT INTO operaciones_cajas (
    id, caja_id, empleado_id, tipo_operacion, monto,
    saldo_anterior, saldo_actual, descripcion,
    tipo_referencia_id, referencia_id, created_at
  ) VALUES (
    uuid_generate_v4(), v_caja_bus_id, p_empleado_id, 'INGRESO', v_venta_bus,
    p_saldo_anterior_caja_bus, v_saldo_final_caja_bus,
    'Venta del día ' || p_fecha,
    (SELECT id FROM tipos_referencia WHERE codigo = 'RECARGAS'), v_recarga_bus_id, NOW()
  );

  -- ==========================================
  -- 8. ACTUALIZAR SALDOS DE LAS CAJAS
  -- ==========================================

  UPDATE cajas SET saldo_actual = v_saldo_final_caja, updated_at = NOW()
  WHERE id = v_caja_id;

  UPDATE cajas SET saldo_actual = v_saldo_final_caja_chica, updated_at = NOW()
  WHERE id = v_caja_chica_id;

  UPDATE cajas SET saldo_actual = v_saldo_final_caja_celular, updated_at = NOW()
  WHERE id = v_caja_celular_id;

  UPDATE cajas SET saldo_actual = v_saldo_final_caja_bus, updated_at = NOW()
  WHERE id = v_caja_bus_id;

  -- ==========================================
  -- 9. RETORNAR RESUMEN
  -- ==========================================

  RETURN json_build_object(
    'success', true,
    'cierre_id', v_cierre_id,
    'fecha', p_fecha,
    'configuracion', json_build_object(
      'fondo_fijo', v_fondo_fijo,
      'transferencia_diaria', v_transferencia_diaria
    ),
    'saldos_finales', json_build_object(
      'caja', v_saldo_final_caja,
      'caja_chica', v_saldo_final_caja_chica,
      'caja_celular', v_saldo_final_caja_celular,
      'caja_bus', v_saldo_final_caja_bus
    ),
    'operaciones_creadas', json_build_object(
      'deposito', v_dinero_a_depositar,
      'transferencia_caja_chica', v_transferencia_diaria,
      'venta_celular', v_venta_celular,
      'venta_bus', v_venta_bus
    )
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error en cierre diario: %', SQLERRM;
END;
$$;

-- ==========================================
-- COMENTARIOS
-- ==========================================

COMMENT ON FUNCTION ejecutar_cierre_diario IS 'Ejecuta el cierre diario completo en transacción atómica (Versión 4.0 - Ultra-simplificado con fondo fijo)';
