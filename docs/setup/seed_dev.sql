-- =============================================================================
-- seed_dev.sql — Datos iniciales para desarrollo/testing
-- =============================================================================
-- Ejecutar DESPUES de (en orden):
--   0. schema.sql
--   1. 01_rls.sql
--   2. 02_triggers.sql
--   3. 03_functions.sql
--   4. 04_realtime.sql
--
-- Crea:
--   - Superadmin en auth.users (con es_superadmin=true en app_metadata)
--   - Fila en public.usuarios con es_superadmin=true
--   Los negocios se crean desde la interfaz (Panel Admin o flujo crear-negocio).
--
-- IMPORTANTE: Cambiar el email y nombre antes de ejecutar en produccion.
-- Este archivo es solo para desarrollo — NO ejecutar en prod con datos reales.
-- =============================================================================

DO $$
DECLARE
    v_superadmin_email  TEXT    := 'ivansan2192@gmail.com';
    v_superadmin_nombre TEXT    := 'Ivan Sanchez';
    v_superadmin_pass   TEXT    := 'Dev1234!';  -- solo para login email/pass en dev

    v_auth_uid          UUID;
    v_usuario_id        UUID;
BEGIN

    -- =========================================================================
    -- 1. Upsert en auth.users
    --    Si el usuario ya existe (login previo via Google OAuth), solo actualiza
    --    el app_metadata. Si no existe, lo inserta con login email/password.
    -- =========================================================================
    v_auth_uid := (SELECT id FROM auth.users WHERE email = v_superadmin_email);

    IF v_auth_uid IS NULL THEN
        -- Crear usuario nuevo en auth (login email+password para dev)
        v_auth_uid := gen_random_uuid();
        INSERT INTO auth.users (
            id,
            instance_id,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            role,
            aud,
            created_at,
            updated_at
        ) VALUES (
            v_auth_uid,
            '00000000-0000-0000-0000-000000000000',
            v_superadmin_email,
            crypt(v_superadmin_pass, gen_salt('bf')),
            NOW(),
            jsonb_build_object('provider', 'email', 'providers', ARRAY['email']::text[], 'es_superadmin', TRUE),
            jsonb_build_object('nombre', v_superadmin_nombre),
            'authenticated',
            'authenticated',
            NOW(),
            NOW()
        );
        RAISE NOTICE 'auth.users creado: %', v_auth_uid;
    ELSE
        -- Ya existe (OAuth previo) — solo marcar es_superadmin en app_metadata
        UPDATE auth.users
        SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('es_superadmin', TRUE)
        WHERE id = v_auth_uid;
        RAISE NOTICE 'auth.users actualizado (ya existia): %', v_auth_uid;
    END IF;

    -- =========================================================================
    -- 2. Upsert en public.usuarios con es_superadmin = true
    -- =========================================================================
    v_usuario_id := (SELECT id FROM public.usuarios WHERE email = v_superadmin_email);

    IF v_usuario_id IS NULL THEN
        v_usuario_id := gen_random_uuid();
        INSERT INTO public.usuarios (id, nombre, email, es_superadmin)
        VALUES (v_usuario_id, v_superadmin_nombre, v_superadmin_email, TRUE);
        RAISE NOTICE 'public.usuarios creado: %', v_usuario_id;
    ELSE
        UPDATE public.usuarios SET es_superadmin = TRUE WHERE id = v_usuario_id;
        RAISE NOTICE 'public.usuarios actualizado (ya existia): %', v_usuario_id;
    END IF;

    -- =========================================================================
    -- 3. (Sin negocios de prueba)
    --    Los negocios se crean desde la interfaz:
    --      - Superadmin: Panel Admin → botón +
    --      - Usuario nuevo: flujo /auth/crear-negocio tras primer login
    -- =========================================================================

    RAISE NOTICE '=== SEED COMPLETADO ===';
    RAISE NOTICE 'Email:      %', v_superadmin_email;
    RAISE NOTICE 'Password:   % (solo si el usuario fue creado ahora)', v_superadmin_pass;
    RAISE NOTICE 'Superadmin listo. Crear negocios desde la interfaz de admin.';

END $$;
