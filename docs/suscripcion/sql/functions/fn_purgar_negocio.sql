-- =============================================================================
-- fn_purgar_negocio — Borrado real e irreversible de un negocio vencido
-- =============================================================================
-- Ver docs/PLAN-BORRADO-AUTOMATICO-NEGOCIOS.md (Fase 4). Disparada manualmente
-- por el superadmin desde /admin ("Purgar ahora") DESPUES de haber borrado la
-- carpeta de Storage del negocio (StorageService.deleteNegocioFolder).
--
-- Cinturon de seguridad: exige purga_programada_el IS NOT NULL Y vencida. Nunca
-- borra un negocio que no paso por el flujo de aviso de fn_marcar_negocios_para_purga
-- (descarta llamadas accidentales o prematuras desde la UI).
--
-- Orden de operaciones:
--   1. SET LOCAL app.purga_en_curso = 'true' — señal que permite a los triggers
--      de inmutabilidad (fn_proteger_operacion_caja, fn_bloquear_delete_movimiento,
--      fn_proteger_propietario_negocio) ceder durante esta purga.
--      SET LOCAL limita el efecto a esta transaccion — al terminar desaparece.
--   2. Borrado MANUAL y ORDENADO de las tablas hijas (hijos → padres). No se
--      confia en el CASCADE de negocios porque hay FK internas entre tablas del
--      negocio SIN ON DELETE CASCADE (ej: ventas_detalles.producto_id → productos)
--      que bloquean el borrado por orden no determinista. Borrar en orden explicito
--      evita tocar esas constraints (que protegen la integridad en operacion normal).
--   3. UPDATE negocios SET propietario_usuario_id = NULL — rompe el FK RESTRICT.
--   4. DELETE FROM negocios — borra el negocio y sus tablas restantes por CASCADE.
--      suscripcion_pagos NO se borra: su FK es ON DELETE SET NULL (historial
--      contable, se mantiene con negocio_id NULL). usuarios NUNCA se toca.
--
-- Parametros:
--   p_negocio_id UUID — negocio a purgar.
--
-- Retorna: JSON con { success, negocio_id, negocio_nombre, propietario_id,
--                     storage_prefix, tablas_afectadas }
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_purgar_negocio(UUID);

CREATE OR REPLACE FUNCTION public.fn_purgar_negocio(
    p_negocio_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_email         TEXT;
    v_caller_es_superadmin BOOLEAN;
    v_negocio              RECORD;
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
        RAISE EXCEPTION 'Solo el superadmin puede purgar un negocio';
    END IF;

    IF p_negocio_id IS NULL THEN
        RAISE EXCEPTION 'p_negocio_id es obligatorio';
    END IF;

    -- Capturar datos del negocio ANTES de borrar (se pierden tras el DELETE).
    -- FOR ... LOOP en vez de SELECT ... INTO (regla del proyecto: INTO rompe en
    -- Supabase con "relation does not exist").
    FOR v_negocio IN
        SELECT n.id, n.nombre, n.propietario_usuario_id,
               s.purga_programada_el
        FROM negocios n
        LEFT JOIN suscripciones s ON s.negocio_id = n.id
        WHERE n.id = p_negocio_id
    LOOP
        EXIT;
    END LOOP;

    IF v_negocio.id IS NULL THEN
        RAISE EXCEPTION 'El negocio no existe';
    END IF;

    -- Cinturon de seguridad: nunca purgar algo que no paso por el flujo de aviso
    -- (fn_marcar_negocios_para_purga) ni cuya gracia de 7 dias no haya vencido.
    IF v_negocio.purga_programada_el IS NULL THEN
        RAISE EXCEPTION 'Este negocio no esta marcado para purga (purga_programada_el es NULL)';
    END IF;
    IF v_negocio.purga_programada_el > NOW() THEN
        RAISE EXCEPTION 'La purga de este negocio aun no esta habilitada (programada para %)', v_negocio.purga_programada_el;
    END IF;

    -- 1. Señalizar a los triggers de inmutabilidad que este DELETE es una purga
    --    administrativa, no una operacion de usuario. SET LOCAL limita el efecto
    --    exactamente a esta transaccion.
    PERFORM set_config('app.purga_en_curso', 'true', true);

    -- 2. Borrado MANUAL ordenado (hijos → padres). Solo se listan las tablas cuya
    --    FK interna NO tiene ON DELETE CASCADE (esas serian bloqueadas por el CASCADE
    --    de negocios por orden no determinista). Las tablas pivote que SI tienen
    --    CASCADE hacia su padre (codigos_barras, producto_atributos,
    --    producto_presentaciones, template_*) se limpian solas al borrar el padre.

    -- 2a. ventas_detalles.producto_id → productos (SIN cascade). Borrar antes que productos.
    --     cuentas_cobrar.venta_id y kardex.producto_id tampoco tienen cascade.
    DELETE FROM ventas_detalles  WHERE venta_id IN (SELECT id FROM ventas WHERE negocio_id = p_negocio_id);
    DELETE FROM cuentas_cobrar   WHERE negocio_id = p_negocio_id;
    DELETE FROM kardex_inventario WHERE negocio_id = p_negocio_id;

    -- 2b. ventas.turno_id/cliente_id, recargas*.turno_id/caja_id (SIN cascade).
    --     Borrar antes que turnos_caja, cajas, clientes, productos.
    DELETE FROM ventas             WHERE negocio_id = p_negocio_id;
    DELETE FROM recargas           WHERE negocio_id = p_negocio_id;
    DELETE FROM recargas_virtuales WHERE negocio_id = p_negocio_id;
    DELETE FROM operaciones_cajas  WHERE negocio_id = p_negocio_id;

    -- 2c. turnos_caja.caja_id ahora es SET NULL, pero borramos turnos antes de cajas igual.
    DELETE FROM turnos_caja        WHERE negocio_id = p_negocio_id;
    DELETE FROM cajas              WHERE negocio_id = p_negocio_id;

    -- 2d. Catalogo de productos. productos.categoria_id → categorias_productos (SIN cascade),
    --     producto_atributos.atributo_opcion_id → atributo_opciones (SIN cascade).
    --     Al borrar productos se limpian codigos_barras, producto_atributos,
    --     producto_presentaciones (todas CASCADE hacia productos).
    DELETE FROM productos             WHERE negocio_id = p_negocio_id;
    DELETE FROM producto_templates    WHERE negocio_id = p_negocio_id;  -- limpia template_* por cascade
    DELETE FROM atributo_opciones     WHERE negocio_id = p_negocio_id;
    DELETE FROM atributos             WHERE negocio_id = p_negocio_id;
    DELETE FROM categorias_productos  WHERE negocio_id = p_negocio_id;
    DELETE FROM clientes              WHERE negocio_id = p_negocio_id;

    -- 3. Romper el FK RESTRICT (propietario_usuario_id es nullable desde 2026-06-30).
    UPDATE negocios SET propietario_usuario_id = NULL WHERE id = p_negocio_id;

    -- 4. Borrar el negocio. suscripcion_pagos queda con negocio_id = NULL (SET NULL).
    DELETE FROM negocios WHERE id = p_negocio_id;

    RETURN json_build_object(
        'success',          TRUE,
        'negocio_id',        v_negocio.id,
        'negocio_nombre',    v_negocio.nombre,
        'propietario_id',    v_negocio.propietario_usuario_id,
        'storage_prefix',    v_negocio.id::text || '/',
        'tablas_afectadas',  'Borrado ordenado de tablas hijas + DELETE negocios (CASCADE del resto). suscripcion_pagos conserva historial con negocio_id = NULL.'
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_purgar_negocio(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_purgar_negocio(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
