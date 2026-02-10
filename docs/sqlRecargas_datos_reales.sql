-- ==========================================
-- SQL RECARGAS - DATOS REALES PARA TESTING
-- ==========================================
-- Ejecutar después de schema_inicial_completo.sql
-- ==========================================

-- ==========================================
-- 1. CREAR TURNO DE AYER (CERRADO)
-- ==========================================

INSERT INTO turnos_caja (
  id, fecha, numero_turno, empleado_id,
  hora_apertura, hora_cierre, created_at
) VALUES (
  uuid_generate_v4(),
  CURRENT_DATE - INTERVAL '1 day',
  1,
  1,
  (CURRENT_DATE - INTERVAL '1 day') + TIME '08:00:00',
  (CURRENT_DATE - INTERVAL '1 day') + TIME '18:00:00',
  NOW() - INTERVAL '1 day'
);

-- ==========================================
-- 2. INSERTAR RECARGAS DE AYER
-- ==========================================

-- BUS:
--   Saldo virtual anterior: $156.35
--   Saldo virtual actual:   $490.70  (se recargó saldo)
--   Venta del día:          -$334.35 (negativo = hubo recarga de saldo virtual)
INSERT INTO recargas (
  id, fecha, turno_id, tipo_servicio_id,
  saldo_virtual_anterior, saldo_virtual_actual, venta_dia,
  empleado_id, validado, created_at
) VALUES (
  uuid_generate_v4(),
  CURRENT_DATE - INTERVAL '1 day',
  (SELECT id FROM turnos_caja WHERE fecha = CURRENT_DATE - INTERVAL '1 day' LIMIT 1),
  (SELECT id FROM tipos_servicio WHERE codigo = 'BUS'),
  156.35,   -- Saldo virtual anterior
  490.70,   -- Saldo virtual actual
  -334.35,  -- Venta (156.35 - 490.70 = -334.35, se pagó recarga)
  1, true,
  NOW() - INTERVAL '1 day'
);

-- CELULAR:
--   Saldo virtual anterior: $117.69
--   Saldo virtual actual:    $81.34
--   Venta del día:           $36.35
INSERT INTO recargas (
  id, fecha, turno_id, tipo_servicio_id,
  saldo_virtual_anterior, saldo_virtual_actual, venta_dia,
  empleado_id, validado, created_at
) VALUES (
  uuid_generate_v4(),
  CURRENT_DATE - INTERVAL '1 day',
  (SELECT id FROM turnos_caja WHERE fecha = CURRENT_DATE - INTERVAL '1 day' LIMIT 1),
  (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR'),
  117.69,  -- Saldo virtual anterior
  81.34,   -- Saldo virtual actual
  36.35,   -- Venta (117.69 - 81.34 = 36.35)
  1, true,
  NOW() - INTERVAL '1 day'
);

-- ==========================================
-- 3. CREAR OPERACIONES DE CAJAS
-- ==========================================

-- BUS: Venta negativa = se PAGÓ recarga de saldo virtual (EGRESO de caja física)
--   Caja física antes: $443.65 (109.30 + 334.35)
--   Caja física después: $109.30
INSERT INTO operaciones_cajas (
  id, fecha, caja_id, empleado_id,
  tipo_operacion, monto,
  saldo_anterior, saldo_actual,
  descripcion, tipo_referencia_id, referencia_id, created_at
) VALUES (
  uuid_generate_v4(),
  CURRENT_DATE - INTERVAL '1 day',
  (SELECT id FROM cajas WHERE codigo = 'CAJA_BUS'),
  1,
  'EGRESO',
  334.35,   -- Monto pagado por la recarga
  443.65,   -- Saldo antes del egreso (109.30 + 334.35)
  109.30,   -- Saldo después del egreso
  'Compra de saldo virtual Bus ' || (CURRENT_DATE - INTERVAL '1 day')::TEXT,
  (SELECT id FROM tipos_referencia WHERE codigo = 'RECARGAS'),
  (SELECT id FROM recargas WHERE fecha = CURRENT_DATE - INTERVAL '1 day'
    AND tipo_servicio_id = (SELECT id FROM tipos_servicio WHERE codigo = 'BUS')),
  NOW() - INTERVAL '1 day'
);

-- CELULAR: Venta positiva = INGRESO a caja física
--   Caja física antes: $82.31 (118.66 - 36.35)
--   Caja física después: $118.66
INSERT INTO operaciones_cajas (
  id, fecha, caja_id, empleado_id,
  tipo_operacion, monto,
  saldo_anterior, saldo_actual,
  descripcion, tipo_referencia_id, referencia_id, created_at
) VALUES (
  uuid_generate_v4(),
  CURRENT_DATE - INTERVAL '1 day',
  (SELECT id FROM cajas WHERE codigo = 'CAJA_CELULAR'),
  1,
  'INGRESO',
  36.35,   -- Venta celular
  82.31,   -- Saldo antes del ingreso (118.66 - 36.35)
  118.66,  -- Saldo después del ingreso
  'Venta del día ' || (CURRENT_DATE - INTERVAL '1 day')::TEXT,
  (SELECT id FROM tipos_referencia WHERE codigo = 'RECARGAS'),
  (SELECT id FROM recargas WHERE fecha = CURRENT_DATE - INTERVAL '1 day'
    AND tipo_servicio_id = (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR')),
  NOW() - INTERVAL '1 day'
);

-- ==========================================
-- 4. ACTUALIZAR SALDOS FINALES DE CAJAS
-- ==========================================

UPDATE cajas SET saldo_actual = 109.30, updated_at = NOW() WHERE codigo = 'CAJA_BUS';
UPDATE cajas SET saldo_actual = 118.66, updated_at = NOW() WHERE codigo = 'CAJA_CELULAR';

-- ==========================================
-- 5. VERIFICACIÓN
-- ==========================================

-- Turno creado
SELECT id, fecha, numero_turno, hora_apertura, hora_cierre
FROM turnos_caja WHERE fecha = CURRENT_DATE - INTERVAL '1 day';

-- Recargas insertadas
SELECT
  ts.codigo AS servicio,
  r.saldo_virtual_anterior,
  r.venta_dia,
  r.saldo_virtual_actual,
  r.fecha
FROM recargas r
JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
ORDER BY ts.codigo;

-- Operaciones creadas
SELECT
  c.codigo AS caja,
  o.tipo_operacion,
  o.monto,
  o.saldo_anterior,
  o.saldo_actual
FROM operaciones_cajas o
JOIN cajas c ON o.caja_id = c.id
WHERE o.fecha = CURRENT_DATE - INTERVAL '1 day'
  AND c.codigo IN ('CAJA_CELULAR', 'CAJA_BUS')
ORDER BY c.codigo;

-- Saldos de cajas
SELECT codigo, nombre, saldo_actual
FROM cajas
WHERE codigo IN ('CAJA_BUS', 'CAJA_CELULAR')
ORDER BY codigo;

-- ==========================================
-- RESUMEN
-- ==========================================
/*
🚌 BUS (ayer):
  Saldo virtual anterior: $156.35
  Saldo virtual actual:   $490.70  (se recargó)
  Venta:                  -$334.35 (EGRESO de caja → pagó recarga)
  Caja física antes:      $443.65
  Caja física después:    $109.30

📱 CELULAR (ayer):
  Saldo virtual anterior: $117.69
  Saldo virtual actual:    $81.34
  Venta:                  +$36.35  (INGRESO de caja → ventas)
  Caja física antes:       $82.31
  Caja física después:    $118.66

✅ getSaldosAnteriores() retornará HOY:
  Bus:    $490.70  (último saldo_virtual_actual de bus)
  Celular: $81.34  (último saldo_virtual_actual de celular)
*/
