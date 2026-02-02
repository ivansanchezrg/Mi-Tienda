-- Schema de Base de Datos - Mi Tienda
-- Basado en: docs/mi_tienda_erd_final.mermaid
-- Generado para Supabase (PostgreSQL)

-- Habilitar extensión para UUIDs (necesaria para uuid_generate_v4())
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- ENUMS (Tipos de datos enumerados)
-- ==========================================

-- Tipos para recargas (saldo virtual)
-- Nota: Ajustar valores según lógica de negocio específica si es necesario.
DROP TYPE IF EXISTS tipo_recarga_enum CASCADE;
CREATE TYPE tipo_recarga_enum AS ENUM ('COMPRA_SALDO', 'VENTA_SALDO', 'AJUSTE');

-- Tipos de movimientos financieros
DROP TYPE IF EXISTS tipo_movimiento_enum CASCADE;
CREATE TYPE tipo_movimiento_enum AS ENUM ('INGRESO', 'EGRESO', 'TRANSFERENCIA');

-- Conceptos de los movimientos
DROP TYPE IF EXISTS concepto_movimiento_enum CASCADE;
CREATE TYPE concepto_movimiento_enum AS ENUM ('VENTA_DIARIA', 'RECARGA', 'GASTO', 'AJUSTE_CAJA', 'TRANSFERENCIA_ENTRE_CAJAS', 'FONDO_INICIAL', 'OTRO');

-- Categorías de gastos
DROP TYPE IF EXISTS categoria_gasto_enum CASCADE;
CREATE TYPE categoria_gasto_enum AS ENUM ('OPERATIVO', 'ADMINISTRATIVO', 'MANTENIMIENTO', 'OTROS', 'SUELDOS', 'SERVICIOS_BASICOS');

-- Tipos de operación en cajas
DROP TYPE IF EXISTS tipo_operacion_caja_enum CASCADE;
CREATE TYPE tipo_operacion_caja_enum AS ENUM ('APERTURA', 'CIERRE', 'INGRESO', 'RETIRO', 'AJUSTE', 'TRANSFERENCIA_ENTRANTE', 'TRANSFERENCIA_SALIENTE');

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

-- 2. Tabla: tipos_servicio (Ej: Recargas Celular, Recargas Bus, etc.)
CREATE TABLE IF NOT EXISTS tipos_servicio (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(100) NOT NULL,
    porcentaje_ganancia DECIMAL(5,2) DEFAULT 0, -- Porcentaje de ganancia esperada
    fondo_base DECIMAL(12,2) DEFAULT 0,         -- Fondo base operativo
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Tabla: cajas (Cuentas de dinero: Caja Principal, Caja Chica, Banco, etc.)
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

-- 4. Tabla: configuraciones (Configuración global del sistema)
CREATE TABLE IF NOT EXISTS configuraciones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    celular_alerta_saldo_bajo DECIMAL(12,2),
    caja_chica_transferencia_diaria DECIMAL(12,2),
    bus_dias_antes_facturacion INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Tabla: recargas (Registro de movimientos de saldo virtual)
CREATE TABLE IF NOT EXISTS recargas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    tipo_servicio_id INTEGER REFERENCES tipos_servicio(id),
    empleado_id INTEGER REFERENCES empleados(id),
    tipo tipo_recarga_enum,
    monto DECIMAL(12,2) NOT NULL,
    saldo_virtual_anterior DECIMAL(12,2),
    saldo_virtual_actual DECIMAL(12,2),
    numero_factura VARCHAR(100),
    observacion TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Tabla: ventas_diarias (Cierre diario por servicio)
CREATE TABLE IF NOT EXISTS ventas_diarias (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha DATE NOT NULL,
    tipo_servicio_id INTEGER REFERENCES tipos_servicio(id),
    empleado_id INTEGER REFERENCES empleados(id),
    saldo_virtual_anterior DECIMAL(12,2),
    saldo_virtual_actual DECIMAL(12,2),
    venta_dia DECIMAL(12,2), -- Calculado: (Saldo Anterior + Compras) - Saldo Actual
    observacion TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(fecha, tipo_servicio_id) -- Asegura un solo cierre por servicio al día
);

-- 7. Tabla: movimientos (Movimientos de dinero real entre cajas o externos)
CREATE TABLE IF NOT EXISTS movimientos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    tipo tipo_movimiento_enum NOT NULL,
    concepto_tipo concepto_movimiento_enum NOT NULL,
    caja_origen_id INTEGER REFERENCES cajas(id),
    caja_destino_id INTEGER REFERENCES cajas(id), -- Null si es ingreso/egreso externo
    monto DECIMAL(12,2) NOT NULL,
    empleado_id INTEGER REFERENCES empleados(id),
    referencia_id UUID, -- ID polimórfico (puede referenciar ventas_diarias, gastos, etc.)
    referencia_tabla VARCHAR(100), -- Nombre de la tabla referenciada
    observacion TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Tabla: gastos (Detalle de gastos)
CREATE TABLE IF NOT EXISTS gastos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    categoria categoria_gasto_enum NOT NULL,
    monto DECIMAL(12,2) NOT NULL,
    descripcion TEXT,
    empleado_id INTEGER REFERENCES empleados(id),
    movimiento_id UUID REFERENCES movimientos(id), -- Link al movimiento financiero
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Tabla: operaciones_cajas (Log/Audit de cambios en saldo de cajas)
CREATE TABLE IF NOT EXISTS operaciones_cajas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    caja_id INTEGER REFERENCES cajas(id),
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
CREATE INDEX IF NOT EXISTS idx_recargas_fecha ON recargas(fecha);
CREATE INDEX IF NOT EXISTS idx_recargas_servicio ON recargas(tipo_servicio_id);
CREATE INDEX IF NOT EXISTS idx_ventas_diarias_fecha ON ventas_diarias(fecha);
CREATE INDEX IF NOT EXISTS idx_movimientos_fecha ON movimientos(fecha);
CREATE INDEX IF NOT EXISTS idx_operaciones_cajas_fecha ON operaciones_cajas(fecha);
CREATE INDEX IF NOT EXISTS idx_operaciones_cajas_caja ON operaciones_cajas(caja_id);
