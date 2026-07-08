-- ==========================================
-- fn_upsert_cliente (v1.0)
-- ==========================================
-- Crea un cliente aceptando un UUID pre-generado en el cliente (Fase D,
-- PLAN-OFFLINE-CALLE-2026-07-03.md §6.5). Camino único para creación de clientes
-- — online (SeleccionarClienteModalComponent) y offline (drenado de outbox_clientes)
-- llaman a la misma función, mismo upsert, mismo bloqueo de superadmin.
--
-- Por qué "upsert" y no un simple INSERT (dos trampas de concurrencia resueltas):
--   1. Idempotencia por `id` (PK): si el drenado offline reintenta tras un fallo
--      parcial (el insert llegó al servidor pero la app murió antes de borrar la
--      fila de outbox_clientes), reenviar el mismo `p_id` debe responder success
--      con el registro existente, NO violar la PK. Mismo contrato que la
--      idempotency_key de fn_registrar_venta_pos: "duplicado = éxito".
--   2. Upsert por (negocio_id, identificacion): un cliente creado offline puede
--      tener una cédula que YA existe en el servidor (creada otro día / otro
--      dispositivo). Insertar de nuevo violaría el UNIQUE. Se reusa el registro
--      existente y se retorna su id — el caller (SyncService) remapea el
--      clienteId de las ventas encoladas de ese cliente al id real.
--
-- Orden de resolución: p_id existe → return ese registro (ignora el resto de
-- campos, ya fue creado); si no, identificacion existe → return el existente
-- (remap); si no, INSERT con el UUID recibido. EXCEPTION WHEN unique_violation
-- como red de seguridad ante una carrera entre dos requests concurrentes con la
-- misma identificación (caso legítimo de manejo de idempotencia, no catch-all).
--
-- NO reemplaza fn_registrar_venta_pos ni ninguna otra función — es exclusiva de
-- la creación de clientes. NO habilita FACTURA ni FIADO offline (§6.5.1): un
-- cliente creado por esta función es apto para TICKET/NOTA_VENTA igual que
-- cualquier otro cliente; la restricción de FACTURA/FIADO offline vive en el
-- frontend (POS) y no depende del origen del cliente.
-- ==========================================

CREATE OR REPLACE FUNCTION public.fn_upsert_cliente(
    p_id             UUID,
    p_nombre         VARCHAR(255),
    p_identificacion VARCHAR(20) DEFAULT NULL,
    p_telefono       VARCHAR(20) DEFAULT NULL,
    p_email          VARCHAR(100) DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id     UUID;
    v_existente_id   UUID;
    v_final_id       UUID;
    v_remapeado      BOOLEAN := FALSE;
BEGIN
    PERFORM public.fn_assert_no_superadmin();

    v_negocio_id := public.get_negocio_id();
    IF v_negocio_id IS NULL THEN
        RAISE EXCEPTION 'No hay negocio activo en el JWT';
    END IF;

    IF TRIM(COALESCE(p_nombre, '')) = '' THEN
        RAISE EXCEPTION 'El nombre del cliente es obligatorio';
    END IF;

    -- ────────── 1. Idempotencia por id (reintento tras fallo parcial) ──────────
    v_existente_id := (
        SELECT id FROM clientes WHERE id = p_id AND negocio_id = v_negocio_id
    );
    IF v_existente_id IS NOT NULL THEN
        RETURN json_build_object('success', true, 'cliente_id', v_existente_id, 'remapeado', false);
    END IF;

    -- ────────── 2. Upsert por (negocio_id, identificacion) ──────────
    IF p_identificacion IS NOT NULL AND TRIM(p_identificacion) <> '' THEN
        v_existente_id := (
            SELECT id FROM clientes
            WHERE negocio_id = v_negocio_id AND identificacion = TRIM(p_identificacion)
        );
        IF v_existente_id IS NOT NULL THEN
            RETURN json_build_object('success', true, 'cliente_id', v_existente_id, 'remapeado', true);
        END IF;
    END IF;

    -- ────────── 3. Insert con el UUID pre-generado ──────────
    BEGIN
        INSERT INTO clientes (id, negocio_id, nombre, identificacion, telefono, email, es_consumidor_final)
        VALUES (
            p_id, v_negocio_id, TRIM(p_nombre),
            NULLIF(TRIM(COALESCE(p_identificacion, '')), ''),
            NULLIF(TRIM(COALESCE(p_telefono, '')), ''),
            NULLIF(TRIM(COALESCE(p_email, '')), ''),
            FALSE
        );
        v_final_id := p_id;
    EXCEPTION WHEN unique_violation THEN
        -- Carrera: otro request creó el mismo cliente (mismo id o misma identificación)
        -- entre el SELECT y el INSERT. Reusar lo que haya ganado la carrera.
        v_final_id := (
            SELECT id FROM clientes
            WHERE negocio_id = v_negocio_id
              AND (id = p_id OR identificacion = NULLIF(TRIM(COALESCE(p_identificacion, '')), ''))
            LIMIT 1
        );
        v_remapeado := (v_final_id <> p_id);
    END;

    RETURN json_build_object('success', true, 'cliente_id', v_final_id, 'remapeado', v_remapeado);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_upsert_cliente(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_upsert_cliente(UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_upsert_cliente IS
    'v1.0 — Camino único de creación de clientes (online + drenado offline). '
    'Idempotente por id (reintentos) y por (negocio_id, identificacion) (upsert). '
    'Retorna cliente_id + remapeado=true si el caller debe reescribir referencias '
    'al UUID local (Fase D — outbox_clientes → outbox_ventas).';
