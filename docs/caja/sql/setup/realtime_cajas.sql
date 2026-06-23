-- =============================================================================
-- Supabase Realtime - tabla cajas
-- =============================================================================
-- Habilita la escucha de cambios en tiempo real para la tabla cajas.
-- Necesario para que CajasService propague saldo_actual actualizado
-- a todos los dispositivos conectados sin recargar la app.
--
-- Propaga automaticamente:
--   - Cambio de saldo_actual (UPDATE) tras ingreso, egreso, traspaso o cierre
--   - Creacion de caja custom (INSERT)
--   - Desactivacion de caja (UPDATE con activo = false)
--
-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- =============================================================================

-- 1. Publicar la tabla en el canal de Realtime (idempotente)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND tablename = 'cajas'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE cajas;
    END IF;
END $$;

-- 2. REPLICA IDENTITY FULL para que los eventos UPDATE entreguen la fila completa
--    (por defecto solo vienen las columnas modificadas, lo que rompe la logica
--    de reconstruccion del estado en el cliente).
ALTER TABLE cajas REPLICA IDENTITY FULL;

-- 3. La politica RLS SELECT de cajas ya esta definida en docs/setup/02_rls.sql
--    (cajas_select: negocio_id = get_negocio_id()). No crear una adicional aqui
--    porque multiples politicas SELECT se combinan con OR y anulan el filtro de negocio.
--    Si por alguna razon existe "authenticated puede leer cajas", eliminarla:
DROP POLICY IF EXISTS "authenticated puede leer cajas" ON cajas;

-- =============================================================================
-- Verificacion (ejecutar por separado si se quiere confirmar el estado)
-- =============================================================================

-- Ver politicas activas en la tabla:
-- SELECT policyname, cmd, qual
-- FROM pg_policies
-- WHERE tablename = 'cajas';

-- Ver si la tabla esta publicada en Realtime:
-- SELECT tablename
-- FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime'
--   AND tablename = 'cajas';

-- Ver REPLICA IDENTITY:
-- SELECT relname, relreplident
-- FROM pg_class
-- WHERE relname = 'cajas';
-- (d = default, f = full, n = nothing, i = index)
