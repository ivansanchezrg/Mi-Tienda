-- =============================================================================
-- trigger_proteger_propietario.sql
-- =============================================================================
-- Blinda la membresia del propietario de un negocio: nadie puede desactivarlo,
-- cambiar su rol o eliminar su fila en usuario_negocios — excepto el superadmin.
--
-- Razon: el propietario es el "dueño original" del negocio (negocios.propietario_usuario_id).
-- Si un admin secundario lo desactiva o degrada, el negocio queda sin su dueño operativo.
-- El superadmin mantiene la potestad de hacer correcciones a nivel plataforma
-- (ej: transferencia de propiedad por venta del negocio — funcionalidad futura).
--
-- Operaciones bloqueadas:
--   - UPDATE de activo (de TRUE a FALSE) sobre la fila del propietario
--   - UPDATE de rol (de ADMIN a EMPLEADO) sobre la fila del propietario
--   - DELETE sobre la fila del propietario
--
-- Operaciones permitidas:
--   - El propietario puede modificar sus propios datos (en tabla usuarios, no aqui)
--   - El superadmin puede hacer cualquier cosa (bypass del trigger via es_superadmin)
-- =============================================================================

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
    -- Resolver: ¿la fila afectada pertenece al propietario del negocio?
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
        -- El superadmin puede hacer cualquier modificacion
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

DROP TRIGGER IF EXISTS trg_proteger_propietario_negocio ON usuario_negocios;

CREATE TRIGGER trg_proteger_propietario_negocio
    BEFORE UPDATE OR DELETE ON usuario_negocios
    FOR EACH ROW EXECUTE FUNCTION public.fn_proteger_propietario_negocio();

NOTIFY pgrst, 'reload schema';
