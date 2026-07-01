-- ==========================================
-- fn_home_dashboard (v1.1 — 2026-07-01)
-- ==========================================
-- v1.1 — Agrega oc.saldo_actual a los "últimos 5 movimientos" para que el
--   home muestre el saldo resultante bajo cada monto, igual que ya hace el
--   detalle de operaciones por caja (operaciones-caja.page). Antes solo se
--   veía el monto con signo, sin el saldo — inconsistente con el detalle.
--
-- Consolida en una sola RPC los datos del home/dashboard inicial.
-- Reemplaza las queries que home.cargarDatos() ejecutaba en Promise.all():
--
--   ANTES (Promise.all paralelo, limitado por la más lenta):
--     1-3. obtenerEstadoCaja()       → 3 queries a turnos_caja
--     4-5. getSaldoVirtualActual()   → 2 queries (snapshot + post-snapshot) por servicio × 2
--     ...
--     8-9. obtenerUltimosMovimientos + contarMovimientosHoy → 2 queries a operaciones_cajas
--
--   AHORA (1 sola RPC con todo): ~250-500ms en lugar de ~400-800ms
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

    -- Movimientos
    v_movimientos_hoy    JSON;
    v_total_movimientos  BIGINT;

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
            'movimientos', json_build_object('lista', '[]'::JSON, 'total', 0),
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
    -- 3. MOVIMIENTOS DEL DÍA — últimos 5 + count total
    --    Excluye solo APERTURA (fondo inicial, no aporta info al usuario).
    --    CIERRE sí se muestra — es un evento relevante del día.
    -- ════════════════════════════════════════════════════════════════
    v_movimientos_hoy := COALESCE((
        SELECT json_agg(row_to_json(m) ORDER BY m.fecha DESC)
        FROM (
            SELECT
                oc.id,
                oc.fecha,
                oc.tipo_operacion::TEXT  AS tipo_operacion,
                oc.monto,
                oc.saldo_actual,
                oc.descripcion,
                oc.comprobante_url,
                json_build_object('id', c.id, 'nombre', c.nombre, 'codigo', c.codigo) AS caja,
                CASE WHEN u.id IS NULL THEN NULL
                     ELSE json_build_object('id', u.id, 'nombre', u.nombre)
                END AS empleado,
                CASE
                    WHEN cat.id   IS NOT NULL THEN json_build_object('id', cat.id,   'nombre', cat.nombre,   'codigo', cat.codigo,   'tipo', cat.tipo)
                    WHEN cat_s.id IS NOT NULL THEN json_build_object('id', cat_s.id, 'nombre', cat_s.nombre, 'codigo', cat_s.codigo, 'tipo', cat_s.tipo)
                    ELSE NULL
                END AS categoria
            FROM operaciones_cajas oc
            INNER JOIN cajas c        ON c.id  = oc.caja_id
            LEFT  JOIN usuarios u     ON u.id  = oc.empleado_id
            LEFT  JOIN categorias_operaciones cat    ON cat.id = oc.categoria_id
            LEFT  JOIN categorias_sistema     cat_s  ON cat_s.id = oc.categoria_sistema_id
            WHERE oc.negocio_id = v_negocio_id
              AND oc.tipo_operacion != 'APERTURA'
              AND oc.fecha >= v_inicio_dia
              AND oc.fecha <  v_fin_dia
            ORDER BY oc.fecha DESC
            LIMIT 5
        ) m
    ), '[]'::JSON);

    v_total_movimientos := (
        SELECT COUNT(*)
        FROM operaciones_cajas
        WHERE negocio_id = v_negocio_id
          AND tipo_operacion != 'APERTURA'
          AND fecha >= v_inicio_dia
          AND fecha <  v_fin_dia
    );

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
        'movimientos', json_build_object(
            'lista', v_movimientos_hoy,
            'total', v_total_movimientos
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
'v1.4 — Agrega modulos: flags de visibilidad con fuente de verdad correcta por caja.
VARIOS: cajas.activo = TRUE (reversible via fn_configurar_caja_varios desde 2026-06-11).
CELULAR/BUS: flag en configuraciones (pueden existir en BD pero estar desactivadas).
v1.3 — Agrega saldos_cajas: lista completa de cajas activas. cargarDatos() del
Home es la unica fuente de verdad sin depender del timing del Realtime.
v1.2 — Movimientos: JOIN a categorias_sistema para mostrar nombre correcto.
v1.1 — Movimientos: excluye solo APERTURA (CIERRE ahora visible).
v1.0 — Consolida en 1 RPC los datos iniciales del home.
Multi-tenant: filtra por get_negocio_id(). Sin fn_assert_no_superadmin.';
