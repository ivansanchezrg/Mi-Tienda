-- =============================================================================
-- Supabase Realtime — tabla configuraciones
-- =============================================================================
-- Habilita la escucha de cambios en tiempo real para la tabla configuraciones.
-- Necesario para que ConfigService (config.service.ts) propague cambios de
-- pos_habilitado a todos los dispositivos conectados sin recargar la app.
--
-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- =============================================================================

-- 1. Publicar la tabla en el canal de Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE configuraciones;

-- 2. Política RLS: usuarios autenticados pueden leer configuraciones
--    (necesario para que Realtime respete RLS y entregue los cambios)
CREATE POLICY "authenticated puede leer configuraciones"
ON configuraciones FOR SELECT
TO authenticated
USING (true);

-- =============================================================================
-- Verificación (ejecutar por separado si se quiere confirmar el estado)
-- =============================================================================

-- Ver políticas activas en la tabla:
-- SELECT policyname, cmd, qual
-- FROM pg_policies
-- WHERE tablename = 'configuraciones';

-- Ver si la tabla está publicada en Realtime:
-- SELECT tablename
-- FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime'
--   AND tablename = 'configuraciones';
