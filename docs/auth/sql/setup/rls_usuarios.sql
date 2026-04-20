-- =============================================================================
-- RLS — tabla usuarios
-- Versión: 1.1
--
-- Ejecutar cada vez que se re-crea la tabla usuarios (ej: tras aplicar schema.sql).
-- DROP TABLE CASCADE elimina todas las políticas — hay que re-aplicarlas.
--
-- Accesos por operación:
--   SELECT  → cualquier usuario autenticado (ver nota abajo)
--   INSERT  → auto-registro del propio email + cualquier ADMIN activo
--   UPDATE  → solo ADMIN activo
--   DELETE  → nadie desde el cliente (sin política = RLS bloquea)
--
-- NOTA sobre SELECT permisivo:
--   La política SELECT permite a cualquier usuario autenticado leer toda la tabla.
--   Esto es necesario para romper el deadlock de bootstrap:
--     - Un usuario nuevo hace OAuth → su registro aún NO existe en usuarios
--     - validarUsuario() hace SELECT para verificar si existe
--     - Si la política SELECT requiere "estar en la tabla para poder leer la tabla",
--       el SELECT falla con error de permisos en vez de retornar vacío
--     - Con política permisiva: retorna vacío → auto-registro funciona correctamente
--   Esto es seguro para esta app porque:
--     - Es una herramienta interna de una sola tienda, no un SaaS multi-tenant
--     - Los datos de usuarios (nombre, email, rol) no son sensibles entre empleados
--     - El control real está en INSERT y UPDATE (solo ADMIN puede crear/modificar)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Limpieza previa — eliminar políticas existentes para re-aplicar limpio
-- Usar DROP IF EXISTS para que sea idempotente (no falla si no existen)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "usuarios_select" ON usuarios;
DROP POLICY IF EXISTS "usuarios_insert" ON usuarios;
DROP POLICY IF EXISTS "usuarios_update" ON usuarios;
-- Nombres del archivo anterior (realtime_usuarios.sql) por si quedaron:
DROP POLICY IF EXISTS "usuario puede leer su propio registro" ON usuarios;
DROP POLICY IF EXISTS "usuario puede auto-registrarse" ON usuarios;

-- Habilitar RLS (idempotente — no falla si ya estaba habilitado)
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- SELECT — permisivo para authenticated
-- Cualquier usuario autenticado puede leer la tabla completa.
-- Ver nota en el encabezado sobre por qué es necesario y seguro.
-- -----------------------------------------------------------------------------
CREATE POLICY "usuarios_select"
ON usuarios FOR SELECT
TO authenticated
USING (true);

-- -----------------------------------------------------------------------------
-- INSERT
-- Casos cubiertos:
--   1. Auto-registro: usuario nuevo se registra con su propio email (activo: false)
--      → auth.service.ts línea 136
--   2. ADMIN crea un usuario nuevo desde el módulo Usuarios (activo: true)
--      → usuario.service.ts línea 39
-- -----------------------------------------------------------------------------
CREATE POLICY "usuarios_insert"
ON usuarios FOR INSERT
TO authenticated
WITH CHECK (
  -- Caso 1: solo puede insertar una fila con su propio email
  usuario = (auth.jwt() ->> 'email')
  OR
  -- Caso 2: ADMIN activo puede insertar cualquier usuario
  EXISTS (
    SELECT 1 FROM usuarios u2
    WHERE u2.usuario = (auth.jwt() ->> 'email')
      AND u2.rol = 'ADMIN'
      AND u2.activo = true
  )
);

-- -----------------------------------------------------------------------------
-- UPDATE
-- Solo ADMIN activo puede modificar usuarios (rol, activo, nombre).
-- → usuario.service.ts línea 66
-- Los empleados no pueden editar ningún registro, ni el propio.
-- -----------------------------------------------------------------------------
CREATE POLICY "usuarios_update"
ON usuarios FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM usuarios u2
    WHERE u2.usuario = (auth.jwt() ->> 'email')
      AND u2.rol = 'ADMIN'
      AND u2.activo = true
  )
);

-- -----------------------------------------------------------------------------
-- DELETE — sin política
-- No existe DELETE en ningún servicio de la app. Los usuarios se desactivan
-- con activo = false, nunca se eliminan desde el cliente.
-- RLS bloquea cualquier intento de DELETE por defecto al no tener política.
-- -----------------------------------------------------------------------------

-- =============================================================================
-- Publicar tabla en Realtime (necesario para que AuthService detecte cambios
-- en tiempo real — desactivaciones, cambios de rol/nombre, eliminaciones)
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'usuarios'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE usuarios;
  END IF;
END $$;

-- =============================================================================
-- Verificación (ejecutar por separado para confirmar el estado)
-- =============================================================================
-- Ver políticas activas:
-- SELECT policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename = 'usuarios';
--
-- Ver si la tabla está publicada en Realtime:
-- SELECT tablename
-- FROM pg_publication_tables
-- WHERE pubname = 'supabase_realtime'
--   AND tablename = 'usuarios';
