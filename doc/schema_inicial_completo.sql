-- ==========================================
-- SCHEMA INICIAL COMPLETO - MI TIENDA
-- Sistema de Gestión de Cajas y Recargas
-- ==========================================
-- Este script crea todas las tablas necesarias para implementar
-- el sistema desde cero con valores iniciales limpios (saldos en 0).
--
-- IMPORTANTE: Ejecutar este script UNA SOLA VEZ al iniciar el proyecto.
-- Para resetear el sistema, ejecutar nuevamente (incluye DROP de tablas).
--
-- Fecha: 2026-02-02
-- Versión: 1.0
-- ==========================================

-- Habilitar extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- LIMPIEZA (eliminar tablas y tipos existentes)
-- ==========================================
DROP TABLE IF EXISTS operaciones_cajas CASCADE;
DROP TABLE IF EXISTS tipos_referencia CASCADE;
DROP TABLE IF EXISTS cierres_diarios CASCADE;
DROP TABLE IF EXISTS recargas CASCADE;
DROP TABLE IF EXISTS cajas CASCADE;
DROP TABLE IF EXISTS configuraciones CASCADE;
DROP TABLE IF EXISTS tipos_servicio CASCADE;
DROP TABLE IF EXISTS empleados CASCADE;
DROP TYPE IF EXISTS tipo_operacion_caja_enum CASCADE;

-- ==========================================
-- TIPOS ENUMERADOS
-- ==========================================

-- Tipos de operación para el sistema de cajas
CREATE TYPE tipo_operacion_caja_enum AS ENUM (
    'APERTURA',                  -- Apertura inicial de caja
    'CIERRE',                    -- Cierre de caja
    'INGRESO',                   -- Entrada de dinero
    'EGRESO',                    -- Salida de dinero
    'AJUSTE',                    -- Ajuste manual de saldo
    'TRANSFERENCIA_ENTRANTE',    -- Recepción de transferencia
    'TRANSFERENCIA_SALIENTE'     -- Envío de transferencia
);

-- ==========================================
-- TABLAS PRINCIPALES
-- ==========================================

-- 1. Tabla: empleados
-- Almacena los usuarios del sistema que pueden operar
CREATE TABLE IF NOT EXISTS empleados (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    usuario VARCHAR(50) NOT NULL UNIQUE,        -- Email de Google OAuth
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tabla: cajas
-- Las 4 cajas del sistema (CAJA, CAJA_CHICA, CAJA_CELULAR, CAJA_BUS)
CREATE TABLE IF NOT EXISTS cajas (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    saldo_actual DECIMAL(12,2) DEFAULT 0,       -- Saldo actual de la caja
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tabla: configuraciones
-- Configuración global del sistema
CREATE TABLE IF NOT EXISTS configuraciones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    celular_alerta_saldo_bajo DECIMAL(12,2),           -- Alerta cuando saldo virtual < este valor
    caja_chica_transferencia_diaria DECIMAL(12,2),     -- Monto fijo diario a caja chica ($20)
    bus_dias_antes_facturacion INTEGER,                -- Días de anticipación para facturación
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Tabla: tipos_servicio
-- Tipos de servicio de recarga (BUS y CELULAR) con sus reglas de negocio
CREATE TABLE IF NOT EXISTS tipos_servicio (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL UNIQUE,              -- 'BUS', 'CELULAR'
    nombre VARCHAR(100) NOT NULL,                    -- 'Recargas Bus', 'Recargas Celular'

    -- Reglas del negocio
    fondo_base DECIMAL(12,2) NOT NULL,               -- Bus: 500, Celular: 200
    porcentaje_comision DECIMAL(5,2) NOT NULL,       -- Bus: 1%, Celular: 5%
    periodo_comision VARCHAR(20) NOT NULL,           -- 'MENSUAL', 'SEMANAL'
    frecuencia_recarga VARCHAR(20) NOT NULL,         -- 'SEMANAL'

    -- Control
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Tabla: recargas
-- Registro diario de control de saldo virtual por servicio
CREATE TABLE IF NOT EXISTS recargas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Identificación
    fecha DATE NOT NULL,
    tipo_servicio_id INTEGER NOT NULL REFERENCES tipos_servicio(id),
    empleado_id INTEGER NOT NULL REFERENCES empleados(id),

    -- Datos del proceso diario
    venta_dia DECIMAL(12,2) NOT NULL,                -- Venta del día
    saldo_virtual_anterior DECIMAL(12,2) NOT NULL,   -- Saldo del día anterior
    saldo_virtual_actual DECIMAL(12,2) NOT NULL,     -- Saldo resultante

    -- Validación
    validado BOOLEAN DEFAULT FALSE,

    -- Control de exceso
    exceso_sobre_base DECIMAL(12,2) DEFAULT 0,
    exceso_transferido BOOLEAN DEFAULT FALSE,

    -- Auditoría
    observacion TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Restricción: un solo registro por día y tipo de servicio
    UNIQUE(fecha, tipo_servicio_id)
);

-- 6. Tabla: cierres_diarios
-- Registro maestro de cada cierre diario (una entidad por día)
CREATE TABLE IF NOT EXISTS cierres_diarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha DATE NOT NULL UNIQUE,                      -- Fecha del cierre (única)
    empleado_id INTEGER NOT NULL REFERENCES empleados(id),
    efectivo_recaudado DECIMAL(12,2) NOT NULL,       -- Efectivo total del día
    transferencia_caja_chica DECIMAL(12,2) NOT NULL, -- Monto transferido a caja chica
    observaciones TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Tabla: tipos_referencia
-- Catálogo de tablas que pueden ser referenciadas por operaciones
CREATE TABLE IF NOT EXISTS tipos_referencia (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL UNIQUE,              -- Código único (ej: 'RECARGAS')
    tabla VARCHAR(100) NOT NULL UNIQUE,              -- Nombre de la tabla (ej: 'recargas')
    descripcion TEXT,                                -- Descripción del tipo de referencia
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Tabla: operaciones_cajas
-- Log completo de todas las operaciones que afectan el saldo de las cajas
CREATE TABLE IF NOT EXISTS operaciones_cajas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    caja_id INTEGER NOT NULL REFERENCES cajas(id),
    empleado_id INTEGER REFERENCES empleados(id),
    tipo_operacion tipo_operacion_caja_enum NOT NULL,
    monto DECIMAL(12,2) NOT NULL,
    saldo_anterior DECIMAL(12,2),                    -- Saldo ANTES de la operación
    saldo_actual DECIMAL(12,2),                      -- Saldo DESPUÉS de la operación
    tipo_referencia_id INTEGER REFERENCES tipos_referencia(id),  -- Tipo de tabla que origina la operación
    referencia_id UUID,                              -- UUID del registro que origina la operación
    descripcion TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- ÍNDICES PARA MEJORAR PERFORMANCE
-- ==========================================
CREATE INDEX idx_recargas_fecha ON recargas(fecha);
CREATE INDEX idx_recargas_tipo_servicio ON recargas(tipo_servicio_id);
CREATE INDEX idx_recargas_empleado ON recargas(empleado_id);
CREATE INDEX idx_cierres_diarios_fecha ON cierres_diarios(fecha);
CREATE INDEX idx_cierres_diarios_empleado ON cierres_diarios(empleado_id);
CREATE INDEX idx_operaciones_cajas_fecha ON operaciones_cajas(fecha);
CREATE INDEX idx_operaciones_cajas_caja ON operaciones_cajas(caja_id);
CREATE INDEX idx_operaciones_cajas_empleado ON operaciones_cajas(empleado_id);

-- ==========================================
-- DATOS INICIALES (Configuración base del sistema)
-- ==========================================

-- Tipos de servicio según las reglas del negocio
INSERT INTO tipos_servicio (codigo, nombre, fondo_base, porcentaje_comision, periodo_comision, frecuencia_recarga) VALUES
('BUS', 'Recargas Bus', 500.00, 1.00, 'MENSUAL', 'SEMANAL'),
('CELULAR', 'Recargas Celular', 200.00, 5.00, 'SEMANAL', 'SEMANAL');

-- Las 4 cajas del sistema
INSERT INTO cajas (codigo, nombre, descripcion, saldo_actual) VALUES
('CAJA', 'Caja Principal', 'Caja principal de la tienda - Recibe efectivo de ventas diarias', 0.00),
('CAJA_CHICA', 'Caja Chica', 'Caja chica - Recibe $20 diarios + comisiones de recargas', 0.00),
('CAJA_CELULAR', 'Caja Celular', 'Efectivo de ventas de recargas celular', 159.20),
('CAJA_BUS', 'Caja Bus', 'Efectivo de ventas de recargas bus', 264.85);

-- Tipos de referencia (catálogo de tablas que pueden originar operaciones)
INSERT INTO tipos_referencia (codigo, tabla, descripcion) VALUES
('RECARGAS', 'recargas', 'Operaciones originadas desde registros de recargas diarias'),
('CIERRES_DIARIOS', 'cierres_diarios', 'Operaciones originadas desde el cierre diario (efectivo, transferencias)');

-- Configuración inicial del sistema
INSERT INTO configuraciones (celular_alerta_saldo_bajo, caja_chica_transferencia_diaria, bus_dias_antes_facturacion) VALUES
(50.00, 20.00, 3);

-- Empleado inicial del sistema
INSERT INTO empleados (nombre, usuario) VALUES
('Ivan Sanchez', 'ivansan2192@gmail.com');

-- Registros iniciales de recargas (necesarios para el primer cierre diario)
-- Estos registros establecen el saldo virtual anterior para el siguiente cierre
INSERT INTO recargas (fecha, tipo_servicio_id, empleado_id, venta_dia, saldo_virtual_anterior, saldo_virtual_actual, validado, observacion) VALUES
((SELECT CURRENT_DATE), (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR'), (SELECT id FROM empleados WHERE usuario = 'ivansan2192@gmail.com'), 59.15, 135.15, 76.00, TRUE, 'Registro inicial del sistema'),
((SELECT CURRENT_DATE), (SELECT id FROM tipos_servicio WHERE codigo = 'BUS'), (SELECT id FROM empleados WHERE usuario = 'ivansan2192@gmail.com'), 154.80, 440.80, 286.00, TRUE, 'Registro inicial del sistema');

-- ==========================================
-- COMENTARIOS PARA DOCUMENTACIÓN
-- ==========================================
COMMENT ON TABLE empleados IS 'Usuarios del sistema que pueden operar las cajas';
COMMENT ON TABLE cajas IS 'Cajas de efectivo físico (CAJA, CAJA_CHICA) y virtual (CELULAR, BUS)';
COMMENT ON TABLE configuraciones IS 'Configuración global del sistema';
COMMENT ON TABLE tipos_servicio IS 'Tipos de servicio de recarga con sus reglas de negocio';
COMMENT ON TABLE recargas IS 'Registro diario de control de saldo virtual por servicio';
COMMENT ON TABLE cierres_diarios IS 'Registro maestro de cada cierre diario (una entidad por día con datos generales)';
COMMENT ON TABLE tipos_referencia IS 'Catálogo de tablas que pueden originar operaciones en cajas (para trazabilidad)';
COMMENT ON TABLE operaciones_cajas IS 'Log de auditoría de todas las operaciones en cajas con trazabilidad completa';

COMMENT ON COLUMN cajas.saldo_actual IS 'Saldo actual de la caja (se actualiza con cada operación)';
COMMENT ON COLUMN configuraciones.caja_chica_transferencia_diaria IS 'Monto fijo diario que se transfiere a caja chica ($20)';
COMMENT ON COLUMN recargas.venta_dia IS 'Monto vendido en el día';
COMMENT ON COLUMN recargas.saldo_virtual_anterior IS 'Saldo del día anterior (viene del saldo_virtual_actual previo)';
COMMENT ON COLUMN recargas.saldo_virtual_actual IS 'Saldo resultante: saldo_virtual_anterior - venta_dia';
COMMENT ON COLUMN recargas.validado IS 'Validación: venta_dia + saldo_virtual_actual = saldo_virtual_anterior';
COMMENT ON COLUMN operaciones_cajas.saldo_anterior IS 'Saldo de la caja ANTES de esta operación';
COMMENT ON COLUMN operaciones_cajas.saldo_actual IS 'Saldo de la caja DESPUÉS de esta operación';
COMMENT ON COLUMN operaciones_cajas.tipo_referencia_id IS 'FK a tipos_referencia - Indica qué tipo de tabla originó esta operación';
COMMENT ON COLUMN operaciones_cajas.referencia_id IS 'UUID del registro específico que originó esta operación (para trazabilidad completa)';

-- ==========================================
-- FLUJO DEL CIERRE DIARIO
-- ==========================================
-- Al realizar el cierre diario se ejecutan las siguientes operaciones:
--
-- 1. CAJA (Principal):
--    • Recibe: efectivo de ventas de tienda
--    • Sale: $20 diarios a CAJA_CHICA
--    • Fórmula: saldo_anterior + efectivo_recaudado - 20 = saldo_actual
--    • Operaciones: INGRESO (efectivo) + TRANSFERENCIA_SALIENTE ($20)
--
-- 2. CAJA_CHICA:
--    • Recibe: $20 diarios de CAJA (automático en cierre)
--    • Comisiones: se registran manualmente cuando el proveedor paga
--    • Fórmula: saldo_anterior + 20 = saldo_actual
--    • Operación: TRANSFERENCIA_ENTRANTE ($20)
--
-- 3. CAJA_CELULAR:
--    • Recibe: efectivo de ventas de recargas celular
--    • Fórmula: saldo_anterior + venta_celular = saldo_actual
--    • Operación: INGRESO (venta)
--
-- 4. CAJA_BUS:
--    • Recibe: efectivo de ventas de recargas bus
--    • Fórmula: saldo_anterior + venta_bus = saldo_actual
--    • Operación: INGRESO (venta)
--
-- IMPORTANTE:
-- - El saldo_actual de cada caja se actualiza con cada operación
-- - La tabla operaciones_cajas registra el historial completo
-- - Cada operación guarda saldo_anterior y saldo_actual para auditoría

-- ==========================================
-- RESUMEN
-- ==========================================
-- ✅ 8 Tablas creadas
-- ✅ 1 Tipo enumerado creado
-- ✅ 8 Índices creados para performance
-- ✅ 2 Tipos de servicio configurados (BUS, CELULAR)
-- ✅ 2 Tipos de referencia configurados (RECARGAS, CIERRES_DIARIOS)
-- ✅ 4 Cajas inicializadas:
--    • CAJA: $0.00
--    • CAJA_CHICA: $0.00
--    • CAJA_CELULAR: $159.20
--    • CAJA_BUS: $264.85
-- ✅ Configuración inicial establecida
-- ✅ 1 Empleado inicial creado (Ivan Sanchez)
-- ✅ 2 Registros iniciales de recargas:
--    • Celular: Saldo virtual $76.00
--    • Bus: Saldo virtual $286.00
--
-- El sistema está listo para comenzar a operar.
-- Los saldos virtuales actuales servirán como base para el próximo cierre diario.
-- La trazabilidad completa de operaciones está habilitada mediante tipos_referencia.
