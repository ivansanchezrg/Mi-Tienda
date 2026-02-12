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
-- Fecha: 2026-02-09
-- Versión: 4.5 - Modelo de recargas virtuales (CELULAR a crédito / BUS compra directa)
--   • Solo 1 campo: efectivo_recaudado (total contado al final)
--   • Fondo fijo en config: configuraciones.fondo_fijo_diario ($40)
--   • Transferencia en config: configuraciones.caja_chica_transferencia_diaria ($20)
--   • Fórmula: depósito = efectivo_recaudado - fondo_fijo - transferencia
--   • Tabla gastos_diarios para tracking de gastos operativos
--   • CAMBIOS v4.1: Múltiples cierres por día (1 por turno)
--   • turno_id en caja_fisica_diaria y recargas
--   • UNIQUE(turno_id, tipo_servicio_id) en recargas
--   • CAMBIOS v4.2: Categorización contable
--   • Nueva tabla: categorias_operaciones
--   • categoria_id en operaciones_cajas (obligatorio para INGRESO/EGRESO)
--   • 12 categorías por defecto (9 egresos + 3 ingresos)
--   • CAMBIOS v4.3: Comprobantes en gastos_diarios
--   • comprobante_url en gastos_diarios (opcional)
--   • CAMBIOS v4.4: Categorización de gastos diarios
--   • Nueva tabla: categorias_gastos
--   • categoria_gasto_id en gastos_diarios (obligatorio)
--   • 7 categorías predefinidas para gastos operativos
-- ==========================================

-- Habilitar extensión para UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- LIMPIEZA (eliminar tablas y tipos existentes)
-- ==========================================
-- ORDEN: De más dependiente a menos dependiente
DROP TABLE IF EXISTS operaciones_cajas CASCADE;
DROP TABLE IF EXISTS caja_fisica_diaria CASCADE;
DROP TABLE IF EXISTS gastos_diarios CASCADE;
DROP TABLE IF EXISTS turnos_caja CASCADE;
DROP TABLE IF EXISTS recargas CASCADE;
DROP TABLE IF EXISTS recargas_virtuales CASCADE;
DROP TABLE IF EXISTS categorias_operaciones CASCADE;
DROP TABLE IF EXISTS categorias_gastos CASCADE;
DROP TABLE IF EXISTS tipos_referencia CASCADE;
DROP TABLE IF EXISTS cierres_diarios CASCADE; -- Mantener por compatibilidad (nombre antiguo)
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
    fondo_fijo_diario DECIMAL(10,2) DEFAULT 40.00,      -- Fondo fijo que se deja en caja física cada día
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
    porcentaje_comision DECIMAL(5,2) NOT NULL,       -- Bus: 1%, Celular: 5% (descuento sobre monto_virtual: monto_a_pagar = monto_virtual * (1 - pct/100))
    periodo_comision VARCHAR(20) NOT NULL,           -- 'MENSUAL', 'SEMANAL'
    frecuencia_recarga VARCHAR(20) NOT NULL,         -- 'SEMANAL'

    -- Control
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Tabla: turnos_caja
-- Registro de turnos de apertura/cierre de caja (independiente del cierre contable)
-- Permite múltiples turnos por día con hora exacta de apertura y cierre
CREATE TABLE IF NOT EXISTS turnos_caja (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha DATE NOT NULL,
    numero_turno SMALLINT NOT NULL DEFAULT 1,
    empleado_id INTEGER NOT NULL REFERENCES empleados(id),
    hora_apertura TIMESTAMP WITH TIME ZONE NOT NULL,
    hora_cierre TIMESTAMP WITH TIME ZONE,
    observaciones TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(fecha, numero_turno)
);

-- 6. Tabla: recargas
-- Registro de control de saldo virtual por servicio (v4.1: por turno)
CREATE TABLE IF NOT EXISTS recargas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Identificación
    fecha DATE NOT NULL,
    turno_id UUID NOT NULL REFERENCES turnos_caja(id), -- Turno al que pertenece este registro
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

    -- Restricción v4.1: un solo registro por turno y tipo de servicio
    UNIQUE(turno_id, tipo_servicio_id)
);

-- 7. Tabla: caja_fisica_diaria
-- Registro de la caja física diaria (versión ultra-simplificada)
-- En v4.1: Permite múltiples cierres por día (1 cierre por turno)
CREATE TABLE IF NOT EXISTS caja_fisica_diaria (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha DATE NOT NULL,                             -- Fecha del cierre (múltiples por día permitidos)
    turno_id UUID NOT NULL REFERENCES turnos_caja(id) UNIQUE, -- Relación 1:1 con turno (un cierre por turno)
    empleado_id INTEGER NOT NULL REFERENCES empleados(id),
    efectivo_recaudado DECIMAL(12,2) NOT NULL,       -- Total efectivo contado al final del día
    observaciones TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Tabla: categorias_gastos
-- Catálogo de categorías para clasificar gastos diarios operativos
CREATE TABLE IF NOT EXISTS categorias_gastos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,                    -- Nombre de la categoría
    codigo VARCHAR(20) NOT NULL UNIQUE,              -- Código único (ej: 'GS-001')
    descripcion TEXT,                                -- Descripción de la categoría
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Tabla: gastos_diarios
-- Registro de gastos operativos pagados desde la caja física (efectivo de ventas del día)
-- NOTA: Si no hay efectivo, se hace EGRESO desde CAJA PRINCIPAL (en operaciones_cajas)
CREATE TABLE IF NOT EXISTS gastos_diarios (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha DATE NOT NULL,                             -- Fecha del gasto
    empleado_id INTEGER NOT NULL REFERENCES empleados(id),
    categoria_gasto_id INTEGER NOT NULL REFERENCES categorias_gastos(id), -- Categoría del gasto
    monto DECIMAL(10,2) NOT NULL CHECK (monto > 0),  -- Monto del gasto
    observaciones TEXT,                              -- Detalles adicionales del gasto
    comprobante_url TEXT,                            -- Path del comprobante en Storage (opcional)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índice para búsquedas por fecha
CREATE INDEX idx_gastos_diarios_fecha ON gastos_diarios(fecha);

-- 11. Tabla: tipos_referencia
-- Catálogo de tablas que pueden ser referenciadas por operaciones
CREATE TABLE IF NOT EXISTS tipos_referencia (
    id SERIAL PRIMARY KEY,
    codigo VARCHAR(50) NOT NULL UNIQUE,              -- Código único (ej: 'RECARGAS')
    tabla VARCHAR(100) NOT NULL UNIQUE,              -- Nombre de la tabla (ej: 'recargas')
    descripcion TEXT,                                -- Descripción del tipo de referencia
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. Tabla: categorias_operaciones
-- Catálogo de categorías contables para clasificar ingresos y egresos
CREATE TABLE IF NOT EXISTS categorias_operaciones (
    id SERIAL PRIMARY KEY,
    tipo TEXT NOT NULL CHECK (tipo IN ('INGRESO', 'EGRESO')),
    nombre VARCHAR(100) NOT NULL,                    -- Nombre de la categoría
    codigo VARCHAR(20) NOT NULL UNIQUE,              -- Código único (ej: 'EG-001')
    descripcion TEXT,                                -- Descripción de la categoría
    activo BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 13. Tabla: operaciones_cajas
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
    categoria_id INTEGER REFERENCES categorias_operaciones(id),  -- Categoría contable (obligatorio para INGRESO/EGRESO)
    tipo_referencia_id INTEGER REFERENCES tipos_referencia(id),  -- Tipo de tabla que origina la operación
    referencia_id UUID,                              -- UUID del registro que origina la operación
    descripcion TEXT,
    comprobante_url TEXT,                            -- URL del comprobante en Supabase Storage (obligatorio para egresos)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 14. Tabla: recargas_virtuales
-- Registra cada vez que se agrega saldo virtual:
--   CELULAR: proveedor carga a crédito → crea deuda, no mueve efectivo
--   BUS: compra directa con depósito bancario → EGRESO inmediato de CAJA_BUS
CREATE TABLE IF NOT EXISTS recargas_virtuales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha DATE NOT NULL,
    tipo_servicio_id INTEGER NOT NULL REFERENCES tipos_servicio(id),
    empleado_id INTEGER NOT NULL REFERENCES empleados(id),

    -- Montos
    monto_virtual DECIMAL(12,2) NOT NULL,      -- Lo que subió el saldo virtual ($210 celular / $X bus)
    monto_a_pagar DECIMAL(12,2) NOT NULL,      -- Lo que se debe pagar ($200 celular = monto_virtual * 0.95 / $X bus)
    ganancia DECIMAL(12,2) NOT NULL DEFAULT 0, -- Ganancia del negocio ($10 celular / $0 bus)

    -- Estado del pago
    -- CELULAR: false hasta que el proveedor cobre
    -- BUS: siempre true (pagó al depositar)
    pagado BOOLEAN DEFAULT false,
    fecha_pago DATE,
    operacion_pago_id UUID REFERENCES operaciones_cajas(id), -- Enlace al EGRESO cuando se paga

    notas TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- ÍNDICES PARA MEJORAR PERFORMANCE
-- ==========================================
CREATE INDEX idx_recargas_fecha ON recargas(fecha);
CREATE INDEX idx_recargas_turno ON recargas(turno_id);
CREATE INDEX idx_recargas_tipo_servicio ON recargas(tipo_servicio_id);
CREATE INDEX idx_recargas_empleado ON recargas(empleado_id);
CREATE INDEX idx_caja_fisica_diaria_fecha ON caja_fisica_diaria(fecha);
CREATE INDEX idx_caja_fisica_diaria_turno ON caja_fisica_diaria(turno_id);
CREATE INDEX idx_caja_fisica_diaria_empleado ON caja_fisica_diaria(empleado_id);
CREATE INDEX idx_turnos_caja_fecha ON turnos_caja(fecha);
CREATE INDEX idx_turnos_caja_empleado ON turnos_caja(empleado_id);
CREATE INDEX idx_operaciones_cajas_fecha ON operaciones_cajas(fecha);
CREATE INDEX idx_operaciones_cajas_caja ON operaciones_cajas(caja_id);
CREATE INDEX idx_operaciones_cajas_empleado ON operaciones_cajas(empleado_id);
CREATE INDEX idx_operaciones_cajas_categoria ON operaciones_cajas(categoria_id);
CREATE INDEX idx_recargas_virtuales_fecha ON recargas_virtuales(fecha);
CREATE INDEX idx_recargas_virtuales_servicio ON recargas_virtuales(tipo_servicio_id);
CREATE INDEX idx_recargas_virtuales_pagado ON recargas_virtuales(pagado);

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
('CAJA_CELULAR', 'Caja Celular', 'Efectivo de ventas de recargas celular', 0.00),
('CAJA_BUS', 'Caja Bus', 'Efectivo de ventas de recargas bus', 0.00);

-- Tipos de referencia (catálogo de tablas que pueden originar operaciones)
INSERT INTO tipos_referencia (codigo, tabla, descripcion) VALUES
('RECARGAS',            'recargas',            'Operaciones originadas desde registros de recargas diarias'),
('CAJA_FISICA_DIARIA',  'caja_fisica_diaria',  'Operaciones originadas desde el cierre de caja física diaria (depósito, transferencias)'),
('TURNOS_CAJA',         'turnos_caja',         'Registro de turnos de apertura/cierre de caja'),
('RECARGAS_VIRTUALES',  'recargas_virtuales',  'Pagos al proveedor celular (EGRESO) y compras de saldo bus (EGRESO)');

-- Categorías de gastos diarios (clasificación de gastos operativos)
INSERT INTO categorias_gastos (nombre, codigo, descripcion) VALUES
('Servicios Públicos', 'GS-001', 'Luz, agua, internet, teléfono y otros servicios básicos'),
('Transporte', 'GS-002', 'Gastos de transporte, combustible y estacionamiento'),
('Mantenimiento', 'GS-003', 'Reparaciones y mantenimiento del local, equipos y mobiliario'),
('Limpieza', 'GS-004', 'Productos de limpieza y servicios de limpieza'),
('Papelería', 'GS-005', 'Papelería, útiles de oficina y suministros'),
('Alimentación', 'GS-006', 'Alimentación y bebidas para el personal'),
('Otros', 'GS-007', 'Otros gastos operativos no clasificados');

-- Categorías de operaciones (para clasificación contable de ingresos y egresos)
INSERT INTO categorias_operaciones (tipo, nombre, codigo, descripcion) VALUES
-- Categorías de EGRESOS
('EGRESO', 'Compras/Mercadería', 'EG-001', 'Compra de productos para reventa o uso en el negocio'),
('EGRESO', 'Servicios Básicos', 'EG-002', 'Pago de luz, agua, internet, teléfono'),
('EGRESO', 'Alquiler', 'EG-003', 'Pago de alquiler del local'),
('EGRESO', 'Mantenimiento', 'EG-004', 'Reparaciones y mantenimiento del local o equipo'),
('EGRESO', 'Transporte/Combustible', 'EG-005', 'Gastos de transporte y combustible'),
('EGRESO', 'Papelería/Suministros', 'EG-006', 'Papelería, útiles de oficina y suministros generales'),
('EGRESO', 'Salarios', 'EG-007', 'Pago de salarios a empleados'),
('EGRESO', 'Impuestos/Tasas', 'EG-008', 'Pago de impuestos y tasas municipales'),
('EGRESO', 'Otros Gastos',              'EG-009', 'Otros gastos operativos no clasificados'),
('EGRESO', 'Pago Proveedor Recargas',  'EG-010', 'Pago al proveedor de recargas celular (saldo prestado a crédito)'),
('EGRESO', 'Compra Saldo Virtual Bus', 'EG-011', 'Compra de saldo virtual bus mediante depósito bancario'),
-- Categorías de INGRESOS
('INGRESO', 'Ventas', 'IN-001', 'Ingresos por ventas del negocio'),
('INGRESO', 'Devoluciones de Proveedores', 'IN-002', 'Devolución de dinero por parte de proveedores'),
('INGRESO', 'Otros Ingresos', 'IN-003', 'Otros ingresos no clasificados');

-- Configuración inicial del sistema
INSERT INTO configuraciones (fondo_fijo_diario, celular_alerta_saldo_bajo, caja_chica_transferencia_diaria, bus_dias_antes_facturacion) VALUES
(40.00, 50.00, 20.00, 3);

-- Empleado inicial del sistema
INSERT INTO empleados (nombre, usuario) VALUES
('Ivan Sanchez', 'ivansan2192@gmail.com');

-- NOTA v4.1: Los registros de recargas se crean automáticamente con el primer cierre
-- Ya no se insertan registros iniciales aquí porque requieren un turno_id
-- El primer cierre del día tomará saldo_virtual_anterior = 0 (o el configurado manualmente)

-- ==========================================
-- COMENTARIOS PARA DOCUMENTACIÓN
-- ==========================================
COMMENT ON TABLE empleados IS 'Usuarios del sistema que pueden operar las cajas';
COMMENT ON TABLE cajas IS 'Cajas de efectivo físico (CAJA, CAJA_CHICA) y virtual (CELULAR, BUS)';
COMMENT ON TABLE configuraciones IS 'Configuración global del sistema';
COMMENT ON TABLE tipos_servicio IS 'Tipos de servicio de recarga con sus reglas de negocio';
COMMENT ON TABLE recargas IS 'Registro de control de saldo virtual por servicio (v4.1: un registro por turno y tipo servicio)';
COMMENT ON TABLE caja_fisica_diaria IS 'Registro de la caja física por turno (v4.1: permite múltiples cierres por día - 1 cierre por turno)';
COMMENT ON TABLE gastos_diarios IS 'Registro de gastos operativos pagados desde efectivo de ventas del día (no afecta CAJA PRINCIPAL, comprobante opcional)';
COMMENT ON TABLE tipos_referencia IS 'Catálogo de tablas que pueden originar operaciones en cajas (para trazabilidad)';
COMMENT ON TABLE categorias_operaciones IS 'Catálogo de categorías contables para clasificar ingresos y egresos (permite reportes por tipo de gasto)';
COMMENT ON TABLE turnos_caja IS 'Registro de turnos de apertura/cierre de caja (independiente del cierre contable diario)';
COMMENT ON TABLE operaciones_cajas IS 'Log de auditoría de todas las operaciones en cajas con trazabilidad completa';

COMMENT ON COLUMN cajas.saldo_actual IS 'Saldo actual de la caja (se actualiza con cada operación)';
COMMENT ON COLUMN configuraciones.caja_chica_transferencia_diaria IS 'Monto fijo diario que se transfiere a caja chica ($20)';
COMMENT ON COLUMN caja_fisica_diaria.efectivo_recaudado IS 'Total efectivo contado al final del día (el único campo necesario)';
COMMENT ON COLUMN configuraciones.fondo_fijo_diario IS 'Fondo fijo que se deja en caja física todos los días ($40 por defecto)';
COMMENT ON COLUMN recargas.venta_dia IS 'Monto vendido en el día';
COMMENT ON COLUMN recargas.saldo_virtual_anterior IS 'Saldo del día anterior (viene del saldo_virtual_actual previo)';
COMMENT ON COLUMN recargas.saldo_virtual_actual IS 'Saldo resultante: saldo_virtual_anterior - venta_dia';
COMMENT ON COLUMN recargas.validado IS 'Validación: venta_dia + saldo_virtual_actual = saldo_virtual_anterior';
COMMENT ON COLUMN operaciones_cajas.saldo_anterior IS 'Saldo de la caja ANTES de esta operación';
COMMENT ON COLUMN operaciones_cajas.saldo_actual IS 'Saldo de la caja DESPUÉS de esta operación';
COMMENT ON COLUMN operaciones_cajas.categoria_id IS 'FK a categorias_operaciones - Clasificación contable de la operación (obligatorio para INGRESO/EGRESO)';
COMMENT ON COLUMN operaciones_cajas.tipo_referencia_id IS 'FK a tipos_referencia - Indica qué tipo de tabla originó esta operación';
COMMENT ON COLUMN operaciones_cajas.referencia_id IS 'UUID del registro específico que originó esta operación (para trazabilidad completa)';
COMMENT ON COLUMN gastos_diarios.comprobante_url IS 'Path del comprobante en Storage (opcional) - Ej: "2026/02/uuid.jpg"';

-- ==========================================
-- FLUJO DEL CIERRE DIARIO (VERSIÓN 2.0)
-- ==========================================
-- El cierre diario ahora representa APERTURA + OPERACIONES + CIERRE en un solo registro
--
-- APERTURA (implícita):
--    • No se crea operación APERTURA - el registro de cierre con saldo_inicial representa la apertura
--    • saldo_inicial = fondo_siguiente_dia del día anterior (validación de continuidad)
--
-- OPERACIONES DEL DÍA:
--
-- 1. CAJA (Principal):
--    • Comienza con: saldo_inicial (del cierre)
--    • Recibe: efectivo_recaudado
--    • Sale: egresos_del_dia
--    • Sale: $20 a CAJA_CHICA (transferencia_caja_chica)
--    • Sale: fondo_siguiente_dia (se deja para mañana)
--    • Fórmula: saldo_inicial + efectivo_recaudado - egresos_del_dia - transferencia_caja_chica - fondo_siguiente_dia = saldo_final
--    • Operaciones: INGRESO (efectivo) + TRANSFERENCIA_SALIENTE ($20)
--
-- 2. CAJA_CHICA:
--    • Recibe: $20 diarios de CAJA (automático en cierre)
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
-- CIERRE (implícito):
--    • No se crea operación CIERRE - el registro de cierre representa el fin del turno
--    • fondo_siguiente_dia será el saldo_inicial del próximo día
--
-- VALIDACIÓN DE CONTINUIDAD:
--    • saldo_inicial_dia_N = fondo_siguiente_dia_dia_N-1
--
-- IMPORTANTE:
-- - YA NO se crean operaciones APERTURA/CIERRE en operaciones_cajas
-- - El estado abierto/cerrado se determina por la existencia de cierre para HOY
-- - Si existe cierre para hoy → día cerrado
-- - Si NO existe cierre para hoy → día abierto

-- ==========================================
-- RESUMEN
-- ==========================================
-- ✅ 11 Tablas creadas
-- ✅ 1 Tipo enumerado creado
-- ✅ 13 Índices creados para performance
-- ✅ 2 Tipos de servicio configurados (BUS, CELULAR)
-- ✅ 3 Tipos de referencia configurados (RECARGAS, CAJA_FISICA_DIARIA, TURNOS_CAJA)
-- ✅ 12 Categorías de operaciones creadas (9 egresos + 3 ingresos)
-- ✅ 4 Cajas inicializadas:
--    • CAJA: $0.00
--    • CAJA_CHICA: $0.00
--    • CAJA_CELULAR: $159.20
--    • CAJA_BUS: $264.85
-- ✅ Configuración inicial establecida
-- ✅ 1 Empleado inicial creado (Ivan Sanchez)
-- NOTA: Los registros de recargas se crean con el primer cierre (requieren turno_id)
--
-- El sistema está listo para comenzar a operar.
-- Al hacer el primer cierre, se crearán los primeros registros de recargas.
-- La trazabilidad completa de operaciones está habilitada mediante tipos_referencia.
--
-- CAMBIOS VERSIÓN 4.0:
-- ✅ Ultra-simplificado: Solo 1 campo (efectivo_recaudado)
-- ✅ Fondo fijo centralizado: configuraciones.fondo_fijo_diario ($40)
-- ✅ Fórmula final: depósito = efectivo_recaudado - fondo_fijo - transferencia
-- ✅ UI más simple: Solo cuenta 1 número al final del día
-- ✅ Menos errores: No pueden equivocarse con saldo_inicial/fondo_siguiente
-- ✅ Estado abierto/cerrado por existencia de cierre para HOY
-- ✅ Tabla gastos_diarios para tracking de gastos operativos
-- ✅ Cuando no hay efectivo: EGRESO desde CAJA PRINCIPAL (en operaciones_cajas)
--
-- CAMBIOS VERSIÓN 4.2:
-- ✅ Sistema de categorías contables para clasificación de operaciones
-- ✅ 12 categorías predefinidas (9 egresos + 3 ingresos)
-- ✅ Campo categoria_id agregado a operaciones_cajas
--
-- CAMBIOS VERSIÓN 4.3:
-- ✅ Campo comprobante_url agregado a gastos_diarios (opcional)
-- ✅ Gastos operativos ahora soportan comprobantes fotográficos
-- ✅ Modal directo desde FAB para registro rápido de gastos
-- ✅ NO afecta saldos de cajas (gastos pagados con efectivo del día)
--
-- NOTA: Las funciones PostgreSQL están documentadas en:
--       src/app/features/dashboard/docs/PROCESO_INGRESO_EGRESO.md
--       (Copiar desde ahí para ejecutar en Supabase)
