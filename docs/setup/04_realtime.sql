-- =============================================================================
-- 04_realtime.sql — Publicaciones Realtime + REPLICA IDENTITY
-- =============================================================================
-- Ejecutar DESPUES de 03_functions.sql.
-- Orden: 01_rls → 02_triggers → 03_functions → 04_realtime → 05_seed_dev
--
-- DROP TABLE ... CASCADE en schema.sql elimina las publicaciones de Realtime.
-- Los canales websocket que la app ya tenía abiertos quedan huérfanos
-- (sin error visible) — hay que re-ejecutar este archivo tras cada schema.sql
-- y reiniciar la app para que los servicios abran canales nuevos.
--
-- Tablas publicadas:
--   - usuarios        (AuthService — detecta desactivaciones y cambios de nombre)
--   - configuraciones (ConfigService — propaga cambios de config sin recargar)
--   - turnos_caja     (TurnosCajaService — habilita/deshabilita POS en tiempo real)
-- =============================================================================

-- usuarios
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'usuarios'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE usuarios;
    END IF;
END $$;

-- configuraciones
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'configuraciones'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE configuraciones;
    END IF;
END $$;

-- turnos_caja — REPLICA IDENTITY FULL para que los UPDATE entreguen la fila completa
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'turnos_caja'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE turnos_caja;
    END IF;
END $$;

ALTER TABLE turnos_caja REPLICA IDENTITY FULL;

-- Política RLS de lectura para turnos_caja (necesaria para que Realtime respete RLS)
-- La política general de 01_rls.sql filtra por negocio_id.
-- Esta política de SELECT ya está cubierta en 01_rls.sql — no duplicar.
-- Si por algún motivo no existe, crearla:
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'turnos_caja' AND policyname = 'authenticated puede leer turnos_caja'
    ) THEN
        CREATE POLICY "authenticated puede leer turnos_caja"
        ON turnos_caja FOR SELECT TO authenticated USING (true);
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';


-- =============================================================================
-- VERIFICACIÓN (ejecutar por separado para confirmar estado)
-- =============================================================================
-- Ver tablas publicadas en Realtime:
-- SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
--
-- Ver REPLICA IDENTITY de turnos_caja (debe ser 'f' = full):
-- SELECT relname, relreplident FROM pg_class WHERE relname = 'turnos_caja';
-- =============================================================================
