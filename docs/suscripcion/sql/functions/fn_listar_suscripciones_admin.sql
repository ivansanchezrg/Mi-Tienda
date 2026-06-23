-- =============================================================================
-- fn_listar_suscripciones_admin — Lista TODOS los negocios con su suscripción vigente
-- =============================================================================
-- Para la tab "Suscripciones" del panel /admin. Devuelve un negocio por fila con
-- su suscripción más reciente, el estado EFECTIVO (VENCIDA derivada por fecha),
-- días restantes y plan. En una sola query — evita N llamadas a fn_estado_suscripcion.
--
-- Solo superadmin. SECURITY DEFINER (lee todos los negocios salteando RLS). NO bloquea
-- al superadmin: es una función de lectura del panel.
--
-- Estado efectivo:
--   SUSPENDIDA / CANCELADA → ese estado (bloqueada)
--   vence_el < NOW()       → 'VENCIDA'   (bloqueada)
--   resto                  → estado guardado (TRIAL | ACTIVA)
--
-- Retorna: JSON array ordenado por negocio. Cada item:
--   { negocio_id, negocio_nombre, propietario_nombre, propietario_email,
--     estado, plan_codigo, plan_nombre, precio, periodo, vence_el, dias_restantes }
-- Negocios sin suscripción aún → estado 'SIN_SUSCRIPCION'.
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_listar_suscripciones_admin();

CREATE OR REPLACE FUNCTION public.fn_listar_suscripciones_admin()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_email         TEXT;
    v_caller_es_superadmin BOOLEAN;
    v_result               JSON;
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
        RAISE EXCEPTION 'Solo el superadmin puede listar las suscripciones';
    END IF;

    -- Una fila de suscripcion por negocio (negocio_id es UNIQUE) — JOIN directo, sin DISTINCT ON.
    SELECT COALESCE(json_agg(item ORDER BY item->>'negocio_nombre'), '[]'::json)
    INTO v_result
    FROM (
        SELECT json_build_object(
            'negocio_id',         n.id,
            'negocio_nombre',     n.nombre,
            'propietario_nombre', u.nombre,
            'propietario_email',  u.email,
            'plan_codigo',        p.codigo,
            'plan_nombre',        p.nombre,
            -- periodo_contratado: lo que eligio el cliente. precio: el que aplica a ese periodo.
            'periodo',            s.periodo_contratado,
            'precio',
                CASE
                    WHEN s.periodo_contratado = 'ANUAL' THEN p.precio_anual
                    ELSE p.precio_mensual
                END,
            'vence_el',           s.vence_el,
            -- Vencimiento por FECHA local (Ecuador), no por instante exacto — mismo criterio
            -- que fn_estado_suscripcion: el cliente opera todo su dia de corte. Asi el estado
            -- que ve el admin coincide con el que ve el cliente (no se desfasan por la hora).
            -- TRIAL vencido se distingue de ACTIVA vencida (contexto comercial opuesto).
            'estado',
                CASE
                    WHEN s.estado IS NULL                        THEN 'SIN_SUSCRIPCION'
                    WHEN s.estado IN ('SUSPENDIDA', 'CANCELADA') THEN s.estado
                    WHEN (s.vence_el AT TIME ZONE 'America/Guayaquil')::date
                          < (NOW()   AT TIME ZONE 'America/Guayaquil')::date
                        THEN CASE WHEN s.estado = 'TRIAL' THEN 'TRIAL_VENCIDO' ELSE 'VENCIDA' END
                    ELSE s.estado
                END,
            -- Dias de calendario en hora local (mismo criterio que fn_estado_suscripcion):
            -- vence hoy -> 0, manana -> 1. Restar timestamps daba "2" para manana (CEIL de 1.16).
            'dias_restantes',
                CASE
                    WHEN s.vence_el IS NULL THEN NULL
                    ELSE GREATEST(0,
                        (s.vence_el AT TIME ZONE 'America/Guayaquil')::date
                        - (NOW()    AT TIME ZONE 'America/Guayaquil')::date
                    )
                END
        ) AS item
        FROM negocios n
        LEFT JOIN usuarios      u ON u.id = n.propietario_usuario_id
        LEFT JOIN suscripciones s ON s.negocio_id = n.id
        LEFT JOIN planes        p ON p.id = s.plan_id
    ) sub;

    RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_listar_suscripciones_admin() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_listar_suscripciones_admin() TO authenticated;

NOTIFY pgrst, 'reload schema';
