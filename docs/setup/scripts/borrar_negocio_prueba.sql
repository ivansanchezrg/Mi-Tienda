-- =============================================================================
-- SCRIPT MANUAL — Borrar un negocio de prueba completo (con todo lo del onboarding)
-- =============================================================================
-- USO: solo en entornos de desarrollo/test. Reemplazar el UUID de abajo por el
-- negocio_id real que quieres borrar antes de ejecutar.
--
-- Que borra (via ON DELETE CASCADE desde negocios, ya definido en schema.sql):
--   cajas, configuraciones, categorias_operaciones, categorias_productos,
--   turnos_caja, operaciones_cajas, recargas, recargas_virtuales,
--   movimientos_empleados, atributos, atributo_opciones, producto_templates,
--   productos, template_atributos, template_atributo_opciones,
--   producto_presentaciones, codigos_barras, clientes, secuencias_comprobantes,
--   ventas (+ ventas_detalles en cascada), kardex_inventario, cuentas_cobrar,
--   notas, usuario_negocios, suscripciones.
--
-- Que NO borra (a proposito):
--   - usuarios: la cuenta de login del propietario/admin sigue existiendo,
--     puede volver a hacer onboarding de un negocio nuevo.
--   - suscripcion_pagos: el historico de pagos se conserva (ON DELETE SET NULL
--     en negocio_id) — solo se desvincula del negocio borrado.
--   - planes, categorias_sistema, metodos_pago_suscripcion: catalogos globales.
--
-- negocios.propietario_usuario_id tiene ON DELETE RESTRICT pero ya NO tiene NOT NULL
-- (eliminado en la implementacion de Fase 1 del borrado automatico, 2026-06-30,
-- para que fn_purgar_negocio pueda poner NULL transitoriamente antes del DELETE).
-- Por eso este script solo necesita el UPDATE + DELETE — sin ALTER TABLE.
-- =============================================================================

DO $$
DECLARE
    v_negocio_id UUID := '00000000-0000-0000-0000-000000000000'; -- ← REEMPLAZAR
BEGIN
    IF NOT EXISTS (SELECT 1 FROM negocios WHERE id = v_negocio_id) THEN
        RAISE EXCEPTION 'No existe ningun negocio con id %', v_negocio_id;
    END IF;

    -- 1. Liberar la FK RESTRICT del propietario antes de poder borrar.
    --    La columna ya es nullable (DROP NOT NULL aplicado en Supabase 2026-06-30).
    UPDATE negocios SET propietario_usuario_id = NULL WHERE id = v_negocio_id;

    -- 2. Borrar el negocio — dispara el CASCADE sobre las tablas listadas arriba.
    DELETE FROM negocios WHERE id = v_negocio_id;

    RAISE NOTICE 'Negocio % borrado correctamente.', v_negocio_id;
END $$;

-- =============================================================================
-- VERIFICACION (opcional, ejecutar despues)
-- =============================================================================
-- SELECT * FROM negocios WHERE id = '00000000-0000-0000-0000-000000000000'; -- debe devolver 0 filas
-- SELECT * FROM usuario_negocios WHERE negocio_id = '00000000-0000-0000-0000-000000000000'; -- 0 filas
-- SELECT * FROM suscripciones WHERE negocio_id = '00000000-0000-0000-0000-000000000000'; -- 0 filas
