-- ============================================
-- TEST: NOTIFICACIONES DE GANANCIAS MENSUALES
-- ============================================
--
-- Este script crea datos de prueba para verificar el sistema de
-- notificaciones de ganancias mensuales.
--
-- OBJETIVO:
-- - Crear operaciones de INGRESO en CAJA_CELULAR y CAJA_BUS del mes anterior
-- - Para que aparezca la notificación de "Transferir ganancias"
-- - Y poder probar todo el flujo hasta confirmar la transferencia
--
-- FECHA: 2026-02-03
-- AUTOR: Sistema Mi Tienda
-- ============================================

-- ============================================
-- PASO 1: LIMPIAR DATOS DE PRUEBA ANTERIORES
-- ============================================

-- Eliminar operaciones de INGRESO de enero 2026 (mes anterior)
DELETE FROM operaciones_cajas
WHERE DATE_TRUNC('month', fecha) = '2026-01-01'
  AND tipo_operacion = 'INGRESO'
  AND caja_id IN (3, 4);  -- CAJA_CELULAR y CAJA_BUS

-- Eliminar transferencias de ganancias de enero 2026 (si existen)
DELETE FROM operaciones_cajas
WHERE descripcion LIKE '%Ganancia%2026-01%';

COMMIT;

-- ============================================
-- PASO 2: CREAR OPERACIONES DE INGRESO DE ENERO
-- ============================================

-- Variables de contexto
DO $$
DECLARE
  v_empleado_id INTEGER;
  v_dia INTEGER;
  v_fecha_operacion TIMESTAMP;
  v_monto_celular DECIMAL(12,2);
  v_monto_bus DECIMAL(12,2);
BEGIN
  -- Obtener el primer empleado activo
  SELECT id INTO v_empleado_id
  FROM empleados
  WHERE activo = TRUE
  LIMIT 1;

  RAISE NOTICE 'Usando empleado ID: %', v_empleado_id;

  -- ============================================
  -- GENERAR OPERACIONES DE CAJA_CELULAR (ID=3)
  -- ============================================
  -- Objetivo: $1,500 en ventas → Ganancia 5% = $75
  -- Estrategia: 10 operaciones de ~$150 cada una

  RAISE NOTICE '=== CAJA_CELULAR ===';

  FOR v_dia IN 1..10 LOOP
    -- Fecha: Días del 5 al 14 de enero 2026
    v_fecha_operacion := ('2026-01-' || LPAD((v_dia + 4)::TEXT, 2, '0') || ' 10:30:00')::TIMESTAMP;

    -- Monto variable entre $145 y $155
    v_monto_celular := 145 + (RANDOM() * 10);

    INSERT INTO operaciones_cajas (
      caja_id,
      empleado_id,
      tipo_operacion,
      monto,
      saldo_anterior,
      saldo_actual,
      descripcion,
      fecha
    ) VALUES (
      3,  -- CAJA_CELULAR
      v_empleado_id,
      'INGRESO',
      v_monto_celular,
      0,  -- Saldos no importan para este test
      v_monto_celular,
      'Venta de recargas celular - TEST',
      v_fecha_operacion
    );

    RAISE NOTICE 'Celular: Día % - $%', v_dia, v_monto_celular;
  END LOOP;

  -- ============================================
  -- GENERAR OPERACIONES DE CAJA_BUS (ID=4)
  -- ============================================
  -- Objetivo: $2,000 en ventas → Ganancia 1% = $20
  -- Estrategia: 15 operaciones de ~$133.33 cada una

  RAISE NOTICE '=== CAJA_BUS ===';

  FOR v_dia IN 1..15 LOOP
    -- Fecha: Días del 5 al 19 de enero 2026
    v_fecha_operacion := ('2026-01-' || LPAD((v_dia + 4)::TEXT, 2, '0') || ' 14:45:00')::TIMESTAMP;

    -- Monto variable entre $130 y $137
    v_monto_bus := 130 + (RANDOM() * 7);

    INSERT INTO operaciones_cajas (
      caja_id,
      empleado_id,
      tipo_operacion,
      monto,
      saldo_anterior,
      saldo_actual,
      descripcion,
      fecha
    ) VALUES (
      4,  -- CAJA_BUS
      v_empleado_id,
      'INGRESO',
      v_monto_bus,
      0,  -- Saldos no importan para este test
      v_monto_bus,
      'Venta de recargas bus - TEST',
      v_fecha_operacion
    );

    RAISE NOTICE 'Bus: Día % - $%', v_dia, v_monto_bus;
  END LOOP;

  RAISE NOTICE '=== OPERACIONES CREADAS ===';

END $$;

COMMIT;

-- ============================================
-- PASO 3: VERIFICAR DATOS CREADOS
-- ============================================

-- Ver resumen de operaciones creadas
SELECT
  c.nombre AS caja,
  COUNT(*) AS total_operaciones,
  SUM(o.monto) AS total_ventas,
  CASE
    WHEN c.id = 3 THEN SUM(o.monto) * 0.05
    WHEN c.id = 4 THEN SUM(o.monto) * 0.01
  END AS ganancia_calculada,
  MIN(DATE(o.fecha)) AS desde,
  MAX(DATE(o.fecha)) AS hasta
FROM operaciones_cajas o
JOIN cajas c ON o.caja_id = c.id
WHERE DATE_TRUNC('month', o.fecha) = '2026-01-01'
  AND o.tipo_operacion = 'INGRESO'
  AND c.id IN (3, 4)
GROUP BY c.id, c.nombre
ORDER BY c.id;

-- Ver detalle de operaciones
SELECT
  DATE(o.fecha) AS fecha,
  c.nombre AS caja,
  COUNT(*) AS operaciones,
  SUM(o.monto) AS total_dia
FROM operaciones_cajas o
JOIN cajas c ON o.caja_id = c.id
WHERE DATE_TRUNC('month', o.fecha) = '2026-01-01'
  AND o.tipo_operacion = 'INGRESO'
  AND c.id IN (3, 4)
GROUP BY DATE(o.fecha), c.id, c.nombre
ORDER BY DATE(o.fecha), c.id;

-- ============================================
-- RESULTADO ESPERADO
-- ============================================
--
-- CAJA_CELULAR:
--   - Ventas totales: ~$1,500
--   - Ganancia 5%: ~$75
--
-- CAJA_BUS:
--   - Ventas totales: ~$2,000
--   - Ganancia 1%: ~$20
--
-- TOTAL A TRANSFERIR: ~$95
--
-- NOTIFICACIÓN EN LA APP:
--   ✅ Badge con "1" en el ícono de campana
--   ✅ Modal muestra: "Transferir ganancias - Enero 2026"
--   ✅ Detalle: "Celular: $75.00 | Bus: $20.00 | Total: $95.00"
--
-- ============================================

-- ============================================
-- PASO 4: QUERY PARA SIMULAR LO QUE HACE LA APP
-- ============================================

-- Este es el mismo cálculo que hace ganancias.service.ts
SELECT
  '2026-01' AS mes,
  'Enero 2026' AS mes_display,
  SUM(CASE WHEN caja_id = 3 THEN monto ELSE 0 END) AS ventas_celular,
  SUM(CASE WHEN caja_id = 4 THEN monto ELSE 0 END) AS ventas_bus,
  SUM(CASE WHEN caja_id = 3 THEN monto ELSE 0 END) * 0.05 AS ganancia_celular,
  SUM(CASE WHEN caja_id = 4 THEN monto ELSE 0 END) * 0.01 AS ganancia_bus,
  (SUM(CASE WHEN caja_id = 3 THEN monto ELSE 0 END) * 0.05) +
  (SUM(CASE WHEN caja_id = 4 THEN monto ELSE 0 END) * 0.01) AS total_a_transferir
FROM operaciones_cajas
WHERE tipo_operacion = 'INGRESO'
  AND caja_id IN (3, 4)
  AND fecha >= '2026-01-01'
  AND fecha < '2026-02-01';

-- ============================================
-- LIMPIEZA (Ejecutar después de probar)
-- ============================================

-- Para eliminar los datos de prueba después:
/*
DELETE FROM operaciones_cajas
WHERE descripcion LIKE '%TEST%'
  AND DATE_TRUNC('month', fecha) = '2026-01-01';

COMMIT;
*/
