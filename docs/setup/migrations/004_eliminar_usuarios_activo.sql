-- =============================================================================
-- MIGRACION 004 — Eliminar usuarios.activo (suspension global obsoleta)
-- =============================================================================
-- INCREMENTAL. Seguro para re-ejecutar (IF EXISTS).
--
-- Contexto: la suspension global del propietario se hacia con
-- fn_suspender_usuario (UPDATE usuarios SET activo = false) — un "muro seco"
-- sin canal de pago. Se reemplazo (2026-06-16) por fn_suspender_propietario_suscripcion,
-- que suspende por COBRO la suscripcion de todos los negocios del propietario,
-- mostrando la pantalla "Suscribete" (WhatsApp + cuentas) en vez de un bloqueo seco.
--
-- Tras este cambio, ninguna funcion SQL escribe usuarios.activo. La columna
-- queda huerfana — este script la elimina junto con su validacion residual, y
-- elimina ademas las dos funciones de suspension obsoletas que la usaban o que
-- suspendian 1 negocio puntual: fn_suspender_usuario y fn_suspender_suscripcion.
--
-- IMPORTANTE — antes de ejecutar este script:
--   1. Si tienes usuarios con activo = false de pruebas anteriores, reactivalos
--      manualmente o pierdes la oportunidad de hacerlo despues:
--      UPDATE usuarios SET activo = true WHERE activo = false;
--   2. Re-ejecutar despues de este script (toman la nueva firma sin `activo`):
--      docs/setup/03_functions.sql           (fn_set_negocio_activo)
--      docs/auth/sql/functions/fn_validar_sesion.sql
--
-- COMO USARLO: ejecutar completo en el SQL Editor de Supabase.
-- =============================================================================

ALTER TABLE usuarios DROP COLUMN IF EXISTS activo;

-- -----------------------------------------------------------------------------
-- Eliminar funciones de suspension obsoletas (reemplazadas por
-- fn_suspender_propietario_suscripcion el 2026-06-16).
--   - fn_suspender_usuario      → ponia usuarios.activo = FALSE (columna ya eliminada arriba).
--   - fn_suspender_suscripcion  → suspendia 1 negocio puntual.
-- 01_teardown.sql ya las elimina en un reset completo; este DROP cubre la BD
-- existente que NO se resetea. Drop dinamico por NOMBRE (igual que el teardown):
-- elimina TODAS las sobrecargas sin depender de conocer la firma exacta.
-- Idempotente: si ya no existen, no hace nada.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
    v_firma TEXT;
BEGIN
    FOR v_firma IN
        SELECT 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN ('fn_suspender_usuario', 'fn_suspender_suscripcion')
    LOOP
        EXECUTE 'DROP FUNCTION IF EXISTS ' || v_firma || ' CASCADE';
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFICACION (opcional)
-- =============================================================================
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'usuarios' ORDER BY ordinal_position;
-- =============================================================================
