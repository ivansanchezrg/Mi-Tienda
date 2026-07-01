-- =============================================================================
-- MIGRACION 006 — Corrige el seed de planes: PRO + MAX reales (en vez de BASICO)
-- =============================================================================
-- INCREMENTAL e IDEMPOTENTE. Seguro para re-ejecutar.
--
-- Contexto: el seed original de planes (schema.sql, antes de esta migracion) solo
-- creaba un plan placeholder 'BASICO'. Los planes reales 'PRO' y 'MAX' se crearon
-- a mano en el SQL Editor de Supabase en su momento — nunca quedaron versionados.
-- En un reset completo desde cero (teardown + schema.sql), 'BASICO' vuelve a ser
-- la unica fila, y fn_completar_onboarding falla con "El plan PRO no existe o
-- esta desactivado" porque busca codigo = 'PRO'.
--
-- Esta migracion corrige eso SIN tocar ninguna otra tabla:
--   1. Si existe la fila 'BASICO', la renombra a 'PRO' (conserva el mismo id,
--      asi que cualquier suscripcion existente que ya apunte a ese plan_id sigue
--      siendo valida sin necesidad de re-vincular nada).
--   2. Si no existe 'BASICO' ni 'PRO', crea 'PRO' desde cero.
--   3. Crea 'MAX' si no existe.
--
-- Valores (ver docs/suscripcion/SUSCRIPCION-README.md, "Planes actuales"):
--   PRO  → $9.99/mes,  $99.99/año,  trial 15 dias, max_negocios = 1
--   MAX  → $16.99/mes, $169.99/año, sin trial,     max_negocios = 3 (precio provisional,
--          editable por el superadmin desde /admin sin redeploy)
--
-- DESPUES de este archivo, no es necesario re-ejecutar ninguna funcion — solo es
-- un ajuste de datos sobre una tabla que las funciones ya leen por `codigo`.
--
-- COMO USARLO: ejecutar completo en el SQL Editor de Supabase.
-- =============================================================================


-- =============================================================================
-- 1. Renombrar BASICO -> PRO (si BASICO existe y PRO todavia no)
-- =============================================================================
UPDATE planes
SET codigo         = 'PRO',
    nombre         = 'Plan PRO',
    descripcion    = 'Acceso completo al sistema de gestion para un negocio.',
    precio_mensual = 9.99,
    precio_anual   = 99.99,
    trial_dias     = 15,
    max_negocios   = 1,
    features       = '{"panel_financiero":true,"pos":true,"inventario":true,"ventas":true,"clientes":true,"empleados":true,"nomina":true,"notas":true,"acciones_rapidas":true,"configuracion":true}'::jsonb,
    orden          = 1
WHERE codigo = 'BASICO'
  AND NOT EXISTS (SELECT 1 FROM planes WHERE codigo = 'PRO');


-- =============================================================================
-- 2. Crear PRO si no existe aun (ni como BASICO ni como PRO)
-- =============================================================================
INSERT INTO planes (codigo, nombre, descripcion, precio_mensual, precio_anual, trial_dias, features, max_negocios, orden)
SELECT 'PRO', 'Plan PRO', 'Acceso completo al sistema de gestion para un negocio.', 9.99, 99.99, 15,
       '{"panel_financiero":true,"pos":true,"inventario":true,"ventas":true,"clientes":true,"empleados":true,"nomina":true,"notas":true,"acciones_rapidas":true,"configuracion":true}'::jsonb, 1, 1
WHERE NOT EXISTS (SELECT 1 FROM planes WHERE codigo = 'PRO');


-- =============================================================================
-- 3. Crear MAX si no existe aun
-- =============================================================================
INSERT INTO planes (codigo, nombre, descripcion, precio_mensual, precio_anual, trial_dias, features, max_negocios, orden)
SELECT 'MAX', 'Plan MAX — Gestion inteligente, sin limites',
       'Hasta 3 negocios bajo un mismo propietario, con todo lo de PRO mas inteligencia artificial.',
       16.99, 169.99, 0,
       '{"panel_financiero":true,"pos":true,"inventario":true,"ventas":true,"clientes":true,"empleados":true,"nomina":true,"notas":true,"acciones_rapidas":true,"configuracion":true,"ia":true}'::jsonb, 3, 2
WHERE NOT EXISTS (SELECT 1 FROM planes WHERE codigo = 'MAX');


NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- VERIFICACION (opcional)
-- =============================================================================
-- SELECT codigo, nombre, precio_mensual, precio_anual, trial_dias, max_negocios, orden
-- FROM planes ORDER BY orden;
-- =============================================================================
