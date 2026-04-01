-- ==========================================
-- SCHEMA - MI TIENDA v5.3
-- Sistema de Gestión de Cajas, Ventas POS y Recargas
-- ==========================================
-- ⚠️  Ejecutar UNA SOLA VEZ. Incluye DROP de tablas → borra todos los datos.
-- ⚠️  Para actualizar funciones PostgreSQL usar archivos en docs/*/sql/functions/
--     NO ejecutar este schema para eso — el DROP CASCADE borra todo.
-- ==========================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- LIMPIEZA (orden: más dependiente → menos)
-- ==========================================
DROP TABLE IF EXISTS notas CASCADE;
DROP TABLE IF EXISTS cuentas_cobrar CASCADE;
DROP TABLE IF EXISTS ventas_detalles CASCADE;
DROP TABLE IF EXISTS kardex_inventario CASCADE;
DROP TABLE IF EXISTS ventas CASCADE;
DROP TABLE IF EXISTS productos CASCADE;
DROP TABLE IF EXISTS categorias_productos CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;
DROP TABLE IF EXISTS deudas_empleados CASCADE;
DROP TABLE IF EXISTS operaciones_cajas CASCADE;
DROP TABLE IF EXISTS turnos_caja CASCADE;
DROP TABLE IF EXISTS recargas CASCADE;
DROP TABLE IF EXISTS recargas_virtuales CASCADE;
DROP TABLE IF EXISTS categorias_operaciones CASCADE;
DROP TABLE IF EXISTS tipos_referencia CASCADE;
DROP TABLE IF EXISTS cierres_diarios CASCADE;
DROP TABLE IF EXISTS cajas CASCADE;
DROP TABLE IF EXISTS configuraciones CASCADE;
DROP TABLE IF EXISTS tipos_servicio CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TYPE IF EXISTS tipo_comprobante_enum CASCADE;
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

CREATE TYPE tipo_comprobante_enum AS ENUM (
    'TICKET', 'NOTA_VENTA', 'FACTURA'
);

-- ==========================================
-- TABLAS
-- ==========================================

-- 1. usuarios
CREATE TABLE IF NOT EXISTS usuarios (
    id         SERIAL PRIMARY KEY,
    nombre     VARCHAR(255) NOT NULL,
    usuario    VARCHAR(50)  NOT NULL UNIQUE,  -- Email Google OAuth
    rol        rol_usuario_enum NOT NULL DEFAULT 'EMPLEADO',
    activo     BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. cajas — CAJA | CAJA_CHICA | VARIOS | CAJA_CELULAR | CAJA_BUS
CREATE TABLE IF NOT EXISTS cajas (
    id          SERIAL PRIMARY KEY,
    codigo      VARCHAR(50)   NOT NULL UNIQUE,
    nombre      VARCHAR(100)  NOT NULL,
    descripcion TEXT,
    saldo_actual DECIMAL(12,2) DEFAULT 0,
    activo      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. configuraciones — Parámetros globales del negocio (clave/valor)
-- Cada fila es una configuración independiente.
-- Agregar nueva config = INSERT de una fila, sin ALTER TABLE.
-- Prefijo por módulo: negocio_, caja_, bus_, pos_
-- Claves actuales:
--   negocio_nombre                — Nombre del negocio (aparece en comprobantes)
--   caja_fondo_fijo_diario        — Efectivo que queda en caja para mañana
--   caja_varios_transferencia_dia — Monto transferido a VARIOS en cada cierre
--   bus_alerta_saldo_bajo         — Alerta cuando saldo virtual BUS <= este valor
--   bus_dias_antes_facturacion    — Anticipación para recordar facturación mensual BUS
--   pos_descuentos_habilitados    — 'true'/'false' — activa descuentos automáticos en POS
--   pos_descuento_maximo_pct      — Porcentaje máximo de descuento aplicable (ej: '10')
--   pos_umbral_monto_descuento    — Monto mínimo de venta para descuento automático (ej: '50.00')
CREATE TABLE IF NOT EXISTS configuraciones (
    clave      VARCHAR(100) PRIMARY KEY,
    valor      TEXT NOT NULL
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
    empleado_id         INTEGER  NOT NULL REFERENCES usuarios(id),
    hora_fecha_apertura TIMESTAMP WITH TIME ZONE NOT NULL,
    hora_fecha_cierre   TIMESTAMP WITH TIME ZONE,
    fondo_cubierto      BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE si efectivoFisico < fondoFijo al cierre
    observaciones       TEXT
);

-- 6. deudas_empleados — Faltantes de conteo físico al cierre (posibles descuentos de nómina)
-- Causa: efectivo_fisico < efectivo_esperado al contar el cajón.
-- Insertado automáticamente por fn_ejecutar_cierre_diario cuando v_diferencia < 0.
-- El déficit de VARIOS y el fondo NO se registran aquí — son costos operacionales del negocio,
-- no responsabilidad del empleado. Solo el faltante del conteo físico implica deuda.
-- Marcado SALDADA manualmente cuando el empleado repone (pago en efectivo o descuento en nómina).
CREATE TABLE IF NOT EXISTS deudas_empleados (
    id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    empleado_id    INTEGER      NOT NULL REFERENCES usuarios(id),
    turno_id       UUID         NOT NULL REFERENCES turnos_caja(id),   -- turno en que ocurrió el faltante
    fecha          DATE         NOT NULL,                               -- fecha local del cierre
    monto_faltante DECIMAL(12,2) NOT NULL,                             -- ABS(efectivo_fisico - efectivo_esperado)
    estado         VARCHAR(20)  NOT NULL DEFAULT 'PENDIENTE'
                     CHECK (estado IN ('PENDIENTE', 'SALDADA', 'CANCELADA'))
);

-- 7. recargas — Control de saldo virtual por servicio y turno
CREATE TABLE IF NOT EXISTS recargas (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha                 DATE    NOT NULL,
    turno_id              UUID    NOT NULL REFERENCES turnos_caja(id),
    tipo_servicio_id      INTEGER NOT NULL REFERENCES tipos_servicio(id),
    empleado_id           INTEGER NOT NULL REFERENCES usuarios(id),
    venta_dia             DECIMAL(12,2) NOT NULL CHECK (venta_dia >= 0),
    saldo_virtual_anterior DECIMAL(12,2) NOT NULL,
    saldo_virtual_actual  DECIMAL(12,2) NOT NULL,  -- saldo_anterior - venta_dia
    observaciones         TEXT,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(turno_id, tipo_servicio_id)             -- 1 registro por turno y servicio
);

-- 7. tipos_referencia — Catálogo de tablas origen para trazabilidad en operaciones_cajas
CREATE TABLE IF NOT EXISTS tipos_referencia (
    id          SERIAL PRIMARY KEY,
    tabla       VARCHAR(100) NOT NULL UNIQUE,  -- Nombre exacto de la tabla origen (ej: 'recargas_virtuales')
    descripcion TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. categorias_operaciones — Para movimientos que SÍ afectan saldos de cajas
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

-- 9. operaciones_cajas — Log de auditoría de todos los movimientos en cajas
CREATE TABLE IF NOT EXISTS operaciones_cajas (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    caja_id            INTEGER NOT NULL REFERENCES cajas(id),
    empleado_id        INTEGER REFERENCES usuarios(id),
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

-- 10. recargas_virtuales — Saldo virtual agregado al sistema
-- CELULAR: proveedor carga a crédito (pagado=false hasta que se le pague, pagado=true al pagar)
-- BUS v4.0: pagado=false al comprar saldo, pagado=true al liquidar la ganancia mensual via fn_liquidar_ganancias_bus()
CREATE TABLE IF NOT EXISTS recargas_virtuales (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    fecha             DATE    NOT NULL,
    tipo_servicio_id  INTEGER NOT NULL REFERENCES tipos_servicio(id),
    empleado_id       INTEGER NOT NULL REFERENCES usuarios(id),
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
-- MÓDULO POS E INVENTARIO (v5.0)
-- ==========================================

-- 11. categorias_productos
CREATE TABLE IF NOT EXISTS categorias_productos (
    id          SERIAL PRIMARY KEY,
    nombre      VARCHAR(100) NOT NULL UNIQUE,
    activo      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. productos
CREATE TABLE IF NOT EXISTS productos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    categoria_id    INTEGER REFERENCES categorias_productos(id),
    codigo_barras   VARCHAR(50) UNIQUE,
    nombre          VARCHAR(150) NOT NULL,
    precio_costo    DECIMAL(12,2) NOT NULL DEFAULT 0,
    precio_venta    DECIMAL(12,2) NOT NULL,
    stock_actual    DECIMAL(12,2) DEFAULT 0,
    stock_minimo    INTEGER DEFAULT 5,
    tiene_iva       BOOLEAN DEFAULT FALSE,
    activo          BOOLEAN DEFAULT TRUE,
    imagen_url      TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 13. clientes (Consumidor Final y otros)
CREATE TABLE IF NOT EXISTS clientes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identificacion  VARCHAR(20) UNIQUE,
    nombre          VARCHAR(255) NOT NULL,
    telefono        VARCHAR(20),
    email           VARCHAR(100),
    es_consumidor_final BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 14. secuencias_comprobantes — Contadores atómicos por tipo de comprobante
-- Usado por fn_registrar_venta_pos via UPDATE ... RETURNING para evitar race conditions.
-- Ver: docs/pos/sql/tables/secuencias_comprobantes.sql
CREATE TABLE IF NOT EXISTS secuencias_comprobantes (
    tipo_documento VARCHAR(20) PRIMARY KEY,
    ultimo_valor   INTEGER     NOT NULL DEFAULT 0
);

INSERT INTO secuencias_comprobantes (tipo_documento, ultimo_valor)
VALUES ('TICKET', 0), ('NOTA_VENTA', 0), ('FACTURA', 0)
ON CONFLICT (tipo_documento) DO NOTHING;

-- 15. ventas (Cabecera Maestra)
CREATE TABLE IF NOT EXISTS ventas (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    turno_id        UUID NOT NULL REFERENCES turnos_caja(id),
    cliente_id      UUID REFERENCES clientes(id),
    empleado_id     INTEGER NOT NULL REFERENCES usuarios(id),
    fecha           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    subtotal        DECIMAL(12,2) NOT NULL,
    descuento       DECIMAL(12,2) DEFAULT 0,
    descuento_pct   SMALLINT DEFAULT 0,
    total           DECIMAL(12,2) NOT NULL,
    metodo_pago     VARCHAR(20) DEFAULT 'EFECTIVO' CHECK (metodo_pago IN ('EFECTIVO', 'DEUNA', 'TRANSFERENCIA', 'FIADO')),

    base_iva_0      DECIMAL(12,2) DEFAULT 0,
    base_iva_15     DECIMAL(12,2) DEFAULT 0,
    iva_valor       DECIMAL(12,2) DEFAULT 0,
    tipo_comprobante    tipo_comprobante_enum DEFAULT 'TICKET',
    numero_comprobante  INTEGER,                          -- Correlativo interno generado por fn_registrar_venta_pos
    secuencial_sri      VARCHAR(17),                      -- Reservado fase SRI: '001-001-000000001'
    clave_acceso_sri    VARCHAR(49),                      -- Reservado fase SRI: clave de acceso 49 dígitos
    estado_sri          VARCHAR(20) CHECK (estado_sri IN ('PENDIENTE', 'AUTORIZADO', 'RECHAZADO', 'NO_ENVIADO')) DEFAULT 'NO_ENVIADO',

    estado          VARCHAR(20) DEFAULT 'COMPLETADA' CHECK (estado IN ('COMPLETADA', 'ANULADA')),
    estado_pago     VARCHAR(20) DEFAULT 'NO_APLICA'
                        CHECK (estado_pago IN ('NO_APLICA', 'PENDIENTE', 'PAGADO_PARCIAL', 'PAGADO')),
    observaciones   TEXT,
    idempotency_key UUID UNIQUE                              -- Evita ventas duplicadas por reintento (POS)
);

-- 15. ventas_detalles (El Recibo Físico)
CREATE TABLE IF NOT EXISTS ventas_detalles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venta_id        UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id     UUID NOT NULL REFERENCES productos(id),
    cantidad        DECIMAL(12,2) NOT NULL,
    precio_unitario DECIMAL(12,2) NOT NULL,
    subtotal        DECIMAL(12,2) NOT NULL
);

-- 16. kardex_inventario (Auditoría Anti-Fraude Bodega)
CREATE TABLE IF NOT EXISTS kardex_inventario (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    producto_id     UUID NOT NULL REFERENCES productos(id),
    fecha           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    tipo_movimiento VARCHAR(20) CHECK (tipo_movimiento IN ('VENTA', 'COMPRA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO', 'ANULACION_VENTA')),
    cantidad        DECIMAL(12,2) NOT NULL,
    stock_anterior  DECIMAL(12,2) NOT NULL,
    stock_nuevo     DECIMAL(12,2) NOT NULL,
    referencia_id   UUID,
    observaciones   TEXT
);

-- 17. cuentas_cobrar — Registro de pagos contra ventas fiadas
CREATE TABLE IF NOT EXISTS cuentas_cobrar (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venta_id        UUID NOT NULL REFERENCES ventas(id),
    empleado_id     INTEGER NOT NULL REFERENCES usuarios(id),
    monto           DECIMAL(12,2) NOT NULL CHECK (monto > 0),
    metodo_pago     VARCHAR(20) NOT NULL DEFAULT 'EFECTIVO'
                        CHECK (metodo_pago IN ('EFECTIVO', 'DEUNA', 'TRANSFERENCIA')),
    fecha           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    observaciones   TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 18. notas — Tablón de notas compartido visible por todos los empleados
CREATE TABLE IF NOT EXISTS notas (
    id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    texto          TEXT        NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 500),
    completada     BOOLEAN     NOT NULL DEFAULT false,
    creada_por     INTEGER     REFERENCES usuarios(id) ON DELETE SET NULL,
    completada_por INTEGER     REFERENCES usuarios(id) ON DELETE SET NULL,
    completada_at  TIMESTAMP WITH TIME ZONE,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- ÍNDICES (todos con IF NOT EXISTS → re-ejecutable sin errores)
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_recargas_fecha                ON recargas(fecha);
CREATE INDEX IF NOT EXISTS idx_recargas_turno                ON recargas(turno_id);
CREATE INDEX IF NOT EXISTS idx_recargas_tipo_servicio        ON recargas(tipo_servicio_id);
CREATE INDEX IF NOT EXISTS idx_recargas_empleado             ON recargas(empleado_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_turnos_caja_fecha_turno ON turnos_caja ((CAST(hora_fecha_apertura AT TIME ZONE 'America/Guayaquil' AS date)), numero_turno);
CREATE INDEX IF NOT EXISTS idx_turnos_caja_empleado          ON turnos_caja(empleado_id);
CREATE INDEX IF NOT EXISTS idx_deudas_empleado               ON deudas_empleados(empleado_id);  -- listado/suma por empleado
CREATE INDEX IF NOT EXISTS idx_deudas_estado                 ON deudas_empleados(estado);       -- filtro PENDIENTE / SALDADA
CREATE INDEX IF NOT EXISTS idx_deudas_turno                  ON deudas_empleados(turno_id);     -- lookup por turno
CREATE INDEX IF NOT EXISTS idx_operaciones_cajas_fecha       ON operaciones_cajas(fecha);
CREATE INDEX IF NOT EXISTS idx_operaciones_cajas_caja        ON operaciones_cajas(caja_id);
CREATE INDEX IF NOT EXISTS idx_operaciones_cajas_empleado    ON operaciones_cajas(empleado_id);
CREATE INDEX IF NOT EXISTS idx_operaciones_cajas_categoria   ON operaciones_cajas(categoria_id);
CREATE INDEX IF NOT EXISTS idx_recargas_virtuales_fecha      ON recargas_virtuales(fecha);
CREATE INDEX IF NOT EXISTS idx_recargas_virtuales_servicio   ON recargas_virtuales(tipo_servicio_id);
CREATE INDEX IF NOT EXISTS idx_recargas_virtuales_pagado     ON recargas_virtuales(pagado);
CREATE INDEX IF NOT EXISTS idx_productos_codigo_barras       ON productos(codigo_barras);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha                  ON ventas(fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_turno_id               ON ventas(turno_id);
CREATE INDEX IF NOT EXISTS idx_ventas_cliente_id             ON ventas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ventas_detalles_venta_id      ON ventas_detalles(venta_id);
CREATE INDEX IF NOT EXISTS idx_ventas_detalles_producto_id   ON ventas_detalles(producto_id);
CREATE INDEX IF NOT EXISTS idx_kardex_inventario_producto_id ON kardex_inventario(producto_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_cobrar_venta          ON cuentas_cobrar(venta_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_cobrar_fecha          ON cuentas_cobrar(fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_estado_pago            ON ventas(estado_pago);
CREATE INDEX IF NOT EXISTS idx_ventas_metodo_pago            ON ventas(metodo_pago);
CREATE INDEX IF NOT EXISTS idx_notas_completada              ON notas(completada, created_at DESC);

-- ==========================================
-- TRIGGERS — AUTO-GENERACIÓN DE CÓDIGOS Y POS
-- ==========================================
-- Van aquí (después de CREATE TABLE, antes de INSERT) porque el DROP TABLE
-- CASCADE del inicio borra los triggers existentes junto con la tabla.

-- Nota v5: fn_set_codigo_categoria_gasto y trg_set_codigo_categoria_gasto eliminados
-- (tabla categorias_gastos eliminada en v5 — los gastos van como EGRESOS en CAJA_CHICA)

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

-- ── TRIGGERS POS E INVENTARIO ──

-- 0. Código de barras interno EAN-13 (prefijo 20) para productos sin código
--    Fuente: docs/inventario/sql/functions/fn_generar_codigo_interno.sql
--    Trigger: trg_generar_codigo_interno → BEFORE INSERT ON productos

-- A. Descontar Stock y grabar Kardex al vender
CREATE OR REPLACE FUNCTION fn_actualizar_stock_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_stock_actual DECIMAL(12,2);
BEGIN
    SELECT stock_actual INTO v_stock_actual FROM productos WHERE id = NEW.producto_id;
    
    UPDATE productos 
    SET stock_actual = stock_actual - NEW.cantidad
    WHERE id = NEW.producto_id;
    
    INSERT INTO kardex_inventario (producto_id, tipo_movimiento, cantidad, stock_anterior, stock_nuevo, referencia_id, observaciones)
    VALUES (NEW.producto_id, 'VENTA', NEW.cantidad, v_stock_actual, v_stock_actual - NEW.cantidad, NEW.venta_id, 'Descuento automático por Venta POS');
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_descontar_stock_venta
    AFTER INSERT ON ventas_detalles
    FOR EACH ROW
    EXECUTE FUNCTION fn_actualizar_stock_venta();

-- B. Actualizar Saldo del Cajón Diario CAJA_CHICA (Ingreso Automático del Efectivo por Venta POS)
-- v5: Las ventas EFECTIVO van a CAJA_CHICA (cajón diario), no a CAJA (bóveda).
--     Al cierre, fn_ejecutar_cierre_diario distribuye CAJA_CHICA → VARIOS + CAJA.
CREATE OR REPLACE FUNCTION fn_actualizar_saldo_caja_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_caja_id            INTEGER;
    v_categoria_id       INTEGER;
    v_tipo_referencia_id INTEGER;
    v_saldo_actual_caja  DECIMAL(12,2);
BEGIN
    IF NEW.metodo_pago = 'EFECTIVO' AND NEW.estado = 'COMPLETADA' THEN
        -- v5: ingreso va a CAJA_CHICA (cajón diario), no a CAJA (bóveda)
        SELECT id INTO v_caja_id FROM cajas WHERE codigo = 'CAJA_CHICA';
        SELECT id INTO v_categoria_id FROM categorias_operaciones WHERE tipo = 'INGRESO' AND nombre ILIKE '%Ventas%' LIMIT 1;
        SELECT id INTO v_tipo_referencia_id FROM tipos_referencia WHERE tabla = 'ventas' LIMIT 1;

        IF v_caja_id IS NOT NULL AND v_categoria_id IS NOT NULL THEN
            SELECT saldo_actual INTO v_saldo_actual_caja FROM cajas WHERE id = v_caja_id;

            INSERT INTO operaciones_cajas (
                caja_id, empleado_id, tipo_operacion, monto, saldo_anterior, saldo_actual,
                categoria_id, tipo_referencia_id, referencia_id, descripcion
            ) VALUES (
                v_caja_id, NEW.empleado_id, 'INGRESO', NEW.total,
                v_saldo_actual_caja, v_saldo_actual_caja + NEW.total,
                v_categoria_id, v_tipo_referencia_id, NEW.id, 'Venta POS Efectivo'
            );

            UPDATE cajas
               SET saldo_actual = saldo_actual + NEW.total
             WHERE id = v_caja_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_actualizar_caja_por_venta
    AFTER INSERT ON ventas
    FOR EACH ROW
    EXECUTE FUNCTION fn_actualizar_saldo_caja_venta();

-- ==========================================
-- DATOS INICIALES
-- ==========================================

INSERT INTO tipos_servicio (codigo, nombre, porcentaje_comision, periodo_comision) VALUES
('BUS',     'Recargas Bus',     1.00, 'MENSUAL'),
('CELULAR', 'Recargas Celular', 5.00, 'SEMANAL');

INSERT INTO cajas (codigo, nombre, descripcion, saldo_actual) VALUES
('CAJA',         'Tienda',     'Bóveda principal — recibe el depósito del cajón en cada cierre',              0.00),
('CAJA_CHICA',   'Caja Chica', 'Cajón físico diario — ventas efectivo y egresos del día. Se resetea a $0 en cada cierre.', 0.00),
('VARIOS',       'Varios',     'Fondo de emergencia — recibe $20 diarios de transferencia en cada cierre',    0.00),
('CAJA_CELULAR', 'Celular',    'Saldo digital de recargas celular',                                           0.00),
('CAJA_BUS',     'Bus',        'Saldo digital de recargas bus',                                               0.00);

INSERT INTO tipos_referencia (tabla, descripcion) VALUES
('recargas',           'Operaciones originadas desde recargas diarias'),
('turnos_caja',        'Operaciones originadas desde el cierre de turno (depósito, transferencia a Varios)'),
('recargas_virtuales', 'Pagos al proveedor celular y compras de saldo bus'),
('ventas',             'Operaciones originadas desde ventas POS');

-- Agregar Consumidor Final Básico
INSERT INTO clientes (identificacion, nombre, es_consumidor_final) 
VALUES ('9999999999999', 'CONSUMIDOR FINAL', TRUE);

-- Categorías de Productos Iniciales (Semilla)
INSERT INTO categorias_productos (nombre) VALUES
('Bebidas'),
('Snacks'),
('Abarrotes'),
('Lácteos'),
('Limpieza'),
('Aseo Personal'),
('Panadería')
ON CONFLICT (nombre) DO NOTHING;

-- codigo se omite: el trigger fn_set_codigo_categoria_operacion() lo genera automáticamente
-- EGRESO → EG-001, EG-002... / INGRESO → IN-001, IN-002...
-- seleccionable = FALSE → creada por funciones SQL, no aparece en dropdowns del usuario
INSERT INTO categorias_operaciones (tipo, nombre, descripcion, seleccionable) VALUES
-- EGRESOS (EG-001 a EG-013)
('EGRESO',  'Compras/Mercadería',               'Compra de productos para reventa o uso en el negocio',                              TRUE),
('EGRESO',  'Servicios Básicos',                'Pago de luz, agua, internet, teléfono',                                             TRUE),
('EGRESO',  'Alquiler',                         'Pago de alquiler del local',                                                        TRUE),
('EGRESO',  'Mantenimiento',                    'Reparaciones y mantenimiento del local o equipo',                                   TRUE),
('EGRESO',  'Transporte/Combustible',           'Gastos de transporte y combustible',                                                TRUE),
('EGRESO',  'Papelería/Suministros',            'Papelería, útiles de oficina y suministros generales',                              TRUE),
('EGRESO',  'Salarios',                         'Pago de salarios a empleados',                                                      TRUE),
('EGRESO',  'Impuestos/Tasas',                  'Pago de impuestos y tasas municipales',                                             TRUE),
('EGRESO',  'Otros Gastos',                     'Otros gastos operativos no clasificados',                                           TRUE),
('EGRESO',  'Pago Proveedor Recargas',          'Pago al proveedor de recargas celular (saldo prestado a crédito)',                  FALSE),
('EGRESO',  'Compra Saldo Virtual Bus',         'Compra de saldo virtual bus mediante depósito bancario',                            FALSE),
('EGRESO',  'Ajuste Déficit Turno Anterior',    'Retiro de Tienda para reponer déficit del turno anterior',                         FALSE),
('EGRESO',  'Ajuste Diferencia Conteo',         'Ajuste al cierre cuando el conteo físico es menor al saldo digital del cajón',     FALSE),
-- INGRESOS (IN-001 a IN-005)
('INGRESO', 'Ventas',                           'Ingresos por ventas del negocio',                                                   TRUE),
('INGRESO', 'Devoluciones de Proveedores',      'Devolución de dinero por parte de proveedores',                                     TRUE),
('INGRESO', 'Otros Ingresos',                   'Otros ingresos no clasificados',                                                    TRUE),
('INGRESO', 'Reposición Déficit Turno Anterior','Ingreso a Varios por reposición del déficit pendiente del turno anterior',          FALSE),
('INGRESO', 'Ajuste Diferencia Conteo',         'Ajuste al cierre cuando el conteo físico supera al saldo digital del cajón',       FALSE);

INSERT INTO configuraciones (clave, valor) VALUES
('negocio_nombre',                'Panaderia Don Viche'),
('caja_fondo_fijo_diario',        '20.00'),
('caja_varios_transferencia_dia', '20.00'),
('bus_alerta_saldo_bajo',         '75.00'),
('bus_dias_antes_facturacion',    '3'),
('pos_descuentos_habilitados',    'false'),
('pos_descuento_maximo_pct',      '10'),
('pos_umbral_monto_descuento',    '50.00');

INSERT INTO usuarios (nombre, usuario, rol) VALUES
('Ivan Sanchez', 'ivansan2192@gmail.com', 'ADMIN');

-- ==========================================
-- DATOS DE PRUEBA ADICIONALES
-- ==========================================

-- Insertar 3 productos de prueba (Asumiendo IDs 1 a 6 que se generan secuencialmente arriba)
-- 1 = Bebidas, 2 = Snacks, 4 = Lácteos
INSERT INTO productos (categoria_id, codigo_barras, nombre, precio_costo, precio_venta, stock_actual, stock_minimo, tiene_iva) VALUES
(1, '786123456001', 'Coca-Cola 1L', 0.80, 1.25, 24, 5, TRUE),
(2, '786123456002', 'Ruffles Natural 50g', 0.35, 0.50, 50, 10, TRUE),
(4, '786123456003', 'Yogur Toni Fresa 200ml', 0.40, 0.60, 15, 5, FALSE);

-- ==========================================
-- RESUMEN (v5.0)
-- ==========================================
-- ✅ 18 Tablas | 2 Enums | 27 Índices
-- ✅ 2 Tipos de servicio (BUS, CELULAR)
-- ✅ 4 Tipos de referencia (eliminado caja_fisica_diaria)
-- ✅ 18 Categorías de operaciones (13 egresos + 5 ingresos)
--    → EG-013 y IN-005: Ajuste Diferencia Conteo (seleccionable=FALSE)
-- ✅ 5 Cajas inicializadas en $0.00
--    → CAJA (bóveda), CAJA_CHICA (cajón diario), VARIOS (fondo emergencia), CAJA_CELULAR, CAJA_BUS
-- ✅ Configuración: fondo=$20 | varios=$20 | alerta_bus=$75 | dias_fact=3
-- ✅ Admin inicial: Ivan Sanchez
-- ✅ 3 Productos de prueba
-- ❌ Tablas eliminadas en v5: caja_fisica_diaria, gastos_diarios, categorias_gastos
--
-- ⚠️  FUNCIONES POSTGRESQL (archivos separados, ejecutar después del schema):
--   Dashboard:
--   • fn_abrir_turno                            → docs/dashboard/sql/functions/fn_abrir_turno.sql
--   • fn_ejecutar_cierre_diario v5             → docs/dashboard/sql/functions/fn_ejecutar_cierre_diario_v5.sql
--   • fn_reparar_deficit_turno                 → docs/dashboard/sql/functions/fn_reparar_deficit_turno.sql
--   • fn_verificar_transferencia_caja_chica_hoy → docs/dashboard/sql/functions/fn_verificar_transferencia_caja_chica_hoy.sql
--   • fn_registrar_operacion_manual            → docs/dashboard/sql/functions/fn_registrar_operacion_manual.sql
--   • fn_crear_transferencia                   → docs/dashboard/sql/functions/fn_crear_transferencia.sql
--   Recargas Virtuales:
--   • fn_registrar_recarga_proveedor_celular   → docs/recargas-virtuales/sql/functions/
--   • fn_registrar_pago_proveedor_celular      → docs/recargas-virtuales/sql/functions/
--   • fn_registrar_compra_saldo_bus            → docs/recargas-virtuales/sql/functions/
--   • fn_liquidar_ganancias_bus                → docs/recargas-virtuales/sql/functions/
--   POS:
--   • fn_registrar_venta_pos                   → docs/pos/sql/functions/fn_registrar_venta_pos.sql
--   Cuentas por Cobrar:
--   • fn_registrar_pago_fiado                  → docs/cuentas-cobrar/sql/functions/fn_registrar_pago_fiado.sql
--   • fn_listar_cuentas_cobrar                 → docs/cuentas-cobrar/sql/functions/fn_listar_cuentas_cobrar.sql
--   • fn_resumir_cuentas_cobrar                → docs/cuentas-cobrar/sql/functions/fn_resumir_cuentas_cobrar.sql
--   Inventario:
--   • fn_ajustar_stock_inventario              → docs/inventario/sql/functions/fn_ajustar_stock_inventario.sql
--   • fn_generar_codigo_interno                → docs/inventario/sql/functions/fn_generar_codigo_interno.sql
--   Ventas (historial):
--   • fn_listar_ventas                         → docs/ventas/sql/functions/fn_listar_ventas.sql
--   • fn_resumir_ventas                        → docs/ventas/sql/functions/fn_resumir_ventas.sql
--   POS — Anulación:
--   • fn_anular_venta                          → docs/pos/sql/functions/fn_anular_venta.sql
--   Ventas — Reporte período:
--   • fn_reporte_ventas_periodo                → docs/ventas/sql/functions/fn_reporte_ventas_periodo.sql
--
-- ✅ 19 Tablas | 24 Funciones SQL
-- (6 dashboard + 4 recargas + 2 POS + 3 cuentas-cobrar + 2 inventario + 3 ventas + 4 triggers/helpers)
--
-- ⚠️  MIGRACIÓN desde v4.9: ejecutar v5_migracion_cajas.sql (NO este schema completo)
--   → docs/dashboard/sql/migrations/v5_migracion_cajas.sql
-- ==========================================

-- Refresca el schema cache de PostgREST para que reconozca los cambios DDL
NOTIFY pgrst, 'reload schema';
