-- ==========================================
-- Schema de Base de Datos - Módulo de Recargas V2
-- Basado en: proceso_recargas.md
-- Generado para Supabase (PostgreSQL)
-- ==========================================

-- Habilitar extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- LIMPIEZA (eliminar tablas anteriores)
-- ==========================================
DROP TABLE IF EXISTS operaciones_cajas CASCADE;
DROP TABLE IF EXISTS recargas CASCADE;
DROP TABLE IF EXISTS cajas CASCADE;
DROP TABLE IF EXISTS configuraciones CASCADE;
DROP TABLE IF EXISTS tipos_servicio CASCADE;
DROP TABLE IF EXISTS empleados CASCADE;
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

-- 1. Tabla: empleados
CREATE TABLE IF NOT EXISTS empleados (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    usuario VARCHAR(50) NOT NULL UNIQUE,
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Tabla: cajas (Cuentas de efectivo físico y virtual)
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

-- 3. Tabla: configuraciones (Configuración global del sistema)
CREATE TABLE IF NOT EXISTS configuraciones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    celular_alerta_saldo_bajo DECIMAL(12,2),
    caja_chica_transferencia_diaria DECIMAL(12,2),
    bus_dias_antes_facturacion INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Tabla: tipos_servicio (Bus, Celular)
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

-- 5. Tabla: recargas (Registro diario de control de saldo virtual)
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

-- 6. Tabla: operaciones_cajas (Log/Auditoría de operaciones en cajas)
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
CREATE INDEX idx_recargas_fecha ON recargas(fecha);
CREATE INDEX idx_recargas_tipo_servicio ON recargas(tipo_servicio_id);
CREATE INDEX idx_recargas_empleado ON recargas(empleado_id);
CREATE INDEX idx_operaciones_cajas_fecha ON operaciones_cajas(fecha);
CREATE INDEX idx_operaciones_cajas_caja ON operaciones_cajas(caja_id);
CREATE INDEX idx_operaciones_cajas_empleado ON operaciones_cajas(empleado_id);

-- ==========================================
-- DATOS INICIALES
-- ==========================================

-- Tipos de servicio según el proceso
INSERT INTO tipos_servicio (codigo, nombre, fondo_base, porcentaje_comision, periodo_comision, frecuencia_recarga) VALUES
('BUS', 'Recargas Bus', 500.00, 1.00, 'MENSUAL', 'SEMANAL'),
('CELULAR', 'Recargas Celular', 200.00, 5.00, 'SEMANAL', 'SEMANAL');

-- Cajas del sistema (4 cajas según flujo de negocio)
INSERT INTO cajas (codigo, nombre, descripcion, saldo_actual) VALUES
('CAJA', 'Caja Principal', 'Caja principal de la tienda - Recibe efectivo de ventas diarias', 0.00),
('CAJA_CHICA', 'Caja Chica', 'Caja chica - Recibe $20 diarios + comisiones de recargas', 0.00),
('CAJA_CELULAR', 'Caja Celular', 'Efectivo de ventas de recargas celular', 0.00),
('CAJA_BUS', 'Caja Bus', 'Efectivo de ventas de recargas bus', 0.00);

-- Configuración inicial del sistema
INSERT INTO configuraciones (celular_alerta_saldo_bajo, caja_chica_transferencia_diaria, bus_dias_antes_facturacion) VALUES
(50.00, 20.00, 3);

-- ==========================================
-- COMENTARIOS DE TABLAS
-- ==========================================
COMMENT ON TABLE cajas IS 'Cajas de efectivo físico (CAJA, CAJA_CHICA) y virtual (CELULAR, BUS)';
COMMENT ON TABLE configuraciones IS 'Configuración global del sistema';
COMMENT ON TABLE tipos_servicio IS 'Tipos de servicio de recarga con sus reglas de negocio';
COMMENT ON TABLE recargas IS 'Registro diario de control de saldo virtual por servicio';
COMMENT ON TABLE operaciones_cajas IS 'Log de todas las operaciones que afectan el saldo de las cajas';

COMMENT ON COLUMN cajas.saldo_actual IS 'Saldo actual de la caja (actualizado con cada operación)';
COMMENT ON COLUMN configuraciones.caja_chica_transferencia_diaria IS 'Monto fijo diario que se transfiere a caja chica ($20)';
COMMENT ON COLUMN recargas.venta_dia IS 'Monto vendido en el día';
COMMENT ON COLUMN recargas.saldo_virtual_anterior IS 'Saldo del día anterior (viene del saldo_virtual_actual previo)';
COMMENT ON COLUMN recargas.saldo_virtual_actual IS 'Saldo resultante: saldo_virtual_anterior - venta_dia';
COMMENT ON COLUMN recargas.validado IS 'Validación: venta_dia + saldo_virtual_actual = saldo_virtual_anterior';
COMMENT ON COLUMN recargas.exceso_sobre_base IS 'Cuando saldo_virtual_actual > fondo_base del tipo_servicio';
COMMENT ON COLUMN recargas.exceso_transferido IS 'Indica si el exceso ya fue transferido a caja chica';
COMMENT ON COLUMN operaciones_cajas.saldo_anterior IS 'Saldo de la caja ANTES de esta operación';
COMMENT ON COLUMN operaciones_cajas.saldo_actual IS 'Saldo de la caja DESPUÉS de esta operación';

-- ==========================================
-- FLUJO DEL CIERRE DIARIO
-- ==========================================
-- Al realizar el cierre diario se ejecutan las siguientes operaciones:
--
-- 1. CAJA (Principal):
--    - Recibe: efectivo de ventas de tienda
--    - Sale: $20 diarios a CAJA_CHICA
--    - Fórmula: saldo_anterior + efectivo_recaudado - 20 = saldo_actual
--    - Operación: INGRESO (efectivo) + TRANSFERENCIA_SALIENTE ($20)
--
-- 2. CAJA_CHICA:
--    - Recibe: $20 diarios de CAJA (automático)
--    - Comisiones: se registran manualmente cuando el proveedor las paga
--    - Fórmula: saldo_anterior + 20 = saldo_actual
--    - Operación: TRANSFERENCIA_ENTRANTE ($20)
--
-- 3. CAJA_CELULAR:
--    - Recibe: efectivo de ventas de recargas celular
--    - Fórmula: saldo_anterior + venta_celular = saldo_actual
--    - Operación: INGRESO (venta)
--
-- 4. CAJA_BUS:
--    - Recibe: efectivo de ventas de recargas bus
--    - Fórmula: saldo_anterior + venta_bus = saldo_actual
--    - Operación: INGRESO (venta)
--
-- Nota: El saldo_actual de cada caja se actualiza con cada operación.
--       La tabla operaciones_cajas registra el historial completo con
--       saldo_anterior y saldo_actual para auditoría.
