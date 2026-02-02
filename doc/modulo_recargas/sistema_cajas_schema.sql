-- ==========================================
-- Schema: Sistema de Cajas
-- Módulo de Recargas - Complemento
-- ==========================================
-- Este script crea las tablas del sistema de cajas y operaciones
-- Prerequisito: Ejecutar proceso_recargas_schema_v2.sql primero
-- ==========================================

-- Habilitar extensión para UUIDs (si no está habilitada)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- LIMPIEZA (eliminar si existen)
-- ==========================================
DROP TABLE IF EXISTS operaciones_cajas CASCADE;
DROP TABLE IF EXISTS cajas CASCADE;
DROP TABLE IF EXISTS configuraciones CASCADE;
DROP TYPE IF EXISTS tipo_operacion_caja_enum CASCADE;

-- ==========================================
-- TIPOS ENUMERADOS
-- ==========================================
CREATE TYPE tipo_operacion_caja_enum AS ENUM (
    'APERTURA',
    'CIERRE',
    'INGRESO',
    'EGRESO',
    'AJUSTE',
    'TRANSFERENCIA_ENTRANTE',
    'TRANSFERENCIA_SALIENTE'
);

-- ==========================================
-- TABLAS
-- ==========================================

-- 1. Tabla: cajas
CREATE TABLE IF NOT EXISTS cajas (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    saldo_actual DECIMAL(12,2) DEFAULT 0,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tabla: configuraciones
CREATE TABLE IF NOT EXISTS configuraciones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    celular_alerta_saldo_bajo DECIMAL(12,2),
    caja_chica_transferencia_diaria DECIMAL(12,2),
    bus_dias_antes_facturacion INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tabla: operaciones_cajas
CREATE TABLE IF NOT EXISTS operaciones_cajas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    caja_id INTEGER NOT NULL REFERENCES cajas(id),
    empleado_id INTEGER REFERENCES empleados(id),
    tipo_operacion tipo_operacion_caja_enum NOT NULL,
    monto DECIMAL(12,2) NOT NULL,
    saldo_anterior DECIMAL(12,2),
    saldo_actual DECIMAL(12,2),
    referencia_id UUID,
    referencia_tabla VARCHAR(100),
    descripcion TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- ÍNDICES
-- ==========================================
CREATE INDEX idx_operaciones_cajas_fecha ON operaciones_cajas(fecha);
CREATE INDEX idx_operaciones_cajas_caja ON operaciones_cajas(caja_id);
CREATE INDEX idx_operaciones_cajas_empleado ON operaciones_cajas(empleado_id);

-- ==========================================
-- DATOS DE PRUEBA
-- ==========================================

-- Insertar las 4 cajas del sistema con saldos de prueba
INSERT INTO cajas (codigo, nombre, descripcion, saldo_actual) VALUES
('CAJA', 'Caja Principal', 'Caja principal de la tienda - Recibe efectivo de ventas diarias', 500.00),
('CAJA_CHICA', 'Caja Chica', 'Caja chica - Recibe $20 diarios + comisiones de recargas', 150.00),
('CAJA_CELULAR', 'Caja Celular', 'Efectivo de ventas de recargas celular', 320.50),
('CAJA_BUS', 'Caja Bus', 'Efectivo de ventas de recargas bus', 180.75);

-- Insertar configuración inicial
INSERT INTO configuraciones (celular_alerta_saldo_bajo, caja_chica_transferencia_diaria, bus_dias_antes_facturacion) VALUES
(50.00, 20.00, 3);

-- Insertar operaciones de prueba (historial de las cajas)
-- Nota: Reemplaza 1 con el ID real de un empleado de tu tabla empleados

-- Operaciones de CAJA (Principal)
INSERT INTO operaciones_cajas (caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual, descripcion) VALUES
(1, 1, 'APERTURA', 0.00, 0.00, 0.00, 'Apertura inicial de caja principal'),
(1, 1, 'INGRESO', 350.00, 0.00, 350.00, 'Efectivo de ventas de tienda - Día 1'),
(1, 1, 'TRANSFERENCIA_SALIENTE', 20.00, 350.00, 330.00, 'Transferencia diaria a caja chica'),
(1, 1, 'INGRESO', 190.00, 330.00, 520.00, 'Efectivo de ventas de tienda - Día 2'),
(1, 1, 'TRANSFERENCIA_SALIENTE', 20.00, 520.00, 500.00, 'Transferencia diaria a caja chica');

-- Operaciones de CAJA_CHICA
INSERT INTO operaciones_cajas (caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual, descripcion) VALUES
(2, 1, 'APERTURA', 0.00, 0.00, 0.00, 'Apertura inicial de caja chica'),
(2, 1, 'TRANSFERENCIA_ENTRANTE', 20.00, 0.00, 20.00, 'Transferencia desde caja principal - Día 1'),
(2, 1, 'INGRESO', 15.50, 20.00, 35.50, 'Comisión manual de recargas celular'),
(2, 1, 'EGRESO', 5.50, 35.50, 30.00, 'Gasto menor de caja chica'),
(2, 1, 'TRANSFERENCIA_ENTRANTE', 20.00, 30.00, 50.00, 'Transferencia desde caja principal - Día 2'),
(2, 1, 'INGRESO', 100.00, 50.00, 150.00, 'Comisión manual de recargas bus');

-- Operaciones de CAJA_CELULAR
INSERT INTO operaciones_cajas (caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual, descripcion) VALUES
(3, 1, 'APERTURA', 0.00, 0.00, 0.00, 'Apertura inicial de caja celular'),
(3, 1, 'INGRESO', 125.50, 0.00, 125.50, 'Venta de recargas celular - Día 1'),
(3, 1, 'INGRESO', 95.00, 125.50, 220.50, 'Venta de recargas celular - Día 2'),
(3, 1, 'INGRESO', 100.00, 220.50, 320.50, 'Venta de recargas celular - Día 3');

-- Operaciones de CAJA_BUS
INSERT INTO operaciones_cajas (caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual, descripcion) VALUES
(4, 1, 'APERTURA', 0.00, 0.00, 0.00, 'Apertura inicial de caja bus'),
(4, 1, 'INGRESO', 80.25, 0.00, 80.25, 'Venta de recargas bus - Día 1'),
(4, 1, 'INGRESO', 50.00, 80.25, 130.25, 'Venta de recargas bus - Día 2'),
(4, 1, 'INGRESO', 50.50, 130.25, 180.75, 'Venta de recargas bus - Día 3');

-- ==========================================
-- COMENTARIOS
-- ==========================================
COMMENT ON TABLE cajas IS 'Cajas de efectivo físico (CAJA, CAJA_CHICA) y virtual (CELULAR, BUS)';
COMMENT ON TABLE configuraciones IS 'Configuración global del sistema';
COMMENT ON TABLE operaciones_cajas IS 'Log de todas las operaciones que afectan el saldo de las cajas';

COMMENT ON COLUMN cajas.saldo_actual IS 'Saldo actual de la caja (se actualiza con cada operación)';
COMMENT ON COLUMN configuraciones.caja_chica_transferencia_diaria IS 'Monto fijo diario que se transfiere a caja chica ($20)';
COMMENT ON COLUMN operaciones_cajas.saldo_anterior IS 'Saldo de la caja ANTES de esta operación';
COMMENT ON COLUMN operaciones_cajas.saldo_actual IS 'Saldo de la caja DESPUÉS de esta operación (debe coincidir con cajas.saldo_actual)';

-- ==========================================
-- RESUMEN DE SALDOS ACTUALES (DATOS DE PRUEBA)
-- ==========================================
-- CAJA (Principal): $500.00
-- CAJA_CHICA: $150.00
-- CAJA_CELULAR: $320.50
-- CAJA_BUS: $180.75
-- TOTAL: $1,151.25
