-- =============================================================================
-- Supabase Realtime — tabla usuarios
-- =============================================================================
-- Habilita la escucha de cambios en tiempo real para la tabla usuarios.
-- Necesario para que AuthService detecte cuando el admin desactiva o elimina
-- un usuario que está actualmente logueado, y lo redirige sin esperar al próximo
-- arranque de la app.
--
-- Ejecutar una sola vez en el SQL Editor de Supabase.
-- =============================================================================

-- 1. Publicar la tabla en el canal de Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE usuarios;

-- 2. Política RLS: cada usuario autenticado solo puede recibir eventos de su
--    propio registro (columna `usuario` contiene el email de Google OAuth,
--    que coincide con auth.jwt() ->> 'email')
CREATE POLICY "usuario puede leer su propio registro"
ON usuarios FOR SELECT
TO authenticated
USING (usuario = (auth.jwt() ->> 'email'));

-- =============================================================================
-- Verificación (ejecutar por separado si se quiere confirmar el estado)
-- =============================================================================

-- Ver políticas activas en la tabla:
-- SELECT policyname, cmd, qual
-- FROM pg_policies
-- WHERE tablename = 'usuarios';

-- Ver si la tabla está publicada en Realtime:
-- SELECT tablename
-- FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime'
--   AND tablename = 'usuarios';
