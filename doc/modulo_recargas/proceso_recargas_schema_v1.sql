-- ==========================================
-- Schema de Base de Datos - Módulo de Recargas
-- Basado en: proceso_recargas.md
-- Generado para Supabase (PostgreSQL)
-- ==========================================

-- Habilitar extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- LIMPIEZA (eliminar tablas anteriores)
-- ==========================================
DROP TABLE IF EXISTS recargas CASCADE;
DROP TABLE IF EXISTS tipos_servicio CASCADE;
DROP TABLE IF EXISTS empleados CASCADE;

-- ==========================================
-- TABLAS
-- ==========================================

-- 1. Tabla: empleados
CREATE TABLE IF NOT EXISTS empleados (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    usuario VARCHAR(50) NOT NULL UNIQUE,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tabla: tipos_servicio (Bus, Celular)
-- Contiene las reglas de negocio por cada tipo
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

-- 3. Tabla: recargas (Registro diario de control de saldo virtual)
CREATE TABLE IF NOT EXISTS recargas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Identificación
    fecha DATE NOT NULL,
    tipo_servicio_id INTEGER NOT NULL REFERENCES tipos_servicio(id),
    empleado_id INTEGER NOT NULL REFERENCES empleados(id),
    
    -- Datos del proceso diario
    venta_dia DECIMAL(12,2) NOT NULL,                -- Venta del día
    saldo_virtual_anterior DECIMAL(12,2) NOT NULL,   -- Viene del día anterior
    saldo_virtual_actual DECIMAL(12,2) NOT NULL,     -- Calculado: anterior - venta_dia
    
    -- Validación (regla: venta_dia + saldo_actual = saldo_anterior)
    validado BOOLEAN DEFAULT FALSE,
    
    -- Control de exceso (cuando saldo_actual > fondo_base)
    exceso_sobre_base DECIMAL(12,2) DEFAULT 0,
    exceso_transferido BOOLEAN DEFAULT FALSE,
    
    -- Auditoría
    observacion TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Restricción: un solo registro por día y tipo de servicio
    UNIQUE(fecha, tipo_servicio_id)
);

-- ==========================================
-- ÍNDICES
-- ==========================================
CREATE INDEX idx_recargas_fecha ON recargas(fecha);
CREATE INDEX idx_recargas_tipo_servicio ON recargas(tipo_servicio_id);
CREATE INDEX idx_recargas_empleado ON recargas(empleado_id);

-- ==========================================
-- DATOS INICIALES
-- ==========================================

-- Tipos de servicio según el proceso
INSERT INTO tipos_servicio (codigo, nombre, fondo_base, porcentaje_comision, periodo_comision, frecuencia_recarga) VALUES
('BUS', 'Recargas Bus', 500.00, 1.00, 'MENSUAL', 'SEMANAL'),
('CELULAR', 'Recargas Celular', 200.00, 5.00, 'SEMANAL', 'SEMANAL');

-- ==========================================
-- COMENTARIOS DE TABLAS
-- ==========================================
COMMENT ON TABLE tipos_servicio IS 'Tipos de servicio de recarga con sus reglas de negocio';
COMMENT ON TABLE recargas IS 'Registro diario de control de saldo virtual por servicio';

COMMENT ON COLUMN recargas.venta_dia IS 'Monto vendido en el día';
COMMENT ON COLUMN recargas.saldo_virtual_anterior IS 'Saldo del día anterior (viene del saldo_virtual_actual previo)';
COMMENT ON COLUMN recargas.saldo_virtual_actual IS 'Saldo resultante: saldo_virtual_anterior - venta_dia';
COMMENT ON COLUMN recargas.validado IS 'Validación: venta_dia + saldo_virtual_actual = saldo_virtual_anterior';
COMMENT ON COLUMN recargas.exceso_sobre_base IS 'Cuando saldo_virtual_actual > fondo_base del tipo_servicio';
COMMENT ON COLUMN recargas.exceso_transferido IS 'Indica si el exceso ya fue transferido a caja chica';
