-- =============================================================================
-- RLS — tablas de identidad y membresia: usuarios, usuario_negocios, negocios
-- Version: 2.0 (Multi-Tenant)
--
-- Ejecutar despues de schema.sql (DROP TABLE CASCADE elimina politicas).
-- Idempotente: DROP IF EXISTS + CREATE.
--
-- Helpers JWT usados (definidos en schema.sql, schema public):
--   public.get_negocio_id()    → UUID del negocio activo en el JWT
--   public.get_es_superadmin() → TRUE si el claim es_superadmin esta en el JWT
--   public.get_rol()           → rol del usuario en el negocio activo ('ADMIN'|'EMPLEADO')
--   public.get_email()         → email del usuario autenticado
--   public.comparten_negocio(UUID) → TRUE si el usuario_id dado esta en el mismo negocio
--                                     que el usuario actual (SECURITY DEFINER, sin recursion)
--
-- Patron general (Grupo A): tenant_or_superadmin
--   USING (negocio_id = public.get_negocio_id() OR public.get_es_superadmin())
--
-- Tabla usuarios (Grupo D): no tiene negocio_id.
--   SELECT: el usuario ve su propio registro + compañeros de negocio.
--   INSERT: auto-registro con email propio; ADMIN crea usuarios en su negocio.
--   UPDATE: solo ADMIN de ese negocio puede editar; o superadmin.
--
-- Tabla usuario_negocios (Grupo B pivot): row is tenant-scoped via negocio_id.
--   Las RLS de usuarios dependen de esta tabla via auth.comparten_negocio()
--   que usa SECURITY DEFINER para evitar recursion de RLS.
--
-- Tabla negocios (root): solo superadmin puede gestionar.
-- =============================================================================

-- =============================================================================
-- USUARIOS
-- =============================================================================

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usuarios_select"           ON usuarios;
DROP POLICY IF EXISTS "usuarios_insert"           ON usuarios;
DROP POLICY IF EXISTS "usuarios_update"           ON usuarios;
DROP POLICY IF EXISTS "usuarios_delete"           ON usuarios;
-- Nombres legacy del archivo anterior
DROP POLICY IF EXISTS "usuario puede leer su propio registro" ON usuarios;
DROP POLICY IF EXISTS "usuario puede auto-registrarse"        ON usuarios;

-- SELECT: el usuario ve su propio perfil + compañeros de su negocio activo.
-- auth.comparten_negocio() usa SECURITY DEFINER → no hay recursion de RLS.
CREATE POLICY "usuarios_select"
ON usuarios FOR SELECT
TO authenticated
USING (
    public.get_es_superadmin()
    OR email = public.get_email()
    OR public.comparten_negocio(id)
);

-- INSERT: auto-registro (email propio); o ADMIN del negocio activo crea usuarios.
-- El auto-registro ocurre en el momento del primer login OAuth —
-- el usuario aun NO existe en la tabla, por eso se permite insertar el email propio.
CREATE POLICY "usuarios_insert"
ON usuarios FOR INSERT
TO authenticated
WITH CHECK (
    -- Auto-registro: el usuario inserta su propio email
    email = public.get_email()
    OR
    -- ADMIN crea un nuevo usuario para su negocio
    public.get_rol() = 'ADMIN'
    OR
    public.get_es_superadmin()
);

-- UPDATE: solo ADMIN del negocio activo o superadmin pueden editar un usuario.
-- Un usuario no puede editarse a si mismo (impide que se auto-promueva a superadmin).
CREATE POLICY "usuarios_update"
ON usuarios FOR UPDATE
TO authenticated
USING (
    public.get_es_superadmin()
    OR (public.get_rol() = 'ADMIN' AND public.comparten_negocio(id))
);

-- DELETE: nadie desde el cliente.
-- Los usuarios se desactivan via usuario_negocios.activo = false.
-- Sin politica → RLS bloquea todos los DELETEs.


-- =============================================================================
-- USUARIO_NEGOCIOS
-- =============================================================================

ALTER TABLE usuario_negocios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "usuario_negocios_select" ON usuario_negocios;
DROP POLICY IF EXISTS "usuario_negocios_insert" ON usuario_negocios;
DROP POLICY IF EXISTS "usuario_negocios_update" ON usuario_negocios;
DROP POLICY IF EXISTS "usuario_negocios_delete" ON usuario_negocios;

-- SELECT: un usuario ve las membresías de su negocio activo (lista de empleados)
-- + sus propias membresías en cualquier negocio (selector de negocios, login).
-- Superadmin: lo mismo — solo ve negocios donde tiene membresía propia,
-- más el negocio activo para gestionar empleados. NO tiene acceso global
-- a membresías de negocios ajenos (aislamiento entre tenants).
CREATE POLICY "usuario_negocios_select"
ON usuario_negocios FOR SELECT
TO authenticated
USING (
    -- Caso 1: membresías del negocio activo (para ver empleados del negocio)
    negocio_id = public.get_negocio_id()
    -- Caso 2: mis propias membresías en cualquier negocio (selector, login)
    OR usuario_id = (SELECT id FROM usuarios WHERE email = public.get_email())
);

-- INSERT: ADMIN del negocio activo puede agregar usuarios a su negocio.
-- Superadmin también, pero solo si el negocio es el activo en su JWT
-- (no puede insertar en negocios donde no está operando).
CREATE POLICY "usuario_negocios_insert"
ON usuario_negocios FOR INSERT
TO authenticated
WITH CHECK (
    negocio_id = public.get_negocio_id()
    AND (public.get_rol() = 'ADMIN' OR public.get_es_superadmin())
);

-- UPDATE: ADMIN del negocio activo puede modificar membresías (activo, rol).
CREATE POLICY "usuario_negocios_update"
ON usuario_negocios FOR UPDATE
TO authenticated
USING (
    negocio_id = public.get_negocio_id()
    AND (public.get_rol() = 'ADMIN' OR public.get_es_superadmin())
);

-- DELETE: solo superadmin puede eliminar membresías.
-- Los ADMINs desactivan con activo = false (UPDATE arriba).
CREATE POLICY "usuario_negocios_delete"
ON usuario_negocios FOR DELETE
TO authenticated
USING (public.get_es_superadmin());


-- =============================================================================
-- NEGOCIOS
-- =============================================================================

ALTER TABLE negocios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "negocios_select" ON negocios;
DROP POLICY IF EXISTS "negocios_insert" ON negocios;
DROP POLICY IF EXISTS "negocios_update" ON negocios;
DROP POLICY IF EXISTS "negocios_delete" ON negocios;

-- SELECT: un usuario ve los negocios donde tiene membresía activa (selector de sucursales)
-- + el negocio activo en el JWT (por si acaso la membresía ya no está activa).
-- Superadmin ve todos.
CREATE POLICY "negocios_select"
ON negocios FOR SELECT
TO authenticated
USING (
    public.get_es_superadmin()
    OR id = public.get_negocio_id()
    OR id IN (
        SELECT negocio_id FROM usuario_negocios
        WHERE usuario_id = (SELECT id FROM usuarios WHERE email = public.get_email())
          AND activo = TRUE
    )
);

-- INSERT/UPDATE/DELETE: solo superadmin.
-- Los negocios se crean via fn_crear_negocio (SECURITY DEFINER).
CREATE POLICY "negocios_insert"
ON negocios FOR INSERT
TO authenticated
WITH CHECK (public.get_es_superadmin());

CREATE POLICY "negocios_update"
ON negocios FOR UPDATE
TO authenticated
USING (public.get_es_superadmin());

CREATE POLICY "negocios_delete"
ON negocios FOR DELETE
TO authenticated
USING (public.get_es_superadmin());


-- =============================================================================
-- REALTIME — publicar tablas para cambios en tiempo real
-- AuthService escucha cambios en usuarios para detectar desactivaciones y
-- cambios de rol/nombre sin necesidad de re-login.
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
-- VERIFICACION (ejecutar por separado en el SQL editor de Supabase)
-- =============================================================================
-- Ver politicas activas en las tres tablas:
-- SELECT tablename, policyname, cmd, qual, with_check
-- FROM pg_policies
-- WHERE tablename IN ('usuarios', 'usuario_negocios', 'negocios')
-- ORDER BY tablename, cmd;

NOTIFY pgrst, 'reload schema';
