-- ==========================================
-- SQL RECARGAS - DATOS REALES PARA TESTING
-- ==========================================
-- Ejecutar después de schema_inicial_completo.sql
-- Versión actualizada para schema v4.5
-- ==========================================
--
-- ESCENARIO:
--   BUS ayer:
--     - Saldo virtual anterior: $156.35
--     - Sin compra de saldo virtual (se registrará desde la app)
--     - Saldo virtual final:    $490.70 (simulado: como si hubiera comprado $334.35)
--     - Venta del día:          $0.00   (no hubo ventas, solo recarga)
--     - CAJA_BUS saldo:         $443.65 (listo para registrar compras desde la app)
--
--   CELULAR ayer:
--     - Saldo virtual anterior: $117.69
--     - Sin recarga del proveedor (se registrará desde la app)
--     - Saldo virtual final:     $81.34
--     - Venta del día:           $36.35 (117.69 - 81.34)
--
-- NOTAS:
--   recargas_virtuales NO se inserta aquí.
--   Usar la app (módulo Saldo Virtual) para registrar las cargas y probar el flujo completo.
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
-- 2. INSERTAR RECARGAS DEL DÍA (cierre virtual)
-- ==========================================

-- BUS:
--   agregado_dia = 334.35 (simulado: como si el proveedor hubiera cargado ese monto)
--   venta_dia    = (saldo_anterior + agregado) - saldo_final
--               = (156.35 + 334.35) - 490.70 = 0
INSERT INTO recargas (
  id, fecha, turno_id, tipo_servicio_id,
  saldo_virtual_anterior, saldo_virtual_actual, venta_dia,
  empleado_id, validado, created_at
) VALUES (
  uuid_generate_v4(),
  CURRENT_DATE - INTERVAL '1 day',
  (SELECT id FROM turnos_caja WHERE fecha = CURRENT_DATE - INTERVAL '1 day' LIMIT 1),
  (SELECT id FROM tipos_servicio WHERE codigo = 'BUS'),
  156.35,   -- saldo_virtual_anterior
  490.70,   -- saldo_virtual_actual
  0.00,     -- venta_dia = 0 (solo recarga, sin ventas)
  1, true,
  NOW() - INTERVAL '1 day'
);

-- CELULAR:
--   agregado_dia = 0 (el proveedor no cargó saldo ayer)
--   venta_dia    = (117.69 + 0) - 81.34 = 36.35
INSERT INTO recargas (
  id, fecha, turno_id, tipo_servicio_id,
  saldo_virtual_anterior, saldo_virtual_actual, venta_dia,
  empleado_id, validado, created_at
) VALUES (
  uuid_generate_v4(),
  CURRENT_DATE - INTERVAL '1 day',
  (SELECT id FROM turnos_caja WHERE fecha = CURRENT_DATE - INTERVAL '1 day' LIMIT 1),
  (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR'),
  117.69,  -- saldo_virtual_anterior
  81.34,   -- saldo_virtual_actual
  36.35,   -- venta_dia (117.69 - 81.34)
  1, true,
  NOW() - INTERVAL '1 day'
);

-- ==========================================
-- 3. CREAR OPERACIONES DE CAJAS
-- ==========================================

-- CELULAR: INGRESO por ventas del día
--   CAJA_CELULAR antes: $82.31
--   CAJA_CELULAR después: $118.66  (82.31 + 36.35)
INSERT INTO operaciones_cajas (
  id, fecha, caja_id, empleado_id,
  tipo_operacion, monto,
  saldo_anterior, saldo_actual,
  categoria_id, tipo_referencia_id, referencia_id,
  descripcion, created_at
) VALUES (
  uuid_generate_v4(),
  (CURRENT_DATE - INTERVAL '1 day') + TIME '18:00:00',
  (SELECT id FROM cajas WHERE codigo = 'CAJA_CELULAR'),
  1,
  'INGRESO',
  36.35,
  82.31,    -- saldo antes del ingreso
  118.66,   -- saldo después del ingreso (82.31 + 36.35)
  (SELECT id FROM categorias_operaciones WHERE codigo = 'IN-001'),
  (SELECT id FROM tipos_referencia WHERE codigo = 'RECARGAS'),
  (SELECT id FROM recargas
    WHERE fecha = CURRENT_DATE - INTERVAL '1 day'
      AND tipo_servicio_id = (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR')
    LIMIT 1),
  'Venta celular del día ' || (CURRENT_DATE - INTERVAL '1 day')::TEXT,
  NOW() - INTERVAL '1 day'
);

-- NOTA: El EGRESO de CAJA_BUS NO se inserta aquí.
-- Se generará automáticamente cuando se registre la compra de saldo BUS desde la app
-- usando la función registrar_compra_saldo_bus().

-- ==========================================
-- 4. ACTUALIZAR SALDOS FINALES DE CAJAS
-- ==========================================

-- CAJA_BUS: queda con saldo $443.65 (sin descontar la compra, que se hará desde la app)
UPDATE cajas SET saldo_actual = 443.65, updated_at = NOW() WHERE codigo = 'CAJA_BUS';
UPDATE cajas SET saldo_actual = 118.66, updated_at = NOW() WHERE codigo = 'CAJA_CELULAR';

-- ==========================================
-- 5. VERIFICACIÓN
-- ==========================================

-- Turno de ayer
SELECT id, fecha, numero_turno, hora_apertura, hora_cierre
FROM turnos_caja WHERE fecha = CURRENT_DATE - INTERVAL '1 day';

-- Recargas virtuales (debe estar vacío — se registran desde la app)
SELECT
  ts.codigo AS servicio,
  rv.fecha, rv.monto_virtual, rv.monto_a_pagar, rv.ganancia,
  rv.pagado, rv.notas
FROM recargas_virtuales rv
JOIN tipos_servicio ts ON rv.tipo_servicio_id = ts.id
ORDER BY rv.created_at;

-- Recargas (cierre virtual)
SELECT
  ts.codigo AS servicio,
  r.saldo_virtual_anterior,
  r.venta_dia,
  r.saldo_virtual_actual,
  r.validado
FROM recargas r
JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
WHERE r.fecha = CURRENT_DATE - INTERVAL '1 day'
ORDER BY ts.codigo;

-- Operaciones de cajas
SELECT
  c.codigo AS caja,
  o.tipo_operacion,
  o.monto,
  o.saldo_anterior,
  o.saldo_actual,
  cat.codigo AS categoria
FROM operaciones_cajas o
JOIN cajas c ON o.caja_id = c.id
LEFT JOIN categorias_operaciones cat ON o.categoria_id = cat.id
WHERE DATE(o.fecha) = CURRENT_DATE - INTERVAL '1 day'
  AND c.codigo IN ('CAJA_CELULAR', 'CAJA_BUS')
ORDER BY c.codigo;

-- Saldos actuales de cajas
SELECT codigo, nombre, saldo_actual
FROM cajas
WHERE codigo IN ('CAJA_BUS', 'CAJA_CELULAR')
ORDER BY codigo;

-- ==========================================
-- RESUMEN
-- ==========================================
/*
🚌 BUS (ayer):
  Saldo virtual anterior:  $156.35
  Saldo virtual final:     $490.70  (simulado para testing)
  Venta del día:            $0.00
  CAJA_BUS saldo:          $443.65  ← listo para registrar compras desde la app

📱 CELULAR (ayer):
  Saldo virtual anterior:  $117.69
  Sin recarga del proveedor
  Saldo virtual final:      $81.34
  Venta del día:            $36.35  → INGRESO a CAJA_CELULAR (IN-001)
  CAJA_CELULAR saldo:      $118.66

✅ getSaldosAnteriores() retornará HOY:
  Bus:     $490.70  (último saldo_virtual_actual de bus)
  Celular:  $81.34  (último saldo_virtual_actual de celular)

▶ PRÓXIMOS PASOS (desde la app):
  1. Módulo "Saldo Virtual" → Registrar carga CELULAR (proveedor carga saldo)
  2. Módulo "Saldo Virtual" → Registrar compra BUS (depósito bancario)
  3. Verificar que recargas_virtuales.ganancia se guarda correctamente
  4. Al fin del mes → notificación de ganancias → Transferir a Caja Chica
*/
