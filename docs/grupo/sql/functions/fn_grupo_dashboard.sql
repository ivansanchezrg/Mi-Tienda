-- ==========================================
-- fn_grupo_dashboard (v1.0 — 2026-07-02)
-- ==========================================
-- RPC ÚNICA del dashboard "Resumen general" multi-negocio (plan MAX). Devuelve en
-- un solo JSON todo lo que la parte superior del dashboard necesita, para
-- minimizar round-trips:
--
--   • grupo    → KPIs consolidados del grupo (ventas, ganancia, ticket,
--                clientes, descuentos, anuladas) + comparativa contra el período
--                anterior (mismos días retrocedidos) para las flechas ↑↓.
--   • negocios → una fila por negocio del propietario con: ventas,
--                clientes únicos, ticket promedio, productos vendidos (unidades),
--                ganancia, participación % en el total del grupo, variación vs
--                período anterior, y deuda fiado por cobrar. Alimenta tanto la
--                tabla de rendimiento como el donut de participación. Incluye
--                negocios SIN ventas (monto 0) — es señal accionable, no ruido.
--
-- Absorbe y reemplaza a fn_grupo_resumen_ventas y fn_grupo_ventas_por_sucursal
-- (borradas): consolida ambas en una sola llamada.
--
-- DEUDA FIADO = SNAPSHOT ACTUAL (no acotada al período). "Plata en la calle":
-- todo el fiado pendiente vigente hoy, igual que fn_resumir_cuentas_cobrar del
-- módulo Clientes (ventas FIADO + COMPLETADA + estado_pago PENDIENTE/PAGADO_PARCIAL,
-- menos abonos en cuentas_cobrar). NO depende de p_fecha_inicio/p_fecha_fin.
--
-- SEGURIDAD (crítico): SECURITY DEFINER bypassa RLS. La función NO recibe
-- negocio_id del cliente — deriva la lista blanca de negocios internamente vía
-- propietario_usuario_id = <usuario del JWT> (get_email() → usuarios.id). Un
-- usuario solo consolida SUS negocios; nunca los de otro propietario. Todas las
-- agregaciones filtran por negocio_id = ANY(v_negocios). Si el usuario no es
-- propietario de ningún negocio, devuelve shape de ceros.
--
-- No lleva fn_assert_no_superadmin: lectura pura. El superadmin no es propietario
-- de negocios en el flujo normal → lista vacía → ceros. Correcto.
--
-- ÍNDICE: el WHERE de cada bloque acota `fecha` por rango UTC en variables
-- (v_inicio/v_fin como TIMESTAMPTZ), nunca (fecha AT TIME ZONE ...)::date — así
-- se conserva el índice (negocio_id, fecha). Misma regla que el resto del proyecto.
--
-- LANGUAGE plpgsql STABLE: lectura pura.
-- ==========================================

DROP FUNCTION IF EXISTS public.fn_grupo_dashboard(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.fn_grupo_dashboard(
    p_fecha_inicio TEXT,
    p_fecha_fin    TEXT
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_usuario_id      UUID;
    v_negocios        UUID[];          -- lista blanca de negocios del propietario
    v_inicio          TIMESTAMPTZ;
    v_fin             TIMESTAMPTZ;
    v_dias_rango      INTEGER;
    v_inicio_anterior TIMESTAMPTZ;
    v_fin_anterior    TIMESTAMPTZ;

    v_actuales           RECORD;   -- COUNTs/SUMs período actual sobre ventas
    v_detalles_actuales  RECORD;   -- costo + ganancia + unidades actual (ventas_detalles)
    v_anteriores         RECORD;   -- período anterior sobre ventas
    v_ganancia_anterior  NUMERIC(12,2);

    v_margen_pct         NUMERIC(5,2);
    v_ticket_promedio    NUMERIC(12,2);
    v_total_grupo        NUMERIC(12,2);   -- monto total grupo (para participación %)
    v_negocios_json      JSON;
BEGIN
    -- ── Resolver propietario + lista blanca de negocios (nunca desde parámetro) ──
    v_usuario_id := (SELECT id FROM usuarios WHERE email = public.get_email());

    v_negocios := ARRAY(
        SELECT id FROM negocios WHERE propietario_usuario_id = v_usuario_id
    );

    -- Sin negocios propios → shape de ceros (defensa en profundidad; el frontend
    -- ya no debería llamar aquí si el gate < 2).
    IF v_usuario_id IS NULL OR COALESCE(array_length(v_negocios, 1), 0) = 0 THEN
        RETURN json_build_object(
            'fecha_inicio', p_fecha_inicio,
            'fecha_fin',    p_fecha_fin,
            'grupo', json_build_object(
                'total_negocios', 0,
                'total_ventas', 0, 'total_monto', 0,
                'total_anuladas', 0, 'monto_anulado', 0,
                'total_descuentos', 0, 'clientes_unicos', 0,
                'unidades_vendidas', 0,
                'costo_total', 0, 'ganancia_bruta', 0,
                'margen_pct', 0, 'ticket_promedio', 0,
                'deuda_fiado', 0,
                'total_monto_anterior', 0, 'total_ventas_anterior', 0,
                'ganancia_anterior', 0
            ),
            'negocios', '[]'::JSON
        );
    END IF;

    -- ── Rangos (fin exclusivo; período anterior = mismos días retrocedidos) ──────
    v_inicio := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin    := ((p_fecha_fin::DATE + 1)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    v_dias_rango      := (p_fecha_fin::DATE - p_fecha_inicio::DATE) + 1;
    v_inicio_anterior := ((p_fecha_inicio::DATE - v_dias_rango)::TIMESTAMP AT TIME ZONE 'America/Guayaquil');
    v_fin_anterior    := (p_fecha_inicio::DATE::TIMESTAMP AT TIME ZONE 'America/Guayaquil');

    -- ══════════════════════════════════════════════════════════════════════════
    -- BLOQUE GRUPO — KPIs consolidados
    -- ══════════════════════════════════════════════════════════════════════════

    -- Agregados período actual sobre `ventas`
    FOR v_actuales IN
        SELECT
            COALESCE(COUNT(*) FILTER (WHERE estado = 'COMPLETADA'), 0)::BIGINT          AS total_ventas,
            COALESCE(SUM(total) FILTER (WHERE estado = 'COMPLETADA'), 0)::NUMERIC(12,2) AS total_monto,
            COALESCE(COUNT(*) FILTER (WHERE estado = 'ANULADA'), 0)::BIGINT             AS total_anuladas,
            COALESCE(SUM(total) FILTER (WHERE estado = 'ANULADA'), 0)::NUMERIC(12,2)    AS monto_anulado,
            COALESCE(SUM(descuento) FILTER (WHERE estado = 'COMPLETADA'), 0)::NUMERIC(12,2) AS total_descuentos,
            COALESCE(
                COUNT(DISTINCT cliente_id) FILTER (WHERE estado = 'COMPLETADA' AND cliente_id IS NOT NULL),
                0
            )::BIGINT                                                                   AS clientes_unicos
        FROM ventas
        WHERE negocio_id = ANY(v_negocios)
          AND fecha >= v_inicio
          AND fecha <  v_fin
    LOOP EXIT; END LOOP;

    -- Costo + ganancia + unidades actual sobre `ventas_detalles`
    FOR v_detalles_actuales IN
        SELECT
            COALESCE(SUM(vd.precio_costo * vd.cantidad), 0)::NUMERIC(12,2)                        AS costo_total,
            COALESCE(SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad), 0)::NUMERIC(12,2) AS ganancia_bruta,
            COALESCE(SUM(vd.cantidad), 0)::NUMERIC(12,2)                                          AS unidades_vendidas
        FROM ventas_detalles vd
        JOIN ventas v ON v.id = vd.venta_id
        WHERE v.negocio_id = ANY(v_negocios)
          AND v.estado = 'COMPLETADA'
          AND v.fecha >= v_inicio AND v.fecha < v_fin
    LOOP EXIT; END LOOP;

    v_total_grupo     := v_actuales.total_monto;
    v_margen_pct      := CASE WHEN v_actuales.total_monto > 0
                              THEN ROUND((v_detalles_actuales.ganancia_bruta / v_actuales.total_monto) * 100, 2)
                              ELSE 0 END;
    v_ticket_promedio := CASE WHEN v_actuales.total_ventas > 0
                              THEN ROUND(v_actuales.total_monto / v_actuales.total_ventas, 2)
                              ELSE 0 END;

    -- Agregados período anterior sobre `ventas` (para comparativa)
    FOR v_anteriores IN
        SELECT
            COALESCE(SUM(total) FILTER (WHERE estado = 'COMPLETADA'), 0)::NUMERIC(12,2) AS total_monto,
            COALESCE(COUNT(*)   FILTER (WHERE estado = 'COMPLETADA'), 0)::BIGINT        AS total_ventas
        FROM ventas
        WHERE negocio_id = ANY(v_negocios)
          AND fecha >= v_inicio_anterior
          AND fecha <  v_fin_anterior
    LOOP EXIT; END LOOP;

    -- Ganancia período anterior sobre `ventas_detalles`
    v_ganancia_anterior := COALESCE((
        SELECT SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad)
        FROM ventas_detalles vd
        JOIN ventas v ON v.id = vd.venta_id
        WHERE v.negocio_id = ANY(v_negocios)
          AND v.estado = 'COMPLETADA'
          AND v.fecha >= v_inicio_anterior AND v.fecha < v_fin_anterior
    ), 0);

    -- ══════════════════════════════════════════════════════════════════════════
    -- BLOQUE NEGOCIOS — una fila por sucursal (tabla + donut)
    -- Deuda fiado: snapshot actual (NO acotada al período).
    -- ══════════════════════════════════════════════════════════════════════════
    v_negocios_json := (
        SELECT COALESCE(json_agg(row_to_json(fila) ORDER BY fila.total_monto DESC, fila.nombre ASC), '[]'::JSON)
        FROM (
            WITH negocios_grupo AS (
                SELECT n.id, n.nombre
                FROM negocios n
                WHERE n.id = ANY(v_negocios)
            ),
            -- Ventas + clientes del período actual por negocio
            actual AS (
                SELECT v.negocio_id,
                       COUNT(*)::BIGINT                                        AS ventas,
                       COALESCE(SUM(v.total), 0)::NUMERIC(12,2)               AS monto,
                       COUNT(DISTINCT v.cliente_id)
                           FILTER (WHERE v.cliente_id IS NOT NULL)::BIGINT    AS clientes
                FROM ventas v
                WHERE v.negocio_id = ANY(v_negocios)
                  AND v.estado = 'COMPLETADA'
                  AND v.fecha >= v_inicio AND v.fecha < v_fin
                GROUP BY v.negocio_id
            ),
            -- Ganancia + unidades del período actual por negocio
            detalle AS (
                SELECT v.negocio_id,
                       COALESCE(SUM((vd.precio_unitario - vd.precio_costo) * vd.cantidad), 0)::NUMERIC(12,2) AS ganancia,
                       COALESCE(SUM(vd.cantidad), 0)::NUMERIC(12,2)                                          AS unidades
                FROM ventas_detalles vd
                JOIN ventas v ON v.id = vd.venta_id
                WHERE v.negocio_id = ANY(v_negocios)
                  AND v.estado = 'COMPLETADA'
                  AND v.fecha >= v_inicio AND v.fecha < v_fin
                GROUP BY v.negocio_id
            ),
            -- Monto del período anterior por negocio (para la variación)
            anterior AS (
                SELECT v.negocio_id,
                       COALESCE(SUM(v.total), 0)::NUMERIC(12,2) AS monto
                FROM ventas v
                WHERE v.negocio_id = ANY(v_negocios)
                  AND v.estado = 'COMPLETADA'
                  AND v.fecha >= v_inicio_anterior AND v.fecha < v_fin_anterior
                GROUP BY v.negocio_id
            ),
            -- Deuda fiado SNAPSHOT por negocio (todo el pendiente vigente hoy).
            -- Espeja fn_resumir_cuentas_cobrar: FIADO + COMPLETADA + estado_pago
            -- PENDIENTE/PAGADO_PARCIAL, menos abonos en cuentas_cobrar por venta.
            fiado AS (
                SELECT v.negocio_id,
                       COALESCE(SUM(v.total - COALESCE(pg.total_pagado, 0)), 0)::NUMERIC(12,2) AS deuda
                FROM ventas v
                LEFT JOIN (
                    SELECT cc.venta_id, SUM(cc.monto) AS total_pagado
                    FROM cuentas_cobrar cc
                    WHERE cc.negocio_id = ANY(v_negocios)
                    GROUP BY cc.venta_id
                ) pg ON pg.venta_id = v.id
                WHERE v.negocio_id = ANY(v_negocios)
                  AND v.metodo_pago = 'FIADO'
                  AND v.estado = 'COMPLETADA'
                  AND v.estado_pago IN ('PENDIENTE', 'PAGADO_PARCIAL')
                GROUP BY v.negocio_id
            )
            SELECT
                ng.id                                                        AS negocio_id,
                ng.nombre                                                    AS nombre,
                COALESCE(a.ventas, 0)::BIGINT                                 AS total_ventas,
                COALESCE(a.monto, 0)::NUMERIC(12,2)                           AS total_monto,
                COALESCE(a.clientes, 0)::BIGINT                              AS clientes_unicos,
                COALESCE(d.unidades, 0)::NUMERIC(12,2)                        AS unidades_vendidas,
                COALESCE(d.ganancia, 0)::NUMERIC(12,2)                        AS ganancia_bruta,
                CASE WHEN COALESCE(a.ventas, 0) > 0
                     THEN ROUND(COALESCE(a.monto, 0) / a.ventas, 2)
                     ELSE 0 END::NUMERIC(12,2)                               AS ticket_promedio,
                CASE WHEN v_total_grupo > 0
                     THEN ROUND((COALESCE(a.monto, 0) / v_total_grupo) * 100, 2)
                     ELSE 0 END::NUMERIC(5,2)                                AS participacion_pct,
                COALESCE(ant.monto, 0)::NUMERIC(12,2)                        AS total_monto_anterior,
                CASE WHEN COALESCE(ant.monto, 0) > 0
                     THEN ROUND(((COALESCE(a.monto, 0) - ant.monto) / ant.monto) * 100, 2)
                     ELSE NULL END::NUMERIC(6,2)                             AS variacion_pct,
                COALESCE(f.deuda, 0)::NUMERIC(12,2)                          AS deuda_fiado
            FROM negocios_grupo ng
            LEFT JOIN actual   a   ON a.negocio_id   = ng.id
            LEFT JOIN detalle  d   ON d.negocio_id   = ng.id
            LEFT JOIN anterior ant ON ant.negocio_id = ng.id
            LEFT JOIN fiado    f   ON f.negocio_id   = ng.id
        ) fila
    );

    -- Deuda fiado del grupo = suma de la deuda snapshot de cada negocio.
    -- Se recalcula directo (más simple que sumar el JSON) sobre la misma lógica.
    RETURN json_build_object(
        'fecha_inicio', p_fecha_inicio,
        'fecha_fin',    p_fecha_fin,
        'grupo', json_build_object(
            'total_negocios',        array_length(v_negocios, 1),
            'total_ventas',          v_actuales.total_ventas,
            'total_monto',           v_actuales.total_monto,
            'total_anuladas',        v_actuales.total_anuladas,
            'monto_anulado',         v_actuales.monto_anulado,
            'total_descuentos',      v_actuales.total_descuentos,
            'clientes_unicos',       v_actuales.clientes_unicos,
            'unidades_vendidas',     v_detalles_actuales.unidades_vendidas,
            'costo_total',           v_detalles_actuales.costo_total,
            'ganancia_bruta',        v_detalles_actuales.ganancia_bruta,
            'margen_pct',            v_margen_pct,
            'ticket_promedio',       v_ticket_promedio,
            'deuda_fiado',           COALESCE((
                SELECT SUM(v.total - COALESCE(pg.total_pagado, 0))
                FROM ventas v
                LEFT JOIN (
                    SELECT cc.venta_id, SUM(cc.monto) AS total_pagado
                    FROM cuentas_cobrar cc
                    WHERE cc.negocio_id = ANY(v_negocios)
                    GROUP BY cc.venta_id
                ) pg ON pg.venta_id = v.id
                WHERE v.negocio_id = ANY(v_negocios)
                  AND v.metodo_pago = 'FIADO'
                  AND v.estado = 'COMPLETADA'
                  AND v.estado_pago IN ('PENDIENTE', 'PAGADO_PARCIAL')
            ), 0),
            'total_monto_anterior',  v_anteriores.total_monto,
            'total_ventas_anterior', v_anteriores.total_ventas,
            'ganancia_anterior',     v_ganancia_anterior
        ),
        'negocios', v_negocios_json
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_grupo_dashboard(TEXT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_grupo_dashboard(TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMENT ON FUNCTION public.fn_grupo_dashboard IS
'v1.0 — Dashboard consolidado del grupo (plan MAX): KPIs + comparativa período
anterior y tabla por negocio (ventas, clientes, ticket, unidades,
ganancia, participación %, variación, deuda fiado snapshot). SECURITY DEFINER:
deriva la lista de negocios de propietario_usuario_id del JWT, nunca recibe
negocio_id. Deuda fiado = snapshot actual, no acotada al período.';
