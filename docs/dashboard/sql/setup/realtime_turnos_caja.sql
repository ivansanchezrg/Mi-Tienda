-- =============================================================================
-- Supabase Realtime - tabla turnos_caja
-- =============================================================================
-- Habilita la escucha de cambios en tiempo real para la tabla turnos_caja.
-- Necesario para que TurnosCajaService propague el estado del turno activo
-- (turnoActivo$) a todos los dispositivos conectados sin recargar la app.
--
-- Propaga automaticamente:
--   - Apertura de turno (INSERT)  -> habilita POS, Cajon, etc.
--   - Cierre de turno (UPDATE con hora_fecha_cierre IS NOT NULL) -> deshabilita
--
-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- =============================================================================

-- 1. Publicar la tabla en el canal de Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE turnos_caja;

-- 2. REPLICA IDENTITY FULL para que los eventos UPDATE entreguen la fila completa
--    (por defecto solo vienen las columnas modificadas, lo que rompe la logica
--    de reconstruccion del estado en el cliente).
ALTER TABLE turnos_caja REPLICA IDENTITY FULL;

-- 3. Politica RLS: usuarios autenticados pueden leer turnos_caja
--    (necesario para que Realtime respete RLS y entregue los cambios)
CREATE POLICY "authenticated puede leer turnos_caja"
ON turnos_caja FOR SELECT
TO authenticated
USING (true);

-- =============================================================================
-- Verificacion (ejecutar por separado si se quiere confirmar el estado)
-- =============================================================================

-- Ver politicas activas en la tabla:
-- SELECT policyname, cmd, qual
-- FROM pg_policies
-- WHERE tablename = 'turnos_caja';

-- Ver si la tabla esta publicada en Realtime:
-- SELECT tablename
-- FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime'
--   AND tablename = 'turnos_caja';

-- Ver REPLICA IDENTITY:
-- SELECT relname, relreplident
-- FROM pg_class
-- WHERE relname = 'turnos_caja';
-- (d = default, f = full, n = nothing, i = index)
