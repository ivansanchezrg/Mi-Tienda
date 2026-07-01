-- =============================================================================
-- fn_listar_negocios_pendientes_purga — Lista negocios en cuenta regresiva de purga
-- =============================================================================
-- Ver docs/PLAN-BORRADO-AUTOMATICO-NEGOCIOS.md (Fase 2/5). Solo lectura, para la
-- seccion del panel /admin que muestra a quien avisar y a quien purgar.
--
-- Devuelve un item POR NEGOCIO con purga_avisada_el IS NOT NULL (ya sea que solo
-- este en cuenta regresiva, o que purga_programada_el ya este vencida y el boton
-- "Purgar ahora" deba habilitarse). El campo `puede_purgar_ya` se calcula aqui
-- para que el frontend no tenga que repetir la comparacion de fecha.
--
-- telefono_contacto: telefono del NEGOCIO ANCLA del propietario (el mas antiguo,
-- created_at ASC) — mismo criterio "ancla" que ya usa fn_registrar_pago_propietario
-- para el pago. Un propietario puede tener varios negocios (plan MAX); se usa un
-- solo telefono de contacto para el aviso de WhatsApp en vez de pedir que el
-- superadmin elija entre varios.
--
-- Solo superadmin. SECURITY DEFINER (lee todos los negocios salteando RLS). NO
-- bloquea al superadmin — es una funcion de lectura.
--
-- Retorna: JSON array, un item por negocio:
--   { propietario_id, propietario_email, propietario_nombre, telefono_contacto,
--     negocio_id, negocio_nombre, vence_el, purga_avisada_el, purga_programada_el,
--     dias_restantes_purga, puede_purgar_ya }
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_listar_negocios_pendientes_purga();

CREATE OR REPLACE FUNCTION public.fn_listar_negocios_pendientes_purga()
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
        RAISE EXCEPTION 'Solo el superadmin puede listar negocios pendientes de purga';
    END IF;

    v_result := (
        SELECT COALESCE(json_agg(item ORDER BY item->>'purga_programada_el'), '[]'::json)
        FROM (
            SELECT json_build_object(
                'propietario_id',        n.propietario_usuario_id,
                'propietario_email',     u.email,
                'propietario_nombre',    u.nombre,
                'telefono_contacto',
                    (SELECT na.telefono
                     FROM negocios na
                     WHERE na.propietario_usuario_id = n.propietario_usuario_id
                     ORDER BY na.created_at ASC
                     LIMIT 1),
                'negocio_id',            n.id,
                'negocio_nombre',        n.nombre,
                'vence_el',              s.vence_el,
                'purga_avisada_el',      s.purga_avisada_el,
                'purga_programada_el',   s.purga_programada_el,
                -- Dias de calendario en hora local (mismo criterio que fn_estado_suscripcion).
                'dias_restantes_purga',
                    GREATEST(0,
                        (s.purga_programada_el AT TIME ZONE 'America/Guayaquil')::date
                        - (NOW()               AT TIME ZONE 'America/Guayaquil')::date
                    ),
                'puede_purgar_ya', s.purga_programada_el <= NOW()
            ) AS item
            FROM negocios n
            JOIN suscripciones s ON s.negocio_id = n.id
            JOIN usuarios      u ON u.id = n.propietario_usuario_id
            WHERE s.purga_avisada_el IS NOT NULL
        ) sub
    );

    RETURN COALESCE(v_result, '[]'::json);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_listar_negocios_pendientes_purga() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_listar_negocios_pendientes_purga() TO authenticated;

NOTIFY pgrst, 'reload schema';
