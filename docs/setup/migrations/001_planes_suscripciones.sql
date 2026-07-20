-- =============================================================================
-- MIGRACION 001 — Planes y Suscripciones (Monetizacion del SaaS)
-- =============================================================================
-- INCREMENTAL e IDEMPOTENTE. Seguro para ejecutar en PRODUCCION con datos reales.
-- NO borra ni recrea ninguna tabla existente — tu negocio activo NO se toca.
-- Se puede re-ejecutar sin efectos secundarios (IF NOT EXISTS / ON CONFLICT / OR REPLACE).
--
-- Que hace:
--   1. Crea 4 tablas nuevas: planes, metodos_pago_suscripcion, config_plataforma, suscripciones
--   2. Siembra: plan Basico, metodos de pago, config singleton
--   3. Aplica RLS de las 4 tablas
--   4. Reemplaza fn_completar_onboarding (ahora crea suscripcion TRIAL al nacer un negocio)
--   5. Crea fn_estado_suscripcion, fn_registrar_pago_suscripcion, fn_suspender_suscripcion
--   6. MIGRACION DE DATOS: crea suscripcion para los negocios que YA existian (evita autobloqueo)
--
-- COMO USARLO:
--   - Ejecutar este archivo completo en el SQL Editor de Supabase.
--   - O ejecutar por bloques si prefieres ir verificando.
--
-- Ver docs/suscripcion/SUSCRIPCION-README.md para el detalle de diseño.
-- =============================================================================


-- =============================================================================
-- 1. TABLAS
-- =============================================================================

CREATE TABLE IF NOT EXISTS planes (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo        VARCHAR(50)   NOT NULL UNIQUE,
    nombre        VARCHAR(100)  NOT NULL,
    descripcion   TEXT,
    precio        DECIMAL(12,2) NOT NULL DEFAULT 0,
    periodo       VARCHAR(20)   NOT NULL DEFAULT 'MENSUAL' CHECK (periodo IN ('MENSUAL', 'ANUAL')),
    trial_dias    INT           NOT NULL DEFAULT 0,
    features      JSONB         NOT NULL DEFAULT '{}',
    activo        BOOLEAN       NOT NULL DEFAULT TRUE,
    orden         INT           NOT NULL DEFAULT 0,
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metodos_pago_suscripcion (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    codigo     VARCHAR(50)  NOT NULL UNIQUE,
    nombre     VARCHAR(100) NOT NULL,
    icono      VARCHAR(50)  NOT NULL DEFAULT 'cash-outline',
    activo     BOOLEAN      NOT NULL DEFAULT TRUE,
    orden      INT          NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS config_plataforma (
    id                 INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    whatsapp_cobro     VARCHAR(20),
    mensaje_suspension TEXT,
    cuentas_bancarias  JSONB NOT NULL DEFAULT '[]',
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suscripciones (
    id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    negocio_id     UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    plan_id        UUID NOT NULL REFERENCES planes(id),
    estado         VARCHAR(20) NOT NULL DEFAULT 'TRIAL'
                   CHECK (estado IN ('TRIAL', 'ACTIVA', 'SUSPENDIDA', 'CANCELADA')),
    inicia_el      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    vence_el       TIMESTAMP WITH TIME ZONE NOT NULL,
    monto_pagado   DECIMAL(12,2) DEFAULT 0,
    metodo_pago_id UUID REFERENCES metodos_pago_suscripcion(id),
    nota           TEXT,
    registrada_por UUID REFERENCES usuarios(id),
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suscripciones_negocio ON suscripciones(negocio_id, created_at DESC);


-- =============================================================================
-- 2. SEEDS
-- =============================================================================

INSERT INTO planes (codigo, nombre, descripcion, precio, periodo, trial_dias, features, orden) VALUES
('BASICO', 'Plan Basico', 'Acceso completo al sistema de gestion.', 5.00, 'MENSUAL', 15,
 '{"pos": true, "inventario": true, "recargas": true, "clientes": true, "reportes": true}', 1)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO metodos_pago_suscripcion (codigo, nombre, icono, orden) VALUES
('TRANSFERENCIA', 'Transferencia bancaria', 'swap-horizontal-outline', 1),
('DEPOSITO',      'Deposito bancario',      'cash-outline',            2),
('EFECTIVO',      'Efectivo',               'wallet-outline',          3)
ON CONFLICT (codigo) DO NOTHING;

-- NOTA: edita whatsapp_cobro y cuentas_bancarias con tus datos reales (o desde /admin luego).
INSERT INTO config_plataforma (id, whatsapp_cobro, mensaje_suspension, cuentas_bancarias)
VALUES (1, '', 'Tu acceso fue suspendido por falta de pago. Comunicate con nosotros por WhatsApp o realiza tu pago a las cuentas indicadas para reactivar tu cuenta.', '[]')
ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- 3. RLS
-- =============================================================================

ALTER TABLE planes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "planes_select" ON planes;
DROP POLICY IF EXISTS "planes_admin"  ON planes;
CREATE POLICY "planes_select" ON planes FOR SELECT TO authenticated USING (true);
CREATE POLICY "planes_admin"  ON planes FOR ALL TO authenticated
    USING (public.get_es_superadmin()) WITH CHECK (public.get_es_superadmin());

ALTER TABLE metodos_pago_suscripcion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "metodos_pago_select" ON metodos_pago_suscripcion;
DROP POLICY IF EXISTS "metodos_pago_admin"  ON metodos_pago_suscripcion;
CREATE POLICY "metodos_pago_select" ON metodos_pago_suscripcion FOR SELECT TO authenticated USING (true);
CREATE POLICY "metodos_pago_admin"  ON metodos_pago_suscripcion FOR ALL TO authenticated
    USING (public.get_es_superadmin()) WITH CHECK (public.get_es_superadmin());

ALTER TABLE config_plataforma ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "config_plataforma_select" ON config_plataforma;
DROP POLICY IF EXISTS "config_plataforma_admin"  ON config_plataforma;
CREATE POLICY "config_plataforma_select" ON config_plataforma FOR SELECT TO authenticated USING (true);
CREATE POLICY "config_plataforma_admin"  ON config_plataforma FOR ALL TO authenticated
    USING (public.get_es_superadmin()) WITH CHECK (public.get_es_superadmin());

ALTER TABLE suscripciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "suscripciones_select"   ON suscripciones;
DROP POLICY IF EXISTS "suscripciones_no_write" ON suscripciones;
CREATE POLICY "suscripciones_select" ON suscripciones FOR SELECT TO authenticated
USING (
    negocio_id = public.get_negocio_id()
    OR EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true)
);
-- Bloqueo TOTAL de escritura directa: las suscripciones solo se escriben via funciones
-- SECURITY DEFINER (que bypassan RLS). Evita que un ADMIN se auto-asigne una suscripcion.
CREATE POLICY "suscripciones_no_write" ON suscripciones AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (false);


-- =============================================================================
-- 4. FUNCIONES — ejecutar los archivos fuente (orden importa)
-- =============================================================================
-- Ejecuta el contenido de estos archivos a continuacion (o copialos aqui):
--   a) docs/onboarding/sql/functions/fn_completar_onboarding.sql   (REEMPLAZO — ahora crea TRIAL)
--   b) docs/suscripcion/sql/functions/fn_estado_suscripcion.sql
--   c) docs/suscripcion/sql/functions/fn_registrar_pago_suscripcion.sql
--   d) docs/suscripcion/sql/functions/fn_suspender_suscripcion.sql
--   e) docs/suscripcion/sql/functions/fn_listar_suscripciones_admin.sql
--
-- (Se mantienen en sus archivos como fuente de verdad. No se duplican aqui para
--  evitar divergencia: si editas la funcion, editas un solo lugar.)


-- =============================================================================
-- 5. MIGRACION DE DATOS — negocios existentes sin suscripcion
-- =============================================================================
-- CRITICO: sin esto, al activar el guard de suscripcion (frontend, fase posterior)
-- tu negocio actual quedaria sin suscripcion y se bloquearia.
-- A cada negocio existente sin suscripcion le creamos una ACTIVA con vencimiento
-- a 1 año (cortesia para los negocios previos al sistema de cobro). Ajusta el
-- intervalo o el estado si prefieres ponerlos en TRIAL.
DO $$
DECLARE
    v_plan_basico_id UUID := (SELECT id FROM planes WHERE codigo = 'BASICO');
    v_negocio        RECORD;
BEGIN
    IF v_plan_basico_id IS NULL THEN
        RAISE EXCEPTION 'No existe el plan BASICO — ejecuta los seeds (paso 2) primero';
    END IF;

    FOR v_negocio IN
        SELECT n.id
        FROM negocios n
        WHERE NOT EXISTS (SELECT 1 FROM suscripciones s WHERE s.negocio_id = n.id)
    LOOP
        INSERT INTO suscripciones (negocio_id, plan_id, estado, inicia_el, vence_el, nota)
        VALUES (
            v_negocio.id,
            v_plan_basico_id,
            'ACTIVA',
            NOW(),
            NOW() + INTERVAL '1 year',
            'Cortesia: negocio existente antes del sistema de suscripciones'
        );
        RAISE NOTICE 'Suscripcion creada para negocio %', v_negocio.id;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFICACION (opcional — ejecutar por separado)
-- =============================================================================
-- SELECT codigo, nombre, precio, trial_dias FROM planes;
-- SELECT codigo, nombre FROM metodos_pago_suscripcion;
-- SELECT n.nombre, s.estado, s.vence_el
--   FROM suscripciones s JOIN negocios n ON n.id = s.negocio_id
--   ORDER BY s.created_at DESC;
-- =============================================================================
