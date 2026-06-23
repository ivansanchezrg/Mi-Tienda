-- =============================================================================
-- fn_configurar_caja_varios — Activa o desactiva la Caja Varios del negocio
-- =============================================================================
-- Desde 2026-06-11 la Caja Varios es potestad del ADMIN del negocio (antes era
-- opt-in permanente del superadmin via fn_configurar_modulos). Reversible.
--
-- Reglas:
--   - Solo un ADMIN del negocio activo (JWT) puede ejecutarla.
--   - Superadmin bloqueado (fn_assert_no_superadmin) — es operación del negocio.
--   - Activar: requiere monto > 0. Crea la caja si no existe, o la reactiva
--     (cajas.activo = TRUE) conservando su historial de operaciones.
--   - Desactivar: SALVAGUARDA — si la caja tiene saldo > 0 lanza excepción;
--     el admin debe traspasar el saldo a otra caja primero. La caja NO se
--     elimina: cajas.activo = FALSE la oculta del home, traspasos y operaciones
--     (CajasService y fn_home_dashboard filtran por activo = TRUE).
--   - El monto (caja_varios_transferencia_dia) se conserva al desactivar para
--     facilitar una futura reactivación.
--
-- Efectos en cascada (sin cambios en otras funciones — ya son flag-driven):
--   - fn_ejecutar_cierre_diario: flag false → transferencia_diaria = 0
--   - fn_registrar_operacion_manual: bloquea INGRESO/EGRESO sobre VARIOS
--   - fn_liquidar_ganancias: destino CAJA en lugar de VARIOS
--
-- Parámetros:
--   p_activar  BOOLEAN        — true = activar, false = desactivar
--   p_monto    DECIMAL(12,2)  — monto diario a transferir al cierre (requerido si p_activar)
--
-- Retorna: JSON { success, activa }
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_configurar_caja_varios(BOOLEAN, DECIMAL);

CREATE OR REPLACE FUNCTION public.fn_configurar_caja_varios(
    p_activar BOOLEAN,
    p_monto   DECIMAL(12,2) DEFAULT 0
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id UUID;
    v_caja_id    UUID;
    v_saldo      DECIMAL(12,2);
BEGIN
    PERFORM public.fn_assert_no_superadmin();

    v_negocio_id := public.get_negocio_id();
    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    -- Solo un ADMIN del negocio puede configurar la Caja Varios
    IF NOT EXISTS (
        SELECT 1
        FROM usuario_negocios un
        JOIN usuarios u ON u.id = un.usuario_id
        WHERE u.email      = public.get_email()
          AND un.negocio_id = v_negocio_id
          AND un.rol        = 'ADMIN'
          AND un.activo     = TRUE
    ) THEN
        RAISE EXCEPTION 'Solo un administrador del negocio puede configurar la Caja Varios';
    END IF;

    IF p_activar THEN
        -- ── ACTIVAR ──
        IF p_monto IS NULL OR p_monto <= 0 THEN
            RAISE EXCEPTION 'Para activar la Caja Varios debes indicar un monto diario mayor a $0';
        END IF;

        -- Crea la caja si no existe; si existe (desactivada o no), la reactiva
        INSERT INTO cajas (negocio_id, codigo, nombre, descripcion, saldo_actual, puede_tener_turno, icono, color, activo)
        VALUES (v_negocio_id, 'VARIOS', 'Varios', 'Fondo de emergencia', 0, FALSE, 'archive-outline', '#e06c00', TRUE)
        ON CONFLICT (negocio_id, codigo) DO UPDATE SET activo = TRUE;

        INSERT INTO configuraciones (negocio_id, clave, valor) VALUES
        (v_negocio_id, 'caja_varios_activa',            'true'),
        (v_negocio_id, 'caja_varios_transferencia_dia', p_monto::TEXT)
        ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = EXCLUDED.valor;

    ELSE
        -- ── DESACTIVAR ──
        v_caja_id := (SELECT id FROM cajas WHERE codigo = 'VARIOS' AND negocio_id = v_negocio_id);

        IF v_caja_id IS NOT NULL THEN
            -- Lock de la fila: evita carrera con un cierre diario en curso
            PERFORM id FROM cajas WHERE id = v_caja_id FOR UPDATE;
            v_saldo := (SELECT saldo_actual FROM cajas WHERE id = v_caja_id);

            IF v_saldo > 0 THEN
                RAISE EXCEPTION 'No puedes desactivar la Caja Varios con saldo ($%). Primero traspasa el saldo a otra caja.',
                    TO_CHAR(v_saldo, 'FM999990.00');
            END IF;

            UPDATE cajas SET activo = FALSE WHERE id = v_caja_id AND negocio_id = v_negocio_id;
        END IF;

        -- El monto (caja_varios_transferencia_dia) se conserva para reactivación
        INSERT INTO configuraciones (negocio_id, clave, valor)
        VALUES (v_negocio_id, 'caja_varios_activa', 'false')
        ON CONFLICT (negocio_id, clave) DO UPDATE SET valor = 'false';
    END IF;

    RETURN json_build_object('success', TRUE, 'activa', p_activar);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_configurar_caja_varios(BOOLEAN, DECIMAL) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_configurar_caja_varios(BOOLEAN, DECIMAL) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_configurar_caja_varios IS
'Activa/desactiva la Caja Varios del negocio activo (JWT). Solo ADMIN del negocio; superadmin bloqueado. '
'Activar: crea o reactiva la caja (cajas.activo = TRUE) + flag caja_varios_activa + monto. '
'Desactivar: exige saldo $0 (salvaguarda), oculta via cajas.activo = FALSE conservando historial. '
'Reemplaza el manejo de VARIOS que tenían fn_configurar_modulos / fn_configurar_modulos_admin (superadmin).';
