-- =============================================================================
-- fn_estado_suscripcion — Estado vigente de la suscripcion de un negocio
-- =============================================================================
-- Calcula el estado EFECTIVO de la suscripcion. Hay UNA fila por negocio (negocio_id
-- UNIQUE) — el estado vigente es directo, sin DISTINCT ON.
-- Los estados de vencimiento NO se almacenan: se derivan comparando vence_el con NOW()
-- (por fecha local). Esto evita inconsistencias (una fila 'ACTIVA' con fecha pasada) y
-- no necesita cron/jobs.
--
-- Reglas de derivacion del estado efectivo (por fecha de calendario, hora Ecuador):
--   - SUSPENDIDA / CANCELADA       → bloqueada = true  (bloqueo manual / cancelacion)
--   - TRIAL  + fecha de corte pasada → 'TRIAL_VENCIDO', bloqueada = true (nunca pago → ACTIVAR)
--   - ACTIVA + fecha de corte pasada → 'VENCIDA',        bloqueada = true (fue cliente → RENOVAR)
--   - resto                        → estado guardado (TRIAL | ACTIVA), bloqueada = false
--
-- El campo `bloqueada` resume las razones de bloqueo en un solo booleano — es lo unico
-- que el guard mira. El `estado` da el contexto comercial para el lenguaje/CTA de la UI.
--
-- Parametros:
--   p_negocio_id UUID — negocio a consultar. Si es NULL, usa get_negocio_id() del JWT.
--
-- Seguridad: SECURITY DEFINER (lee suscripciones + planes salteando RLS). Valida que
--   el negocio consultado sea el del JWT, salvo que el caller sea superadmin (soporte).
--   NO bloquea al superadmin — es una funcion de lectura.
--
-- Retorna: JSON con estado, plan, vence_el, dias_restantes, features, bloqueada.
--   Si el negocio no tiene suscripcion → { tiene_suscripcion: false, bloqueada: false }.
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_estado_suscripcion(UUID);

CREATE OR REPLACE FUNCTION public.fn_estado_suscripcion(
    p_negocio_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_email         TEXT;
    v_caller_es_superadmin BOOLEAN;
    v_negocio_id           UUID;
    v_sub                  RECORD;
    v_encontrada           BOOLEAN := FALSE;
    v_estado_efectivo      TEXT;
    v_bloqueada            BOOLEAN;
    v_dias_restantes       INT;
BEGIN
    v_caller_email := (auth.jwt() ->> 'email');
    IF v_caller_email IS NULL THEN
        RAISE EXCEPTION 'No hay sesion activa';
    END IF;

    v_caller_es_superadmin := COALESCE(
        (SELECT es_superadmin FROM usuarios WHERE email = v_caller_email),
        FALSE
    );

    -- Resolver negocio objetivo: parametro o el del JWT
    v_negocio_id := COALESCE(p_negocio_id, public.get_negocio_id());
    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No se especifico negocio y el JWT no tiene negocio_id';
    END IF;

    -- Aislamiento multi-tenant: solo el propio negocio o el superadmin (soporte)
    IF NOT v_caller_es_superadmin AND v_negocio_id <> public.get_negocio_id() THEN
        RAISE EXCEPTION 'No puedes consultar la suscripcion de otro negocio';
    END IF;

    -- Hay UNA fila de suscripcion por negocio (negocio_id es UNIQUE) — es el estado actual.
    -- periodo_contratado lo aporta la suscripcion (lo eligio el cliente al pagar); el plan
    -- define ambos precios. FOR ... LOOP en vez de SELECT ... INTO: en Supabase INTO rompe
    -- con "relation does not exist" (regla del proyecto). El loop lee la fila una sola vez.
    FOR v_sub IN
        SELECT s.estado, s.vence_el, s.plan_id, s.periodo_contratado,
               p.codigo AS plan_codigo, p.nombre AS plan_nombre,
               p.precio_mensual, p.precio_anual, p.features
        FROM suscripciones s
        JOIN planes p ON p.id = s.plan_id
        WHERE s.negocio_id = v_negocio_id
    LOOP
        v_encontrada := TRUE;
    END LOOP;

    IF NOT v_encontrada THEN
        RETURN json_build_object(
            'tiene_suscripcion', FALSE,
            'bloqueada',         FALSE
        );
    END IF;

    -- Derivar estado efectivo + bloqueo
    -- El vencimiento se evalua por FECHA DE CALENDARIO en hora local (Ecuador), NO por
    -- instante exacto del timestamp. Asi el cliente opera TODO su dia de corte: si vence
    -- "el 18", sigue activo todo el 18 local y recien se bloquea al iniciar el 19 local.
    -- Mismo criterio que el conteo de dias_restantes (abajo) → bloqueo y dias coherentes.
    --
    -- Al vencer por fecha distinguimos el ORIGEN, porque el contexto comercial es opuesto:
    --   TRIAL  + fecha pasada → 'TRIAL_VENCIDO' (nunca pago: la UI ofrece ACTIVAR el plan).
    --   ACTIVA + fecha pasada → 'VENCIDA'        (fue cliente: la UI ofrece RENOVAR).
    -- Ambos bloquean igual; solo cambia el lenguaje/CTA que muestra el frontend.
    IF v_sub.estado IN ('SUSPENDIDA', 'CANCELADA') THEN
        v_estado_efectivo := v_sub.estado;
        v_bloqueada       := TRUE;
    ELSIF (v_sub.vence_el AT TIME ZONE 'America/Guayaquil')::date
            < (NOW()       AT TIME ZONE 'America/Guayaquil')::date THEN
        v_estado_efectivo := CASE WHEN v_sub.estado = 'TRIAL' THEN 'TRIAL_VENCIDO' ELSE 'VENCIDA' END;
        v_bloqueada       := TRUE;
    ELSE
        v_estado_efectivo := v_sub.estado;  -- TRIAL | ACTIVA
        v_bloqueada       := FALSE;
    END IF;

    -- Dias restantes EN DIAS DE CALENDARIO (hora local de Ecuador), no en bloques de 24h.
    -- Restar timestamps con CEIL daba "2 dias" cuando vence manana (28h / 24 = 1.16 -> CEIL 2).
    -- El usuario cuenta dias de calendario: vence hoy -> 0, manana -> 1, pasado -> 2.
    -- vence_el se guarda en UTC; lo llevamos a fecha local antes de restar. No afecta indices
    -- (es una columna calculada sobre la fila ya seleccionada, no un WHERE).
    v_dias_restantes := GREATEST(0,
        (v_sub.vence_el AT TIME ZONE 'America/Guayaquil')::date
        - (NOW()        AT TIME ZONE 'America/Guayaquil')::date
    );

    RETURN json_build_object(
        'tiene_suscripcion', TRUE,
        'estado',            v_estado_efectivo,
        'bloqueada',         v_bloqueada,
        'plan_codigo',       v_sub.plan_codigo,
        'plan_nombre',       v_sub.plan_nombre,
        -- periodo_contratado: que eligio el cliente (MENSUAL|ANUAL).
        -- precio: el que aplica segun ese periodo (lo que realmente paga).
        'periodo',           v_sub.periodo_contratado,
        'precio',            CASE WHEN v_sub.periodo_contratado = 'ANUAL'
                                  THEN v_sub.precio_anual ELSE v_sub.precio_mensual END,
        -- Ambos precios del plan, por si la UI necesita mostrar el toggle/ahorro.
        'precio_mensual',    v_sub.precio_mensual,
        'precio_anual',      v_sub.precio_anual,
        'vence_el',          v_sub.vence_el,
        'dias_restantes',    v_dias_restantes,
        'features',          v_sub.features
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_estado_suscripcion(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_estado_suscripcion(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
