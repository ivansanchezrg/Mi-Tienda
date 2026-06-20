-- =============================================================================
-- Supabase Realtime — tabla suscripciones
-- =============================================================================
-- Habilita la escucha de cambios en tiempo real para la tabla suscripciones.
-- Necesario para que SuscripcionService detecte al instante cuando el superadmin
-- suspende/reactiva un propietario por cobro (fn_suspender_propietario_suscripcion)
-- o registra un pago, y redirija a /suscripcion sin esperar a que el usuario
-- navegue o recargue (sin esto, la suspensión solo se detecta en la próxima
-- navegación que dispare suscripcionGuard, o tras 5 min de TTL del cache).
--
-- Canal que lo consume: `suscripcion-negocio-{negocio_id}` en suscripcion.service.ts
-- Eventos relevantes (modelo de estado mutable, refactor 2026-06):
--   INSERT → primer alta de la suscripcion (onboarding crea la fila TRIAL del negocio).
--   UPDATE → pago/renovacion/suspension/reactivacion (cambian estado/plan/vence_el de la fila).
-- El servicio escucha AMBOS (event '*') y siempre re-deriva el estado con fn_estado_suscripcion.
--
-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Si se re-ejecuta schema.sql desde cero, volver a ejecutar este archivo después.
-- =============================================================================

-- 1. Publicar la tabla en el canal de Realtime
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'suscripciones'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE suscripciones;
    END IF;
END $$;

-- 2. REPLICA IDENTITY FULL — NECESARIO ahora que se escucha UPDATE: sin esto, el
--    payload del UPDATE no trae la fila completa (solo la PK), y el handler del cliente
--    no podria leer el nuevo `estado`. Con FULL, cada UPDATE entrega la fila entera.
ALTER TABLE suscripciones REPLICA IDENTITY FULL;

-- =============================================================================
-- Verificacion (ejecutar por separado para confirmar el estado)
-- =============================================================================

-- Ver si la tabla esta publicada en Realtime:
-- SELECT tablename FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime' AND tablename = 'suscripciones';

-- Ver REPLICA IDENTITY (debe ser 'f' = full):
-- SELECT relname, relreplident FROM pg_class WHERE relname = 'suscripciones';
-- (d = default, f = full, n = nothing, i = index)
