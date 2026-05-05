-- =============================================================================
-- Supabase Realtime — tabla usuario_negocios
-- =============================================================================
-- Habilita la escucha de cambios en tiempo real para la tabla usuario_negocios.
-- Necesario para que AuthService detecte cuando un ADMIN desactiva la membresía
-- de un empleado/usuario conectado y lo redirija a /auth/pending en tiempo real,
-- sin esperar a que intente navegar o recargar.
--
-- Canal que lo consume: `membresia-activa-{usuario_id}-{negocio_id}` en auth.service.ts
-- Evento relevante: UPDATE con activo = false → handleUsuarioDesactivado() con motivo 'membresia'
--
-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- Si se re-ejecuta schema.sql desde cero, volver a ejecutar este archivo después.
-- =============================================================================

-- 1. Publicar la tabla en el canal de Realtime
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'usuario_negocios'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE usuario_negocios;
    END IF;
END $$;

-- 2. REPLICA IDENTITY FULL — los eventos UPDATE entregan la fila completa.
--    Sin esto Supabase solo entrega las columnas modificadas (activo), omitiendo
--    usuario_id y negocio_id, lo que impide que el filtro del canal haga match.
ALTER TABLE usuario_negocios REPLICA IDENTITY FULL;

-- =============================================================================
-- Verificacion (ejecutar por separado para confirmar el estado)
-- =============================================================================

-- Ver si la tabla esta publicada en Realtime:
-- SELECT tablename FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime' AND tablename = 'usuario_negocios';

-- Ver REPLICA IDENTITY (debe ser 'f' = full):
-- SELECT relname, relreplident FROM pg_class WHERE relname = 'usuario_negocios';
-- (d = default, f = full, n = nothing, i = index)
