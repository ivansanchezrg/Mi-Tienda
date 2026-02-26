-- ================================================================
-- INSERTAR DATOS REALES DEL CUADERNO EN TABLA RECARGAS
-- ================================================================
-- Fecha: 2026-02-24
-- Descripción: Inserta los datos históricos del cuaderno del empleado
--              Valores EXACTOS del cuaderno SIN cálculos
-- ================================================================

DO $$
DECLARE
  v_turno_id UUID;
  v_empleado_id INTEGER;
  v_tipo_bus_id INTEGER;
  v_tipo_celular_id INTEGER;
  v_caja_bus_id INTEGER;
  v_caja_celular_id INTEGER;
  v_categoria_ventas_id INTEGER;
  v_tipo_ref_recargas_id INTEGER;
  v_recarga_bus_id UUID;
  v_recarga_celular_id UUID;
  v_fecha_cierre DATE := '2026-02-23'; -- Ajustar a la fecha real del cierre
BEGIN

  -- ============================================================
  -- 1. OBTENER IDs NECESARIOS
  -- ============================================================

  SELECT id INTO v_empleado_id FROM empleados WHERE usuario = 'ivansan2192@gmail.com' LIMIT 1;
  SELECT id INTO v_tipo_bus_id FROM tipos_servicio WHERE codigo = 'BUS' LIMIT 1;
  SELECT id INTO v_tipo_celular_id FROM tipos_servicio WHERE codigo = 'CELULAR' LIMIT 1;
  SELECT id INTO v_caja_bus_id FROM cajas WHERE codigo = 'CAJA_BUS' LIMIT 1;
  SELECT id INTO v_caja_celular_id FROM cajas WHERE codigo = 'CAJA_CELULAR' LIMIT 1;
  SELECT id INTO v_categoria_ventas_id FROM categorias_operaciones WHERE codigo = 'IN-001' LIMIT 1;
  SELECT id INTO v_tipo_ref_recargas_id FROM tipos_referencia WHERE codigo = 'RECARGAS' LIMIT 1;

  -- ============================================================
  -- 2. CREAR TURNO
  -- ============================================================

  INSERT INTO turnos_caja (
    id, fecha, numero_turno, hora_apertura, hora_cierre, empleado_id, observaciones
  ) VALUES (
    gen_random_uuid(),
    v_fecha_cierre,
    1,
    v_fecha_cierre + INTERVAL '8 hours',
    v_fecha_cierre + INTERVAL '17 hours',
    v_empleado_id,
    'Turno histórico - datos del cuaderno'
  )
  RETURNING id INTO v_turno_id;

  RAISE NOTICE 'Turno creado: %', v_turno_id;

  -- ============================================================
  -- 3. INSERTAR RECARGA BUS (valores exactos del cuaderno)
  -- ============================================================

  v_recarga_bus_id := gen_random_uuid();

  INSERT INTO recargas (
    id, fecha, turno_id, tipo_servicio_id, empleado_id,
    venta_dia, saldo_virtual_anterior, saldo_virtual_actual,
    validado, created_at
  ) VALUES (
    v_recarga_bus_id,
    v_fecha_cierre,
    v_turno_id,
    v_tipo_bus_id,
    v_empleado_id,
    73.95,      -- venta_dia (exacto del cuaderno)
    155.25,     -- saldo_virtual_anterior (exacto del cuaderno)
    526.05,     -- saldo_virtual_actual (exacto del cuaderno)
    true,
    v_fecha_cierre + INTERVAL '17 hours'
  );

  RAISE NOTICE 'Recarga BUS: saldo_virtual 155.25 → 526.05, venta $73.95';

  -- ============================================================
  -- 4. INSERTAR RECARGA CELULAR (valores exactos del cuaderno)
  -- ============================================================

  v_recarga_celular_id := gen_random_uuid();

  INSERT INTO recargas (
    id, fecha, turno_id, tipo_servicio_id, empleado_id,
    venta_dia, saldo_virtual_anterior, saldo_virtual_actual,
    validado, created_at
  ) VALUES (
    v_recarga_celular_id,
    v_fecha_cierre,
    v_turno_id,
    v_tipo_celular_id,
    v_empleado_id,
    34.29,      -- venta_dia (exacto del cuaderno)
    151.00,     -- saldo_virtual_anterior (exacto del cuaderno)
    116.71,     -- saldo_virtual_actual (exacto del cuaderno)
    true,
    v_fecha_cierre + INTERVAL '17 hours'
  );

  RAISE NOTICE 'Recarga CELULAR: saldo_virtual 151.00 → 116.71, venta $34.29';

  -- ============================================================
  -- 5. REGISTRAR OPERACIONES (valores exactos del cuaderno)
  -- ============================================================

  -- CAJA_BUS: Registrar INGRESO por venta
  INSERT INTO operaciones_cajas (
    id, fecha, caja_id, empleado_id, tipo_operacion,
    monto, saldo_anterior, saldo_actual,
    categoria_id, tipo_referencia_id, referencia_id,
    descripcion, created_at
  ) VALUES (
    gen_random_uuid(),
    v_fecha_cierre + INTERVAL '17 hours',
    v_caja_bus_id,
    v_empleado_id,
    'INGRESO',
    73.95,      -- venta del día
    0.00,       -- saldo antes (73.95 - 73.95)
    73.95,      -- saldo después (exacto del cuaderno)
    v_categoria_ventas_id,
    v_tipo_ref_recargas_id,
    v_recarga_bus_id,
    'Venta de recargas Bus del día',
    v_fecha_cierre + INTERVAL '17 hours'
  );

  RAISE NOTICE 'Operación BUS: 0.00 + 73.95 = 73.95';

  -- CAJA_CELULAR: Registrar INGRESO por venta
  INSERT INTO operaciones_cajas (
    id, fecha, caja_id, empleado_id, tipo_operacion,
    monto, saldo_anterior, saldo_actual,
    categoria_id, tipo_referencia_id, referencia_id,
    descripcion, created_at
  ) VALUES (
    gen_random_uuid(),
    v_fecha_cierre + INTERVAL '17 hours',
    v_caja_celular_id,
    v_empleado_id,
    'INGRESO',
    34.29,      -- venta del día
    49.00,      -- saldo antes (83.29 - 34.29)
    83.29,      -- saldo después (exacto del cuaderno)
    v_categoria_ventas_id,
    v_tipo_ref_recargas_id,
    v_recarga_celular_id,
    'Venta de recargas Celular del día',
    v_fecha_cierre + INTERVAL '17 hours'
  );

  RAISE NOTICE 'Operación CELULAR: 49.00 + 34.29 = 83.29';

  -- ============================================================
  -- 6. ACTUALIZAR SALDOS FINALES (valores exactos del cuaderno)
  -- ============================================================

  UPDATE cajas SET saldo_actual = 73.95, updated_at = NOW() WHERE codigo = 'CAJA_BUS';
  UPDATE cajas SET saldo_actual = 83.29, updated_at = NOW() WHERE codigo = 'CAJA_CELULAR';

  RAISE NOTICE '========================================';
  RAISE NOTICE 'COMPLETADO - Valores del cuaderno aplicados';
  RAISE NOTICE 'CAJA_BUS: $73.95';
  RAISE NOTICE 'CAJA_CELULAR: $83.29';
  RAISE NOTICE '========================================';

END $$;

-- ================================================================
-- VALORES INSERTADOS (exactos del cuaderno):
-- ================================================================
-- BUS:
--   saldo_virtual_anterior: 155.25
--   venta_dia: 73.95
--   saldo_virtual_actual: 526.05
--   caja física final: 73.95
--
-- CELULAR:
--   saldo_virtual_anterior: 151.00
--   venta_dia: 34.29
--   saldo_virtual_actual: 116.71
--   caja física final: 83.29
-- ================================================================
