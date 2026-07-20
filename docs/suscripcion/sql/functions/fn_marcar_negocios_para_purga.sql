-- =============================================================================
-- fn_marcar_negocios_para_purga — Marca propietarios vencidos para purga diferida
-- =============================================================================
-- Ver docs/suscripcion/SUSCRIPCION-README.md, sección "Purga automática de
-- negocios vencidos". Job de detección, NO borra nada todavía — solo marca
-- purga_avisada_el/purga_programada_el en suscripciones para que el panel
-- /admin sepa a quién avisar y, 7 días después, a quién purgar.
--
-- Criterio de vencimiento (confirmado contra el codigo real): la
-- suscripcion se paga POR PROPIETARIO — fn_registrar_pago_propietario y
-- fn_suspender_propietario_suscripcion sincronizan vence_el/estado en TODOS los
-- negocios de un propietario en cada pago/suspension. MIN(vence_el) por
-- propietario es el mismo criterio que ya usa fn_registrar_pago_propietario como
-- "red de seguridad para datos viejos desfasados" — aqui se usa igual, no como
-- caso especial.
--
-- Solo marca propietarios cuyo estado efectivo (mismo criterio de fecha que
-- fn_estado_suscripcion, comparando por FECHA local Ecuador) sea TRIAL_VENCIDO o
-- VENCIDA. SUSPENDIDA/CANCELADA quedan excluidas SOLO de la deteccion (no
-- disparan el marcado por si mismas).
--
-- Importante: una vez que el propietario califica por OTRO negocio suyo vencido,
-- el UPDATE marca TODOS sus negocios sin filtrar por estado — incluye negocios
-- SUSPENDIDA/CANCELADA del mismo propietario. Decision consciente (confirmada
-- 2026-07-18): la facturacion es por propietario, no por negocio (ver decision #1
-- del plan) — si el propietario no paga, se purga TODO su grupo, sin excepcion
-- para negocios bloqueados por otros motivos.
--
-- Filtra MIN(vence_el) con >= 23 dias vencidos Y purga_avisada_el IS NULL (no
-- vuelve a marcar a quien ya esta en cuenta regresiva). Al marcar, actualiza
-- TODOS los negocios del propietario (no solo el del MIN), para que la purga
-- posterior los incluya a todos.
--
-- Quien la dispara: el superadmin desde el panel /admin (boton "Detectar
-- pendientes" o al cargar la seccion). No hay cron en este alcance (ver plan,
-- seccion "Diferido") — SECURITY DEFINER + validacion de superadmin, igual que
-- el resto de funciones del panel admin. No lleva fn_assert_no_superadmin (esa
-- funcion bloquea mutaciones OPERATIVAS del negocio; esto es administracion de
-- la plataforma).
--
-- Parametros: ninguno (evalua todos los propietarios vencidos del sistema).
--
-- Retorna: JSON array con un item POR NEGOCIO marcado:
--   { propietario_id, propietario_email, negocio_id, negocio_nombre,
--     vence_el, purga_programada_el }
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_marcar_negocios_para_purga();

CREATE OR REPLACE FUNCTION public.fn_marcar_negocios_para_purga()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_email         TEXT;
    v_caller_es_superadmin BOOLEAN;
    v_ahora                TIMESTAMPTZ := NOW();
    v_propietario           RECORD;
    v_purga_programada_el   TIMESTAMPTZ;
    v_negocios_marcados     UUID[] := ARRAY[]::UUID[];
    v_result                JSON;
BEGIN
    v_caller_email := (auth.jwt() ->> 'email');
    IF v_caller_email IS NULL THEN
        RAISE EXCEPTION 'No hay sesion activa';
    END IF;

    v_caller_es_superadmin := COALESCE(
        (SELECT es_superadmin FROM usuarios WHERE email = v_caller_email),
        FALSE
    );
    IF NOT v_caller_es_superadmin THEN
        RAISE EXCEPTION 'Solo el superadmin puede marcar negocios para purga';
    END IF;

    -- Propietarios candidatos: MIN(vence_el) por propietario, estado efectivo
    -- TRIAL_VENCIDO o VENCIDA (excluye SUSPENDIDA/CANCELADA), >= 23 dias vencido
    -- por fecha de calendario en hora local (mismo criterio que fn_estado_suscripcion),
    -- y aun no avisado (purga_avisada_el IS NULL en al menos uno de sus negocios).
    FOR v_propietario IN
        SELECT
            n.propietario_usuario_id AS propietario_id,
            u.email                  AS propietario_email,
            MIN(s.vence_el)          AS vence_el_min
        FROM negocios n
        JOIN suscripciones s ON s.negocio_id = n.id
        JOIN usuarios      u ON u.id = n.propietario_usuario_id
        WHERE s.estado NOT IN ('SUSPENDIDA', 'CANCELADA')
        GROUP BY n.propietario_usuario_id, u.email
        HAVING MIN(s.vence_el) IS NOT NULL
           AND (MIN(s.vence_el) AT TIME ZONE 'America/Guayaquil')::date
                 <= (v_ahora     AT TIME ZONE 'America/Guayaquil')::date - 23
           AND NOT EXISTS (
                SELECT 1 FROM suscripciones s2
                JOIN negocios n2 ON n2.id = s2.negocio_id
                WHERE n2.propietario_usuario_id = n.propietario_usuario_id
                  AND s2.purga_avisada_el IS NOT NULL
           )
    LOOP
        v_purga_programada_el := v_ahora + INTERVAL '7 days';

        UPDATE suscripciones s
        SET purga_avisada_el    = v_ahora,
            purga_programada_el = v_purga_programada_el
        FROM negocios n
        WHERE n.id = s.negocio_id
          AND n.propietario_usuario_id = v_propietario.propietario_id;

        v_negocios_marcados := v_negocios_marcados ||
            (SELECT array_agg(n3.id) FROM negocios n3 WHERE n3.propietario_usuario_id = v_propietario.propietario_id);
    END LOOP;

    -- Retorna un item por NEGOCIO marcado (no por propietario) para que el panel
    -- admin pueda listar/agrupar como prefiera.
    v_result := (
        SELECT COALESCE(json_agg(item ORDER BY item->>'negocio_nombre'), '[]'::json)
        FROM (
            SELECT json_build_object(
                'propietario_id',      n.propietario_usuario_id,
                'propietario_email',   u.email,
                'negocio_id',          n.id,
                'negocio_nombre',      n.nombre,
                'vence_el',            s.vence_el,
                'purga_programada_el', s.purga_programada_el
            ) AS item
            FROM negocios n
            JOIN suscripciones s ON s.negocio_id = n.id
            JOIN usuarios      u ON u.id = n.propietario_usuario_id
            WHERE n.id = ANY(v_negocios_marcados)
        ) sub
    );

    RETURN COALESCE(v_result, '[]'::json);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_marcar_negocios_para_purga() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_marcar_negocios_para_purga() TO authenticated;

NOTIFY pgrst, 'reload schema';
