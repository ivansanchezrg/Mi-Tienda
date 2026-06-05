-- =============================================================================
-- fn_datos_cierre_diario (v1.1 — 2026-06-05)
-- =============================================================================
-- Consolida en una sola RPC todos los datos que necesita el wizard de cierre
-- diario para cargarse. Reemplaza las 8-9 queries paralelas que hacía
-- cargarDatosIniciales() en cierre-diario.page.ts.
--
-- Datos retornados:
--   turno_activo          — turno abierto actualmente (con empleado JOIN)
--   saldos_virtuales      — snapshot + agregado (total actual visible en UI)
--   snapshot_virtuales    — solo el saldo_virtual_actual del último registro en recargas
--                           (se envía a fn_ejecutar_cierre_diario como p_saldo_anterior_*)
--   agregado_virtual_hoy  — recargas_virtuales posteriores al snapshot (informativo)
--   saldos_cajas          — saldo_actual de CAJA_CHICA, CAJA_CELULAR, CAJA_BUS
--   saldos_antes_cierre   — saldo_actual de CAJA y VARIOS (para preview antes→después)
--   transferencia_diaria_varios — monto configurado para transferir a VARIOS al cierre
--   transferencia_ya_hecha      — true si VARIOS ya recibió su transferencia hoy
--   resumen_turno         — ventas POS en efectivo + egresos del cajón en este turno
--   configuracion         — flags de módulos activos
--
-- Multi-tenant: filtra todo por public.get_negocio_id() del JWT.
-- STABLE: lectura pura — sin mutaciones.
-- Sin fn_assert_no_superadmin: el superadmin necesita ver el cierre del negocio activo.
-- =============================================================================

DROP FUNCTION IF EXISTS public.fn_datos_cierre_diario();

CREATE OR REPLACE FUNCTION public.fn_datos_cierre_diario()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id        UUID;

    -- Turno activo
    v_turno             JSON;
    v_turno_id          UUID;
    v_hora_apertura     TIMESTAMPTZ;

    -- IDs de cajas
    v_caja_id           UUID;
    v_caja_chica_id     UUID;
    v_varios_id         UUID;
    v_caja_celular_id   UUID;
    v_caja_bus_id       UUID;

    -- IDs de tipos de servicio
    v_tipo_celular_id   INTEGER;
    v_tipo_bus_id       INTEGER;

    -- Saldos de cajas
    v_saldo_caja_chica  NUMERIC(12,2);
    v_saldo_caja        NUMERIC(12,2);
    v_saldo_varios      NUMERIC(12,2);
    v_saldo_celular     NUMERIC(12,2);
    v_saldo_bus         NUMERIC(12,2);

    -- Saldos virtuales — snapshot + post-snapshot (mismo algoritmo que fn_home_dashboard)
    v_celular_snapshot_at   TIMESTAMPTZ;
    v_bus_snapshot_at       TIMESTAMPTZ;
    v_celular_snapshot_val  NUMERIC(12,2);
    v_bus_snapshot_val      NUMERIC(12,2);
    v_celular_agregado      NUMERIC(12,2);
    v_bus_agregado          NUMERIC(12,2);
    v_saldo_virtual_celular NUMERIC(12,2);
    v_saldo_virtual_bus     NUMERIC(12,2);

    -- Transferencia a VARIOS
    v_transferencia_diaria  NUMERIC(12,2);
    v_varios_ya_cobro       BOOLEAN;
    v_fecha_local           DATE;
    v_inicio_utc            TIMESTAMPTZ;
    v_fin_utc               TIMESTAMPTZ;
    v_cat_def_reponer CONSTANT UUID := 'a1000001-0000-0000-0000-000000000005';

    -- Resumen del turno
    v_ventas_pos_efectivo   NUMERIC(12,2);
    v_egresos               NUMERIC(12,2);

    -- Flags de módulos
    v_celular_habilitada    BOOLEAN;
    v_bus_habilitada        BOOLEAN;
    v_varios_activa         BOOLEAN;
BEGIN
    v_negocio_id := public.get_negocio_id();

    -- Shape vacío defensivo si no hay negocio en el JWT
    IF v_negocio_id IS NULL THEN
        RETURN json_build_object(
            'turno_activo',               NULL,
            'saldos_virtuales',           json_build_object('celular', 0, 'bus', 0),
            'agregado_virtual_hoy',       json_build_object('celular', 0, 'bus', 0),
            'saldos_cajas',               json_build_object('caja_chica_digital', 0, 'caja_celular', 0, 'caja_bus', 0),
            'saldos_antes_cierre',        json_build_object('caja', 0, 'varios', 0),
            'transferencia_diaria_varios',0,
            'transferencia_ya_hecha',     FALSE,
            'resumen_turno',              json_build_object('ventas_pos_efectivo', 0, 'egresos', 0),
            'configuracion',              json_build_object('recargas_celular_habilitada', FALSE, 'recargas_bus_habilitada', FALSE, 'caja_varios_activa', FALSE)
        );
    END IF;

    -- ── IDs de tipos de servicio ──────────────────────────────────────────────
    v_tipo_celular_id := (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR');
    v_tipo_bus_id     := (SELECT id FROM tipos_servicio WHERE codigo = 'BUS');

    -- ── IDs de cajas (VARIOS, CELULAR, BUS pueden no existir) ────────────────
    v_caja_id         := (SELECT id FROM cajas WHERE codigo = 'CAJA'         AND negocio_id = v_negocio_id AND activo = TRUE);
    v_caja_chica_id   := (SELECT id FROM cajas WHERE codigo = 'CAJA_CHICA'   AND negocio_id = v_negocio_id AND activo = TRUE);
    v_varios_id       := (SELECT id FROM cajas WHERE codigo = 'VARIOS'       AND negocio_id = v_negocio_id AND activo = TRUE);
    v_caja_celular_id := (SELECT id FROM cajas WHERE codigo = 'CAJA_CELULAR' AND negocio_id = v_negocio_id AND activo = TRUE);
    v_caja_bus_id     := (SELECT id FROM cajas WHERE codigo = 'CAJA_BUS'     AND negocio_id = v_negocio_id AND activo = TRUE);

    -- ── 1. TURNO ACTIVO ───────────────────────────────────────────────────────
    v_turno := (
        SELECT row_to_json(t)
        FROM (
            SELECT
                tc.id,
                tc.numero_turno,
                tc.empleado_id,
                tc.hora_fecha_apertura,
                tc.hora_fecha_cierre,
                tc.fondo_apertura,
                json_build_object('id', u.id, 'nombre', u.nombre) AS empleado
            FROM turnos_caja tc
            JOIN usuarios u ON u.id = tc.empleado_id
            WHERE tc.negocio_id    = v_negocio_id
              AND tc.hora_fecha_cierre IS NULL
            LIMIT 1
        ) t
    );

    -- Extraer id y hora_apertura para usarlos en resumen_turno
    v_turno_id      := (v_turno::jsonb ->> 'id')::UUID;
    v_hora_apertura := (v_turno::jsonb ->> 'hora_fecha_apertura')::TIMESTAMPTZ;

    -- ── 2. SALDOS DE CAJAS ───────────────────────────────────────────────────
    v_saldo_caja_chica := COALESCE((SELECT saldo_actual FROM cajas WHERE id = v_caja_chica_id),   0);
    v_saldo_caja       := COALESCE((SELECT saldo_actual FROM cajas WHERE id = v_caja_id),         0);
    v_saldo_varios     := COALESCE((SELECT saldo_actual FROM cajas WHERE id = v_varios_id),       0);
    v_saldo_celular    := COALESCE((SELECT saldo_actual FROM cajas WHERE id = v_caja_celular_id), 0);
    v_saldo_bus        := COALESCE((SELECT saldo_actual FROM cajas WHERE id = v_caja_bus_id),     0);

    -- ── 3. SALDOS VIRTUALES (snapshot + post-snapshot) ───────────────────────
    -- Mismo algoritmo que fn_home_dashboard y fn_ejecutar_cierre_diario:
    -- cutoff = created_at del último registro en tabla recargas por servicio.

    -- CELULAR
    v_celular_snapshot_at  := (SELECT r.created_at        FROM recargas r WHERE r.negocio_id = v_negocio_id AND r.tipo_servicio_id = v_tipo_celular_id ORDER BY r.created_at DESC LIMIT 1);
    v_celular_snapshot_val := (SELECT r.saldo_virtual_actual FROM recargas r WHERE r.negocio_id = v_negocio_id AND r.tipo_servicio_id = v_tipo_celular_id ORDER BY r.created_at DESC LIMIT 1);

    v_celular_agregado := COALESCE((
        SELECT SUM(rv.monto_virtual)
        FROM recargas_virtuales rv
        WHERE rv.negocio_id       = v_negocio_id
          AND rv.tipo_servicio_id = v_tipo_celular_id
          AND rv.created_at > COALESCE(v_celular_snapshot_at, '1900-01-01'::timestamptz)
    ), 0);

    v_saldo_virtual_celular := COALESCE(v_celular_snapshot_val, 0) + v_celular_agregado;

    -- BUS
    v_bus_snapshot_at  := (SELECT r.created_at          FROM recargas r WHERE r.negocio_id = v_negocio_id AND r.tipo_servicio_id = v_tipo_bus_id ORDER BY r.created_at DESC LIMIT 1);
    v_bus_snapshot_val := (SELECT r.saldo_virtual_actual FROM recargas r WHERE r.negocio_id = v_negocio_id AND r.tipo_servicio_id = v_tipo_bus_id ORDER BY r.created_at DESC LIMIT 1);

    v_bus_agregado := COALESCE((
        SELECT SUM(rv.monto_virtual)
        FROM recargas_virtuales rv
        WHERE rv.negocio_id       = v_negocio_id
          AND rv.tipo_servicio_id = v_tipo_bus_id
          AND rv.created_at > COALESCE(v_bus_snapshot_at, '1900-01-01'::timestamptz)
    ), 0);

    v_saldo_virtual_bus := COALESCE(v_bus_snapshot_val, 0) + v_bus_agregado;

    -- ── 4. TRANSFERENCIA A VARIOS ─────────────────────────────────────────────
    v_transferencia_diaria := COALESCE((
        SELECT valor::NUMERIC(12,2)
        FROM configuraciones
        WHERE negocio_id = v_negocio_id
          AND clave      = 'caja_varios_transferencia_dia'
    ), 0);

    -- Ventana UTC del día local (Ecuador UTC-5, sin DST) para aprovechar el índice
    v_fecha_local := (NOW() AT TIME ZONE 'America/Guayaquil')::DATE;
    v_inicio_utc  := (v_fecha_local::TIMESTAMP        AT TIME ZONE 'America/Guayaquil');
    v_fin_utc     := ((v_fecha_local + 1)::TIMESTAMP  AT TIME ZONE 'America/Guayaquil');

    v_varios_ya_cobro := FALSE;
    IF v_varios_id IS NOT NULL THEN
        v_varios_ya_cobro := EXISTS (
            SELECT 1
            FROM operaciones_cajas oc
            WHERE oc.negocio_id = v_negocio_id
              AND oc.caja_id    = v_varios_id
              AND oc.fecha     >= v_inicio_utc
              AND oc.fecha     <  v_fin_utc
              AND (
                oc.tipo_operacion = 'TRANSFERENCIA_ENTRANTE'
                OR (oc.tipo_operacion = 'INGRESO' AND oc.categoria_sistema_id = v_cat_def_reponer)
              )
        );
    END IF;

    -- ── 5. RESUMEN DEL TURNO ACTIVO ───────────────────────────────────────────
    -- Ventas POS en efectivo + egresos del cajón desde la apertura del turno.
    -- Si no hay turno activo, ambos son 0.
    v_ventas_pos_efectivo := 0;
    v_egresos             := 0;

    IF v_turno_id IS NOT NULL AND v_caja_chica_id IS NOT NULL THEN
        v_ventas_pos_efectivo := COALESCE((
            SELECT SUM(v.total)
            FROM ventas v
            WHERE v.turno_id    = v_turno_id
              AND v.negocio_id  = v_negocio_id
              AND v.metodo_pago = 'EFECTIVO'
              AND v.estado      = 'COMPLETADA'
        ), 0);

        v_egresos := COALESCE((
            SELECT SUM(oc.monto)
            FROM operaciones_cajas oc
            WHERE oc.caja_id    = v_caja_chica_id
              AND oc.negocio_id = v_negocio_id
              AND oc.tipo_operacion = 'EGRESO'
              AND oc.fecha    >= v_hora_apertura
        ), 0);
    END IF;

    -- ── 6. FLAGS DE MÓDULOS ───────────────────────────────────────────────────
    v_celular_habilitada := COALESCE((
        SELECT valor = 'true' FROM configuraciones
        WHERE negocio_id = v_negocio_id AND clave = 'recargas_celular_habilitada'
    ), FALSE);

    v_bus_habilitada := COALESCE((
        SELECT valor = 'true' FROM configuraciones
        WHERE negocio_id = v_negocio_id AND clave = 'recargas_bus_habilitada'
    ), FALSE);

    -- VARIOS: existencia real en BD (irreversible — si existe, está activa)
    v_varios_activa := v_varios_id IS NOT NULL;

    -- ── 7. RETORNAR JSON CONSOLIDADO ──────────────────────────────────────────
    RETURN json_build_object(
        'turno_activo',         v_turno,
        'saldos_virtuales',     json_build_object(
            'celular', v_saldo_virtual_celular,
            'bus',     v_saldo_virtual_bus
        ),
        'snapshot_virtuales',   json_build_object(
            'celular', COALESCE(v_celular_snapshot_val, 0),
            'bus',     COALESCE(v_bus_snapshot_val, 0)
        ),
        'agregado_virtual_hoy', json_build_object(
            'celular', v_celular_agregado,
            'bus',     v_bus_agregado
        ),
        'saldos_cajas',         json_build_object(
            'caja_chica_digital', v_saldo_caja_chica,
            'caja_celular',       v_saldo_celular,
            'caja_bus',           v_saldo_bus
        ),
        'saldos_antes_cierre',  json_build_object(
            'caja',   v_saldo_caja,
            'varios', v_saldo_varios
        ),
        'transferencia_diaria_varios', v_transferencia_diaria,
        'transferencia_ya_hecha',      v_varios_ya_cobro,
        'resumen_turno',        json_build_object(
            'ventas_pos_efectivo', v_ventas_pos_efectivo,
            'egresos',             v_egresos
        ),
        'configuracion',        json_build_object(
            'recargas_celular_habilitada', v_celular_habilitada,
            'recargas_bus_habilitada',     v_bus_habilitada,
            'caja_varios_activa',          v_varios_activa
        )
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_datos_cierre_diario() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_datos_cierre_diario() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_datos_cierre_diario IS
'v1.1 — Agrega snapshot_virtuales (valor puro del último registro en recargas, sin agregado).
La página usa saldos_virtuales para mostrar el total en UI y snapshot_virtuales para enviarlo
como p_saldo_anterior_* a fn_ejecutar_cierre_diario (el SQL recalcula el agregado internamente).
v1.0: Consolida en 1 RPC todos los datos iniciales del wizard de cierre diario.
Multi-tenant: filtra por get_negocio_id(). STABLE: lectura pura.
Sin fn_assert_no_superadmin: el superadmin necesita ver el wizard del negocio activo.';
