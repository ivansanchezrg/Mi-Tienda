-- ==========================================
-- SCHEMA - MI TIENDA v4.9
-- Sistema de Gestión de Cajas y Recargas
-- ==========================================
-- ⚠️  Ejecutar UNA SOLA VEZ. Incluye DROP de tablas → borra todos los datos.
-- ⚠️  Para actualizar funciones PostgreSQL usar archivos en docs/*/sql/functions/
--     NO ejecutar este schema para eso — el DROP CASCADE borra todo.
-- ==========================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- LIMPIEZA (orden: más dependiente → menos)
-- ==========================================
DROP TABLE IF EXISTS operaciones_cajas CASCADE;
DROP TABLE IF EXISTS caja_fisica_diaria CASCADE;
DROP TABLE IF EXISTS gastos_diarios CASCADE;
DROP TABLE IF EXISTS turnos_caja CASCADE;
DROP TABLE IF EXISTS recargas CASCADE;
DROP TABLE IF EXISTS recargas_virtuales CASCADE;
DROP TABLE IF EXISTS categorias_operaciones CASCADE;
DROP TABLE IF EXISTS categorias_gastos CASCADE;
DROP TABLE IF EXISTS tipos_referencia CASCADE;
DROP TABLE IF EXISTS cierres_diarios CASCADE;
DROP TABLE IF EXISTS cajas CASCADE;
DROP TABLE IF EXISTS configuraciones CASCADE;
DROP TABLE IF EXISTS tipos_servicio CASCADE;
DROP TABLE IF EXISTS empleados CASCADE;
DROP TYPE IF EXISTS tipo_operacion_caja_enum CASCADE;
DROP TYPE IF EXISTS rol_usuario_enum CASCADE;

-- ==========================================
-- TIPOS ENUMERADOS
-- ==========================================
CREATE TYPE tipo_operacion_caja_enum AS ENUM (
    'APERTURA', 'CIERRE', 'INGRESO', 'EGRESO',
    'AJUSTE', 'TRANSFERENCIA_ENTRANTE', 'TRANSFERENCIA_SALIENTE'
);

CREATE TYPE rol_usuario_enum AS ENUM (
    'ADMIN', 'EMPLEADO'
);

-- ==========================================
-- TABLAS
-- ==========================================

-- 1. empleados
CREATE TABLE IF NOT EXISTS empleados (
    id         SERIAL PRIMARY KEY,
    nombre     VARCHAR(255) NOT NULL,
    usuario    VARCHAR(50)  NOT NULL UNIQUE,  -- Email Google OAuth
    rol        rol_usuario_enum NOT NULL DEFAULT 'EMPLEADO',
    activo     BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. cajas — CAJA | CAJA_CHICA | CAJA_CELULAR | CAJA_BUS
CREATE TABLE IF NOT EXISTS cajas (
    id          SERIAL PRIMARY KEY,
    codigo      VARCHAR(50)   NOT NULL UNIQUE,
    nombre      VARCHAR(100)  NOT NULL,
    descripcion TEXT,
    saldo_actual DECIMAL(12,2) DEFAULT 0,
    activo      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. configuraciones — Parámetros globales del negocio (1 sola fila)
CREATE TABLE IF NOT EXISTS configuraciones (
    id                              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fondo_fijo_diario               DECIMAL(12,2) DEFAULT 20.00,  -- Efectivo que queda en caja para mañana
    caja_chica_transferencia_diaria DECIMAL(12,2),                -- Monto transferido a Caja Chica en cada cierre
    bus_alerta_saldo_bajo           DECIMAL(12,2) DEFAULT 75.00,  -- Alerta cuando saldo virtual BUS <= este valor
    bus_dias_antes_facturacion      INTEGER,                      -- Anticipación para recordar facturación mensual BUS
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. tipos_servicio — BUS y CELULAR con sus reglas de comisión
CREATE TABLE IF NOT EXISTS tipos_servicio (
    id                  SERIAL PRIMARY KEY,
    codigo              VARCHAR(50)  NOT NULL UNIQUE,  -- 'BUS' | 'CELULAR'
    nombre              VARCHAR(100) NOT NULL,
    porcentaje_comision DECIMAL(5,2) NOT NULL,         -- BUS: 1% | CELULAR: 5%
    periodo_comision    VARCHAR(20)  NOT NULL CHECK (periodo_comision IN ('MENSUAL', 'SEMANAL')),
    activo              BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. turnos_caja — Un turno por apertura (puede haber varios por día)
CREATE TABLE IF NOT EXISTS turnos_caja (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    numero_turno        SMALLINT NOT NULL DEFAULT 1,
    empleado_id         INTEGER  NOT NULL REFERENCES empleados(id),
    hora_fecha_apertura TIMESTAMP WITH TIME ZONE NOT NULL,
    hora_fecha_cierre   TIMESTAMP WITH TIME ZONE,
    observaciones       TEXT
);

-- 6. recargas — Control de saldo virtual por servicio y turno
CREATE TABLE IF NOT EXISTS recargas (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha                 DATE    NOT NULL,
    turno_id              UUID    NOT NULL REFERENCES turnos_caja(id),
    tipo_servicio_id      INTEGER NOT NULL REFERENCES tipos_servicio(id),
    empleado_id           INTEGER NOT NULL REFERENCES empleados(id),
    venta_dia             DECIMAL(12,2) NOT NULL CHECK (venta_dia >= 0),
    saldo_virtual_anterior DECIMAL(12,2) NOT NULL,
    saldo_virtual_actual  DECIMAL(12,2) NOT NULL,  -- saldo_anterior - venta_dia
    observaciones         TEXT,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(turno_id, tipo_servicio_id)             -- 1 registro por turno y servicio
);

-- 7. caja_fisica_diaria — Cierre físico de caja (1 por turno)
-- Fórmula: depósito = efectivo_recaudado - fondo_fijo_diario - caja_chica_transferencia_diaria
CREATE TABLE IF NOT EXISTS caja_fisica_diaria (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha              DATE    NOT NULL,
    turno_id           UUID    NOT NULL REFERENCES turnos_caja(id) UNIQUE,
    empleado_id        INTEGER NOT NULL REFERENCES empleados(id),
    efectivo_recaudado DECIMAL(12,2) NOT NULL,           -- Total contado al cierre
    deficit_caja_chica DECIMAL(12,2) NOT NULL DEFAULT 0, -- >0 = faltó dinero para transferir a Caja Chica
    observaciones      TEXT,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │  DOS SISTEMAS DE CATEGORÍAS — NO UNIFICAR                              │
-- ├──────────────────────┬──────────────────────────────────────────────────┤
-- │  categorias_gastos   │  categorias_operaciones                          │
-- │  (GS-XXX)            │  (EG-XXX / IN-XXX)                              │
-- ├──────────────────────┼──────────────────────────────────────────────────┤
-- │  Gasto pagado con    │  Movimiento formal que DESCUENTA saldo de        │
-- │  efectivo del día    │  CAJA PRINCIPAL o CAJA_CHICA (Varios)            │
-- │  → NO afecta cajas   │  → SÍ afecta saldos registrados                 │
-- ├──────────────────────┼──────────────────────────────────────────────────┤
-- │  Cuándo usarlo:      │  Cuándo usarlo:                                  │
-- │  Hay plata en mano   │  No hay efectivo disponible                      │
-- │  del día de ventas   │  o el gasto requiere trazabilidad contable       │
-- ├──────────────────────┼──────────────────────────────────────────────────┤
-- │  Tabla: gastos_      │  Tabla: operaciones_cajas                        │
-- │  diarios             │                                                  │
-- └──────────────────────┴──────────────────────────────────────────────────┘
-- Los nombres similares (Transporte, Mantenimiento, etc.) son intencionales:
-- el mismo gasto real puede pagarse por cualquiera de las dos vías.

-- 8. categorias_gastos — Para gastos pagados con efectivo del día (no afecta cajas)
CREATE TABLE IF NOT EXISTS categorias_gastos (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL,
    codigo      VARCHAR(20)  NOT NULL UNIQUE,  -- Ej: 'GS-001'
    descripcion TEXT,
    activo      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. gastos_diarios — Gastos pagados con efectivo del día → usa categorias_gastos (GS-XXX)
-- ⚠️  Si no hay efectivo disponible → registrar como EGRESO en operaciones_cajas (EG-XXX)
CREATE TABLE IF NOT EXISTS gastos_diarios (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha              DATE    NOT NULL,
    empleado_id        INTEGER NOT NULL REFERENCES empleados(id),
    categoria_gasto_id INTEGER NOT NULL REFERENCES categorias_gastos(id),
    monto              DECIMAL(12,2) NOT NULL CHECK (monto > 0),
    observaciones      TEXT,
    comprobante_url    TEXT,  -- Path en Storage: "2026/02/uuid.jpg" (opcional)
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. tipos_referencia — Catálogo de tablas origen para trazabilidad en operaciones_cajas
CREATE TABLE IF NOT EXISTS tipos_referencia (
    id          SERIAL PRIMARY KEY,
    tabla       VARCHAR(100) NOT NULL UNIQUE,  -- Nombre exacto de la tabla origen (ej: 'recargas_virtuales')
    descripcion TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. categorias_operaciones — Para movimientos que SÍ afectan saldos de cajas (ver cuadro arriba)
-- seleccionable = FALSE → creada por el sistema, no aparece en dropdowns del usuario
CREATE TABLE IF NOT EXISTS categorias_operaciones (
    id           SERIAL PRIMARY KEY,
    tipo         VARCHAR(10)  NOT NULL CHECK (tipo IN ('INGRESO', 'EGRESO')),
    nombre       VARCHAR(100) NOT NULL,
    codigo       VARCHAR(20)  NOT NULL UNIQUE,  -- Ej: 'EG-001', 'IN-001'
    descripcion  TEXT,
    activo       BOOLEAN DEFAULT TRUE,
    seleccionable BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. operaciones_cajas — Log de auditoría de todos los movimientos en cajas
CREATE TABLE IF NOT EXISTS operaciones_cajas (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    caja_id            INTEGER NOT NULL REFERENCES cajas(id),
    empleado_id        INTEGER REFERENCES empleados(id),
    tipo_operacion     tipo_operacion_caja_enum NOT NULL,
    monto              DECIMAL(12,2) NOT NULL CHECK (monto > 0),
    saldo_anterior     DECIMAL(12,2),
    saldo_actual       DECIMAL(12,2),
    categoria_id       INTEGER REFERENCES categorias_operaciones(id),  -- Obligatorio para INGRESO/EGRESO
    tipo_referencia_id INTEGER REFERENCES tipos_referencia(id),        -- Tabla que originó la operación
    referencia_id      UUID,                                           -- ID del registro origen
    descripcion        TEXT,
    comprobante_url    TEXT
);

-- 13. recargas_virtuales — Saldo virtual agregado al sistema
-- CELULAR: proveedor carga a crédito (pagado=false hasta que se le pague, pagado=true al pagar)
-- BUS v4.0: pagado=false al comprar saldo, pagado=true al liquidar la ganancia mensual via liquidar_ganancias_bus()
CREATE TABLE IF NOT EXISTS recargas_virtuales (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha             DATE    NOT NULL,
    tipo_servicio_id  INTEGER NOT NULL REFERENCES tipos_servicio(id),
    empleado_id       INTEGER NOT NULL REFERENCES empleados(id),
    monto_virtual     DECIMAL(12,2) NOT NULL CHECK (monto_virtual >= 0),       -- Saldo que subió al sistema
    monto_a_pagar     DECIMAL(12,2) NOT NULL CHECK (monto_a_pagar >= 0),       -- Lo que se debe al proveedor
    ganancia          DECIMAL(12,2) NOT NULL DEFAULT 0,
    pagado            BOOLEAN DEFAULT false,
    fecha_pago        DATE,
    operacion_pago_id UUID REFERENCES operaciones_cajas(id),
    observaciones     TEXT,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- ÍNDICES
-- ==========================================
CREATE INDEX idx_recargas_fecha                ON recargas(fecha);
CREATE INDEX idx_recargas_turno                ON recargas(turno_id);
CREATE INDEX idx_recargas_tipo_servicio        ON recargas(tipo_servicio_id);
CREATE INDEX idx_recargas_empleado             ON recargas(empleado_id);
CREATE INDEX idx_caja_fisica_diaria_fecha      ON caja_fisica_diaria(fecha);
CREATE INDEX idx_caja_fisica_diaria_turno      ON caja_fisica_diaria(turno_id);
CREATE INDEX idx_caja_fisica_diaria_empleado   ON caja_fisica_diaria(empleado_id);
CREATE UNIQUE INDEX idx_turnos_caja_fecha_turno ON turnos_caja ((CAST(hora_fecha_apertura AT TIME ZONE 'America/Guayaquil' AS date)), numero_turno);
CREATE INDEX idx_turnos_caja_empleado          ON turnos_caja(empleado_id);
CREATE INDEX idx_gastos_diarios_fecha          ON gastos_diarios(fecha);
CREATE INDEX idx_operaciones_cajas_fecha       ON operaciones_cajas(fecha);
CREATE INDEX idx_operaciones_cajas_caja        ON operaciones_cajas(caja_id);
CREATE INDEX idx_operaciones_cajas_empleado    ON operaciones_cajas(empleado_id);
CREATE INDEX idx_operaciones_cajas_categoria   ON operaciones_cajas(categoria_id);
CREATE INDEX idx_recargas_virtuales_fecha      ON recargas_virtuales(fecha);
CREATE INDEX idx_recargas_virtuales_servicio   ON recargas_virtuales(tipo_servicio_id);
CREATE INDEX idx_recargas_virtuales_pagado     ON recargas_virtuales(pagado);

-- ==========================================
-- TRIGGERS — AUTO-GENERACIÓN DE CÓDIGOS
-- ==========================================
-- Van aquí (después de CREATE TABLE, antes de INSERT) porque el DROP TABLE
-- CASCADE del inicio borra los triggers existentes junto con la tabla.

CREATE OR REPLACE FUNCTION fn_set_codigo_categoria_gasto()
RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  SELECT COALESCE(
    MAX(
      CASE WHEN codigo ~ '^GS-\d+$'
        THEN CAST(SUBSTRING(codigo FROM 4) AS INTEGER)
        ELSE 0
      END
    ), 0
  ) + 1
  INTO v_numero
  FROM categorias_gastos;

  NEW.codigo := 'GS-' || LPAD(v_numero::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_set_codigo_categoria_gasto
  BEFORE INSERT ON categorias_gastos
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_codigo_categoria_gasto();

-- ──

CREATE OR REPLACE FUNCTION fn_set_codigo_categoria_operacion()
RETURNS TRIGGER AS $$
DECLARE
  v_prefijo VARCHAR(2);
  v_numero  INTEGER;
BEGIN
  v_prefijo := CASE NEW.tipo
    WHEN 'EGRESO'  THEN 'EG'
    WHEN 'INGRESO' THEN 'IN'
    ELSE UPPER(SUBSTRING(NEW.tipo FROM 1 FOR 2))
  END;

  SELECT COALESCE(
    MAX(
      CASE WHEN codigo ~ ('^' || v_prefijo || '-\d+$')
        THEN CAST(SUBSTRING(codigo FROM 4) AS INTEGER)
        ELSE 0
      END
    ), 0
  ) + 1
  INTO v_numero
  FROM categorias_operaciones
  WHERE codigo LIKE v_prefijo || '-%';

  NEW.codigo := v_prefijo || '-' || LPAD(v_numero::TEXT, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_set_codigo_categoria_operacion
  BEFORE INSERT ON categorias_operaciones
  FOR EACH ROW
  EXECUTE FUNCTION fn_set_codigo_categoria_operacion();

-- ==========================================
-- DATOS INICIALES
-- ==========================================

INSERT INTO tipos_servicio (codigo, nombre, porcentaje_comision, periodo_comision) VALUES
('BUS',     'Recargas Bus',     1.00, 'MENSUAL'),
('CELULAR', 'Recargas Celular', 5.00, 'SEMANAL');

INSERT INTO cajas (codigo, nombre, descripcion, saldo_actual) VALUES
('CAJA',         'Tienda',  'Recibe efectivo de ventas diarias',          0.00),
('CAJA_CHICA',   'Varios',  'Recibe $20 diarios + comisiones recargas',   0.00),
('CAJA_CELULAR', 'Celular', 'Efectivo de ventas de recargas celular',     0.00),
('CAJA_BUS',     'Bus',     'Efectivo de ventas de recargas bus',         0.00);

INSERT INTO tipos_referencia (tabla, descripcion) VALUES
('recargas',           'Operaciones originadas desde recargas diarias'),
('caja_fisica_diaria', 'Operaciones originadas desde el cierre físico diario'),
('turnos_caja',        'Registro de turnos de apertura/cierre'),
('recargas_virtuales', 'Pagos al proveedor celular y compras de saldo bus');

-- codigo se omite: el trigger fn_set_codigo_categoria_gasto() lo genera automáticamente (GS-001, GS-002...)
INSERT INTO categorias_gastos (nombre, descripcion) VALUES
('Servicios Públicos', 'Luz, agua, internet, teléfono y otros servicios básicos'),
('Transporte',         'Gastos de transporte, combustible y estacionamiento'),
('Mantenimiento',      'Reparaciones y mantenimiento del local, equipos y mobiliario'),
('Limpieza',           'Productos de limpieza y servicios de limpieza'),
('Papelería',          'Papelería, útiles de oficina y suministros'),
('Alimentación',       'Alimentación y bebidas para el personal'),
('Otros',              'Otros gastos operativos no clasificados');

-- codigo se omite: el trigger fn_set_codigo_categoria_operacion() lo genera automáticamente
-- EGRESO → EG-001, EG-002... / INGRESO → IN-001, IN-002...
-- seleccionable = FALSE → creada por funciones SQL, no aparece en dropdowns
INSERT INTO categorias_operaciones (tipo, nombre, descripcion, seleccionable) VALUES
('EGRESO',  'Compras/Mercadería',               'Compra de productos para reventa o uso en el negocio',                    TRUE),
('EGRESO',  'Servicios Básicos',                'Pago de luz, agua, internet, teléfono',                                   TRUE),
('EGRESO',  'Alquiler',                         'Pago de alquiler del local',                                              TRUE),
('EGRESO',  'Mantenimiento',                    'Reparaciones y mantenimiento del local o equipo',                         TRUE),
('EGRESO',  'Transporte/Combustible',           'Gastos de transporte y combustible',                                      TRUE),
('EGRESO',  'Papelería/Suministros',            'Papelería, útiles de oficina y suministros generales',                    TRUE),
('EGRESO',  'Salarios',                         'Pago de salarios a empleados',                                            TRUE),
('EGRESO',  'Impuestos/Tasas',                  'Pago de impuestos y tasas municipales',                                   TRUE),
('EGRESO',  'Otros Gastos',                     'Otros gastos operativos no clasificados',                                 TRUE),
('EGRESO',  'Pago Proveedor Recargas',          'Pago al proveedor de recargas celular (saldo prestado a crédito)',        FALSE),
('EGRESO',  'Compra Saldo Virtual Bus',         'Compra de saldo virtual bus mediante depósito bancario',                  FALSE),
('EGRESO',  'Ajuste Déficit Turno Anterior',    'Retiro de Tienda para reponer déficit del turno anterior',                FALSE),
('INGRESO', 'Ventas',                           'Ingresos por ventas del negocio',                                         TRUE),
('INGRESO', 'Devoluciones de Proveedores',      'Devolución de dinero por parte de proveedores',                           TRUE),
('INGRESO', 'Otros Ingresos',                   'Otros ingresos no clasificados',                                          TRUE),
('INGRESO', 'Reposición Déficit Turno Anterior','Ingreso a Varios por reposición del déficit pendiente del turno anterior', FALSE);

INSERT INTO configuraciones (fondo_fijo_diario, caja_chica_transferencia_diaria, bus_alerta_saldo_bajo, bus_dias_antes_facturacion) VALUES
(20.00, 20.00, 75.00, 3);

INSERT INTO empleados (nombre, usuario, rol) VALUES
('Ivan Sanchez', 'ivansan2192@gmail.com', 'ADMIN');

-- ==========================================
-- RESUMEN
-- ==========================================
-- ✅ 13 Tablas | 1 Enum | 17 Índices
-- ✅ 2 Tipos de servicio (BUS, CELULAR)
-- ✅ 4 Tipos de referencia
-- ✅ 16 Categorías de operaciones (12 egresos + 4 ingresos)
-- ✅ 7 Categorías de gastos
-- ✅ 4 Cajas inicializadas en $0.00
-- ✅ Configuración: fondo=$20 | caja_chica=$20 | alerta_bus=$75 | dias_fact=3
-- ✅ Admin inicial: Ivan Sanchez
--
-- ⚠️  FUNCIONES POSTGRESQL (archivos separados, no van en este schema):
--   • ejecutar_cierre_diario           → docs/dashboard/sql/functions/
--   • registrar_operacion_manual       → docs/dashboard/sql/functions/
--   • reparar_deficit_turno            → docs/dashboard/sql/functions/
--   • registrar_compra_saldo_bus       → docs/recargas-virtuales/sql/functions/
--   • registrar_recarga_proveedor_*    → docs/recargas-virtuales/sql/functions/
--   • registrar_pago_proveedor_celular → docs/recargas-virtuales/sql/functions/
-- ==========================================
