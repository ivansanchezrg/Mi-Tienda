-- =============================================================================
-- fn_registrar_pago_propietario — El superadmin registra UN pago para el dueño
-- =============================================================================
-- La suscripcion se paga POR PROPIETARIO, no por sucursal (PRO = 1 negocio,
-- MAX = N negocios bajo UN solo precio). Por eso un pago renueva la suscripcion
-- de TODOS los negocios del propietario de una sola accion, con el MISMO plan,
-- periodo y vence_el — asi sus negocios quedan siempre sincronizados (se vencen,
-- suspenden y renuevan juntos). Espejo de fn_suspender_propietario_suscripcion.
--
-- Reemplaza el pago por-negocio (fn_registrar_pago_suscripcion) como flujo del
-- panel admin. Es el PUNTO UNICO de renovacion: hoy lo dispara el superadmin;
-- el dia que se integre una pasarela, su webhook llamaria a esta misma funcion.
--
-- Renovacion "desde el vencimiento": la base es el vencimiento mas PROXIMO entre
-- sus negocios (MIN(vence_el)) o HOY si ya vencio. Con la herencia de suscripcion
-- al crear negocio (fn_completar_onboarding) los negocios ya comparten fecha, asi
-- que MIN solo es la red de seguridad para datos viejos desfasados. El cliente que
-- paga por adelantado no pierde dias; al que pago tarde no se le regalan meses.
--
-- Modelo de datos (refactor 2026-06): el ESTADO de cada negocio se ACTUALIZA en
-- suscripciones (UPDATE — una fila por negocio). El PAGO se registra UNA sola vez en
-- suscripcion_pagos (historial financiero inmutable, monto real). Asi la suma de
-- ingresos es un SUM(monto) limpio, sin filas de sincronizacion con monto 0.
--
-- NO lleva fn_assert_no_superadmin: es una funcion que el superadmin SI ejecuta.
-- Valida internamente que el caller sea superadmin.
--
-- Negocios sin suscripcion previa del propietario igual reciben la fila de estado
-- (quedan alineados al plan/fecha que se esta cobrando).
--
-- Parametros:
--   p_propietario_id UUID    — propietario (usuarios.id) al que se le registra el pago
--   p_monto          DECIMAL — monto pagado (uno solo, cubre toda su suscripcion)
--   p_metodo_pago_id UUID    — FK a metodos_pago_suscripcion (NULL permitido)
--   p_plan_id        UUID    — plan a aplicar. Si NULL, conserva el plan vigente.
--   p_periodo        TEXT    — 'MENSUAL' | 'ANUAL'. Si NULL, conserva el de la fila vigente.
--   p_nota           TEXT    — referencia del pago / comprobante (opcional)
--
-- Retorna: JSON con { success, propietario_id, estado, plan_codigo, periodo,
--                     vence_el, negocios_afectados }
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_registrar_pago_propietario(UUID, DECIMAL, UUID, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_registrar_pago_propietario(
    p_propietario_id UUID,
    p_monto          DECIMAL,
    p_metodo_pago_id UUID DEFAULT NULL,
    p_plan_id        UUID DEFAULT NULL,
    p_periodo        TEXT DEFAULT NULL,
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
    v_plan_id              UUID;
    v_plan_codigo          TEXT;
    v_precio_anual         DECIMAL;
    v_periodo              TEXT;
    v_periodo_anterior     TEXT;
    v_vence_min            TIMESTAMPTZ;
    v_base                 TIMESTAMPTZ;
    v_nuevo_vence          TIMESTAMPTZ;
    v_negocio              RECORD;
    v_negocio_ancla        UUID;        -- negocio mas antiguo: se usa como ancla del pago
    v_afectados            INT := 0;
BEGIN
    v_caller_email := (auth.jwt() ->> 'email');
    IF v_caller_email IS NULL THEN
        RAISE EXCEPTION 'No hay sesion activa';
    END IF;

    v_caller_id            := (SELECT id            FROM usuarios WHERE email = v_caller_email);
    v_caller_es_superadmin := COALESCE((SELECT es_superadmin FROM usuarios WHERE email = v_caller_email), FALSE);

    IF NOT v_caller_es_superadmin THEN
        RAISE EXCEPTION 'Solo el superadmin puede registrar pagos de suscripcion';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM usuarios WHERE id = p_propietario_id) THEN
        RAISE EXCEPTION 'El propietario no existe';
    END IF;

    IF p_monto IS NULL OR p_monto < 0 THEN
        RAISE EXCEPTION 'El monto del pago no puede ser negativo';
    END IF;

    -- Validar metodo de pago si se especifico
    IF p_metodo_pago_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM metodos_pago_suscripcion WHERE id = p_metodo_pago_id AND activo = TRUE) THEN
        RAISE EXCEPTION 'El metodo de pago no existe o esta inactivo';
    END IF;

    -- El propietario debe tener al menos un negocio.
    IF NOT EXISTS (SELECT 1 FROM negocios WHERE propietario_usuario_id = p_propietario_id) THEN
        RAISE EXCEPTION 'El propietario no tiene negocios';
    END IF;

    -- Resolver plan: el indicado, o el de la suscripcion vigente del propietario.
    -- Hay una fila por negocio y todos sus negocios comparten plan → cualquier fila sirve.
    v_plan_id := COALESCE(
        p_plan_id,
        (SELECT s.plan_id FROM suscripciones s
         JOIN negocios n ON n.id = s.negocio_id
         WHERE n.propietario_usuario_id = p_propietario_id
         LIMIT 1)
    );
    IF v_plan_id IS NULL THEN
        RAISE EXCEPTION 'No se pudo determinar el plan: pasa p_plan_id o asegura que el propietario tenga una suscripcion previa';
    END IF;

    v_plan_codigo  := (SELECT codigo       FROM planes WHERE id = v_plan_id);
    v_precio_anual := (SELECT precio_anual FROM planes WHERE id = v_plan_id);
    IF v_plan_codigo IS NULL THEN
        RAISE EXCEPTION 'El plan indicado no existe';
    END IF;

    -- Resolver el periodo a cobrar: el indicado, o el de la suscripcion vigente, o MENSUAL.
    v_periodo_anterior := (SELECT s.periodo_contratado FROM suscripciones s
                           JOIN negocios n ON n.id = s.negocio_id
                           WHERE n.propietario_usuario_id = p_propietario_id
                           LIMIT 1);
    v_periodo := UPPER(COALESCE(NULLIF(TRIM(p_periodo), ''), v_periodo_anterior, 'MENSUAL'));

    IF v_periodo NOT IN ('MENSUAL', 'ANUAL') THEN
        RAISE EXCEPTION 'Periodo invalido: % (esperado MENSUAL o ANUAL)', v_periodo;
    END IF;

    -- Si se pide ANUAL, el plan debe ofrecerlo (precio_anual NO NULL).
    IF v_periodo = 'ANUAL' AND v_precio_anual IS NULL THEN
        RAISE EXCEPTION 'Este plan no ofrece pago anual';
    END IF;

    -- Base de la renovacion: el vencimiento MAS PROXIMO entre sus negocios (o NOW si
    -- ya vencio / no tiene). Un solo vence_el comun para TODOS — quedan sincronizados.
    -- Una fila por negocio → MIN directo, sin DISTINCT ON.
    v_vence_min := (
        SELECT MIN(s.vence_el)
        FROM suscripciones s
        JOIN negocios n ON n.id = s.negocio_id
        WHERE n.propietario_usuario_id = p_propietario_id
    );
    v_base        := GREATEST(COALESCE(v_vence_min, NOW()), NOW());
    v_nuevo_vence := v_base + (CASE WHEN v_periodo = 'ANUAL' THEN INTERVAL '1 year' ELSE INTERVAL '1 month' END);

    -- ACTUALIZAR el estado de CADA negocio del propietario a ACTIVA con el mismo plan,
    -- periodo y vence_el — quedan sincronizados. UPSERT por negocio_id (UNIQUE): si el
    -- negocio aun no tiene fila de suscripcion, se crea; si la tiene, se actualiza.
    -- El negocio mas antiguo (primero del loop) queda como ancla del pago.
    FOR v_negocio IN
        SELECT id FROM negocios WHERE propietario_usuario_id = p_propietario_id
        ORDER BY created_at ASC
    LOOP
        IF v_afectados = 0 THEN
            v_negocio_ancla := v_negocio.id;
        END IF;

        -- purga_avisada_el / purga_programada_el en NULL: un pago siempre cancela
        -- cualquier purga en curso (ver docs/suscripcion/SUSCRIPCION-README.md,
        -- seccion "Purga automatica de negocios vencidos") — el negocio vuelve
        -- a ACTIVA, no tiene sentido que siga marcado para borrarse.
        INSERT INTO suscripciones (negocio_id, plan_id, estado, periodo_contratado,
                                   inicia_el, vence_el, actualizada_por, updated_at,
                                   purga_avisada_el, purga_programada_el)
        VALUES (v_negocio.id, v_plan_id, 'ACTIVA', v_periodo, NOW(), v_nuevo_vence, v_caller_id, NOW(),
                NULL, NULL)
        ON CONFLICT (negocio_id) DO UPDATE SET
            plan_id            = EXCLUDED.plan_id,
            estado             = 'ACTIVA',
            periodo_contratado = EXCLUDED.periodo_contratado,
            inicia_el          = EXCLUDED.inicia_el,
            vence_el           = EXCLUDED.vence_el,
            actualizada_por    = EXCLUDED.actualizada_por,
            updated_at         = NOW(),
            purga_avisada_el    = NULL,
            purga_programada_el = NULL;

        v_afectados := v_afectados + 1;
    END LOOP;

    -- Registrar el pago UNA sola vez (historial financiero, monto real). Ligado al
    -- propietario; el negocio ancla da trazabilidad para reportes por negocio.
    INSERT INTO suscripcion_pagos (propietario_id, negocio_id, plan_id, periodo, monto,
                                   metodo_pago_id, vence_el, nota, registrada_por)
    VALUES (p_propietario_id, v_negocio_ancla, v_plan_id, v_periodo, p_monto,
            p_metodo_pago_id, v_nuevo_vence, p_nota, v_caller_id);

    RETURN json_build_object(
        'success',            TRUE,
        'propietario_id',     p_propietario_id,
        'estado',             'ACTIVA',
        'plan_codigo',        v_plan_codigo,
        'periodo',            v_periodo,
        'vence_el',           v_nuevo_vence,
        'negocios_afectados', v_afectados
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_registrar_pago_propietario(UUID, DECIMAL, UUID, UUID, TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_registrar_pago_propietario(UUID, DECIMAL, UUID, UUID, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
