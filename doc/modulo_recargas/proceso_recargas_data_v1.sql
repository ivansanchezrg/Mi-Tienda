-- ==========================================
-- DATOS DE PRUEBA - Módulo de Recargas
-- Ejecutar después de V001_20250131_recargas_create.sql
-- ==========================================

-- 1. Empleado de prueba
INSERT INTO empleados (nombre, usuario) VALUES
('Juan Pérez', 'jperez'),
('María López', 'mlopez');

-- 2. Registros iniciales (día anterior: 2025-01-30)
-- Esto establece el saldo_virtual_actual que será el saldo_virtual_anterior de hoy

-- Bus: Saldo inicial 440.80 (ejemplo del documento)
INSERT INTO recargas (
    fecha,
    tipo_servicio_id,
    empleado_id,
    venta_dia,
    saldo_virtual_anterior,
    saldo_virtual_actual,
    validado,
    observacion
) VALUES (
    '2025-01-30',
    (SELECT id FROM tipos_servicio WHERE codigo = 'BUS'),
    (SELECT id FROM empleados WHERE usuario = 'jperez'),
    0.00,                    -- Sin venta (es registro inicial)
    440.80,                  -- Saldo inicial
    440.80,                  -- Mismo valor (no hubo venta)
    TRUE,
    'Registro inicial de saldo'
);

-- Celular: Saldo inicial 200.00
INSERT INTO recargas (
    fecha,
    tipo_servicio_id,
    empleado_id,
    venta_dia,
    saldo_virtual_anterior,
    saldo_virtual_actual,
    validado,
    observacion
) VALUES (
    '2025-01-30',
    (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR'),
    (SELECT id FROM empleados WHERE usuario = 'jperez'),
    0.00,
    200.00,
    200.00,
    TRUE,
    'Registro inicial de saldo'
);

-- ==========================================
-- EJEMPLO: Registro del día de hoy (2025-01-31)
-- ==========================================

-- Bus: Venta del día 154.80 (ejemplo del documento)
INSERT INTO recargas (
    fecha,
    tipo_servicio_id,
    empleado_id,
    venta_dia,
    saldo_virtual_anterior,
    saldo_virtual_actual,
    validado,
    exceso_sobre_base,
    observacion
) VALUES (
    '2025-01-31',
    (SELECT id FROM tipos_servicio WHERE codigo = 'BUS'),
    (SELECT id FROM empleados WHERE usuario = 'jperez'),
    154.80,                  -- Venta del día
    440.80,                  -- Viene del día anterior
    286.00,                  -- 440.80 - 154.80 = 286.00
    TRUE,                    -- Validado: 154.80 + 286.00 = 440.80 ✓
    0.00,                    -- Sin exceso (286 < 500 base)
    'Cierre del día'
);

-- ==========================================
-- VERIFICACIÓN
-- ==========================================

-- Ver todos los registros
SELECT 
    r.fecha,
    ts.codigo AS servicio,
    e.nombre AS empleado,
    r.venta_dia,
    r.saldo_virtual_anterior,
    r.saldo_virtual_actual,
    r.validado,
    -- Validación: venta + actual = anterior
    (r.venta_dia + r.saldo_virtual_actual = r.saldo_virtual_anterior) AS validacion_ok
FROM recargas r
JOIN tipos_servicio ts ON r.tipo_servicio_id = ts.id
JOIN empleados e ON r.empleado_id = e.id
ORDER BY r.fecha, ts.codigo;
