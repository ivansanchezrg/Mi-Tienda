-- =============================================================================
-- MIGRACION 005 — Suscripciones: modelo de 2 tablas (estado + historial de pagos)
-- =============================================================================
-- INCREMENTAL e IDEMPOTENTE. Seguro para re-ejecutar (IF NOT EXISTS / DROP IF EXISTS).
-- NO borra negocios. SI colapsa las filas historicas de `suscripciones` dejando solo
-- la mas reciente por negocio (requisito del nuevo UNIQUE) — esto es intencional: el
-- historial financiero pasa a vivir en la tabla nueva `suscripcion_pagos`.
--
-- Contexto del refactor: antes `suscripciones` mezclaba estado actual + historial
-- (una fila nueva por cada pago/suspension). Ahora se separan:
--   - `suscripciones`     → ESTADO ACTUAL (1 fila por negocio, negocio_id UNIQUE, se UPDATEa).
--   - `suscripcion_pagos` → HISTORIAL FINANCIERO inmutable (1 fila por pago, monto real).
-- Asi la suma de ingresos es SUM(monto) limpio, sin "filas de sincronizacion con monto 0".
--
-- Que hace:
--   1. suscripciones: colapsa a 1 fila por negocio; agrega actualizada_por + updated_at;
--      pone negocio_id UNIQUE; quita monto_pagado/metodo_pago_id/nota/registrada_por.
--   2. Crea la tabla suscripcion_pagos + indices.
--   3. RLS de suscripcion_pagos (select por tenant + RESTRICTIVE no_write).
--   4. REPLICA IDENTITY FULL en suscripciones (necesario para escuchar UPDATE en Realtime).
--
-- DESPUES de este archivo, re-ejecutar las funciones (ver seccion FUNCIONES abajo).
--
-- COMO USARLO: ejecutar completo en el SQL Editor de Supabase.
-- =============================================================================


-- =============================================================================
-- 1. suscripciones — estado mutable, 1 fila por negocio
-- =============================================================================

-- Una sola fila por negocio: antes de poner el UNIQUE, conservar la mas reciente
-- por negocio y borrar el resto (filas historicas del modelo viejo).
DELETE FROM suscripciones s
USING suscripciones s2
WHERE s.negocio_id = s2.negocio_id
  AND s.created_at < s2.created_at;

-- Columnas nuevas del modelo de estado.
ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS actualizada_por UUID REFERENCES usuarios(id);
ALTER TABLE suscripciones ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Constraint UNIQUE en negocio_id (ahora que ya hay 1 fila por negocio).
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'suscripciones_negocio_id_key'
    ) THEN
        ALTER TABLE suscripciones ADD CONSTRAINT suscripciones_negocio_id_key UNIQUE (negocio_id);
    END IF;
END $$;

-- Columnas del modelo viejo (el pago ahora vive en suscripcion_pagos).
ALTER TABLE suscripciones DROP COLUMN IF EXISTS monto_pagado;
ALTER TABLE suscripciones DROP COLUMN IF EXISTS metodo_pago_id;
ALTER TABLE suscripciones DROP COLUMN IF EXISTS nota;
ALTER TABLE suscripciones DROP COLUMN IF EXISTS registrada_por;

-- Indice: ya no hace falta ordenar por created_at (1 fila por negocio).
DROP INDEX IF EXISTS idx_suscripciones_negocio;
CREATE INDEX IF NOT EXISTS idx_suscripciones_negocio ON suscripciones(negocio_id);


-- =============================================================================
-- 2. suscripcion_pagos — historial financiero inmutable
-- =============================================================================
CREATE TABLE IF NOT EXISTS suscripcion_pagos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    propietario_id  UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,  -- dueño que pago
    negocio_id      UUID REFERENCES negocios(id) ON DELETE SET NULL,          -- negocio ancla (reportes)
    plan_id         UUID NOT NULL REFERENCES planes(id),
    periodo         VARCHAR(20) NOT NULL CHECK (periodo IN ('MENSUAL', 'ANUAL')),
    monto           DECIMAL(12,2) NOT NULL DEFAULT 0,         -- monto real cobrado en este pago
    metodo_pago_id  UUID REFERENCES metodos_pago_suscripcion(id),
    vence_el        TIMESTAMP WITH TIME ZONE NOT NULL,        -- vencimiento resultante de este pago
    nota            TEXT,                                     -- referencia / comprobante
    registrada_por  UUID REFERENCES usuarios(id),             -- superadmin que registro el pago
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suscripcion_pagos_propietario ON suscripcion_pagos(propietario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suscripcion_pagos_negocio     ON suscripcion_pagos(negocio_id, created_at DESC);


-- =============================================================================
-- 3. RLS de suscripcion_pagos
-- =============================================================================
ALTER TABLE suscripcion_pagos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "suscripcion_pagos_select" ON suscripcion_pagos;
CREATE POLICY "suscripcion_pagos_select" ON suscripcion_pagos FOR SELECT TO authenticated
USING (
    negocio_id = public.get_negocio_id()
    OR EXISTS (SELECT 1 FROM usuarios WHERE email = public.get_email() AND es_superadmin = true)
);

-- Bloqueo TOTAL de escritura directa: el historial solo lo escriben las funciones
-- SECURITY DEFINER (fn_registrar_pago_propietario). Nadie inserta pagos a mano.
DROP POLICY IF EXISTS "suscripcion_pagos_no_write" ON suscripcion_pagos;
CREATE POLICY "suscripcion_pagos_no_write" ON suscripcion_pagos AS RESTRICTIVE FOR ALL TO authenticated
    USING (true)
    WITH CHECK (false);


-- =============================================================================
-- 3b. config_plataforma — quitar mensaje_suspension (texto de bloqueo ahora es por estado)
-- =============================================================================
-- El mensaje unico de suspension quedo obsoleto: los textos de la pantalla de bloqueo
-- son contextuales (trial vencido / vencida / suspendida) y viven en el frontend.
ALTER TABLE config_plataforma DROP COLUMN IF EXISTS mensaje_suspension;


-- =============================================================================
-- 4. Realtime: REPLICA IDENTITY FULL (necesario para escuchar UPDATE)
-- =============================================================================
-- El servicio ahora escucha event '*' (INSERT + UPDATE). Sin FULL, el payload del
-- UPDATE no trae la fila completa y el handler no podria leer el nuevo `estado`.
ALTER TABLE suscripciones REPLICA IDENTITY FULL;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'suscripciones'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE suscripciones;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- 5. FUNCIONES — re-ejecutar (usan el nuevo modelo de 2 tablas)
-- =============================================================================
-- Ejecutar a continuacion el contenido actualizado de:
--   a) docs/onboarding/sql/functions/fn_completar_onboarding.sql
--   b) docs/suscripcion/sql/functions/fn_registrar_pago_propietario.sql
--   c) docs/suscripcion/sql/functions/fn_suspender_propietario_suscripcion.sql
--   d) docs/suscripcion/sql/functions/fn_estado_suscripcion.sql
--   e) docs/suscripcion/sql/functions/fn_listar_suscripciones_admin.sql
-- (Quedan como fuente de verdad en sus archivos.)


-- =============================================================================
-- VERIFICACION (opcional)
-- =============================================================================
-- SELECT negocio_id, count(*) FROM suscripciones GROUP BY 1 HAVING count(*) > 1;  -- debe dar 0 filas
-- SELECT conname FROM pg_constraint WHERE conname = 'suscripciones_negocio_id_key';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'suscripciones' ORDER BY ordinal_position;
-- SELECT relreplident FROM pg_class WHERE relname = 'suscripciones';  -- debe ser 'f'
-- =============================================================================
