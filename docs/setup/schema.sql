-- ==========================================
-- SCHEMA - MI TIENDA v11.0 (Multi-Tenant)
-- Sistema de Gestión de Cajas, Ventas POS, Recargas y Nómina
-- ==========================================
-- ⚠️  REESCRITURA COMPLETA: borra y recrea todas las tablas.
-- ⚠️  Ejecutar SOLO en entorno de desarrollo. No hay datos en produccion.
-- ⚠️  Para actualizar funciones PostgreSQL usar archivos en docs/*/sql/functions/
-- ⚠️  Orden de ejecucion posterior al schema (ver 01_teardown.sql para lista completa):
--     1. docs/setup/02_rls.sql
--     2. docs/setup/03_functions.sql               (fn_set_negocio_activo, fn_registrar_usuario_negocio)
--     3. docs/setup/fn_assert_no_superadmin.sql
--     4. docs/auth/sql/setup/trigger_proteger_superadmin.sql
--     5. docs/auth/sql/setup/trigger_proteger_propietario.sql
--     6. docs/onboarding/sql/functions/fn_completar_onboarding.sql
--     7. docs/onboarding/sql/functions/fn_configurar_modulos.sql
--     8. docs/admin/sql/functions/fn_configurar_modulos_admin.sql
--     9. docs/*/sql/functions/*.sql                (resto de funciones de modulos)
--    10. docs/*/sql/setup/realtime_*.sql
-- ==========================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- LIMPIEZA COMPLETA (orden: mas dependiente -> menos)
-- ==========================================

-- Funciones helper JWT
-- NO se dropean — son propiedad de Supabase (permission denied).
-- Las funciones auth.* se sobreescriben con CREATE OR REPLACE mas abajo.

-- Funciones de trigger inline (recreadas mas abajo)
DROP FUNCTION IF EXISTS fn_set_codigo_categoria_operacion() CASCADE;
DROP FUNCTION IF EXISTS fn_actualizar_stock_venta() CASCADE;
DROP FUNCTION IF EXISTS fn_actualizar_saldo_caja_venta() CASCADE;
DROP FUNCTION IF EXISTS fn_limpiar_herencia_template() CASCADE;
DROP FUNCTION IF EXISTS fn_sync_codigo_barras() CASCADE;
DROP FUNCTION IF EXISTS fn_sync_superadmin_to_jwt() CASCADE;
DROP FUNCTION IF EXISTS fn_sync_rol_to_jwt() CASCADE;
DROP FUNCTION IF EXISTS fn_proteger_movimiento_empleado() CASCADE;
DROP FUNCTION IF EXISTS fn_bloquear_delete_movimiento() CASCADE;
DROP FUNCTION IF EXISTS fn_proteger_operacion_caja() CASCADE;
DROP FUNCTION IF EXISTS fn_set_updated_at() CASCADE;

-- Vistas (recreadas mas abajo)
DROP VIEW IF EXISTS v_saldos_empleados CASCADE;
DROP VIEW IF EXISTS v_productos_completos CASCADE;

-- Tablas (orden: mas dependiente -> menos)
DROP TABLE IF EXISTS notas CASCADE;
DROP TABLE IF EXISTS cuentas_cobrar CASCADE;
DROP TABLE IF EXISTS ventas_detalles CASCADE;
DROP TABLE IF EXISTS kardex_inventario CASCADE;
DROP TABLE IF EXISTS ventas CASCADE;
DROP TABLE IF EXISTS secuencias_comprobantes CASCADE;
DROP TABLE IF EXISTS codigos_barras CASCADE;
DROP TABLE IF EXISTS producto_presentaciones CASCADE;
DROP TABLE IF EXISTS producto_atributos CASCADE;
DROP TABLE IF EXISTS productos CASCADE;
DROP TABLE IF EXISTS template_atributo_opciones CASCADE;
DROP TABLE IF EXISTS template_atributos CASCADE;
DROP TABLE IF EXISTS producto_templates CASCADE;
DROP TABLE IF EXISTS atributo_opciones CASCADE;
DROP TABLE IF EXISTS atributos CASCADE;
DROP TABLE IF EXISTS categorias_productos CASCADE;
DROP TABLE IF EXISTS clientes CASCADE;
DROP TABLE IF EXISTS movimientos_empleados CASCADE;
DROP TABLE IF EXISTS operaciones_cajas CASCADE;
DROP TABLE IF EXISTS turnos_caja CASCADE;
DROP TABLE IF EXISTS recargas CASCADE;
DROP TABLE IF EXISTS recargas_virtuales CASCADE;
DROP TABLE IF EXISTS categorias_operaciones CASCADE;
DROP TABLE IF EXISTS cajas CASCADE;
DROP TABLE IF EXISTS configuraciones CASCADE;
DROP TABLE IF EXISTS usuario_negocios CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS negocios CASCADE;
DROP TABLE IF EXISTS tipos_referencia CASCADE;
DROP TABLE IF EXISTS tipos_servicio CASCADE;
-- vestigio — nunca tuvo CREATE TABLE pero aparecia en DROP del schema anterior
DROP TABLE IF EXISTS cierres_diarios CASCADE;

-- ==========================================
-- TIPOS ENUMERADOS (idempotentes)
-- ==========================================
DO $$ BEGIN
    CREATE TYPE tipo_operacion_caja_enum AS ENUM (
        'APERTURA', 'CIERRE', 'INGRESO', 'EGRESO',
        'AJUSTE', 'TRANSFERENCIA_ENTRANTE', 'TRANSFERENCIA_SALIENTE'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE rol_usuario_enum AS ENUM ('ADMIN', 'EMPLEADO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE tipo_comprobante_enum AS ENUM ('TICKET', 'NOTA_VENTA', 'FACTURA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE tipo_movimiento_empleado_enum AS ENUM (
        'SUELDO_BASE',    -- (+) Sueldo devengado del periodo
        'BONO_COMISION',  -- (+) Extras a favor del empleado
        'FALTANTE_CAJA',  -- (-) Faltante de conteo fisico al cierre
        'ADELANTO_SUELDO',-- (-) Anticipo/prestamo en efectivo
        'PAGO_NOMINA',    -- (-) Pago final del periodo (liquida todo)
        'AJUSTE_ABONO',   -- (+) Correccion manual a favor del empleado
        'AJUSTE_CARGO',   -- (-) Correccion manual en contra del empleado
        'SALDO_ARRASTRE'  -- (-) Deuda que supera el sueldo, se arrastra al siguiente periodo
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ==========================================
-- HELPERS JWT — extraen claims del token sin consultar tablas
-- ==========================================
-- Principio: NINGUNA RLS policy consulta tablas para autorizacion.
-- Todo viene del JWT via estos helpers. Son O(1), sin round-trip a BD.
--
-- NOTA Supabase: el schema auth es propiedad del sistema — no se puede
-- escribir en el. Las funciones viven en public y replican los helpers
-- que Supabase expone internamente (auth.jwt(), auth.uid(), etc.).

CREATE OR REPLACE FUNCTION public.get_negocio_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT (auth.jwt() -> 'app_metadata' ->> 'negocio_id')::UUID;
$$;

CREATE OR REPLACE FUNCTION public.get_es_superadmin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT COALESCE((auth.jwt() -> 'app_metadata' ->> 'es_superadmin')::BOOLEAN, FALSE);
$$;

-- Rol del usuario en el negocio activo (seteado por fn_set_negocio_activo)
CREATE OR REPLACE FUNCTION public.get_rol()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT auth.jwt() -> 'app_metadata' ->> 'rol';
$$;

CREATE OR REPLACE FUNCTION public.get_email()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT auth.jwt() ->> 'email';
$$;

-- Permisos: authenticated puede invocar los helpers (necesario para RLS)
-- NOTA: comparten_negocio se define MAS ABAJO, despues de las tablas, porque
-- LANGUAGE sql valida la existencia de las tablas en tiempo de creacion.
REVOKE EXECUTE ON FUNCTION public.get_negocio_id()         FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_es_superadmin()      FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_rol()                FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_email()              FROM anon;
GRANT EXECUTE ON FUNCTION public.get_negocio_id()          TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_es_superadmin()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_rol()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_email()               TO authenticated;

-- ==========================================
-- TABLAS GLOBALES DEL SISTEMA (Grupo C y D)
-- Sin negocio_id — compartidas por todos los tenants
-- ==========================================

-- 1. negocios — tenant root
-- propietario_usuario_id: dueño original del negocio. Se setea al crearlo y no se modifica.
--   Cuando se crea una sucursal, hereda el mismo propietario del negocio origen.
--   Solo el superadmin puede operar sobre un negocio sin ser su propietario.
-- Nota: la columna `activo` fue eliminada. La suspensión de acceso se gestiona únicamente
--   a través de usuarios.activo (suspensión del propietario/usuario, via fn_suspender_usuario).
CREATE TABLE IF NOT EXISTS negocios (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre                 VARCHAR(255) NOT NULL,
    slug                   VARCHAR(50)  NOT NULL UNIQUE,  -- identificador URL-safe ('panaderia-don-viche')
    propietario_usuario_id UUID NOT NULL,                 -- FK a usuarios(id), agregada al final via ALTER TABLE
    created_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. usuarios — perfil global (1 registro por email, sin negocio_id)
-- rol y activo en usuario_negocios son por negocio. activo aqui es suspension global del usuario.
-- activo = FALSE: el usuario no puede entrar a ningun negocio (suspension de plataforma).
-- Solo el superadmin puede cambiar este flag (via fn_suspender_usuario).
CREATE TABLE IF NOT EXISTS usuarios (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    nombre        VARCHAR(255) NOT NULL,
    email         VARCHAR(100) NOT NULL UNIQUE,  -- Email Google OAuth (antes 'usuario')
    es_superadmin BOOLEAN DEFAULT FALSE,          -- acceso global al sistema
    activo        BOOLEAN NOT NULL DEFAULT TRUE,  -- FALSE = suspendido globalmente por superadmin
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. usuario_negocios — membresia N:M usuario-negocio
-- El rol y activo son por negocio: un usuario puede ser ADMIN en uno y EMPLEADO en otro.
-- updated_at: se actualiza via trigger en cada cambio (activo, rol).
-- Usado para calcular días trabajados en el negocio al momento de transferencia:
--   días = DATE_PART('day', updated_at - created_at)
--   sueldo_proporcional = (sueldo_base / 30.0) * días
CREATE TABLE IF NOT EXISTS usuario_negocios (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    rol        rol_usuario_enum NOT NULL DEFAULT 'EMPLEADO',
    activo     BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (usuario_id, negocio_id)
);

-- 4. tipos_servicio — catalogo global (BUS, CELULAR). SERIAL: solo 2 filas, inmutable.
CREATE TABLE IF NOT EXISTS tipos_servicio (
    id                  SERIAL PRIMARY KEY,
    codigo              VARCHAR(50)  NOT NULL UNIQUE,  -- 'BUS' | 'CELULAR'
    nombre              VARCHAR(100) NOT NULL,
    porcentaje_comision DECIMAL(5,2) NOT NULL,
    periodo_comision    VARCHAR(20)  NOT NULL CHECK (periodo_comision IN ('MENSUAL', 'SEMANAL')),
    activo              BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. tipos_referencia — catalogo global de tablas origen para trazabilidad
CREATE TABLE IF NOT EXISTS tipos_referencia (
    id          SERIAL PRIMARY KEY,
    tabla       VARCHAR(100) NOT NULL UNIQUE,
    descripcion TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- TABLAS CON negocio_id (Grupo A — 21 tablas)
-- Todas: negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE
-- ==========================================

-- 6. cajas — UUID (antes SERIAL). 5 cajas por negocio.
-- CAJA | CAJA_CHICA | VARIOS | CAJA_CELULAR | CAJA_BUS
CREATE TABLE IF NOT EXISTS cajas (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id  UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    codigo      VARCHAR(50)   NOT NULL,
    nombre      VARCHAR(100)  NOT NULL,
    descripcion TEXT,
    saldo_actual DECIMAL(12,2) DEFAULT 0,
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    activo      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (negocio_id, codigo)
);

-- 7. configuraciones — PK compuesta (negocio_id, clave)
-- Prefijo por modulo: negocio_, caja_, bus_, pos_, nomina_
CREATE TABLE IF NOT EXISTS configuraciones (
    negocio_id UUID        NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    clave      VARCHAR(100) NOT NULL,
    valor      TEXT        NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (negocio_id, clave)
);

-- 8. categorias_operaciones — UUID (antes SERIAL). Por negocio.
-- seleccionable = FALSE → creada por sistema, no aparece en dropdowns del usuario
CREATE TABLE IF NOT EXISTS categorias_operaciones (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id   UUID        NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    tipo         VARCHAR(10)  NOT NULL CHECK (tipo IN ('INGRESO', 'EGRESO')),
    nombre       VARCHAR(100) NOT NULL,
    codigo       VARCHAR(20)  NOT NULL,   -- generado por trigger: 'EG-001', 'IN-001'
    descripcion  TEXT,
    activo       BOOLEAN DEFAULT TRUE,
    seleccionable BOOLEAN DEFAULT TRUE,
    created_at   TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (negocio_id, codigo)
);

-- 9. turnos_caja
CREATE TABLE IF NOT EXISTS turnos_caja (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id          UUID     NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    numero_turno        SMALLINT NOT NULL DEFAULT 1,
    empleado_id         UUID     NOT NULL REFERENCES usuarios(id),
    hora_fecha_apertura TIMESTAMP WITH TIME ZONE NOT NULL,
    hora_fecha_cierre   TIMESTAMP WITH TIME ZONE,
    fondo_cubierto      BOOLEAN NOT NULL DEFAULT TRUE
);

-- 10. recargas — control de saldo virtual por servicio y turno
CREATE TABLE IF NOT EXISTS recargas (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id             UUID    NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    fecha                  DATE    NOT NULL,
    turno_id               UUID    NOT NULL REFERENCES turnos_caja(id),
    tipo_servicio_id       INTEGER NOT NULL REFERENCES tipos_servicio(id),
    empleado_id            UUID    NOT NULL REFERENCES usuarios(id),
    venta_dia              DECIMAL(12,2) NOT NULL CHECK (venta_dia >= 0),
    saldo_virtual_anterior DECIMAL(12,2) NOT NULL,
    saldo_virtual_actual   DECIMAL(12,2) NOT NULL,
    saldo_caja             DECIMAL(12,2) NOT NULL DEFAULT 0,  -- saldo de CAJA_CELULAR o CAJA_BUS tras el cierre
    observaciones          TEXT,
    created_at             TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (turno_id, tipo_servicio_id)
);

-- 11. recargas_virtuales
CREATE TABLE IF NOT EXISTS recargas_virtuales (
    id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id                 UUID    NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    fecha                      DATE    NOT NULL,
    tipo_servicio_id           INTEGER NOT NULL REFERENCES tipos_servicio(id),
    empleado_id                UUID    NOT NULL REFERENCES usuarios(id),
    monto_virtual              DECIMAL(12,2) NOT NULL CHECK (monto_virtual >= 0),
    monto_a_pagar              DECIMAL(12,2) NOT NULL CHECK (monto_a_pagar >= 0),
    ganancia                   DECIMAL(12,2) NOT NULL DEFAULT 0,
    pagado_proveedor           BOOLEAN NOT NULL DEFAULT FALSE,         -- CELULAR: se pago al proveedor / BUS: se compro saldo
    fecha_pago_proveedor       DATE,
    operacion_pago_id          UUID,                                   -- FK a operaciones_cajas (definida despues con ALTER)
    ganancia_liquidada         BOOLEAN NOT NULL DEFAULT FALSE,         -- true = la ganancia ya se transfirio a otra caja (o se decidio dejarla)
    fecha_liquidacion_ganancia DATE,
    observaciones              TEXT,
    created_at                 TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recargas_virtuales_ganancia_pendiente
    ON public.recargas_virtuales (negocio_id, tipo_servicio_id)
    WHERE ganancia_liquidada = FALSE;

-- 12. operaciones_cajas — ledger de auditoria de movimientos en cajas
-- Inmutable: solo descripcion y comprobante_url son editables post-INSERT (ver trigger)
CREATE TABLE IF NOT EXISTS operaciones_cajas (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id         UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    fecha              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    caja_id            UUID NOT NULL REFERENCES cajas(id),
    empleado_id        UUID REFERENCES usuarios(id),
    tipo_operacion     tipo_operacion_caja_enum NOT NULL,
    monto              DECIMAL(12,2) NOT NULL CHECK (monto > 0),
    saldo_anterior     DECIMAL(12,2),
    saldo_actual       DECIMAL(12,2),
    categoria_id       UUID REFERENCES categorias_operaciones(id),
    tipo_referencia_id INTEGER REFERENCES tipos_referencia(id),
    referencia_id      UUID,
    descripcion        TEXT,
    comprobante_url    TEXT
);

-- FK circular: recargas_virtuales.operacion_pago_id -> operaciones_cajas
ALTER TABLE recargas_virtuales
    ADD CONSTRAINT fk_rv_operacion_pago
    FOREIGN KEY (operacion_pago_id) REFERENCES operaciones_cajas(id);

-- 13. movimientos_empleados — ledger de cuenta corriente por empleado
-- Inmutable: solo estado_liquidacion y liquidado_en son editables post-INSERT (ver trigger)
CREATE TABLE IF NOT EXISTS movimientos_empleados (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id         UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    empleado_id        UUID NOT NULL REFERENCES usuarios(id),
    fecha              TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    tipo_movimiento    tipo_movimiento_empleado_enum NOT NULL,
    monto              DECIMAL(12,2) NOT NULL CHECK (monto > 0),
    turno_id           UUID REFERENCES turnos_caja(id),
    descripcion        TEXT,
    estado_liquidacion VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
                           CHECK (estado_liquidacion IN ('PENDIENTE', 'LIQUIDADO')),
    liquidado_en       UUID REFERENCES movimientos_empleados(id),
    creado_por         UUID REFERENCES usuarios(id),
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 14. categorias_productos — UUID (antes SERIAL). Por negocio.
CREATE TABLE IF NOT EXISTS categorias_productos (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id UUID        NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    nombre     VARCHAR(100) NOT NULL,
    activo     BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (negocio_id, nombre)
);

-- 15. atributos — tipos de atributo dinamico (SABOR, COLOR, TAMANO, MARCA...)
-- Por negocio. Siempre MAYUSCULAS.
CREATE TABLE IF NOT EXISTS atributos (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id UUID        NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    nombre     VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT atributos_nombre_normalizado CHECK (nombre = UPPER(TRIM(nombre))),
    UNIQUE (negocio_id, nombre)
);

-- 16. atributo_opciones — valores posibles de cada atributo (FRESA, ROJO, XL...)
-- Siempre MAYUSCULAS.
CREATE TABLE IF NOT EXISTS atributo_opciones (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id  UUID        NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    atributo_id UUID        NOT NULL REFERENCES atributos(id) ON DELETE CASCADE,
    valor       VARCHAR(100) NOT NULL,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT atributo_opciones_valor_normalizado CHECK (valor = UPPER(TRIM(valor))),
    UNIQUE (atributo_id, valor)  -- ya scoped: atributo pertenece a un negocio
);

-- 17. producto_templates — producto base / identidad
-- Ej: "TAPIOCA" es el template; "Tapioca Fresa 500g" es un SKU (producto).
-- Productos simples (95% del inventario) NO necesitan template.
CREATE TABLE IF NOT EXISTS producto_templates (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id    UUID        NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    nombre        VARCHAR(150) NOT NULL,
    categoria_id  UUID        REFERENCES categorias_productos(id),
    tipo_venta    VARCHAR(10) DEFAULT 'UNIDAD' CHECK (tipo_venta IN ('UNIDAD', 'PESO')),
    unidad_medida VARCHAR(10) DEFAULT 'und',
    imagen_url    TEXT,
    activo        BOOLEAN DEFAULT TRUE,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 18. productos — SKU real (unidad de venta con stock y precio propio)
-- Si producto_template_id IS NOT NULL: variante de template.
--   → categoria_id, tipo_venta, unidad_medida heredados del template (deben ser NULL aqui).
--   → tiene_iva vive en este registro — fuente de verdad fiscal.
-- Si producto_template_id IS NULL: producto simple (campos propios).
-- stock_actual >= 0: safety net. El trigger de venta ya lo valida, pero el CHECK es la red final.
CREATE TABLE IF NOT EXISTS productos (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id           UUID        NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    producto_template_id UUID        REFERENCES producto_templates(id) ON DELETE CASCADE,
    categoria_id         UUID        REFERENCES categorias_productos(id),
    codigo_barras        VARCHAR(50),          -- sin UNIQUE propio: unicidad real en codigos_barras
    nombre               VARCHAR(150) NOT NULL,
    precio_costo         DECIMAL(12,2) NOT NULL DEFAULT 0,
    precio_venta         DECIMAL(12,2) NOT NULL,
    stock_actual         DECIMAL(12,2) DEFAULT 0 CONSTRAINT chk_stock_no_negativo CHECK (stock_actual >= 0),
    stock_minimo         INTEGER DEFAULT 5,
    tiene_iva            BOOLEAN DEFAULT TRUE,
    activo               BOOLEAN DEFAULT TRUE,
    imagen_url           TEXT,
    tipo_venta           VARCHAR(10) DEFAULT 'UNIDAD' CHECK (tipo_venta IN ('UNIDAD', 'PESO')),
    unidad_medida        VARCHAR(10) DEFAULT 'und',
    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- Herencia template: si es variante, campos heredados DEBEN ser NULL.
    -- El trigger fn_limpiar_herencia_template los limpia BEFORE INSERT/UPDATE.
    -- Este CHECK es la red de seguridad final.
    CONSTRAINT chk_herencia_template CHECK (
        (producto_template_id IS NULL)
        OR (producto_template_id IS NOT NULL
            AND categoria_id  IS NULL
            AND tipo_venta    IS NULL
            AND unidad_medida IS NULL)
    )
);

-- 19. template_atributos — tipos de atributo que define un template
CREATE TABLE IF NOT EXISTS template_atributos (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES producto_templates(id) ON DELETE CASCADE,
    atributo_id UUID NOT NULL REFERENCES atributos(id) ON DELETE CASCADE,
    UNIQUE (template_id, atributo_id)
);

-- 20. template_atributo_opciones — opciones seleccionadas por tipo en el template
CREATE TABLE IF NOT EXISTS template_atributo_opciones (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_atributo_id UUID NOT NULL REFERENCES template_atributos(id) ON DELETE CASCADE,
    atributo_opcion_id   UUID NOT NULL REFERENCES atributo_opciones(id) ON DELETE CASCADE,
    UNIQUE (template_atributo_id, atributo_opcion_id)
);

-- 21. producto_atributos — relacion SKU <-> opcion de atributo (Grupo B — pivot)
CREATE TABLE IF NOT EXISTS producto_atributos (
    producto_id        UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    atributo_opcion_id UUID NOT NULL REFERENCES atributo_opciones(id) ON DELETE CASCADE,
    PRIMARY KEY (producto_id, atributo_opcion_id)
);

-- 22. producto_presentaciones — formas de venta de un producto (cajetilla, pack, cubeta...)
-- Stock siempre en productos.stock_actual (unidad base).
-- codigo_barras sin UNIQUE propio: unicidad real en codigos_barras.
CREATE TABLE IF NOT EXISTS producto_presentaciones (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id        UUID        NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    producto_id       UUID        NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    nombre            VARCHAR(100) NOT NULL,
    factor_conversion INTEGER      NOT NULL CHECK (factor_conversion > 0),
    precio_venta      DECIMAL(12,2) NOT NULL,
    precio_costo      DECIMAL(12,2) NOT NULL,
    codigo_barras     VARCHAR(50),             -- sin UNIQUE propio: unicidad real en codigos_barras
    es_principal      BOOLEAN DEFAULT FALSE,
    activo            BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
-- Solo una presentacion principal por producto
CREATE UNIQUE INDEX IF NOT EXISTS uq_presentaciones_principal
    ON producto_presentaciones(producto_id) WHERE es_principal = TRUE;
-- Nombres normalizados unicos por producto
CREATE UNIQUE INDEX IF NOT EXISTS uq_presentaciones_nombre
    ON producto_presentaciones(producto_id, LOWER(TRIM(nombre)));

-- 22b. codigos_barras — registro central de unicidad cross-table
-- UNIQUE (negocio_id, codigo): garantia atomica de PostgreSQL, elimina race condition.
-- Los campos codigo_barras en productos/presentaciones son copias denormalizadas
-- sincronizadas por trigger. La fuente de verdad de unicidad es esta tabla.
-- El POS hace 1 query aqui en vez de 2 queries secuenciales.
CREATE TABLE IF NOT EXISTS codigos_barras (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id      UUID        NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    codigo          VARCHAR(50) NOT NULL,
    tipo            VARCHAR(20) NOT NULL CHECK (tipo IN ('PRODUCTO', 'PRESENTACION')),
    producto_id     UUID        NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    presentacion_id UUID        REFERENCES producto_presentaciones(id) ON DELETE CASCADE,
    activo          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_codigo_barras_negocio UNIQUE (negocio_id, codigo)
);

-- 23. clientes
CREATE TABLE IF NOT EXISTS clientes (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id          UUID        NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    identificacion      VARCHAR(20),
    nombre              VARCHAR(255) NOT NULL,
    telefono            VARCHAR(20),
    email               VARCHAR(100),
    es_consumidor_final BOOLEAN DEFAULT FALSE,
    updated_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at          TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (negocio_id, identificacion)
);

-- 24. secuencias_comprobantes — PK compuesta (negocio_id, tipo_documento)
-- fn_registrar_venta_pos usa UPDATE ... RETURNING para atomicidad.
CREATE TABLE IF NOT EXISTS secuencias_comprobantes (
    negocio_id     UUID        NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    tipo_documento VARCHAR(20) NOT NULL,
    ultimo_valor   INTEGER     NOT NULL DEFAULT 0,
    PRIMARY KEY (negocio_id, tipo_documento)
);

-- 25. ventas (cabecera maestra)
CREATE TABLE IF NOT EXISTS ventas (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id       UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    turno_id         UUID NOT NULL REFERENCES turnos_caja(id),
    cliente_id       UUID REFERENCES clientes(id),
    empleado_id      UUID NOT NULL REFERENCES usuarios(id),
    fecha            TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    subtotal         DECIMAL(12,2) NOT NULL CHECK (subtotal >= 0),
    descuento        DECIMAL(12,2) DEFAULT 0 CHECK (descuento >= 0),
    descuento_pct    SMALLINT DEFAULT 0 CHECK (descuento_pct >= 0 AND descuento_pct <= 100),
    total            DECIMAL(12,2) NOT NULL CHECK (total >= 0),
    metodo_pago      VARCHAR(20) DEFAULT 'EFECTIVO'
                         CHECK (metodo_pago IN ('EFECTIVO', 'DEUNA', 'TRANSFERENCIA', 'FIADO')),
    base_iva_0       DECIMAL(12,2) DEFAULT 0 CHECK (base_iva_0 >= 0),
    base_iva_15      DECIMAL(12,2) DEFAULT 0 CHECK (base_iva_15 >= 0),
    iva_valor        DECIMAL(12,2) DEFAULT 0 CHECK (iva_valor >= 0),
    tipo_comprobante     tipo_comprobante_enum DEFAULT 'TICKET',
    numero_comprobante   INTEGER,
    secuencial_sri       VARCHAR(17),
    clave_acceso_sri     VARCHAR(49),
    estado_sri           VARCHAR(20) CHECK (estado_sri IN ('PENDIENTE', 'AUTORIZADO', 'RECHAZADO', 'NO_ENVIADO')) DEFAULT 'NO_ENVIADO',
    estado           VARCHAR(20) DEFAULT 'COMPLETADA' CHECK (estado IN ('COMPLETADA', 'ANULADA')),
    estado_pago      VARCHAR(20) DEFAULT 'NO_APLICA'
                         CHECK (estado_pago IN ('NO_APLICA', 'PENDIENTE', 'PAGADO_PARCIAL', 'PAGADO')),
    observaciones    TEXT,
    idempotency_key  UUID UNIQUE
);

-- 26. ventas_detalles (Grupo B — pivot, hereda negocio via ventas)
CREATE TABLE IF NOT EXISTS ventas_detalles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venta_id        UUID NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
    producto_id     UUID NOT NULL REFERENCES productos(id),
    cantidad        DECIMAL(12,2) NOT NULL CHECK (cantidad > 0),
    precio_unitario DECIMAL(12,2) NOT NULL CHECK (precio_unitario >= 0),
    precio_costo    DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK (precio_costo >= 0),
    subtotal        DECIMAL(12,2) NOT NULL CHECK (subtotal >= 0),
    presentacion_id UUID REFERENCES producto_presentaciones(id)
);

-- 27. kardex_inventario
CREATE TABLE IF NOT EXISTS kardex_inventario (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id      UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    producto_id     UUID NOT NULL REFERENCES productos(id),
    fecha           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    tipo_movimiento VARCHAR(20) CHECK (tipo_movimiento IN ('VENTA', 'COMPRA', 'AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO', 'ANULACION_VENTA')),
    cantidad        DECIMAL(12,2) NOT NULL,
    stock_anterior  DECIMAL(12,2) NOT NULL,
    stock_nuevo     DECIMAL(12,2) NOT NULL,
    referencia_id   UUID,
    presentacion_id UUID REFERENCES producto_presentaciones(id) ON DELETE SET NULL,
    observaciones   TEXT
);

-- 28. cuentas_cobrar
CREATE TABLE IF NOT EXISTS cuentas_cobrar (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id  UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    venta_id    UUID NOT NULL REFERENCES ventas(id),
    empleado_id UUID NOT NULL REFERENCES usuarios(id),
    monto       DECIMAL(12,2) NOT NULL CHECK (monto > 0),
    metodo_pago VARCHAR(20) NOT NULL DEFAULT 'EFECTIVO'
                    CHECK (metodo_pago IN ('EFECTIVO', 'DEUNA', 'TRANSFERENCIA')),
    fecha       TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    observaciones TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 29. notas
CREATE TABLE IF NOT EXISTS notas (
    id             UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id     UUID    NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    texto          TEXT    NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 500),
    completada     BOOLEAN NOT NULL DEFAULT FALSE,
    creada_por     UUID    REFERENCES usuarios(id) ON DELETE SET NULL,
    completada_por UUID    REFERENCES usuarios(id) ON DELETE SET NULL,
    completada_at  TIMESTAMP WITH TIME ZONE,
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- HELPER DEPENDIENTE DE TABLAS
-- comparten_negocio se define aqui (despues de CREATE TABLE) porque
-- LANGUAGE sql valida la existencia de las tablas al momento de creacion.
-- ==========================================

-- Verifica si un usuario_id pertenece al mismo negocio que el usuario actual.
-- SECURITY DEFINER: bypassa RLS de usuario_negocios para evitar recursion en policies.
-- Solo retorna BOOLEAN — no expone datos de usuario_negocios.
-- IMPORTANTE: no filtra por activo en un1 — un empleado inactivo sigue perteneciendo
-- al negocio y el ADMIN debe poder verlo y gestionarlo. El filtro de activo es
-- responsabilidad de cada query, no de la política de visibilidad.
CREATE OR REPLACE FUNCTION public.comparten_negocio(p_usuario_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM usuario_negocios un1
        INNER JOIN usuario_negocios un2 ON un1.negocio_id = un2.negocio_id
        WHERE un1.usuario_id = p_usuario_id
          AND un2.usuario_id = (
              SELECT u.id FROM usuarios u WHERE u.email = public.get_email()
          )
          AND un2.activo = TRUE
    );
$$;

REVOKE EXECUTE ON FUNCTION public.comparten_negocio(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.comparten_negocio(UUID) TO authenticated;

-- ==========================================
-- INDICES
-- Estrategia: negocio_id SIEMPRE como primera columna en indices compuestos.
-- RLS inyecta WHERE negocio_id = public.get_negocio_id() en todas las queries.
-- ==========================================

-- Indices simples de negocio (habilitados para RLS)
CREATE INDEX IF NOT EXISTS idx_cajas_negocio                ON cajas(negocio_id);
CREATE INDEX IF NOT EXISTS idx_configuraciones_negocio      ON configuraciones(negocio_id);
CREATE INDEX IF NOT EXISTS idx_cat_operaciones_negocio      ON categorias_operaciones(negocio_id);
CREATE INDEX IF NOT EXISTS idx_turnos_negocio               ON turnos_caja(negocio_id);
CREATE INDEX IF NOT EXISTS idx_recargas_negocio             ON recargas(negocio_id);
CREATE INDEX IF NOT EXISTS idx_recargas_virt_negocio        ON recargas_virtuales(negocio_id);
CREATE INDEX IF NOT EXISTS idx_operaciones_negocio          ON operaciones_cajas(negocio_id);
CREATE INDEX IF NOT EXISTS idx_mov_empleados_negocio        ON movimientos_empleados(negocio_id);
CREATE INDEX IF NOT EXISTS idx_categorias_prod_negocio      ON categorias_productos(negocio_id);
CREATE INDEX IF NOT EXISTS idx_atributos_negocio            ON atributos(negocio_id);
CREATE INDEX IF NOT EXISTS idx_atrib_opciones_negocio       ON atributo_opciones(negocio_id);
CREATE INDEX IF NOT EXISTS idx_templates_negocio            ON producto_templates(negocio_id);
CREATE INDEX IF NOT EXISTS idx_productos_negocio            ON productos(negocio_id);
CREATE INDEX IF NOT EXISTS idx_presentaciones_negocio       ON producto_presentaciones(negocio_id);
CREATE INDEX IF NOT EXISTS idx_clientes_negocio             ON clientes(negocio_id);
CREATE INDEX IF NOT EXISTS idx_ventas_negocio               ON ventas(negocio_id);
CREATE INDEX IF NOT EXISTS idx_kardex_negocio               ON kardex_inventario(negocio_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_cobrar_negocio       ON cuentas_cobrar(negocio_id);
CREATE INDEX IF NOT EXISTS idx_secuencias_negocio           ON secuencias_comprobantes(negocio_id);
CREATE INDEX IF NOT EXISTS idx_notas_negocio                ON notas(negocio_id);

-- Indices compuestos por tenant (patrones de acceso frecuentes)
CREATE INDEX IF NOT EXISTS idx_turnos_negocio_empleado          ON turnos_caja(negocio_id, empleado_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_turnos_caja_fecha_turno
    ON turnos_caja(negocio_id, (CAST(hora_fecha_apertura AT TIME ZONE 'America/Guayaquil' AS date)), numero_turno);
CREATE INDEX IF NOT EXISTS idx_recargas_negocio_fecha           ON recargas(negocio_id, fecha);
CREATE INDEX IF NOT EXISTS idx_recargas_negocio_turno           ON recargas(negocio_id, turno_id);
CREATE INDEX IF NOT EXISTS idx_recargas_negocio_tipo_servicio   ON recargas(negocio_id, tipo_servicio_id);
CREATE INDEX IF NOT EXISTS idx_recargas_negocio_empleado        ON recargas(negocio_id, empleado_id);
CREATE INDEX IF NOT EXISTS idx_recargas_virt_negocio_pagado     ON recargas_virtuales(negocio_id, pagado_proveedor);
CREATE INDEX IF NOT EXISTS idx_recargas_virt_negocio_servicio   ON recargas_virtuales(negocio_id, tipo_servicio_id);
CREATE INDEX IF NOT EXISTS idx_operaciones_negocio_fecha        ON operaciones_cajas(negocio_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_operaciones_negocio_caja         ON operaciones_cajas(negocio_id, caja_id);
CREATE INDEX IF NOT EXISTS idx_operaciones_negocio_caja_f       ON operaciones_cajas(negocio_id, caja_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_operaciones_negocio_empl         ON operaciones_cajas(negocio_id, empleado_id);
CREATE INDEX IF NOT EXISTS idx_operaciones_negocio_categoria    ON operaciones_cajas(negocio_id, categoria_id);
CREATE INDEX IF NOT EXISTS idx_mov_empl_negocio_empl_est        ON movimientos_empleados(negocio_id, empleado_id, estado_liquidacion);
CREATE INDEX IF NOT EXISTS idx_mov_empl_negocio_fecha           ON movimientos_empleados(negocio_id, empleado_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_mov_empl_negocio_turno           ON movimientos_empleados(negocio_id, turno_id) WHERE turno_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_productos_negocio_activo         ON productos(negocio_id, activo);
CREATE INDEX IF NOT EXISTS idx_productos_negocio_template       ON productos(negocio_id, producto_template_id) WHERE producto_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_productos_negocio_categoria      ON productos(negocio_id, categoria_id);
CREATE INDEX IF NOT EXISTS idx_productos_negocio_nombre         ON productos(negocio_id, LOWER(nombre));
CREATE INDEX IF NOT EXISTS idx_productos_negocio_barcode_nn     ON productos(negocio_id, codigo_barras) WHERE codigo_barras IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_presentaciones_producto          ON producto_presentaciones(producto_id);
CREATE INDEX IF NOT EXISTS idx_presentaciones_producto_activo   ON producto_presentaciones(negocio_id, producto_id, activo);
CREATE INDEX IF NOT EXISTS idx_ventas_negocio_fecha_desc        ON ventas(negocio_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_ventas_negocio_turno             ON ventas(negocio_id, turno_id);
CREATE INDEX IF NOT EXISTS idx_ventas_negocio_estado            ON ventas(negocio_id, estado);
CREATE INDEX IF NOT EXISTS idx_ventas_negocio_metodo            ON ventas(negocio_id, metodo_pago);
CREATE INDEX IF NOT EXISTS idx_ventas_negocio_estado_pago       ON ventas(negocio_id, estado_pago);
CREATE INDEX IF NOT EXISTS idx_ventas_negocio_cliente           ON ventas(negocio_id, cliente_id);
CREATE INDEX IF NOT EXISTS idx_ventas_detalles_venta            ON ventas_detalles(venta_id);
CREATE INDEX IF NOT EXISTS idx_ventas_detalles_producto         ON ventas_detalles(producto_id);
CREATE INDEX IF NOT EXISTS idx_kardex_negocio_producto          ON kardex_inventario(negocio_id, producto_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_cobrar_venta             ON cuentas_cobrar(venta_id);
CREATE INDEX IF NOT EXISTS idx_cuentas_cobrar_negocio_fecha     ON cuentas_cobrar(negocio_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_notas_negocio_completada         ON notas(negocio_id, completada, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atributo_opciones_atributo       ON atributo_opciones(atributo_id);
CREATE INDEX IF NOT EXISTS idx_template_atributos_template      ON template_atributos(template_id);
CREATE INDEX IF NOT EXISTS idx_template_atrib_opciones_ta       ON template_atributo_opciones(template_atributo_id);

-- codigos_barras: index-only scan en POS (INCLUDE evita heap fetch)
CREATE INDEX IF NOT EXISTS idx_codigos_barras_negocio           ON codigos_barras(negocio_id);
CREATE INDEX IF NOT EXISTS idx_codigos_barras_lookup
    ON codigos_barras(negocio_id, codigo)
    INCLUDE (tipo, producto_id, presentacion_id);
CREATE INDEX IF NOT EXISTS idx_codigos_barras_producto          ON codigos_barras(producto_id);

-- usuario_negocios
CREATE INDEX IF NOT EXISTS idx_usuario_negocios_usuario         ON usuario_negocios(usuario_id);
CREATE INDEX IF NOT EXISTS idx_usuario_negocios_negocio         ON usuario_negocios(negocio_id);
CREATE INDEX IF NOT EXISTS idx_usuario_negocios_lookup          ON usuario_negocios(usuario_id, negocio_id, activo);

-- ==========================================
-- VISTAS
-- security_barrier=true: evita que PostgreSQL reordene predicados
-- y filtre datos de otro tenant antes de aplicar el WHERE del usuario.
-- ==========================================

CREATE OR REPLACE VIEW v_saldos_empleados WITH (security_barrier=true) AS
SELECT
    un.negocio_id,
    u.id   AS empleado_id,
    u.nombre,
    COALESCE(SUM(
        CASE
            WHEN m.tipo_movimiento IN ('SUELDO_BASE', 'BONO_COMISION', 'AJUSTE_ABONO')                                         THEN  m.monto
            WHEN m.tipo_movimiento IN ('FALTANTE_CAJA', 'ADELANTO_SUELDO', 'PAGO_NOMINA', 'AJUSTE_CARGO', 'SALDO_ARRASTRE') THEN -m.monto
        END
    ), 0) AS saldo
FROM usuario_negocios un
JOIN usuarios u ON u.id = un.usuario_id
LEFT JOIN movimientos_empleados m
    ON m.empleado_id = u.id
   AND m.negocio_id  = un.negocio_id
   AND m.estado_liquidacion = 'PENDIENTE'
WHERE un.negocio_id = public.get_negocio_id()
  AND un.activo = TRUE
GROUP BY un.negocio_id, u.id, u.nombre
ORDER BY u.nombre;
-- saldo > 0 → negocio le debe al empleado
-- saldo < 0 → empleado le debe al negocio
-- saldo = 0 → al dia
-- NOTA: get_negocio_id() filtra al negocio activo del JWT.
-- Empleados transferidos (activo=FALSE) no aparecen — sus movimientos
-- PENDIENTE siguen en este negocio y son visibles via query directa.

CREATE OR REPLACE VIEW v_productos_completos WITH (security_invoker=true, security_barrier=true) AS
SELECT
    p.id,
    p.negocio_id,
    p.producto_template_id,
    p.nombre,
    p.codigo_barras,
    p.precio_costo,
    p.precio_venta,
    p.stock_actual,
    p.stock_minimo,
    p.tiene_iva,
    p.activo,
    p.imagen_url,
    p.updated_at,
    p.created_at,
    -- Campos efectivos: template si es variante, propios si es simple
    COALESCE(t.categoria_id,  p.categoria_id)  AS categoria_id,
    COALESCE(t.tipo_venta,    p.tipo_venta)     AS tipo_venta,
    COALESCE(t.unidad_medida, p.unidad_medida)  AS unidad_medida,
    t.nombre AS template_nombre
FROM productos p
LEFT JOIN producto_templates t ON t.id = p.producto_template_id;

-- ==========================================
-- TRIGGERS
-- ==========================================

-- ── 1. updated_at generico ──
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_updated_at_cajas
    BEFORE UPDATE ON cajas FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_updated_at_configuraciones
    BEFORE UPDATE ON configuraciones FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_updated_at_productos
    BEFORE UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_updated_at_clientes
    BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();
CREATE TRIGGER trg_updated_at_usuario_negocios
    BEFORE UPDATE ON usuario_negocios FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ── 2. Herencia template: limpiar campos heredados BEFORE INSERT/UPDATE ──
-- Si el frontend envia categoria_id/tipo_venta/unidad_medida en una variante,
-- el trigger los limpia silenciosamente. El constraint chk_herencia_template
-- es la red de seguridad final.
CREATE OR REPLACE FUNCTION fn_limpiar_herencia_template()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.producto_template_id IS NOT NULL THEN
        NEW.categoria_id  := NULL;
        NEW.tipo_venta    := NULL;
        NEW.unidad_medida := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_limpiar_herencia_template
    BEFORE INSERT OR UPDATE ON productos
    FOR EACH ROW
    EXECUTE FUNCTION fn_limpiar_herencia_template();

-- ── 3. Codigos de barras: sincronizacion a tabla central ──
-- Fuente de verdad de unicidad: codigos_barras(negocio_id, codigo).
-- Los campos codigo_barras en productos/presentaciones son copias denormalizadas.
-- El UNIQUE constraint atomico de PostgreSQL elimina la race condition cross-table.
-- Guardia WHERE en ON CONFLICT: evita sobrescribir silenciosamente tipo PRODUCTO→PRESENTACION.
CREATE OR REPLACE FUNCTION fn_sync_codigo_barras()
RETURNS TRIGGER AS $$
DECLARE
    v_negocio_id  UUID;
    v_producto_id UUID;
    v_tipo        TEXT;
    v_pres_id     UUID := NULL;
BEGIN
    IF TG_TABLE_NAME = 'productos' THEN
        v_tipo        := 'PRODUCTO';
        v_negocio_id  := COALESCE(NEW.negocio_id, OLD.negocio_id);
        v_producto_id := COALESCE(NEW.id, OLD.id);
    ELSIF TG_TABLE_NAME = 'producto_presentaciones' THEN
        v_tipo        := 'PRESENTACION';
        v_producto_id := COALESCE(NEW.producto_id, OLD.producto_id);
        v_pres_id     := COALESCE(NEW.id, OLD.id);
        v_negocio_id  := (SELECT negocio_id FROM productos WHERE id = v_producto_id);
    END IF;

    -- DELETE: borrar el registro de codigos_barras
    IF TG_OP = 'DELETE' THEN
        IF OLD.codigo_barras IS NOT NULL THEN
            DELETE FROM codigos_barras
            WHERE negocio_id = v_negocio_id AND codigo = OLD.codigo_barras;
        END IF;
        RETURN OLD;
    END IF;

    -- INSERT o UPDATE: borrar codigo anterior si cambio
    IF TG_OP = 'UPDATE' AND OLD.codigo_barras IS NOT NULL
       AND (NEW.codigo_barras IS DISTINCT FROM OLD.codigo_barras) THEN
        DELETE FROM codigos_barras
        WHERE negocio_id = v_negocio_id AND codigo = OLD.codigo_barras;
    END IF;

    -- Insertar nuevo codigo (si existe)
    IF NEW.codigo_barras IS NOT NULL AND TRIM(NEW.codigo_barras) <> '' THEN
        BEGIN
            INSERT INTO codigos_barras (negocio_id, codigo, tipo, producto_id, presentacion_id)
            VALUES (v_negocio_id, NEW.codigo_barras, v_tipo, v_producto_id, v_pres_id)
            ON CONFLICT (negocio_id, codigo) DO UPDATE
            SET tipo            = EXCLUDED.tipo,
                producto_id     = EXCLUDED.producto_id,
                presentacion_id = EXCLUDED.presentacion_id
            -- Guardia: solo actualizar si es el mismo tipo o mismo producto.
            -- Evita que un INSERT concurrente cambie PRODUCTO→PRESENTACION silenciosamente.
            WHERE codigos_barras.tipo = EXCLUDED.tipo
               OR codigos_barras.producto_id = EXCLUDED.producto_id;
        EXCEPTION WHEN unique_violation THEN
            RAISE EXCEPTION 'El codigo de barras % ya existe en este negocio', NEW.codigo_barras;
        END;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_sync_barcode_productos
    AFTER INSERT OR UPDATE OF codigo_barras OR DELETE ON productos
    FOR EACH ROW EXECUTE FUNCTION fn_sync_codigo_barras();

CREATE TRIGGER trg_sync_barcode_presentaciones
    AFTER INSERT OR UPDATE OF codigo_barras OR DELETE ON producto_presentaciones
    FOR EACH ROW EXECUTE FUNCTION fn_sync_codigo_barras();

-- ── 4. Ledger: movimientos_empleados inmutable (whitelist) ──
-- Solo estado_liquidacion y liquidado_en son editables post-INSERT.
CREATE OR REPLACE FUNCTION fn_proteger_movimiento_empleado()
RETURNS TRIGGER AS $$
BEGIN
    IF ROW(NEW.id, NEW.negocio_id, NEW.empleado_id, NEW.fecha, NEW.tipo_movimiento,
           NEW.monto, NEW.turno_id, NEW.descripcion, NEW.creado_por, NEW.created_at)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.negocio_id, OLD.empleado_id, OLD.fecha, OLD.tipo_movimiento,
           OLD.monto, OLD.turno_id, OLD.descripcion, OLD.creado_por, OLD.created_at)
    THEN
        RAISE EXCEPTION 'Los movimientos de empleados son inmutables. Solo se permite cambiar estado_liquidacion y liquidado_en. Para corregir, crear un movimiento de ajuste.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_proteger_movimiento_empleado
    BEFORE UPDATE ON movimientos_empleados
    FOR EACH ROW EXECUTE FUNCTION fn_proteger_movimiento_empleado();

CREATE OR REPLACE FUNCTION fn_bloquear_delete_movimiento()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'No se pueden eliminar movimientos de empleados. Para corregir, crear un movimiento de ajuste.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_bloquear_delete_movimiento
    BEFORE DELETE ON movimientos_empleados
    FOR EACH ROW EXECUTE FUNCTION fn_bloquear_delete_movimiento();

-- ── 5. Ledger: operaciones_cajas inmutable (whitelist) ──
-- Solo descripcion y comprobante_url son editables post-INSERT.
CREATE OR REPLACE FUNCTION fn_proteger_operacion_caja()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'No se pueden eliminar operaciones de caja. Para corregir, registrar una operacion inversa.';
    END IF;
    -- Whitelist: solo descripcion y comprobante_url pueden cambiar
    IF ROW(NEW.id, NEW.negocio_id, NEW.fecha, NEW.caja_id, NEW.empleado_id,
           NEW.tipo_operacion, NEW.monto, NEW.saldo_anterior, NEW.saldo_actual,
           NEW.categoria_id, NEW.tipo_referencia_id, NEW.referencia_id)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.negocio_id, OLD.fecha, OLD.caja_id, OLD.empleado_id,
           OLD.tipo_operacion, OLD.monto, OLD.saldo_anterior, OLD.saldo_actual,
           OLD.categoria_id, OLD.tipo_referencia_id, OLD.referencia_id)
    THEN
        RAISE EXCEPTION 'Las operaciones de caja son inmutables. Solo se permite editar descripcion y comprobante_url. Para corregir montos, registrar una operacion inversa.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_proteger_operacion_caja
    BEFORE UPDATE ON operaciones_cajas
    FOR EACH ROW EXECUTE FUNCTION fn_proteger_operacion_caja();

CREATE TRIGGER trg_bloquear_delete_operacion_caja
    BEFORE DELETE ON operaciones_cajas
    FOR EACH ROW EXECUTE FUNCTION fn_proteger_operacion_caja();

-- ── 6. JWT sync: es_superadmin → app_metadata ──
CREATE OR REPLACE FUNCTION fn_sync_superadmin_to_jwt()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.es_superadmin IS DISTINCT FROM OLD.es_superadmin THEN
        UPDATE auth.users
        SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('es_superadmin', NEW.es_superadmin)
        WHERE email = NEW.email;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_sync_superadmin
    AFTER UPDATE OF es_superadmin ON usuarios
    FOR EACH ROW EXECUTE FUNCTION fn_sync_superadmin_to_jwt();

-- ── 7. JWT sync: rol → app_metadata (cuando ADMIN cambia rol de un empleado) ──
-- Solo sincroniza si el negocio modificado es el negocio activo del usuario.
CREATE OR REPLACE FUNCTION fn_sync_rol_to_jwt()
RETURNS TRIGGER AS $$
DECLARE
    v_email       TEXT;
    v_negocio_act UUID;
BEGIN
    IF NEW.rol IS DISTINCT FROM OLD.rol THEN
        v_email       := (SELECT email FROM usuarios WHERE id = NEW.usuario_id);
        v_negocio_act := (
            SELECT (raw_app_meta_data ->> 'negocio_id')::UUID
            FROM auth.users WHERE email = v_email
        );
        IF v_negocio_act = NEW.negocio_id THEN
            UPDATE auth.users
            SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('rol', NEW.rol::TEXT)
            WHERE email = v_email;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_sync_rol
    AFTER UPDATE OF rol ON usuario_negocios
    FOR EACH ROW EXECUTE FUNCTION fn_sync_rol_to_jwt();

-- ── 8. Codigos de categorias_operaciones: EG-001, IN-001... ──
-- pg_advisory_xact_lock: evita race condition en INSERTs concurrentes al mismo negocio.
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

    -- Lock de sesion por negocio: previene que dos INSERTs concurrentes lean el mismo MAX y asignen el mismo codigo
    PERFORM pg_advisory_xact_lock(hashtext(NEW.negocio_id::text || v_prefijo));

    v_numero := (
        SELECT COALESCE(
            MAX(
                CASE WHEN codigo ~ ('^' || v_prefijo || '-\d+$')
                    THEN CAST(SUBSTRING(codigo FROM 4) AS INTEGER)
                    ELSE 0
                END
            ), 0
        ) + 1
        FROM categorias_operaciones
        WHERE negocio_id = NEW.negocio_id
          AND codigo LIKE v_prefijo || '-%'
    );

    NEW.codigo := v_prefijo || '-' || LPAD(v_numero::TEXT, 3, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_set_codigo_categoria_operacion
    BEFORE INSERT ON categorias_operaciones
    FOR EACH ROW EXECUTE FUNCTION fn_set_codigo_categoria_operacion();

-- ── 9. Descontar stock y grabar kardex al vender ──
-- Soporta presentaciones: multiplica cantidad * factor_conversion.
-- FOR UPDATE: bloquea la fila para evitar race condition en ventas concurrentes.
CREATE OR REPLACE FUNCTION fn_actualizar_stock_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_negocio_id    UUID;
    v_factor        INTEGER;
    v_cantidad_real DECIMAL(12,2);
    v_stock_actual  DECIMAL(12,2);
BEGIN
    IF NEW.presentacion_id IS NOT NULL THEN
        v_factor := (SELECT factor_conversion FROM producto_presentaciones WHERE id = NEW.presentacion_id);
        IF v_factor IS NULL THEN
            RAISE EXCEPTION 'Presentacion no valida o no encontrada: %', NEW.presentacion_id;
        END IF;
    ELSE
        v_factor := 1;
    END IF;

    v_cantidad_real := NEW.cantidad * v_factor;

    PERFORM id FROM productos WHERE id = NEW.producto_id FOR UPDATE;
    v_negocio_id   := (SELECT negocio_id   FROM productos WHERE id = NEW.producto_id);
    v_stock_actual := (SELECT stock_actual  FROM productos WHERE id = NEW.producto_id);

    IF v_stock_actual < v_cantidad_real THEN
        RAISE EXCEPTION 'Stock insuficiente para producto %. Stock actual: %, requerido: %',
            NEW.producto_id, v_stock_actual, v_cantidad_real;
    END IF;

    UPDATE productos
    SET stock_actual = stock_actual - v_cantidad_real
    WHERE id = NEW.producto_id;

    INSERT INTO kardex_inventario (negocio_id, producto_id, tipo_movimiento, cantidad,
        stock_anterior, stock_nuevo, referencia_id, presentacion_id, observaciones)
    VALUES (v_negocio_id, NEW.producto_id, 'VENTA', v_cantidad_real,
        v_stock_actual, v_stock_actual - v_cantidad_real,
        NEW.venta_id, NEW.presentacion_id, 'Descuento automatico por Venta POS');

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_descontar_stock_venta
    AFTER INSERT ON ventas_detalles
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_stock_venta();

-- ── 10. Actualizar saldo de CAJA_CHICA al registrar venta en efectivo ──
-- v5: ventas EFECTIVO van a CAJA_CHICA (cajon diario).
-- Al cierre, fn_ejecutar_cierre_diario distribuye CAJA_CHICA → VARIOS + CAJA.
CREATE OR REPLACE FUNCTION fn_actualizar_saldo_caja_venta()
RETURNS TRIGGER AS $$
DECLARE
    v_negocio_id         UUID;
    v_caja_id            UUID;
    v_categoria_id       UUID;
    v_tipo_referencia_id INTEGER;
    v_saldo_actual_caja  DECIMAL(12,2);
BEGIN
    IF NEW.metodo_pago = 'EFECTIVO' AND NEW.estado = 'COMPLETADA' THEN
        v_negocio_id         := NEW.negocio_id;
        v_caja_id            := (SELECT id FROM cajas WHERE negocio_id = v_negocio_id AND codigo = 'CAJA_CHICA');
        v_categoria_id       := (SELECT id FROM categorias_operaciones WHERE negocio_id = v_negocio_id AND codigo = 'IN-001');
        v_tipo_referencia_id := (SELECT id FROM tipos_referencia WHERE tabla = 'ventas' LIMIT 1);

        IF v_caja_id IS NOT NULL AND v_categoria_id IS NOT NULL THEN
            v_saldo_actual_caja := (SELECT saldo_actual FROM cajas WHERE id = v_caja_id);

            INSERT INTO operaciones_cajas (
                negocio_id, caja_id, empleado_id, tipo_operacion, monto,
                saldo_anterior, saldo_actual, categoria_id,
                tipo_referencia_id, referencia_id, descripcion
            ) VALUES (
                v_negocio_id, v_caja_id, NEW.empleado_id, 'INGRESO', NEW.total,
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
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_saldo_caja_venta();

-- ==========================================
-- DATOS INICIALES GLOBALES
-- (datos por tenant se insertan via fn_completar_onboarding)
-- ==========================================

INSERT INTO tipos_servicio (codigo, nombre, porcentaje_comision, periodo_comision) VALUES
('BUS',     'Recargas Bus',     1.00, 'MENSUAL'),
('CELULAR', 'Recargas Celular', 5.00, 'SEMANAL')
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO tipos_referencia (tabla, descripcion) VALUES
('recargas',              'Operaciones originadas desde recargas diarias'),
('turnos_caja',           'Operaciones originadas desde el cierre de turno'),
('recargas_virtuales',    'Pagos al proveedor celular y compras de saldo bus'),
('ventas',                'Operaciones originadas desde ventas POS'),
('movimientos_empleados', 'Egresos de caja originados desde adelantos o pago de nomina')
ON CONFLICT (tabla) DO NOTHING;

-- ==========================================
-- TRIGGER: PROTEGER SUPERADMIN
-- Impide cambiar es_superadmin via UPDATE directo en la tabla usuarios.
-- ==========================================

CREATE OR REPLACE FUNCTION fn_proteger_superadmin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF OLD.es_superadmin = true THEN
        IF NEW.es_superadmin IS DISTINCT FROM OLD.es_superadmin THEN
            RAISE EXCEPTION 'No se puede modificar los permisos del administrador principal del sistema.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_superadmin_update ON usuarios;
CREATE TRIGGER trg_proteger_superadmin_update
    BEFORE UPDATE ON usuarios
    FOR EACH ROW EXECUTE FUNCTION fn_proteger_superadmin();

-- ==========================================
-- FUNCION DE SETUP: fn_set_negocio_activo
-- (fn_completar_onboarding vive en docs/onboarding/sql/functions/ — single source of truth para crear negocios)
-- ==========================================

-- fn_set_negocio_activo — Escribe negocio_id + rol en app_metadata del JWT.
-- El frontend llama supabase.auth.refreshSession() despues para aplicarlo.
-- Nota: ya no valida negocios.activo (columna eliminada). Solo valida:
--   - usuario no suspendido (usuarios.activo)
--   - negocio existe
--   - usuario tiene membresia activa (excepto superadmin)
CREATE OR REPLACE FUNCTION public.fn_set_negocio_activo(
    p_negocio_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email          TEXT;
    v_usuario_id     UUID;
    v_rol            TEXT;
    v_es_superadmin  BOOLEAN;
    v_negocio_nombre VARCHAR;
    v_activo         BOOLEAN;
BEGIN
    v_email := (auth.jwt() ->> 'email');
    IF v_email IS NULL THEN
        RAISE EXCEPTION 'No hay sesion activa. El JWT no contiene email.';
    END IF;

    v_usuario_id    := (SELECT id            FROM usuarios WHERE email = v_email);
    v_es_superadmin := (SELECT es_superadmin FROM usuarios WHERE email = v_email);

    IF v_usuario_id IS NULL THEN
        RAISE EXCEPTION 'Usuario % no encontrado en la tabla de usuarios.', v_email;
    END IF;

    -- Bloquear usuarios suspendidos globalmente (excepto superadmin)
    IF NOT COALESCE(v_es_superadmin, FALSE) THEN
        IF NOT COALESCE((SELECT activo FROM usuarios WHERE id = v_usuario_id), TRUE) THEN
            RAISE EXCEPTION 'El usuario % esta suspendido y no puede acceder a ningun negocio.', v_email;
        END IF;
    END IF;

    -- Verificar que el negocio existe (sin filtrar por activo — columna eliminada)
    v_negocio_nombre := (SELECT nombre FROM negocios WHERE id = p_negocio_id);
    IF v_negocio_nombre IS NULL THEN
        RAISE EXCEPTION 'El negocio % no existe.', p_negocio_id;
    END IF;

    IF NOT COALESCE(v_es_superadmin, FALSE) THEN
        v_rol    := (SELECT rol    FROM usuario_negocios WHERE usuario_id = v_usuario_id AND negocio_id = p_negocio_id);
        v_activo := (SELECT activo FROM usuario_negocios WHERE usuario_id = v_usuario_id AND negocio_id = p_negocio_id);
        IF v_rol IS NULL THEN
            RAISE EXCEPTION 'El usuario % no tiene membresia en el negocio %.', v_email, p_negocio_id;
        END IF;
        IF NOT v_activo THEN
            RAISE EXCEPTION 'La membresia del usuario % en el negocio % esta inactiva.', v_email, p_negocio_id;
        END IF;
    ELSE
        v_rol := COALESCE(
            (SELECT rol FROM usuario_negocios WHERE usuario_id = v_usuario_id AND negocio_id = p_negocio_id AND activo = TRUE),
            'ADMIN'
        );
    END IF;

    UPDATE auth.users
    SET raw_app_meta_data = raw_app_meta_data
        || jsonb_build_object(
            'negocio_id',    p_negocio_id::TEXT,
            'rol',           v_rol,
            'es_superadmin', COALESCE(v_es_superadmin, FALSE)
        )
    WHERE email = v_email;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No se pudo actualizar el JWT del usuario %.', v_email;
    END IF;

    RETURN json_build_object(
        'success',        TRUE,
        'negocio_id',     p_negocio_id,
        'rol',            v_rol,
        'negocio_nombre', v_negocio_nombre,
        'mensaje',        'Negocio activado. Llamar supabase.auth.refreshSession() para aplicar el nuevo JWT.'
    );

EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Error al activar negocio: % (SQLSTATE: %)', SQLERRM, SQLSTATE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_set_negocio_activo(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_set_negocio_activo(UUID) TO authenticated;

-- ==========================================
-- REALTIME — Publicaciones + REPLICA IDENTITY
-- DROP TABLE CASCADE en schema.sql elimina publicaciones existentes.
-- ==========================================

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'usuarios') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE usuarios;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'configuraciones') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE configuraciones;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'turnos_caja') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE turnos_caja;
    END IF;
END $$;

-- REPLICA IDENTITY FULL: los UPDATE de turnos_caja entregan la fila completa al cliente
ALTER TABLE turnos_caja REPLICA IDENTITY FULL;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'usuario_negocios') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE usuario_negocios;
    END IF;
END $$;

-- REPLICA IDENTITY FULL: necesario para que el filtro por usuario_id + negocio_id funcione
-- en eventos UPDATE. Sin esto el evento no incluye esas columnas y el canal no hace match.
ALTER TABLE usuario_negocios REPLICA IDENTITY FULL;

-- ==========================================
-- SEED DEV — Superadmin para desarrollo
-- ⚠️  Cambiar email/nombre/password antes de ejecutar en produccion.
-- ⚠️  En produccion: comentar o eliminar este bloque.
--
-- PROBLEMA CONOCIDO — usuario creado con email/password (no Google):
--   El script inserta en auth.users con provider 'email', pero la app solo
--   tiene login con Google. Supabase crea el registro incompleto y luego
--   el Magic Link y otros métodos fallan con "Database error finding user".
--
-- SOLUCIÓN si el superadmin no puede entrar (usuario corrupto en auth.users):
--   1. Ejecutar en SQL Editor:
--        DELETE FROM public.usuarios WHERE email = 'tu-email@gmail.com';
--        DELETE FROM auth.users      WHERE email = 'tu-email@gmail.com';
--   2. Iniciar sesión en la app con Google (ese mismo email).
--      Supabase crea el usuario limpio con provider Google.
--      ⚠️  La app redirige al onboarding porque el usuario no tiene negocio —
--          NO completar el onboarding. Cerrar la app o volver atrás.
--   3. Ejecutar en SQL Editor:
--        UPDATE public.usuarios SET es_superadmin = true WHERE email = 'tu-email@gmail.com';
--      El trigger trg_sync_superadmin sincroniza el flag al JWT automáticamente.
--   4. Volver a iniciar sesión con Google → entra directamente a /admin como superadmin.
-- ==========================================

DO $$
DECLARE
    v_superadmin_email  TEXT := 'ivansan2192@gmail.com';
    v_superadmin_nombre TEXT := 'Ivan Sanchez';
    v_superadmin_pass   TEXT := 'Dev1234!';
    v_auth_uid          UUID;
    v_usuario_id        UUID;
BEGIN
    v_auth_uid := (SELECT id FROM auth.users WHERE email = v_superadmin_email);

    IF v_auth_uid IS NULL THEN
        v_auth_uid := gen_random_uuid();
        INSERT INTO auth.users (
            id, instance_id, email, encrypted_password, email_confirmed_at,
            raw_app_meta_data, raw_user_meta_data, role, aud, created_at, updated_at
        ) VALUES (
            v_auth_uid,
            '00000000-0000-0000-0000-000000000000',
            v_superadmin_email,
            crypt(v_superadmin_pass, gen_salt('bf')),
            NOW(),
            jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::text[], 'es_superadmin', TRUE),
            jsonb_build_object('nombre', v_superadmin_nombre),
            'authenticated', 'authenticated', NOW(), NOW()
        );
        RAISE NOTICE 'auth.users creado: %', v_auth_uid;
    ELSE
        UPDATE auth.users
        SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('es_superadmin', TRUE)
        WHERE id = v_auth_uid;
        RAISE NOTICE 'auth.users actualizado (ya existia): %', v_auth_uid;
    END IF;

    v_usuario_id := (SELECT id FROM public.usuarios WHERE email = v_superadmin_email);
    IF v_usuario_id IS NULL THEN
        v_usuario_id := gen_random_uuid();
        INSERT INTO public.usuarios (id, nombre, email, es_superadmin)
        VALUES (v_usuario_id, v_superadmin_nombre, v_superadmin_email, TRUE);
        RAISE NOTICE 'public.usuarios creado: %', v_usuario_id;
    ELSE
        UPDATE public.usuarios SET es_superadmin = TRUE WHERE id = v_usuario_id;
        RAISE NOTICE 'public.usuarios actualizado (ya existia): %', v_usuario_id;
    END IF;

    RAISE NOTICE '=== SEED DEV COMPLETADO ===';
    RAISE NOTICE 'Superadmin email: %', v_superadmin_email;
    RAISE NOTICE 'Password: (no se imprime por seguridad — ver schema.sql si es la primera ejecucion)';
END $$;

NOTIFY pgrst, 'reload schema';

-- ==========================================
-- RESUMEN (v11.0 — Multi-Tenant)
-- ==========================================
-- INVENTARIO FINAL:
-- ✅ 29 Tablas (21 Grupo A + 4 Grupo B + 2 Grupo C + 1 Grupo D + 1 negocios)
-- ✅ 4 Enums
-- ✅ 4 Helpers JWT + comparten_negocio (todos en schema public)
-- ✅ 12 Triggers / funciones de trigger (incluye fn_proteger_superadmin)
-- ✅ 2 Vistas con security_barrier
-- ✅ ~55 Indices (simples + compuestos por tenant + parciales)
-- ✅ 2 Seeds globales (tipos_servicio, tipos_referencia)
-- ✅ fn_set_negocio_activo (setup de tenants — fn_completar_onboarding vive en docs/onboarding/)
-- ✅ Realtime: usuarios, configuraciones, turnos_caja
-- ✅ Seed dev: superadmin (⚠️  comentar en produccion)
--
-- ORDEN DE EJECUCION — ver 01_teardown.sql para la lista completa y ordenada.
-- FUNCIONES RPC — cada modulo tiene su archivo en docs/*/sql/functions/ (fuente de verdad).
--   Caja:        fn_abrir_turno, fn_ejecutar_cierre_diario_v5, fn_registrar_operacion_manual,
--                fn_crear_transferencia, fn_verificar_transferencia_caja_chica_hoy, fn_reparar_deficit_turno
--   Inventario:  fn_generar_codigo_interno, fn_generar_codigo_interno_presentacion,
--                fn_crear_producto_simple, fn_crear_producto_con_variantes, fn_ajustar_stock_inventario, fn_listar_productos
--   POS:         fn_registrar_venta_pos, fn_anular_venta
--   Recargas:    fn_registrar_recarga_proveedor_celular, fn_registrar_pago_proveedor_celular,
--                fn_registrar_compra_saldo_bus, fn_liquidar_ganancias, fn_liquidar_ganancias_bus
--   Clientes:    fn_registrar_pago_fiado, fn_listar_cuentas_cobrar, fn_resumir_cuentas_cobrar, fn_listar_clientes_con_saldo
--   Ventas:      fn_listar_ventas, fn_reporte_ventas_periodo, fn_resumir_ventas
--   Empleados:   fn_registrar_adelanto_sueldo, fn_pagar_nomina_empleado
--   Usuarios:    fn_actualizar_membresia, fn_transferir_empleado, fn_get_usuarios_asignables
--   Admin:       fn_consultar_usuario_por_email, fn_suspender_usuario, fn_suspender_negocio
--   Notas:       fn_eliminar_nota
-- ==========================================

-- ==========================================
-- FOREIGN KEYS DIFERIDAS
-- Se agregan al final porque negocios → usuarios y usuarios se crea despues de negocios.
-- ==========================================

ALTER TABLE negocios
    ADD CONSTRAINT negocios_propietario_fk
    FOREIGN KEY (propietario_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT;

NOTIFY pgrst, 'reload schema';
