-- =============================================================================
-- fn_suspender_propietario_suscripcion — Suspender / reactivar a un propietario
-- =============================================================================
-- La suscripcion se paga POR PROPIETARIO, no por sucursal (PRO = 1 negocio,
-- MAX = N negocios, pero una sola suscripcion cubre todas). Por eso suspender a
-- un propietario por cobro bloquea TODOS sus negocios de una sola accion, via la
-- suscripcion de cada uno — asi cada sucursal muestra la pantalla de cobro
-- (WhatsApp + cuentas), no un muro seco.
--
-- Reemplaza a fn_suspender_suscripcion (que actuaba sobre 1 negocio puntual) y
-- a fn_suspender_usuario (que ponia usuarios.activo = FALSE — muro seco sin
-- canal de pago). El bloqueo de identidad por fraude se maneja fuera de este
-- modulo si alguna vez se necesita.
--
-- Por cada negocio del propietario ACTUALIZA el estado de su suscripcion (UPDATE —
-- una sola fila por negocio, modelo de estado mutable). Plan y vence_el se conservan
-- intactos (solo cambia el estado):
--   p_suspender = TRUE  → estado 'SUSPENDIDA' (el guard la trata como bloqueada).
--   p_suspender = FALSE → estado 'ACTIVA' (reactivacion: vuelve a operar hasta su corte).
--
-- Negocios sin suscripcion previa se omiten (no hay fila que actualizar).
--
-- NO lleva fn_assert_no_superadmin: es una funcion que el superadmin SI ejecuta.
--
-- Parametros:
--   p_propietario_id UUID    — propietario (usuarios.id) a suspender / reactivar
--   p_suspender      BOOLEAN — TRUE = suspender, FALSE = reactivar
--   p_nota           TEXT    — motivo (opcional). Se mantiene en la firma por compatibilidad,
--                             pero suspender/reactivar ya no escribe historial — no se persiste.
--
-- Retorna: JSON con { success, propietario_id, estado, negocios_afectados }
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_suspender_propietario_suscripcion(UUID, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION public.fn_suspender_propietario_suscripcion(
    p_propietario_id UUID,
    p_suspender      BOOLEAN,
    p_nota           TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_email         TEXT;
    v_caller_id            UUID;
    v_caller_es_superadmin BOOLEAN;
    v_nuevo_estado         TEXT;
    v_afectados            INT := 0;
BEGIN
    v_caller_email := (auth.jwt() ->> 'email');
    IF v_caller_email IS NULL THEN
        RAISE EXCEPTION 'No hay sesion activa';
    END IF;

    v_caller_id            := (SELECT id            FROM usuarios WHERE email = v_caller_email);
    v_caller_es_superadmin := COALESCE((SELECT es_superadmin FROM usuarios WHERE email = v_caller_email), FALSE);

    IF NOT v_caller_es_superadmin THEN
        RAISE EXCEPTION 'Solo el superadmin puede suspender o reactivar propietarios';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_propietario_id) THEN
        RAISE EXCEPTION 'El propietario no existe';
    END IF;

    v_nuevo_estado := CASE WHEN p_suspender THEN 'SUSPENDIDA' ELSE 'ACTIVA' END;

    -- Actualizar el estado de la suscripcion de TODOS los negocios del propietario de
    -- una sola sentencia. Plan, periodo y vence_el quedan intactos — solo cambia estado.
    -- Negocios sin fila de suscripcion simplemente no matchean (se omiten sin error).
    -- GET DIAGNOSTICS captura cuantas filas se actualizaron (negocios afectados).
    UPDATE suscripciones s
    SET estado          = v_nuevo_estado,
        actualizada_por = v_caller_id,
        updated_at      = NOW()
    FROM negocios n
    WHERE n.id = s.negocio_id
      AND n.propietario_usuario_id = p_propietario_id;

    GET DIAGNOSTICS v_afectados = ROW_COUNT;

    RETURN json_build_object(
        'success',            TRUE,
        'propietario_id',     p_propietario_id,
        'estado',             v_nuevo_estado,
        'negocios_afectados', v_afectados
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_suspender_propietario_suscripcion(UUID, BOOLEAN, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_suspender_propietario_suscripcion(UUID, BOOLEAN, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
