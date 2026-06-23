-- =============================================================================
-- MIGRACION 003 — Limite de negocios por plan (max_negocios)
-- =============================================================================
-- INCREMENTAL e IDEMPOTENTE. Seguro para re-ejecutar (IF NOT EXISTS / OR UPDATE).
--
-- Contexto: la suscripcion se paga POR PROPIETARIO, no por sucursal. El plan
-- define cuantos negocios puede tener un propietario:
--   PRO  → 1 negocio.
--   MAX  → 3 negocios.
-- (Valores editables por el superadmin desde /admin sin redeploy.)
--
-- Que hace:
--   1. planes: agrega la columna `max_negocios` (NULL = ilimitado).
--   2. Setea PRO = 1 y MAX = 3 en los planes existentes.
--
-- DESPUES de este archivo, re-ejecutar la funcion que valida el limite:
--   docs/onboarding/sql/functions/fn_completar_onboarding.sql
--
-- COMO USARLO: ejecutar completo en el SQL Editor de Supabase.
-- =============================================================================


-- =============================================================================
-- 1. TABLA planes — limite de negocios
-- =============================================================================
-- NULL = ilimitado (reservado para un plan superior futuro). Un numero = tope
-- de negocios que el propietario puede tener bajo ese plan.
ALTER TABLE planes ADD COLUMN IF NOT EXISTS max_negocios INT;


-- =============================================================================
-- 2. Setear el limite de los planes actuales
-- =============================================================================
UPDATE planes SET max_negocios = 1 WHERE codigo = 'PRO';
UPDATE planes SET max_negocios = 3 WHERE codigo = 'MAX';

-- Plan BASICO (placeholder del seed inicial, si aun existe) → 1 negocio.
UPDATE planes SET max_negocios = 1 WHERE codigo = 'BASICO';


NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- 3. FUNCIONES — re-ejecutar (aplica el limite al crear negocio)
-- =============================================================================
-- Ejecutar a continuacion el contenido actualizado de:
--   docs/onboarding/sql/functions/fn_completar_onboarding.sql
-- (Queda como fuente de verdad en su archivo.)


-- =============================================================================
-- VERIFICACION (opcional)
-- =============================================================================
-- SELECT codigo, nombre, max_negocios FROM planes ORDER BY orden;
-- =============================================================================
