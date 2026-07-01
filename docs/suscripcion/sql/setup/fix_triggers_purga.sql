-- =============================================================================
-- fix_triggers_purga.sql — Permite que fn_purgar_negocio borre sin restricciones
-- =============================================================================
-- Ver docs/PLAN-BORRADO-AUTOMATICO-NEGOCIOS.md (Fase 4).
--
-- Problema: los triggers de inmutabilidad de operaciones_cajas, movimientos_empleados
-- y usuario_negocios bloquean el DELETE en CASCADE que dispara fn_purgar_negocio.
-- Ademas, turnos_caja.caja_id tiene ON DELETE RESTRICT que puede bloquear el CASCADE.
--
-- Solucion:
--   - Los 3 triggers verifican el setting de sesion app.purga_en_curso: si vale
--     'true', ceden y permiten el DELETE. fn_purgar_negocio activa ese setting con
--     SET LOCAL (efecto limitado a la transaccion) antes del DELETE.
--   - La FK turnos_caja.caja_id cambia de RESTRICT a SET NULL: si la caja ya fue
--     borrada por el CASCADE, el turno queda con caja_id = NULL en vez de bloquear.
--
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase.
-- Ya reflejado en docs/setup/schema.sql para resets completos.
-- =============================================================================


-- ── 1. fn_proteger_operacion_caja ──────────────────────────────────────────
-- Agrega bypass de purga al inicio. Resto de la logica intacta.

CREATE OR REPLACE FUNCTION fn_proteger_operacion_caja()
RETURNS TRIGGER AS $$
BEGIN
    -- Bypass: durante una purga administrativa el borrado esta permitido
    IF current_setting('app.purga_en_curso', true) = 'true' THEN
        RETURN OLD;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'No se pueden eliminar operaciones de caja. Para corregir, registrar una operacion inversa.';
    END IF;

    -- Whitelist: solo descripcion y comprobante_url pueden cambiar
    IF ROW(NEW.id, NEW.negocio_id, NEW.fecha, NEW.caja_id, NEW.empleado_id,
           NEW.tipo_operacion, NEW.monto, NEW.saldo_anterior, NEW.saldo_actual,
           NEW.categoria_id, NEW.tipo_referencia_id, NEW.referencia_id)
       IS DISTINCT FROM
       ROW(OLD.id, OLD.negocio_id, OLD.fecha, OLD.caja_id, OLD.empleado_id,
           OLD.tipo_operacion, OLD.monto, OLD.saldo_anterior, OLD.saldo_actual,
           OLD.categoria_id, OLD.tipo_referencia_id, OLD.referencia_id)
    THEN
        RAISE EXCEPTION 'Las operaciones de caja son inmutables. Solo se permite editar descripcion y comprobante_url. Para corregir montos, registrar una operacion inversa.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ── 2. fn_bloquear_delete_movimiento ───────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_bloquear_delete_movimiento()
RETURNS TRIGGER AS $$
BEGIN
    -- Bypass: durante una purga administrativa el borrado esta permitido
    IF current_setting('app.purga_en_curso', true) = 'true' THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'No se pueden eliminar movimientos de empleados. Para corregir, crear un movimiento de ajuste.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- ── 3. fn_proteger_propietario_negocio ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_proteger_propietario_negocio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_propietario_id  UUID;
    v_caller_es_super BOOLEAN;
BEGIN
    -- Bypass: durante una purga administrativa el borrado esta permitido
    IF current_setting('app.purga_en_curso', true) = 'true' THEN
        RETURN COALESCE(OLD, NEW);
    END IF;

    -- Resolver: la fila afectada pertenece al propietario del negocio?
    v_propietario_id := (SELECT propietario_usuario_id FROM negocios WHERE id = COALESCE(NEW.negocio_id, OLD.negocio_id));

    -- Si la fila no es del propietario, no aplica el trigger
    IF COALESCE(NEW.usuario_id, OLD.usuario_id) IS DISTINCT FROM v_propietario_id THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Es la membresia del propietario. Verificar si el caller es superadmin.
    v_caller_es_super := COALESCE(
        (SELECT es_superadmin FROM usuarios WHERE email = (auth.jwt() ->> 'email')),
        FALSE
    );

    IF v_caller_es_super THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Bloquear DELETE
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'No se puede eliminar la membresia del propietario del negocio. Solo el superadmin puede hacerlo.';
    END IF;

    -- Bloquear UPDATE que desactive o degrade
    IF TG_OP = 'UPDATE' THEN
        IF OLD.activo = TRUE AND NEW.activo = FALSE THEN
            RAISE EXCEPTION 'No se puede desactivar la membresia del propietario del negocio.';
        END IF;
        IF OLD.rol = 'ADMIN' AND NEW.rol IS DISTINCT FROM 'ADMIN' THEN
            RAISE EXCEPTION 'No se puede cambiar el rol del propietario del negocio (debe seguir siendo ADMIN).';
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;


-- ── 4. FK turnos_caja.caja_id: RESTRICT → SET NULL ─────────────────────────
-- Si el CASCADE borra cajas antes de turnos_caja, el RESTRICT bloquearia.
-- SET NULL permite que el turno quede con caja_id = NULL en ese caso.

ALTER TABLE turnos_caja
    DROP CONSTRAINT IF EXISTS turnos_caja_caja_id_fkey,
    ADD CONSTRAINT turnos_caja_caja_id_fkey
        FOREIGN KEY (caja_id) REFERENCES cajas(id) ON DELETE SET NULL;


NOTIFY pgrst, 'reload schema';
