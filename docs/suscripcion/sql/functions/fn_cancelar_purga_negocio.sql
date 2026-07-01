-- =============================================================================
-- fn_cancelar_purga_negocio — Excepcion de soporte: cancela la purga sin pago
-- =============================================================================
-- Ver docs/PLAN-BORRADO-AUTOMATICO-NEGOCIOS.md (Fase 5). Limpia
-- purga_avisada_el/purga_programada_el de TODOS los negocios del propietario
-- SIN que medie un pago real — a diferencia de fn_registrar_pago_propietario,
-- que tambien limpia estas columnas pero como efecto secundario de un pago.
--
-- Caso de uso: el superadmin decide, por excepcion de soporte, dar mas tiempo a
-- un propietario que ya esta en cuenta regresiva (ej. prometio pagar en dias,
-- esta resolviendo un problema con el metodo de pago, etc.) sin registrar un
-- pago que no existio.
--
-- No toca estado, plan ni vence_el — solo las columnas de purga.
--
-- Parametros:
--   p_propietario_id UUID — propietario a quien cancelar la purga.
--
-- Retorna: JSON con { success, propietario_id, negocios_afectados }
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_cancelar_purga_negocio(UUID);

CREATE OR REPLACE FUNCTION public.fn_cancelar_purga_negocio(
    p_propietario_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_email         TEXT;
    v_caller_es_superadmin BOOLEAN;
    v_afectados            INT := 0;
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
        RAISE EXCEPTION 'Solo el superadmin puede cancelar una purga programada';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_propietario_id) THEN
        RAISE EXCEPTION 'El propietario no existe';
    END IF;

    UPDATE suscripciones s
    SET purga_avisada_el    = NULL,
        purga_programada_el = NULL
    FROM negocios n
    WHERE n.id = s.negocio_id
      AND n.propietario_usuario_id = p_propietario_id;

    GET DIAGNOSTICS v_afectados = ROW_COUNT;

    RETURN json_build_object(
        'success',            TRUE,
        'propietario_id',     p_propietario_id,
        'negocios_afectados', v_afectados
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_cancelar_purga_negocio(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_cancelar_purga_negocio(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
