-- ==========================================
-- fn_home_dashboard (v2.0 — 2026-07-03)
-- ==========================================
-- v2.0 — Se eliminó la sección "últimos 5 movimientos" del home (el historial
--   vive en el detalle de cada cuenta). La RPC ya no devuelve la lista ni el
--   count: en su lugar devuelve `resumen_dia` con los agregados ingresos/egresos
--   del DÍA COMPLETO para los deltas del hero. Doble ganancia:
--     1. Menos trabajo por request: desaparecen los 4 JOINs por fila de la lista.
--     2. Corrección: antes el hero sumaba solo los últimos 5 movimientos como si
--        fueran "los del día" — ahora el agregado es del día entero.
--
-- Consolida en una sola RPC los datos del home/dashboard inicial.
-- Reemplaza las queries que home.cargarDatos() ejecutaba en Promise.all().
--
-- Multi-tenant: filtra por public.get_negocio_id() del JWT. No bloquea superadmin
-- (es lectura — el superadmin necesita poder ver el dashboard de cualquier negocio
-- que active).
--
-- LANGUAGE plpgsql STABLE: lectura pura.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_home_dashboard();

CREATE OR REPLACE FUNCTION public.fn_home_dashboard()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_negocio_id   UUID;
    v_inicio_dia   TIMESTAMPTZ;
    v_fin_dia      TIMESTAMPTZ;
    v_fecha_local  DATE;

    -- Estado de caja
    v_turno_activo        JSON;
    v_turnos_hoy          BIGINT;
    v_fecha_ultimo_cierre TEXT;

    -- Saldos virtuales (snapshot + post-snapshot)
    v_celular_snapshot   RECORD;
    v_bus_snapshot       RECORD;
    v_celular_post_sum   NUMERIC(12,2);
    v_bus_post_sum       NUMERIC(12,2);
    v_saldo_celular      NUMERIC(12,2);
    v_saldo_bus          NUMERIC(12,2);

    -- Resumen del día (deltas del hero) — agregados del día completo
    v_ingresos_hoy       NUMERIC(12,2);
    v_egresos_hoy        NUMERIC(12,2);

    -- IDs auxiliares
    v_tipo_celular_id    INTEGER;
    v_tipo_bus_id        INTEGER;
BEGIN
    v_negocio_id := public.get_negocio_id();

    -- Si no hay negocio (caso superadmin sin negocio activo), retornar shape vacío
    IF v_negocio_id IS NULL THEN
        RETURN json_build_object(
            'estado_caja', json_build_object(
                'estado', 'SIN_ABRIR',
                'turno_activo', NULL,
                'turnos_hoy', 0,
                'fecha_ultimo_cierre', NULL
            ),
            'saldos_virtuales', json_build_object('celular', 0, 'bus', 0),
            'resumen_dia', json_build_object('ingresos', 0, 'egresos', 0),
            'saldos_cajas', '[]'::JSON,
            'modulos', json_build_object(
                'varios_activa', FALSE,
                'celular_habilitada', FALSE,
                'bus_habilitada', FALSE
            )
        );
    END IF;

    -- Ventana del día en hora Ecuador (UTC-5, sin DST)
    v_fecha_local := (NOW() AT TIME ZONE 'America/Guayaquil')::DATE;
    v_inicio_dia  := (v_fecha_local::TIMESTAMP        AT TIME ZONE 'America/Guayaquil');
    v_fin_dia     := ((v_fecha_local + 1)::TIMESTAMP  AT TIME ZONE 'America/Guayaquil');

    v_tipo_celular_id := (SELECT id FROM tipos_servicio WHERE codigo = 'CELULAR');
    v_tipo_bus_id     := (SELECT id FROM tipos_servicio WHERE codigo = 'BUS');

    -- ════════════════════════════════════════════════════════════════
    -- 1. ESTADO DE CAJA — Turno activo (puede haber 0 o 1)
    -- ════════════════════════════════════════════════════════════════
    v_turno_activo := (
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
            WHERE tc.negocio_id = v_negocio_id
              AND tc.hora_fecha_cierre IS NULL
            LIMIT 1
        ) t
    );

    -- Count de turnos del día (cualquier estado)
    v_turnos_hoy := (
        SELECT COUNT(*)
        FROM turnos_caja
        WHERE negocio_id          = v_negocio_id
          AND hora_fecha_apertura >= v_inicio_dia
          AND hora_fecha_apertura <  v_fin_dia
    );

    -- Fecha del último cierre (como YYYY-MM-DD local)
    v_fecha_ultimo_cierre := (
        SELECT TO_CHAR(hora_fecha_cierre AT TIME ZONE 'America/Guayaquil', 'YYYY-MM-DD')
        FROM turnos_caja
        WHERE negocio_id = v_negocio_id
          AND hora_fecha_cierre IS NOT NULL
        ORDER BY hora_fecha_cierre DESC
        LIMIT 1
    );

    -- ════════════════════════════════════════════════════════════════
    -- 2. SALDOS VIRTUALES — snapshot de tabla `recargas` + post-snapshot de `recargas_virtuales`
    --    Equivalente a getSaldoVirtualActual() para CELULAR y BUS.
    -- ════════════════════════════════════════════════════════════════

    -- CELULAR: snapshot más reciente
    FOR v_celular_snapshot IN
        SELECT saldo_virtual_actual, created_at
        FROM recargas
        WHERE negocio_id = v_negocio_id
          AND tipo_servicio_id = v_tipo_celular_id
        ORDER BY created_at DESC
        LIMIT 1
    LOOP EXIT; END LOOP;

    -- CELULAR: sumar recargas posteriores al snapshot
    v_celular_post_sum := COALESCE((
        SELECT SUM(monto_virtual)
        FROM recargas_virtuales
        WHERE negocio_id = v_negocio_id
          AND tipo_servicio_id = v_tipo_celular_id
          AND created_at > COALESCE(v_celular_snapshot.created_at, '1900-01-01'::timestamptz)
    ), 0);

    v_saldo_celular := COALESCE(v_celular_snapshot.saldo_virtual_actual, 0) + v_celular_post_sum;

    -- BUS: snapshot más reciente
    FOR v_bus_snapshot IN
        SELECT saldo_virtual_actual, created_at
        FROM recargas
        WHERE negocio_id = v_negocio_id
          AND tipo_servicio_id = v_tipo_bus_id
        ORDER BY created_at DESC
        LIMIT 1
    LOOP EXIT; END LOOP;

    -- BUS: sumar recargas posteriores al snapshot
    v_bus_post_sum := COALESCE((
        SELECT SUM(monto_virtual)
        FROM recargas_virtuales
        WHERE negocio_id = v_negocio_id
          AND tipo_servicio_id = v_tipo_bus_id
          AND created_at > COALESCE(v_bus_snapshot.created_at, '1900-01-01'::timestamptz)
    ), 0);

    v_saldo_bus := COALESCE(v_bus_snapshot.saldo_virtual_actual, 0) + v_bus_post_sum;

    -- ════════════════════════════════════════════════════════════════
    -- 3. RESUMEN DEL DÍA — ingresos y egresos agregados del día completo.
    --    Alimenta los deltas del hero ("HOY +$X / -$Y"). Mismos tipos que
    --    sumaba el cliente (INGRESO+TRANSFERENCIA_ENTRANTE / EGRESO+
    --    TRANSFERENCIA_SALIENTE), pero sobre TODO el día — antes se sumaban
    --    solo los últimos 5 movimientos, lo que subestimaba los totales.
    -- ════════════════════════════════════════════════════════════════
    v_ingresos_hoy := COALESCE((
        SELECT SUM(monto)
        FROM operaciones_cajas
        WHERE negocio_id = v_negocio_id
          AND tipo_operacion IN ('INGRESO', 'TRANSFERENCIA_ENTRANTE')
          AND fecha >= v_inicio_dia
          AND fecha <  v_fin_dia
    ), 0);

    v_egresos_hoy := COALESCE((
        SELECT SUM(monto)
        FROM operaciones_cajas
        WHERE negocio_id = v_negocio_id
          AND tipo_operacion IN ('EGRESO', 'TRANSFERENCIA_SALIENTE')
          AND fecha >= v_inicio_dia
          AND fecha <  v_fin_dia
    ), 0);

    -- ════════════════════════════════════════════════════════════════
    -- 4. SALDOS DE CAJAS — lista completa de cajas activas del negocio
    --    Incluye saldo_actual, icono, color y descripcion para que el
    --    Home pueda renderizar las tarjetas sin depender del Realtime.
    --    El Realtime sigue cubriendo sincronizacion entre dispositivos;
    --    esta sección garantiza datos frescos en el dispositivo local
    --    tras cualquier operacion que mute cajas (cierre, pull-to-refresh).
    -- ════════════════════════════════════════════════════════════════

    -- ════════════════════════════════════════════════════════════════
    -- 5. FLAGS DE MÓDULOS — fuente de verdad para visibilidad de cards
    --    VARIOS:        cajas.activo = TRUE (reversible desde 2026-06-11 via
    --                   fn_configurar_caja_varios; desactivar pone activo = FALSE
    --                   conservando el historial)
    --    CAJA_CELULAR:  flag recargas_celular_habilitada (puede estar en BD pero desactivada)
    --    CAJA_BUS:      flag recargas_bus_habilitada     (igual que celular)
    -- ════════════════════════════════════════════════════════════════

    -- ════════════════════════════════════════════════════════════════
    -- 6. RETORNAR JSON CONSOLIDADO
    -- ════════════════════════════════════════════════════════════════
    RETURN json_build_object(
        'estado_caja', json_build_object(
            'turno_activo',        v_turno_activo,
            'turnos_hoy',          v_turnos_hoy,
            'fecha_ultimo_cierre', v_fecha_ultimo_cierre
        ),
        'saldos_virtuales', json_build_object(
            'celular', v_saldo_celular,
            'bus',     v_saldo_bus
        ),
        'resumen_dia', json_build_object(
            'ingresos', v_ingresos_hoy,
            'egresos',  v_egresos_hoy
        ),
        'saldos_cajas', COALESCE((
            SELECT json_agg(row_to_json(c) ORDER BY c.id)
            FROM (
                SELECT id, codigo, nombre, saldo_actual, activo,
                       icono, color, descripcion
                FROM cajas
                WHERE negocio_id = v_negocio_id
                  AND activo = TRUE
            ) c
        ), '[]'::JSON),
        'modulos', json_build_object(
            -- VARIOS: caja existente y activa (reversible via fn_configurar_caja_varios)
            'varios_activa', EXISTS (
                SELECT 1 FROM cajas
                WHERE negocio_id = v_negocio_id AND codigo = 'VARIOS' AND activo = TRUE
            ),
            -- CELULAR y BUS: flag de configuraciones (pueden existir en BD pero desactivadas)
            'celular_habilitada', COALESCE((
                SELECT valor = 'true' FROM configuraciones
                WHERE negocio_id = v_negocio_id AND clave = 'recargas_celular_habilitada'
            ), FALSE),
            'bus_habilitada', COALESCE((
                SELECT valor = 'true' FROM configuraciones
                WHERE negocio_id = v_negocio_id AND clave = 'recargas_bus_habilitada'
            ), FALSE)
        )
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_home_dashboard() FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_home_dashboard() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_home_dashboard IS
'v2.0 — Elimina la lista de "ultimos 5 movimientos" (la seccion del home se borro;
el historial vive en el detalle de cada cuenta). Devuelve resumen_dia con los
agregados ingresos/egresos del dia completo para los deltas del hero.
v1.4 — Agrega modulos: flags de visibilidad con fuente de verdad correcta por caja.
VARIOS: cajas.activo = TRUE (reversible via fn_configurar_caja_varios desde 2026-06-11).
CELULAR/BUS: flag en configuraciones (pueden existir en BD pero estar desactivadas).
v1.3 — Agrega saldos_cajas: lista completa de cajas activas. cargarDatos() del
Home es la unica fuente de verdad sin depender del timing del Realtime.
v1.0 — Consolida en 1 RPC los datos iniciales del home.
Multi-tenant: filtra por get_negocio_id(). Sin fn_assert_no_superadmin.';
