-- =============================================================================
-- Script de prueba MANUAL — fn_marcar_negocios_para_purga (Fase 2)
-- =============================================================================
-- Ejecutar en el SQL Editor de Supabase, paso por paso (cada bloque por separado,
-- revisando el resultado antes de seguir al siguiente). NUNCA correr contra
-- negocios reales — todo este script crea datos ficticios con prefijo
-- 'ZZZ_TEST_PURGA_' y los borra al final.
--
-- Requiere: un plan existente cualquiera (toma el primero que encuentre) y un
-- usuario propietario de prueba nuevo (lo crea el script, no usa ninguno real).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PASO 0 — limpiar cualquier corrida anterior de esta prueba (por si quedo algo)
-- -----------------------------------------------------------------------------
DELETE FROM suscripciones WHERE negocio_id IN (SELECT id FROM negocios WHERE slug LIKE 'zzz-test-purga-%');
DELETE FROM negocios WHERE slug LIKE 'zzz-test-purga-%';
DELETE FROM usuarios WHERE email LIKE 'zzz_test_purga_%@example.com';

-- -----------------------------------------------------------------------------
-- PASO 1 — crear 3 propietarios y sus negocios de prueba
-- -----------------------------------------------------------------------------
-- Propietario A: 1 negocio, TRIAL vencido hace 25 dias → DEBE marcarse
-- Propietario B: 1 negocio, ACTIVA vencida hace 10 dias → NO debe marcarse (gracia no cumplida)
-- Propietario C: 1 negocio, SUSPENDIDA hace 30 dias     → NO debe marcarse (bloqueo manual)
-- Propietario D: 2 negocios MAX, ambos vencidos hace 25 dias → ambos deben marcarse juntos

DO $$
DECLARE
    v_plan_id UUID := (SELECT id FROM planes LIMIT 1);
    v_user_a UUID; v_user_b UUID; v_user_c UUID; v_user_d UUID;
    v_neg_a UUID; v_neg_b UUID; v_neg_c UUID; v_neg_d1 UUID; v_neg_d2 UUID;
BEGIN
    IF v_plan_id IS NULL THEN
        RAISE EXCEPTION 'No hay ningun plan en la tabla planes — crear uno antes de probar';
    END IF;

    -- Propietario A
    INSERT INTO usuarios (nombre, email) VALUES ('ZZZ Test Purga A', 'zzz_test_purga_a@example.com') RETURNING id INTO v_user_a;
    INSERT INTO negocios (nombre, slug, propietario_usuario_id) VALUES ('ZZZ Test Purga A', 'zzz-test-purga-a', v_user_a) RETURNING id INTO v_neg_a;
    INSERT INTO suscripciones (negocio_id, plan_id, estado, vence_el)
        VALUES (v_neg_a, v_plan_id, 'TRIAL', NOW() - INTERVAL '25 days');

    -- Propietario B
    INSERT INTO usuarios (nombre, email) VALUES ('ZZZ Test Purga B', 'zzz_test_purga_b@example.com') RETURNING id INTO v_user_b;
    INSERT INTO negocios (nombre, slug, propietario_usuario_id) VALUES ('ZZZ Test Purga B', 'zzz-test-purga-b', v_user_b) RETURNING id INTO v_neg_b;
    INSERT INTO suscripciones (negocio_id, plan_id, estado, vence_el)
        VALUES (v_neg_b, v_plan_id, 'ACTIVA', NOW() - INTERVAL '10 days');

    -- Propietario C
    INSERT INTO usuarios (nombre, email) VALUES ('ZZZ Test Purga C', 'zzz_test_purga_c@example.com') RETURNING id INTO v_user_c;
    INSERT INTO negocios (nombre, slug, propietario_usuario_id) VALUES ('ZZZ Test Purga C', 'zzz-test-purga-c', v_user_c) RETURNING id INTO v_neg_c;
    INSERT INTO suscripciones (negocio_id, plan_id, estado, vence_el)
        VALUES (v_neg_c, v_plan_id, 'SUSPENDIDA', NOW() - INTERVAL '30 days');

    -- Propietario D (2 negocios MAX, mismo vence_el — comportamiento normal sincronizado)
    INSERT INTO usuarios (nombre, email) VALUES ('ZZZ Test Purga D', 'zzz_test_purga_d@example.com') RETURNING id INTO v_user_d;
    INSERT INTO negocios (nombre, slug, propietario_usuario_id, telefono) VALUES ('ZZZ Test Purga D1', 'zzz-test-purga-d1', v_user_d, '0991234567') RETURNING id INTO v_neg_d1;
    INSERT INTO negocios (nombre, slug, propietario_usuario_id) VALUES ('ZZZ Test Purga D2', 'zzz-test-purga-d2', v_user_d) RETURNING id INTO v_neg_d2;
    INSERT INTO suscripciones (negocio_id, plan_id, estado, vence_el)
        VALUES (v_neg_d1, v_plan_id, 'ACTIVA', NOW() - INTERVAL '25 days');
    INSERT INTO suscripciones (negocio_id, plan_id, estado, vence_el)
        VALUES (v_neg_d2, v_plan_id, 'ACTIVA', NOW() - INTERVAL '25 days');
END $$;

-- -----------------------------------------------------------------------------
-- PASO 2 — ejecutar la función a probar
-- -----------------------------------------------------------------------------
-- El SQL Editor de Supabase corre sin JWT de sesión (auth.jwt() devuelve NULL),
-- así que la función falla con "No hay sesion activa". Para probarla aquí mismo,
-- simulamos el JWT SOLO dentro de esta sesión SQL con SET LOCAL — no persiste,
-- no afecta nada fuera de esta transacción/sesión, y no toca la función real.
--
-- IMPORTANTE: reemplazar 'tu-email-superadmin@ejemplo.com' por TU email real,
-- el que tiene es_superadmin = true en la tabla usuarios. Confirmar antes con:
--   SELECT email FROM usuarios WHERE es_superadmin = true;
--
-- auth.jwt() en Supabase lee de request.jwt.claims y lo parsea como JSON — la
-- función real accede con (auth.jwt() ->> 'email'), así que basta con 'email'
-- en el nivel raíz del JSON simulado (no hace falta anidar en app_metadata).
SELECT set_config('request.jwt.claims', json_build_object('email', 'tu-email-superadmin@ejemplo.com')::text, true);

SELECT public.fn_marcar_negocios_para_purga();

-- -----------------------------------------------------------------------------
-- PASO 3 — verificar resultado esperado
-- -----------------------------------------------------------------------------
-- Esperado:
--   A   → marcado (purga_avisada_el/purga_programada_el NOT NULL)
--   B   → NO marcado (purga_avisada_el IS NULL) — gracia de 23 dias no cumplida
--   C   → NO marcado (SUSPENDIDA excluida)
--   D1, D2 → AMBOS marcados (mismo propietario, deben ir juntos)
SELECT
    n.nombre,
    n.slug,
    s.estado,
    s.vence_el,
    s.purga_avisada_el,
    s.purga_programada_el,
    CASE
        WHEN n.slug = 'zzz-test-purga-a'  AND s.purga_avisada_el IS NOT NULL THEN 'OK — deberia marcarse'
        WHEN n.slug = 'zzz-test-purga-a'  AND s.purga_avisada_el IS NULL     THEN 'FALLO — deberia haberse marcado'
        WHEN n.slug = 'zzz-test-purga-b'  AND s.purga_avisada_el IS NULL     THEN 'OK — no deberia marcarse aun'
        WHEN n.slug = 'zzz-test-purga-b'  AND s.purga_avisada_el IS NOT NULL THEN 'FALLO — no deberia haberse marcado (gracia no cumplida)'
        WHEN n.slug = 'zzz-test-purga-c'  AND s.purga_avisada_el IS NULL     THEN 'OK — SUSPENDIDA no se purga sola'
        WHEN n.slug = 'zzz-test-purga-c'  AND s.purga_avisada_el IS NOT NULL THEN 'FALLO — SUSPENDIDA no deberia marcarse'
        WHEN n.slug IN ('zzz-test-purga-d1', 'zzz-test-purga-d2') AND s.purga_avisada_el IS NOT NULL THEN 'OK — deberia marcarse (ambos del mismo propietario)'
        WHEN n.slug IN ('zzz-test-purga-d1', 'zzz-test-purga-d2') AND s.purga_avisada_el IS NULL     THEN 'FALLO — deberian haberse marcado juntos'
    END AS resultado
FROM negocios n
JOIN suscripciones s ON s.negocio_id = n.id
WHERE n.slug LIKE 'zzz-test-purga-%'
ORDER BY n.slug;

-- -----------------------------------------------------------------------------
-- PASO 4 — verificar fn_listar_negocios_pendientes_purga
-- -----------------------------------------------------------------------------
-- Esperado: solo A, D1, D2 (3 filas). D1/D2 deben mostrar telefono_contacto =
-- '0991234567' (el de D1, que es el negocio ancla por ser el primero creado).
--
-- set_config con is_local=true (tercer parámetro) solo dura la transacción
-- actual — si el SQL Editor ejecuta cada SELECT en su propia transacción
-- implícita, hay que repetir el set_config antes de esta llamada también.
SELECT set_config('request.jwt.claims', json_build_object('email', 'tu-email-superadmin@ejemplo.com')::text, true);

SELECT public.fn_listar_negocios_pendientes_purga();

-- -----------------------------------------------------------------------------
-- PASO 5 — limpiar TODO lo creado en esta prueba
-- -----------------------------------------------------------------------------
DELETE FROM suscripciones WHERE negocio_id IN (SELECT id FROM negocios WHERE slug LIKE 'zzz-test-purga-%');
DELETE FROM negocios WHERE slug LIKE 'zzz-test-purga-%';
DELETE FROM usuarios WHERE email LIKE 'zzz_test_purga_%@example.com';

-- Confirmar que no quedó nada:
-- SELECT COUNT(*) FROM negocios WHERE slug LIKE 'zzz-test-purga-%';  -- debe ser 0
